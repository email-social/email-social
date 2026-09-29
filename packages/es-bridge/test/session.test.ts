import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { parseMessage, serializeReceipt, threadMessages } from "@email-social/es-core";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { EXPECTED } from "./helpers/demo-expected.js";
import { deliver, demoMaildir, folder, openSession } from "./helpers/session.js";

async function conversationBySubject(session: Awaited<ReturnType<typeof openSession>>, subject: string) {
  const found = (await session.conversations()).find((c) => c.subject === subject);
  if (found === undefined) throw new Error(`no conversation ${subject}`);
  return found;
}

describe("MailSession over the demo mailbox", () => {
  it("lists the 9 conversations newest first with their unread counts", async () => {
    const session = await openSession(await demoMaildir());
    const list = await session.conversations();
    expect(list.map((c) => [c.subject, c.unread])).toEqual(EXPECTED.map((e) => [e.subject, e.unread]));
    await session.close();
  });

  it("names the other participants, marks groups, and shows the first new line of the newest message", async () => {
    const session = await openSession(await demoMaildir());
    const list = await session.conversations();
    const by = (subject: string) => list.find((c) => c.subject === subject)!;
    expect(by("Kdy dorazíš?")).toMatchObject({ title: "Karel Holub", group: false, lastLine: "Vidím tě! 🚆", lastFromMe: false });
    expect(by("Oběd v pátek")).toMatchObject({ title: "Bob Svoboda, Jana Nováková", group: true });
    expect(by("Oběd v pátek").participants.map((p) => p.address)).toEqual(["bob@example.org", "jana@example.net"]);
    expect(by("Release plan").group).toBe(true);
    expect(by("March news from the garden club").lastLine).toBe("March news");
    expect(by("Vyúčtování za březen")).toMatchObject({ lastFromMe: true, lastLine: "Děkuji, na shledanou." });
    await session.close();
  });

  it("shows a thread as bubbles in order, with the account's own messages marked as mine", async () => {
    const session = await openSession(await demoMaildir());
    const thread = (await session.thread((await conversationBySubject(session, "Kdy dorazíš?")).id))!;
    expect(thread.messages.map((m) => [m.mine, m.text])).toEqual([
      [false, "Ahoj Alice, kdy dorazíš v sobotu?"],
      [true, "Kolem desáté, vlakem."],
      [false, "Super, vyzvednu tě na nádraží."],
      [true, "Mám vzít něco s sebou?"],
      [false, "Jen dobrou náladu."],
      [false, "Vlak má zpoždění?"],
      [false, "Tak já čekám u vchodu."],
      [false, "Vidím tě! 🚆"],
    ]);
    expect(thread.messages.every((m) => m.emailSocial)).toBe(true);
    expect(thread.messages.filter((m) => m.mine).map((m) => m.status)).toEqual(["sent", "sent"]);
    expect(thread.messages[0]!.from).toEqual({ name: "Karel Holub", address: "karel@example.org" });
    await session.close();
  });

  it("shows an HTML-only message as text and lists attachments with download paths", async () => {
    const session = await openSession(await demoMaildir());
    const news = (await session.thread((await conversationBySubject(session, "March news from the garden club")).id))!;
    expect(news.messages[0]!.textSource).toBe("html");
    expect(news.messages[0]!.text).toContain("Pruning workshop & seed swap");

    const contract = (await session.thread((await conversationBySubject(session, "Návrh smlouvy")).id))!;
    const [attachment] = contract.messages[0]!.attachments;
    expect(attachment).toMatchObject({ filename: "Návrh smlouvy.pdf", contentType: "application/pdf" });
    const part = await session.attachment(contract.messages[0]!.key, attachment!.partId);
    expect(new TextDecoder().decode(part!.bytes).startsWith("%PDF-")).toBe(true);
    const original = await session.original(contract.messages[0]!.key);
    expect(parseMessage(original!).subject).toBe("Návrh smlouvy");
    expect(await session.original("inbox:missing.eml")).toBeNull();
    await session.close();
  });

  it("marks a conversation read in the mailbox", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const b = await conversationBySubject(session, "Projektübersicht Q2");
    await session.markRead(b.id);
    expect((await conversationBySubject(session, "Projektübersicht Q2")).unread).toBe(0);
    await session.close();
    const again = await openSession(root);
    expect((await conversationBySubject(again, "Projektübersicht Q2")).unread).toBe(0);
    await again.close();
  });

  it("replies to everyone else in a group as plain e-mail when none of them has used Email Social", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const a = await conversationBySubject(session, "Oběd v pátek");
    const sentBefore = folder(root, "Sent").length;
    await session.send(a.id, "Tak zítra!");
    const sent = folder(root, "Sent");
    expect(sent).toHaveLength(sentBefore + 1);
    const reply = sent.find((m) => m.message.text === "Tak zítra!")!;
    expect(reply.message.to.map((t) => t.address).sort()).toEqual(["bob@example.org", "jana@example.net"]);
    expect(reply.message.es).toBeNull();
    expect(reply.message.attachments).toEqual([]);
    expect(reply.message.subject).toBe("Re: Oběd v pátek");
    expect(folder(root, "Outbox").some((m) => m.message.text === "Tak zítra!")).toBe(true);

    const all = [...folder(root, "INBOX"), ...folder(root, "Sent")].map((m) => m.message);
    const conversations = threadMessages(all);
    expect(conversations).toHaveLength(9);
    expect(conversations.find((c) => c.messageIds.includes(reply.message.id))!.id).toBe(a.id);
    expect((await session.conversations())[0]).toMatchObject({ id: a.id, lastFromMe: true, lastLine: "Tak zítra!" });
    expect((await simpleParser(Buffer.from(reply.raw))).text).toBe("Tak zítra!");
    await session.close();
  });

  it("replies with the ES part and asks for receipts when the other side uses Email Social", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const d = await conversationBySubject(session, "Kdy dorazíš?");
    const view = await session.send(d.id, "Už jsem tady.");
    expect(view).toMatchObject({ mine: true, text: "Už jsem tady.", status: "sent", emailSocial: true });
    const reply = folder(root, "Sent").find((m) => m.message.text === "Už jsem tady.")!;
    expect(reply.message.es).toMatchObject({ $type: "es.social.post", requestReceipts: ["delivered", "read"] });
    expect(reply.message.to).toEqual([{ name: "Karel Holub", address: "karel@example.org" }]);
    await session.close();
  });

  it("shows receipts as the status of the account's own message, not as messages", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const d = await conversationBySubject(session, "Kdy dorazíš?");
    const thread = (await session.thread(d.id))!;
    const mine = thread.messages.filter((m) => m.mine);
    const original = parseMessage((await session.original(mine[1]!.key))!);
    for (const [i, kind] of (["delivered", "read"] as const).entries()) {
      deliver(
        root,
        `receipt-${kind}.eml`,
        serializeReceipt(
          { kind, from: { name: "Karel Holub", address: "karel@example.org" }, to: DEMO_ACCOUNT, original: { messageId: original.id, subject: original.subject } },
          { date: `2026-03-20T18:0${i}:00Z`, messageId: `<rcpt-${kind}@example.org>` },
        ),
      );
    }
    await session.sync();
    const after = (await session.thread(d.id))!;
    expect(after.messages).toHaveLength(8);
    expect(after.messages.filter((m) => m.mine).map((m) => m.status)).toEqual(["sent", "read"]);
    expect((await session.conversations()).find((c) => c.id === d.id)!.unread).toBe(3);
    expect(await session.conversations()).toHaveLength(9);
    await session.close();
  });

  it("derives contacts without the account itself and knows who uses Email Social", async () => {
    const session = await openSession(await demoMaildir());
    const contacts = session.contacts();
    expect(contacts.some((c) => c.address === DEMO_ACCOUNT.address)).toBe(false);
    expect(contacts.find((c) => c.address === "karel@example.org")).toMatchObject({ name: "Karel Holub", emailSocial: true });
    expect(contacts.find((c) => c.address === "bob@example.org")).toMatchObject({ emailSocial: false });
    await session.close();
  });

  it("returns null for an unknown conversation and refuses to send into one", async () => {
    const session = await openSession(await demoMaildir());
    expect(await session.thread("conv-unknown")).toBeNull();
    await expect(session.send("conv-unknown", "x")).rejects.toThrow();
    await expect(session.send((await session.conversations())[0]!.id, "   ")).rejects.toThrow();
    await session.close();
  });
});
