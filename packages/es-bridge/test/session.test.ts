import { readFileSync } from "node:fs";
import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { parseMessage, serializeMessage, serializeReceipt, splitQuoted } from "@email-social/es-core";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import type { StartProgress } from "../src/api-types.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { MailSession, subjectFromText } from "../src/session.js";
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

  it("shows one chat per person across subjects, with each message's base subject for the separators", async () => {
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

describe("MailSession: quote cards", () => {
  it("gives every message its card: the answered message (also from another folder), or the subject where one starts", async () => {
    const session = await openSession(await demoMaildir());
    const bob = (await session.chat((await chatNamed(session, "Bob Svoboda")).id))!;
    const cards = bob.messages.map((m) => m.replyContext);
    expect(cards.filter((c) => c?.kind === "subject").map((c) => c?.kind === "subject" && c.subject)).toEqual(BOB_SUBJECTS);
    expect(cards[0]).toEqual({ kind: "subject", subject: "Faktura za únor" });
    expect(cards[1]).toEqual({
      kind: "parent",
      messageId: bob.messages[0]!.id,
      from: "Bob Svoboda",
      fromMe: false,
      excerpt: "Ahoj Alice, posílám fakturu za únor, splatná je do konce března.",
      attachment: "Faktura 2026-02.pdf",
    });
    // Bob's answer to Alice's message from the sent folder.
    const k2 = bob.messages.find((m) => m.fresh.startsWith("Jedu!"))!;
    expect(k2.replyContext).toMatchObject({ kind: "parent", from: "Alice Dvořáková", fromMe: true, excerpt: "Ahoj Bobe, jedeš o víkendu na chatu? Můžu vzít dřevo." });
    // Every answered message is a bubble of the same chat, so its card can show it.
    for (const m of bob.messages) {
      const card = m.replyContext;
      if (card?.kind === "parent") expect(bob.messages.some((p) => p.id === card.messageId), m.id).toBe(true);
    }
    await session.close();
  });

  it("shows the subject card for a reply whose parent is not in the mailbox", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    deliver(root, "gmail-web-de.eml", readFileSync(new URL("../../es-core/fixtures/replies/gmail-web-de.eml", import.meta.url)));
    await session.sync();
    const anna = (await session.chat((await chatNamed(session, "Anna Becker")).id))!;
    const reply = anna.messages.find((m) => m.fresh.includes("zwei Zahlen"))!;
    expect(reply.replyContext).toEqual({ kind: "subject", subject: "Projektübersicht" });
    await session.close();
  });

  it("gives a sent reply the card of the message it answers, and a new chat its subject", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const { message } = await session.send({ chatId: (await chatNamed(session, "Anna Becker")).id, text: "Danke!" });
    expect(message.fresh).toBe("Danke!");
    expect(message.replyContext).toMatchObject({ kind: "parent", from: "Anna Becker", fromMe: false, excerpt: "Nachtrag: Meilenstein 3 verschiebt sich um eine Woche. Anna" });
    const created = await session.send({ to: ["zuzana@example.net"], text: "Ahoj Zuzano!" });
    expect(created.message.replyContext).toEqual({ kind: "subject", subject: "Ahoj Zuzano!" });
    await session.close();
  });
});

describe("MailSession: sending", () => {
  it("replies to everyone else in a group as plain e-mail, quoting the message it answers", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const group = await chatNamed(session, "Bob Svoboda, Jana Nováková");
    const sentBefore = folder(root, "Sent").length;
    const { chatId, message } = await session.send({ chatId: group.id, text: "Tak zítra!" });
    expect(chatId).toBe(group.id);
    expect(message).toMatchObject({ mine: true, fresh: "Tak zítra!", status: "sent", emailSocial: false });
    const sent = folder(root, "Sent");
    expect(sent).toHaveLength(sentBefore + 1);
    const reply = sent.find((m) => m.message.text.startsWith("Tak zítra!"))!;
    expect(reply.message.to.map((t) => t.address).sort()).toEqual(["bob@example.org", "jana@example.net"]);
    expect(reply.message.es).toBeNull();
    expect(reply.message.subject).toBe("Re: Oběd v pátek");
    // The answered message is Bob's newest one; its attribution line and text are quoted below the reply.
    expect(reply.message.text).toBe(
      "Tak zítra!\n\nOn Mon, 2 Mar 2026 at 11:05, Bob Svoboda <bob@example.org> wrote:\n> Stůl je zarezervovaný na jméno Svoboda.",
    );
    expect(splitQuoted(reply.message).fresh).toBe("Tak zítra!");
    expect(folder(root, "Outbox").some((m) => m.message.text.startsWith("Tak zítra!"))).toBe(true);
    expect((await session.chats())[0]).toMatchObject({ id: group.id, lastFromMe: true, lastLine: "Tak zítra!" });
    expect((await simpleParser(Buffer.from(reply.raw))).text).toContain("> Stůl je zarezervovaný na jméno Svoboda.");
    await session.close();
  });

  it("replies with the ES part, asks for receipts and quotes nothing when the other side uses Email Social", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const karel = await chatNamed(session, "Karel Holub");
    const { message } = await session.send({ chatId: karel.id, text: "Už jsem tady." });
    expect(message).toMatchObject({ mine: true, text: "Už jsem tady.", status: "sent", emailSocial: true });
    const reply = folder(root, "Sent").find((m) => m.message.text === "Už jsem tady.")!;
    expect(reply.message.es).toMatchObject({ $type: "es.social.post", requestReceipts: ["delivered", "read"] });
    expect(reply.message.to).toEqual([{ name: "Karel Holub", address: "karel@example.org" }]);
    expect(reply.message.subject).toBe("Re: Kdy dorazíš?");
    await session.close();
  });

  it("starts a new chat: text/plain first, the subject from the first line, and the chat appears", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const text = "Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z vrcholu Sněžky.\n\nAlice";
    const { chatId, message } = await session.send({ to: ["zuzana@example.net"], text });
    expect(message.subject).toBe("Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z");
    const sent = folder(root, "Sent").find((m) => m.message.text === text)!;
    expect(sent.message.subject).toBe("Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z");
    expect(sent.message.refs.inReplyTo).toEqual([]);
    expect(sent.message.es).toBeNull();
    const mail = await simpleParser(Buffer.from(sent.raw));
    expect(mail.text).toBe(text);
    expect(new TextDecoder().decode(sent.raw)).toMatch(/Content-Type: text\/plain/);
    const chats = await session.chats();
    expect(chats[0]).toMatchObject({ id: chatId, title: "zuzana@example.net", lastFromMe: true });
    await session.close();
  });

  it("starts a group with several recipients, keeps a given subject, and uses the ES part for Email Social users", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const { chatId } = await session.send({ to: ["karel@example.org", "bob@example.org"], subject: "Sobota", text: "Kdo jede?" });
    const sent = folder(root, "Sent").find((m) => m.message.subject === "Sobota")!;
    expect(sent.message.to.map((a) => a.address)).toEqual(["karel@example.org", "bob@example.org"]);
    expect(sent.message.es?.$type).toBe("es.social.post");
    const chat = (await session.chats()).find((c) => c.id === chatId)!;
    expect(chat).toMatchObject({ group: true, title: "Bob Svoboda, Karel Holub" });
    // Writing to Bob alone again lands in the existing chat with him.
    const bob = await chatNamed(session, "Bob Svoboda");
    expect((await session.send({ to: ["bob@example.org"], text: "Nové téma" })).chatId).toBe(bob.id);
    await session.close();
  });

  it("refuses an empty message, no recipients, an invalid address and an unknown chat", async () => {
    const session = await openSession(await demoMaildir());
    await expect(session.send({ chatId: (await session.chats())[0]!.id, text: "   " })).rejects.toThrow(/empty/);
    await expect(session.send({ to: [], text: "x" })).rejects.toThrow(/recipient/);
    await expect(session.send({ to: ["not an address"], text: "x" })).rejects.toThrow(/Not an e-mail address/);
    await expect(session.send({ chatId: "chat-unknown", text: "x" })).rejects.toThrow(/No such chat/);
    expect(await session.chat("chat-unknown")).toBeNull();
    await session.close();
  });

  it("derives a subject from the first line, cut at 60 characters at a word boundary", () => {
    expect(subjectFromText("Short line\nsecond")).toBe("Short line");
    expect(subjectFromText("\n\n  Padded   words  \n")).toBe("Padded words");
    expect(subjectFromText("a".repeat(70))).toBe("a".repeat(60));
    const long = "The quick brown fox jumps over the lazy dog and keeps running far away";
    expect(subjectFromText(long)).toBe("The quick brown fox jumps over the lazy dog and keeps");
    expect(subjectFromText(long).length).toBeLessThanOrEqual(60);
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
  it("writes the reply text first and the quote below, as text/plain only", async () => {
    const root = await demoMaildir();
    const session = await openSession(root);
    const anna = await chatNamed(session, "Anna Becker");
    await session.send({ chatId: anna.id, text: "Danke, Anna!" });
    const sent = folder(root, "Sent").find((m) => m.message.text.startsWith("Danke, Anna!"))!;
    expect(sent.message.attachments).toEqual([]);
    expect(sent.message.text.split("\n")[2]).toBe("On Fri, 6 Mar 2026 at 14:30, Anna Becker <anna.becker@example.net> wrote:");
    expect(sent.message.text).toContain("> Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.");
    expect(sent.message.text).not.toContain("Von:");
    // Compare with what es-core writes for the same text: nothing is added besides the quote.
    const plain = serializeMessage({ from: DEMO_ACCOUNT, to: [{ name: "", address: "x@example.net" }], subject: "s", text: sent.message.text }, { date: NOW, messageId: "<x@example.com>", includeEsPart: false });
    expect(parseMessage(plain).text).toBe(sent.message.text);
    await session.close();
  });
});
