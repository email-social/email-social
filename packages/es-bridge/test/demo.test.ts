import { simpleParser } from "mailparser";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAddress, parseMessage, threadMessages } from "@email-social/es-core";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import { SEEN } from "../src/adapters/types.js";
import { DEMO_ACCOUNT, buildDemoMailbox, writeDemoMaildir } from "../src/demo.js";
import { EXPECTED } from "./helpers/demo-expected.js";



describe("demo mailbox (the seed of the end-to-end test)", () => {
  const mailbox = buildDemoMailbox();

  it("has 40 messages that es-core threads into the 9 expected conversations, newest first", () => {
    expect(mailbox).toHaveLength(40);
    const parsed = mailbox.map((m) => ({ ...m, message: parseMessage(m.raw) }));
    const conversations = threadMessages(parsed.map((p) => p.message));
    expect(conversations.map((c) => c.subject)).toEqual(EXPECTED.map((e) => e.subject));
    expect(conversations.map((c) => c.messageIds.length)).toEqual(EXPECTED.map((e) => e.messages));
    for (const [i, conversation] of conversations.entries()) {
      const keys = new Set(parsed.filter((p) => conversation.messageIds.includes(p.message.id)).map((p) => p.conversation));
      expect([...keys]).toEqual([EXPECTED[i]!.key]);
    }
  });

  it("marks the expected incoming messages as unread", () => {
    for (const { key, unread } of EXPECTED) {
      const unseen = mailbox.filter((m) => m.conversation === key && m.folder === "inbox" && !m.seen);
      expect(unseen, key).toHaveLength(unread);
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
      const text = new TextDecoder("latin1").decode(m.raw);
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
    expect(entries).toHaveLength(40);
    for (const m of mailbox) {
      const entry = entries.find((e) => e.uid === m.name)!;
      expect(entry.folder).toBe(m.folder);
      expect(entry.flags.includes(SEEN), m.name).toBe(m.seen);
    }
  });
});
