import { simpleParser } from "mailparser";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAddress, classifyMessage, groupByParticipants, parseMessage, splitQuoted } from "@email-social/es-core";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import { SEEN } from "../src/adapters/types.js";
import { DEMO_ACCOUNT, buildDemoMailbox, writeDemoMaildir } from "../src/demo.js";
import { BOB_SUBJECTS, EXPECTED_CHATS, EXPECTED_OTHER } from "./helpers/demo-expected.js";

describe("demo mailbox (the seed of the end-to-end test)", () => {
  const mailbox = buildDemoMailbox();

  it("has 45 messages that es-core groups into the 7 expected chats, newest first, and two lists", () => {
    expect(mailbox).toHaveLength(45);
    const parsed = mailbox.map((m) => ({ ...m, message: parseMessage(m.raw) }));
    const lists = new Set(EXPECTED_OTHER.flatMap((o) => o.threads));
    const people = parsed.filter((p) => !lists.has(p.conversation));
    for (const p of parsed) {
      const mine = p.folder === "sent";
      expect(mine || classifyMessage(p.message) === (lists.has(p.conversation) ? "list" : "person"), p.name).toBe(true);
    }
    const chats = groupByParticipants(
      people.map((p) => p.message),
      { self: DEMO_ACCOUNT.address },
    );
    expect(chats.map((c) => c.messages.length)).toEqual(EXPECTED_CHATS.map((e) => e.messages));
    for (const [i, chat] of chats.entries()) {
      const threads = new Set(parsed.filter((p) => chat.messages.some((m) => m.id === p.message.id)).map((p) => p.conversation));
      expect([...threads].sort(), EXPECTED_CHATS[i]!.title).toEqual(EXPECTED_CHATS[i]!.threads);
    }
    const bob = chats[1]!.messages.map((m) => m.subject).filter((subject, i, all) => i === 0 || all[i - 1] !== subject);
    expect(bob).toEqual(BOB_SUBJECTS);
  });

  it("marks the expected incoming messages as unread", () => {
    for (const { title, threads, unread } of [...EXPECTED_CHATS, ...EXPECTED_OTHER]) {
      const unseen = mailbox.filter((m) => threads.includes(m.conversation) && m.folder === "inbox" && !m.seen);
      expect(unseen, title).toHaveLength(unread);
    }
  });

  it("quotes like real clients: what each sender wrote is what splitQuoted finds", () => {
    for (const m of mailbox) {
      const split = splitQuoted(parseMessage(m.raw));
      if (m.style === "newsletter") continue;
      // iOS Mail's "Odesláno z iPhonu" is a signature, not part of what Jana wrote.
      const fresh = m.fresh.replace(/\n\nOdesláno z iPhonu$/, "");
      expect(split.fresh, m.name).toBe(fresh.trim());
      const reply = m.name.slice(1, 2) !== "1"; // every thread's first message is its original
      const quotes = reply && !(m.style === "email-social" && parseMessage(m.raw).es !== null);
      expect(split.quoted !== "", m.name).toBe(quotes);
    }
  });

  it("puts the account's own messages in Sent and everyone else's in INBOX", () => {
    for (const m of mailbox) {
      const from = parseMessage(m.raw).from!.address;
      expect(m.folder, m.name).toBe(canonicalAddress(from) === DEMO_ACCOUNT.address ? "sent" : "inbox");
    }
  });

  it("uses the formats of several real clients, each readable by an independent parser", async () => {
    const styles = new Set(mailbox.map((m) => m.style));
    for (const style of ["gmail", "thunderbird", "outlook", "apple-mail", "ios-mail", "mutt", "seznam", "mailman", "newsletter", "email-social"]) {
      expect(styles, style).toContain(style);
    }
    for (const m of mailbox) {
      const mail = await simpleParser(Buffer.from(m.raw));
      const ours = parseMessage(m.raw);
      expect(mail.subject ?? "", m.name).toBe(ours.subject);
      if (ours.textSource === "plain") expect(ours.text.trim().length, m.name).toBeGreaterThan(0);
    }
  });

  it("contains only example.com / example.org / example.net domains", () => {
    for (const m of mailbox) {
      // Quoted-printable soft line breaks may split a domain; join them before looking.
      const text = new TextDecoder("latin1").decode(m.raw).replace(/=\r\n/g, "");
      for (const [, domain] of text.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        expect(domain!, m.name).toMatch(/(^|\.)example\.(com|org|net)$/i);
      }
    }
  });

  it("has ES messages that ask for receipts only in the Email Social conversation", () => {
    const asking = mailbox.filter((m) => {
      const es = parseMessage(m.raw).es;
      return es?.$type === "es.social.post" && es.requestReceipts.length > 0;
    });
    expect(new Set(asking.map((m) => m.conversation))).toEqual(new Set(["D"]));
  });

  it("writes a maildir that the Maildir adapter lists with the right flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "es-demo-"));
    await writeDemoMaildir(root);
    expect(readdirSync(join(root, "INBOX")).filter((n) => n.endsWith(".eml")).length).toBe(
      mailbox.filter((m) => m.folder === "inbox").length,
    );
    const adapter = new MaildirAdapter(root);
    await adapter.open();
    const { entries } = await adapter.listSince(null);
    expect(entries).toHaveLength(45);
    for (const m of mailbox) {
      const entry = entries.find((e) => e.uid === m.name)!;
      expect(entry.folder).toBe(m.folder);
      expect(entry.flags.includes(SEEN), m.name).toBe(m.seen);
    }
  });
});
