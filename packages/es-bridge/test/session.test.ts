import { readFileSync } from "node:fs";
import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { parseMessage, serializeMessage, serializeReceipt, splitQuoted } from "@email-social/es-core";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import type { StartProgress } from "../src/api-types.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { MailSession } from "../src/session.js";
import { BOB_SUBJECTS, EXPECTED_CHATS, EXPECTED_OTHER } from "./helpers/demo-expected.js";
import { deliver, demoMaildir, folder, NOW, openSession } from "./helpers/session.js";

type Session = Awaited<ReturnType<typeof openSession>>;

async function chatNamed(session: Session, title: string) {
  const found = (await session.chats()).find((c) => c.title === title);
  if (found === undefined) throw new Error(`no chat ${title}`);
  return found;
}

describe("MailSession: chats with people", () => {
  it("lists the 7 chats newest first with their unread counts, and lists and newsletters under Other mail", async () => {
    const session = await openSession(await demoMaildir());
    expect((await session.chats()).map((c) => [c.title, c.unread])).toEqual(EXPECTED_CHATS.map((e) => [e.title, e.unread]));
    expect((await session.others()).map((o) => [o.title, o.kind, o.count, o.unread])).toEqual(
      EXPECTED_OTHER.map((e) => [e.title, e.kind, e.messages, e.unread]),
    );
    await session.close();
  });

  it("names the other participants, marks groups, and shows the first line of what the newest sender wrote", async () => {
    const session = await openSession(await demoMaildir());
    const list = await session.chats();
    const by = (title: string) => list.find((c) => c.title === title)!;
    expect(by("Karel Holub")).toMatchObject({ group: false, lastLine: "Vidím tě! 🚆", lastFromMe: false, emailSocial: true });
    expect(by("Bob Svoboda, Jana Nováková")).toMatchObject({ group: true, lastLine: "Stůl je zarezervovaný na jméno Svoboda.", emailSocial: false });
    expect(by("Bob Svoboda, Jana Nováková").participants.map((p) => p.address)).toEqual(["bob@example.org", "jana@example.net"]);
    expect(by("Anna Becker").lastLine).toBe("Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.");
    expect(by("Petr Novák")).toMatchObject({ lastFromMe: true, lastLine: "Děkuji, na shledanou." });
    await session.close();
  });

  it("shows one chat per person across subjects, with each message's base subject", async () => {
    const session = await openSession(await demoMaildir());
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    expect(bob.messages).toHaveLength(10);
    const runs = bob.messages.map((m) => m.subject).filter((subject, i, all) => i === 0 || all[i - 1] !== subject);
    expect(runs).toEqual(BOB_SUBJECTS);
    expect(bob.messages.map((m) => m.date)).toEqual([...bob.messages.map((m) => m.date)].sort());
    await session.close();
  });

  it("gives each bubble the fresh text, the quoted text and the signature separately", async () => {
    const session = await openSession(await demoMaildir());
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    const reply = bob.messages.find((m) => m.fresh.startsWith("Jedu!"))!;
    expect(reply.fresh).toBe("Jedu! Dřevo se hodí, já vezmu jídlo.\n\nBob");
    expect(reply.quoted.split("\n")[0]).toBe("On Sat, Mar 7, 2026 at 9:30 AM Alice Dvořáková <alice@example.com> wrote:");
    expect(reply.text).toContain(reply.quoted);
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    expect(anna.messages[2]!.quoted.split("\n")[0]).toBe("Von: Alice Dvořáková <alice@example.com> ");
    const group = (await session.chat((await chatNamed(session, "Bob Svoboda, Jana Nováková")).id))!;
    expect(group.messages[2]).toMatchObject({ fresh: "Jdu taky! 👍", signature: "Odesláno z iPhonu" });
    await session.close();
  });

  it("shows an HTML-only newsletter as text under Other mail, and lists attachments with download paths", async () => {
    const session = await openSession(await demoMaildir());
    const others = await session.others();
    const news = (await session.other(others.find((o) => o.title === "Garden Club")!.id))!;
    expect(news.messages[0]!.textSource).toBe("html");
    expect(news.messages[0]!.text).toContain("Pruning workshop & seed swap");
    const list = (await session.other(others.find((o) => o.kind === "list" && o.title.startsWith("dev-list"))!.id))!;
    expect(list.messages.filter((m) => m.mine)).toHaveLength(1);

    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    const withPdf = bob.messages.find((m) => m.attachments.some((a) => a.filename === "Návrh smlouvy.pdf"))!;
    const [attachment] = withPdf.attachments;
    expect(attachment).toMatchObject({ filename: "Návrh smlouvy.pdf", contentType: "application/pdf" });
    const part = await session.attachment(withPdf.key, attachment!.partId);
    expect(new TextDecoder().decode(part!.bytes).startsWith("%PDF-")).toBe(true);
    expect(parseMessage((await session.original(withPdf.key))!).subject).toBe("Návrh smlouvy");
    expect(await session.original("inbox:missing.eml")).toBeNull();
    await session.close();
  });

  it("marks a chat, or an Other mail sender, read in the mailbox", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    expect(await session.markRead((await chatNamed(session, "Anna Becker")).id)).toBe(true);
    expect((await chatNamed(session, "Anna Becker")).unread).toBe(0);
    const news = (await session.others()).find((o) => o.title === "Garden Club")!;
    expect(await session.markRead(news.id)).toBe(true);
    expect((await session.others()).find((o) => o.id === news.id)!.unread).toBe(0);
    expect(await session.markRead("chat-unknown")).toBe(false);
    await session.close();
    const again = await openSession(root);
    expect((await chatNamed(again, "Anna Becker")).unread).toBe(0);
    await again.close();
  });
});

const FOOTER = "Sent with Email Social. Reply as you normally would; this is an ordinary e-mail.";

/** A plain message from someone else, as an ordinary client writes it. */
function plainMail(init: { from: { name: string; address: string }; subject: string; text: string; date: string; id: string; inReplyTo?: string }): string {
  return serializeMessage(
    { from: init.from, to: [DEMO_ACCOUNT], subject: init.subject, text: init.text, ...(init.inReplyTo === undefined ? {} : { inReplyTo: { messageId: init.inReplyTo } }) },
    { date: init.date, messageId: init.id, includeEsPart: false },
  );
}

/** The copy of a sent message in the Sent folder whose text starts with `start`. */
function sentCopy(root: string, start: string) {
  const copy = folder(root, "Sent").find((m) => m.message.text.startsWith(start));
  if (copy === undefined) throw new Error(`nothing sent starting with ${start}`);
  return copy;
}

const BOB = { name: "Bob Svoboda", address: "bob@example.org" };

describe("MailSession: topics and quote cards in the chat view", () => {
  it("places every message of a chat in a topic, marks where runs start, and lists the topics with counts", async () => {
    const session = await openSession(await demoMaildir());
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    expect(bob.topics.map((t) => [t.base, t.kind, t.count])).toEqual([
      ["Faktura za únor", "plain", 2],
      ["Víkend na chatě", "plain", 2],
      ["Návrh smlouvy", "plain", 5],
      ["Kolo na prodej", "plain", 1],
    ]);
    expect(bob.topics.map((t) => t.base)).toEqual(BOB_SUBJECTS);
    expect(bob.messages.filter((m) => m.topicStart).map((m) => m.topic!.rootId)).toEqual(bob.topics.map((t) => t.rootId));
    expect(bob.messages.every((m) => m.topic !== null && m.subjectNote === null && !m.interleaved)).toBe(true);
    // The composer continues the topic of the account's own newest message.
    expect(bob.composerTopic).toBe(bob.topics[2]!.rootId);
    const karel = (await session.chat((await chatNamed(session, "Karel Holub")).id))!;
    expect(karel.topics).toEqual([{ rootId: karel.messages[0]!.id, label: null, base: "Kdy dorazíš?", kind: "carrier", count: 8 }]);
    await session.close();
  });

  it("draws cards only above deliberate replies: the account's own quoted replies, never another client's whole-message quote", async () => {
    const session = await openSession(await demoMaildir());
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    expect(bob.messages.map((m) => (m.replyCard === null ? "-" : m.mine ? "own" : "theirs"))).toEqual(["-", "own", "-", "-", "-", "own", "-", "own", "-", "-"]);
    expect(bob.messages[1]!.replyCard).toEqual({
      messageId: bob.messages[0]!.id,
      from: "Bob Svoboda",
      fromMe: false,
      excerpt: "Ahoj Alice, posílám fakturu za únor, splatná je do konce března. Bob",
      attachment: "Faktura 2026-02.pdf",
      clickable: true,
    });
    const karel = (await session.chat((await chatNamed(session, "Karel Holub")).id))!;
    expect(karel.messages.every((m) => m.replyCard === null)).toBe(true);
    await session.close();
  });

  it("gives a reply whose parent is not in the mailbox no card, and a note for its different subject", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    deliver(root, "gmail-web-de.eml", readFileSync(new URL("../../es-core/fixtures/replies/gmail-web-de.eml", import.meta.url)));
    await session.sync();
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    const reply = anna.messages.find((m) => m.fresh.includes("zwei Zahlen"))!;
    expect(reply).toMatchObject({ replyCard: null, subjectNote: "Projektübersicht", topicStart: false });
    expect(reply.topic!.rootId).toBe(anna.messages[0]!.id);
    expect(anna.topics).toHaveLength(1);
    await session.close();
  });

  it("shows messages outside chats without topics, cards or notes", async () => {
    const session = await openSession(await demoMaildir());
    const list = (await session.other((await session.others()).find((o) => o.kind === "list" && o.title.startsWith("dev-list"))!.id))!;
    expect(list.messages.every((m) => m.topic === null && !m.topicStart && m.replyCard === null && m.subjectNote === null && !m.interleaved)).toBe(true);
    await session.close();
  });
});

describe("MailSession: sending into a topic", () => {
  it("continues the bound topic: answers its newest message, Subject 'Re: <root base>', no quote, the footer after '-- '", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    const { chatId, message } = await session.send({ chatId: anna.chat.id, text: "Danke!" });
    expect(chatId).toBe(anna.chat.id);
    expect(message).toMatchObject({ mine: true, fresh: "Danke!", quoted: "", replyCard: null, topicStart: false, emailSocial: false, status: "sent" });
    expect(message.topic).toEqual({ rootId: anna.messages[0]!.id, label: null, kind: "plain" });
    const sent = sentCopy(root, "Danke!");
    expect(sent.message.subject).toBe("Re: Projektübersicht Q2");
    expect(sent.message.refs.inReplyTo).toEqual([anna.messages[anna.messages.length - 1]!.id]);
    expect(sent.message.text).toBe(`Danke!\n\n-- \n${FOOTER}`);
    expect(splitQuoted(sent.message)).toEqual({ fresh: "Danke!", quoted: "", signature: `-- \n${FOOTER}` });
    expect(sent.message.es).toBeNull();
    await session.close();
  });

  it("answers a deliberate reply's target, binds to its topic and quotes at most 5 lines with the attribution", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const bobChat = await chatNamed(session, "Bob Svoboda");
    const before = (await session.chat(bobChat.id))!;
    const invoice = before.messages[0]!;
    const { message } = await session.send({ chatId: bobChat.id, replyTo: invoice.id, text: "Zaplaceno." });
    expect(message.topic!.rootId).toBe(invoice.id);
    expect(message.replyCard).toEqual({ messageId: invoice.id, from: "Bob Svoboda", fromMe: false, excerpt: "Ahoj Alice, posílám fakturu za únor, splatná je do konce března. Bob", attachment: "Faktura 2026-02.pdf", clickable: true });
    const sent = sentCopy(root, "Zaplaceno.");
    expect(sent.message.subject).toBe("Re: Faktura za únor");
    expect(sent.message.refs.inReplyTo).toEqual([invoice.id]);
    expect(sent.message.text).toBe(
      "Zaplaceno.\n\nOn Wed, 4 Mar 2026 at 10:10, Bob Svoboda <bob@example.org> wrote:\n> Ahoj Alice,\n>\n> posílám fakturu za únor, splatná je do konce března.\n>\n> Bob\n\n-- \n" + FOOTER,
    );
    // The Sent copy read back: quoted-printable because of "-- " (RFC 2045 §6.7 rule 3), the parts where they belong.
    const raw = new TextDecoder().decode(sent.raw);
    expect(raw).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(raw).toContain("--=20");
    const split = splitQuoted(sent.message);
    expect(split.fresh).toBe("Zaplaceno.");
    expect(split.quoted.split("\n")[0]).toBe("On Wed, 4 Mar 2026 at 10:10, Bob Svoboda <bob@example.org> wrote:");
    expect(split.signature).toBe(`-- \n${FOOTER}`);
    expect((await simpleParser(Buffer.from(sent.raw))).text).toContain("> posílám fakturu za únor");
    // The composer follows what was sent.
    expect((await session.chat(bobChat.id))!.composerTopic).toBe(invoice.id);

    deliver(root, "long.eml", plainMail({ from: BOB, subject: "Re: Návrh smlouvy", date: "2026-03-20T09:00:00Z", id: "<long-1@example.org>", inReplyTo: before.messages[8]!.id, text: Array.from({ length: 9 }, (_, i) => `Bod ${i + 1}.`).join("\n") }));
    await session.sync();
    await session.send({ chatId: bobChat.id, replyTo: "<long-1@example.org>", text: "K bodu 3: souhlas." });
    const quoted = splitQuoted(sentCopy(root, "K bodu 3").message).quoted.split("\n");
    expect(quoted.slice(1)).toEqual(["> Bod 1.", "> Bod 2.", "> Bod 3.", "> Bod 4.", "> Bod 5.", "> [...]"]);
    expect(sentCopy(root, "K bodu 3").message.subject).toBe("Re: Návrh smlouvy");
    await session.close();
  });

  it("refuses a reply target from another chat and a topic that is not in the chat", async () => {
    const session = await openSession(await demoMaildir());
    const bob = await chatNamed(session, "Bob Svoboda");
    const karel = (await session.chat((await chatNamed(session, "Karel Holub")).id))!;
    await expect(session.send({ chatId: bob.id, replyTo: karel.messages[0]!.id, text: "x" })).rejects.toThrow(RangeError);
    await expect(session.send({ chatId: bob.id, topic: { root: karel.messages[0]!.id }, text: "x" })).rejects.toThrow(RangeError);
    await session.close();
  });

  it("starts a named topic: a new root with Subject = the name and topicRoot/topicLabel in the ES part; the same name again continues it", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const karel = await chatNamed(session, "Karel Holub");
    const first = await session.send({ chatId: karel.id, topic: { label: "  Výlet na  Sněžku " }, text: "Pojedeme v létě?" });
    const rootCopy = folder(root, "Sent").find((m) => m.message.text === "Pojedeme v létě?")!;
    expect(rootCopy.message.subject).toBe("Výlet na Sněžku");
    expect(rootCopy.message.refs).toEqual({ messageId: rootCopy.message.id, inReplyTo: [], references: [] });
    expect(rootCopy.message.es).toMatchObject({ $type: "es.social.post", email: { topicRoot: rootCopy.message.id, topicLabel: "Výlet na Sněžku", replyTo: null } });
    expect(first.message).toMatchObject({ topicStart: true, topic: { rootId: rootCopy.message.id, label: "Výlet na Sněžku", kind: "named" } });
    let chat = (await session.chat(karel.id))!;
    expect(chat.topics.map((t) => [t.label, t.base, t.kind, t.count])).toEqual([
      [null, "Kdy dorazíš?", "carrier", 8],
      ["Výlet na Sněžku", "Výlet na Sněžku", "named", 1],
    ]);
    expect(chat.composerTopic).toBe(rootCopy.message.id);

    await session.send({ chatId: karel.id, topic: { label: "výlet na sněžku" }, text: "Třeba v červenci." });
    const again = folder(root, "Sent").find((m) => m.message.text === "Třeba v červenci.")!;
    expect(again.message.subject).toBe("Re: Výlet na Sněžku");
    expect(again.message.refs.inReplyTo).toEqual([rootCopy.message.id]);
    expect(again.message.es).toMatchObject({ email: { topicRoot: rootCopy.message.id, topicLabel: "Výlet na Sněžku" } });
    chat = (await session.chat(karel.id))!;
    expect(chat.topics).toHaveLength(2);
    expect(chat.topics[1]!.count).toBe(2);
    await session.close();
  });

  it("re-enters a plain topic whose base subject equals a new name instead of starting a second root", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    await session.send({ chatId: bob.chat.id, topic: { label: "kolo na prodej" }, text: "Kolik za něj chceš?" });
    const sent = sentCopy(root, "Kolik za něj chceš?");
    expect(sent.message.subject).toBe("Re: Kolo na prodej");
    expect(sent.message.refs.inReplyTo).toEqual([bob.messages[9]!.id]);
    expect((await session.chat(bob.chat.id))!.topics).toHaveLength(4);
    await session.close();
  });

  it("with an Email Social recipient, a deliberate reply carries email.replyTo and neither a quote nor the footer", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const karel = (await session.chat((await chatNamed(session, "Karel Holub")).id))!;
    const target = karel.messages.find((m) => m.fresh === "Super, vyzvednu tě na nádraží.")!;
    const { message } = await session.send({ chatId: karel.chat.id, replyTo: target.id, text: "Díky, budu u kiosku." });
    expect(message).toMatchObject({ emailSocial: true, text: "Díky, budu u kiosku." });
    expect(message.replyCard).toEqual({ messageId: target.id, from: "Karel Holub", fromMe: false, excerpt: "Super, vyzvednu tě na nádraží.", attachment: null, clickable: true });
    const sent = folder(root, "Sent").find((m) => m.message.text === "Díky, budu u kiosku.")!;
    expect(sent.message.refs.inReplyTo).toEqual([target.id]);
    expect(sent.message.subject).toBe("Re: Kdy dorazíš?");
    expect(sent.message.es).toMatchObject({
      requestReceipts: ["delivered", "read"],
      email: { topicRoot: karel.messages[0]!.id, topicLabel: null, replyTo: { messageId: target.id, from: { name: "Karel Holub", address: "karel@example.org" }, excerpt: "Super, vyzvednu tě na nádraží." } },
    });
    // A continuation in the same chat: no replyTo, no card.
    const next = await session.send({ chatId: karel.chat.id, text: "Už jsem tady." });
    expect(next.message.replyCard).toBeNull();
    expect(folder(root, "Sent").find((m) => m.message.text === "Už jsem tady.")!.message.es).toMatchObject({ email: { replyTo: null, topicRoot: karel.messages[0]!.id } });
    await session.close();
  });

  it("puts the footer as the last line of a signature the user typed, never under a second '-- '", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    await session.send({ chatId: anna.chat.id, text: "Danke!\n\n-- \nAlice\n" });
    const plain = sentCopy(root, "Danke!");
    expect(plain.message.text).toBe(`Danke!\n\n-- \nAlice\n${FOOTER}`);
    await session.send({ chatId: anna.chat.id, replyTo: anna.messages[3]!.id, text: "Ja, schon gesehen.\n-- \nAlice" });
    const reply = sentCopy(root, "Ja, schon gesehen.");
    expect(reply.message.text.split("\n").filter((line) => line === "-- ")).toHaveLength(1);
    expect(reply.message.text).toMatch(new RegExp(`^Ja, schon gesehen\\.\\n\\nOn Fri, 6 Mar 2026 at 14:02, Anna Becker <anna.becker@example.net> wrote:\\n> [^]*\\n\\n-- \\nAlice\\n${FOOTER.replace(/[.;]/g, "\\$&")}$`));
    expect(splitQuoted(reply.message)).toMatchObject({ fresh: "Ja, schon gesehen.", signature: `-- \nAlice\n${FOOTER}` });
    await session.close();
  });

  it("starts a carrier root in a chat whose topic has no subject (a '(no subject)' mail)", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    deliver(root, "nosubject.eml", plainMail({ from: { name: "Zuzana Malá", address: "zuzana@example.net" }, subject: "", text: "Ahoj, tady Zuzana.", date: "2026-03-20T08:00:00Z", id: "<nosubj-1@example.net>" }));
    await session.sync();
    const chat = await chatNamed(session, "Zuzana Malá");
    const { message } = await session.send({ chatId: chat.id, text: "Ahoj Zuzano!" });
    const sent = sentCopy(root, "Ahoj Zuzano!");
    expect(sent.message.subject).toBe("Message from Alice Dvořáková");
    expect(sent.message.refs.inReplyTo).toEqual([]);
    expect(message).toMatchObject({ topicStart: true, topic: { rootId: sent.message.id, kind: "carrier" } });
    const view = (await session.chat(chat.id))!;
    expect(view.topics.map((t) => [t.base, t.kind])).toEqual([["", "plain"], ["Message from Alice Dvořáková", "carrier"]]);
    // The next message continues the carrier topic byte for byte.
    await session.send({ chatId: chat.id, text: "Jak se máš?" });
    expect(sentCopy(root, "Jak se máš?").message.subject).toBe("Re: Message from Alice Dvořáková");
    await session.close();
  });

  it("keeps the composer on the topic the account last wrote in when mail arrives in another topic", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    const { message } = await session.send({ chatId: bob.chat.id, topic: { label: "Výlet" }, text: "Pojedeš v sobotu na výlet?" });
    expect((await session.chat(bob.chat.id))!.composerTopic).toBe(message.topic!.rootId);
    deliver(root, "later.eml", plainMail({ from: BOB, subject: "Re: Faktura za únor", text: "Platba dorazila, díky.", date: "2026-03-21T11:00:00Z", id: "<later-1@example.org>", inReplyTo: bob.messages[0]!.id }));
    await session.sync();
    const after = (await session.chat(bob.chat.id))!;
    expect(after.messages.find((m) => m.fresh === "Platba dorazila, díky.")!.topic!.rootId).toBe(bob.messages[0]!.id);
    expect(after.composerTopic).toBe(message.topic!.rootId);
    expect(sentCopy(root, "Pojedeš v sobotu").message.subject).toBe("Výlet");
    await session.close();
  });
});

describe("MailSession: new chats and groups", () => {
  it("replies to everyone else in a group as plain e-mail with the footer", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const group = await chatNamed(session, "Bob Svoboda, Jana Nováková");
    const sentBefore = folder(root, "Sent").length;
    const { chatId, message } = await session.send({ chatId: group.id, text: "Tak zítra!" });
    expect(chatId).toBe(group.id);
    expect(message).toMatchObject({ mine: true, fresh: "Tak zítra!", status: "sent", emailSocial: false, replyCard: null });
    const sent = folder(root, "Sent");
    expect(sent).toHaveLength(sentBefore + 1);
    const reply = sentCopy(root, "Tak zítra!");
    expect(reply.message.to.map((t) => t.address).sort()).toEqual(["bob@example.org", "jana@example.net"]);
    expect(reply.message.es).toBeNull();
    expect(reply.message.subject).toBe("Re: Oběd v pátek");
    expect(reply.message.text).toBe(`Tak zítra!\n\n-- \n${FOOTER}`);
    expect(folder(root, "Outbox").some((m) => m.message.text.startsWith("Tak zítra!"))).toBe(true);
    expect((await session.chats())[0]).toMatchObject({ id: group.id, lastFromMe: true, lastLine: "Tak zítra!" });
    expect((await simpleParser(Buffer.from(reply.raw))).text).toContain(FOOTER);
    await session.close();
  });

  it("starts a new chat: text/plain first, the carrier subject, and the chat appears", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const text = "Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z vrcholu Sněžky.\n\nAlice";
    const { chatId, message } = await session.send({ to: ["zuzana@example.net"], text });
    expect(message.subject).toBe("Message from Alice Dvořáková");
    expect(message.replyCard).toBeNull();
    const sent = sentCopy(root, "Ahoj Zuzano");
    expect(sent.message.subject).toBe("Message from Alice Dvořáková");
    expect(sent.message.refs.inReplyTo).toEqual([]);
    expect(sent.message.es).toBeNull();
    expect(sent.message.text).toBe(`${text}\n\n-- \n${FOOTER}`);
    const mail = await simpleParser(Buffer.from(sent.raw));
    expect(mail.text).toBe(`${text}\n\n-- \n${FOOTER}`);
    expect(new TextDecoder().decode(sent.raw)).toMatch(/Content-Type: text\/plain/);
    const chats = await session.chats();
    expect(chats[0]).toMatchObject({ id: chatId, title: "zuzana@example.net", lastFromMe: true, lastLine: "Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z vrcholu Sněžky." });
    await session.close();
  });

  it("starts a group with a carrier subject naming everyone, or a named topic, with the ES part for Email Social users", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const { chatId } = await session.send({ to: ["karel@example.org", "bob@example.org"], text: "Kdo jede?" });
    const sent = folder(root, "Sent").find((m) => m.message.text === "Kdo jede?")!;
    expect(sent.message.subject).toBe("Message from Alice Dvořáková to Bob Svoboda, Karel Holub");
    expect(sent.message.to.map((a) => a.address)).toEqual(["karel@example.org", "bob@example.org"]);
    expect(sent.message.es).toMatchObject({ $type: "es.social.post", email: { topicRoot: sent.message.id, topicLabel: null } });
    const chat = (await session.chats()).find((c) => c.id === chatId)!;
    expect(chat).toMatchObject({ group: true, title: "Bob Svoboda, Karel Holub" });
    const named = await session.send({ to: ["eva@example.net", "zuzana@example.net"], topic: { label: "Sobota" }, text: "Jedete?" });
    expect(folder(root, "Sent").find((m) => m.message.text.startsWith("Jedete?"))!.message.subject).toBe("Sobota");
    expect(named.message.topic).toMatchObject({ kind: "plain" });
    // Writing to Bob alone again lands in the existing chat with him and continues its topic.
    const bob = await chatNamed(session, "Bob Svoboda");
    expect((await session.send({ to: ["bob@example.org"], text: "Nové téma" })).chatId).toBe(bob.id);
    expect(sentCopy(root, "Nové téma").message.subject).toBe("Re: Návrh smlouvy");
    await session.close();
  });

  it("refuses an empty message, no recipients, an invalid address, an unknown chat and a reply target in a new chat", async () => {
    const session = await openSession(await demoMaildir());
    await expect(session.send({ chatId: (await session.chats())[0]!.id, text: "   " })).rejects.toThrow(/empty/);
    await expect(session.send({ to: [], text: "x" })).rejects.toThrow(/recipient/);
    await expect(session.send({ to: ["not an address"], text: "x" })).rejects.toThrow(/Not an e-mail address/);
    await expect(session.send({ chatId: "chat-unknown", text: "x" })).rejects.toThrow(/No such chat/);
    await expect(session.send({ to: ["bob@example.org"], replyTo: "<x@example.org>", text: "x" })).rejects.toThrow(RangeError);
    expect(await session.chat("chat-unknown")).toBeNull();
    await session.close();
  });
});

describe("MailSession: receipts, contacts, loading", () => {
  it("shows receipts as the status of the account's own message, not as messages", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const karel = await chatNamed(session, "Karel Holub");
    const chat = (await session.chat(karel.id))!;
    const mine = chat.messages.filter((m) => m.mine);
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
    const after = (await session.chat(karel.id))!;
    expect(after.messages).toHaveLength(8);
    expect(after.messages.filter((m) => m.mine).map((m) => m.status)).toEqual(["sent", "read"]);
    expect((await session.chats()).find((c) => c.id === karel.id)!.unread).toBe(3);
    expect(await session.chats()).toHaveLength(7);
    expect(await session.others()).toHaveLength(2);
    await session.close();
  });

  it("derives contacts without the account itself, and a contact page with dates, count, attachments and groups", async () => {
    const session = await openSession(await demoMaildir());
    const contacts = session.contacts();
    expect(contacts.some((c) => c.address === DEMO_ACCOUNT.address)).toBe(false);
    expect(contacts.find((c) => c.address === "karel@example.org")).toMatchObject({ name: "Karel Holub", emailSocial: true });
    const bob = session.contact("bob@example.org")!;
    expect(bob).toMatchObject({
      address: "bob@example.org",
      name: "Bob Svoboda",
      names: ["Bob Svoboda"],
      firstDate: "2026-03-02T08:15:42.000Z",
      lastDate: "2026-03-17T18:20:00.000Z",
      count: 15,
      emailSocial: false,
      chatId: (await chatNamed(session, "Bob Svoboda")).id,
    });
    expect(bob.attachments.map((a) => [a.filename, a.date, a.fromMe])).toEqual([
      ["Návrh smlouvy v2.pdf", "2026-03-16T08:00:00.000Z", false],
      ["Návrh smlouvy.pdf", "2026-03-10T12:22:03.000Z", false],
      ["Faktura 2026-02.pdf", "2026-03-04T09:10:00.000Z", false],
    ]);
    expect(bob.attachments[0]!.path).toMatch(/^\/api\/messages\/inbox%3AI5-gmail\.eml\/attachments\/2$/);
    expect(bob.groups.map((g) => g.title)).toEqual(["Bob Svoboda, Jana Nováková"]);
    expect(session.contact("nobody@example.net")).toBeNull();
    expect(session.contact(DEMO_ACCOUNT.address)).toBeNull();
    await session.close();
  });

  it("shows the chats after the newest messages and loads the rest in the background with a count", async () => {
    const root = await demoMaildir();
    const progress: StartProgress[] = [];
    let statusCalls = 0;
    const session = await openSession(root, { firstBatch: 10, onProgress: (p) => progress.push(p), onStatus: () => statusCalls++ });
    expect(progress[0]).toEqual({ step: "connecting", loaded: 0, total: null });
    expect(progress.map((p) => p.step)).toContain("listing");
    const loading = progress.filter((p) => p.step === "loading");
    expect(loading.map((p) => p.loaded)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(loading.every((p) => p.total === 45)).toBe(true);
    // The newest messages came first: Karel's latest is among the first ten.
    await session.sync();
    expect(session.status()).toEqual({ loading: null, connection: "online", error: null });
    expect(statusCalls).toBeGreaterThan(0);
    expect(await session.chats()).toHaveLength(7);
    await session.close();
  });

  it("fails to start when the mailbox stops answering, instead of waiting forever", async () => {
    const adapter = new MaildirAdapter(await demoMaildir(), { pollMs: 60_000 });
    adapter.listSince = () => new Promise(() => undefined);
    const started = Date.now();
    await expect(
      MailSession.start({ adapter, account: { address: DEMO_ACCOUNT.address, name: DEMO_ACCOUNT.name }, mode: "maildir", stallMs: 300, clock: () => NOW }),
    ).rejects.toThrow(/No answer from the mail server/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reports a background load that stops, and loads the rest on Try again", async () => {
    const adapter = new MaildirAdapter(await demoMaildir(), { pollMs: 60_000 });
    const fetchMany = adapter.fetchMany.bind(adapter);
    let hang = false;
    let drop: ((e: Error) => void) | null = null;
    // Like IMAP: a download that gets no answer fails once the connection is dropped.
    adapter.fetchMany = (refs, each) =>
      hang
        ? new Promise((_, reject) => {
            drop = reject;
          })
        : fetchMany(refs, each);
    adapter.reconnect = () => drop?.(new Error("connection dropped"));
    const session = await MailSession.start({
      adapter,
      account: { address: DEMO_ACCOUNT.address, name: DEMO_ACCOUNT.name },
      mode: "maildir",
      stallMs: 300,
      firstBatch: 5,
      clock: () => NOW,
      onProgress: (p) => {
        if (p.loaded === 5) hang = true;
      },
    });
    for (let i = 0; i < 100 && session.status().error === null; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.status()).toEqual({
      loading: { loaded: 5, total: 45 },
      connection: "online",
      error: "Loading stopped: no answer from the mail server for 0 seconds.",
    });
    hang = false;
    await session.retry();
    expect(session.status()).toEqual({ loading: null, connection: "online", error: null });
    const chats = await session.chats();
    expect(chats.reduce((n, c) => n + c.unread, 0)).toBe(EXPECTED_CHATS.reduce((n, c) => n + c.unread, 0));
    await session.close();
  });
});

describe("MailSession: plain replies from Email Social are readable in any client", () => {
  it("writes the reply text first, the quote of a deliberate reply below it and the footer last, as text/plain only", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    await session.send({ chatId: anna.chat.id, replyTo: anna.messages[4]!.id, text: "Danke, Anna!" });
    const sent = sentCopy(root, "Danke, Anna!");
    expect(sent.message.attachments).toEqual([]);
    expect(sent.message.text.split("\n")[2]).toBe("On Fri, 6 Mar 2026 at 14:30, Anna Becker <anna.becker@example.net> wrote:");
    expect(sent.message.text).toContain("> Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.");
    expect(sent.message.text).not.toContain("Von:");
    expect(sent.message.text.endsWith(`\n\n-- \n${FOOTER}`)).toBe(true);
    // Compare with what es-core writes for the same text: nothing is added besides the quote and the footer.
    const plain = serializeMessage({ from: DEMO_ACCOUNT, to: [{ name: "", address: "x@example.net" }], subject: "s", text: sent.message.text }, { date: NOW, messageId: "<x@example.com>", includeEsPart: false });
    expect(parseMessage(plain).text).toBe(sent.message.text);
    await session.close();
  });
});
