/**
 * Acceptance: "a plain e-mail sender never gets a receipt; an ES sender asking
 * for one gets exactly one Read receipt per message" (tasks/02), and
 * Delivered receipts follow the same rule when a message arrives.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeMessage, type ReceiptKind } from "@email-social/es-core";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { deliver, folder, openSession, tempDir } from "./helpers/session.js";

const me = DEMO_ACCOUNT;
const plain = { name: "Petra Plain", address: "petra@example.net" };
const es = { name: "Ema Social", address: "ema@example.org" };
const quiet = { name: "Tomáš Quiet", address: "tomas@example.org" };

function message(from: typeof es, id: string, subject: string, requestReceipts: ReceiptKind[] | null, date: string): string {
  return serializeMessage(
    { from, to: [me], subject, text: `${subject} text`, ...(requestReceipts === null ? {} : { es: { requestReceipts } }) },
    { date, messageId: id, includeEsPart: requestReceipts !== null },
  );
}

async function mailbox(): Promise<string> {
  const root = tempDir("es-receipts-");
  for (const dir of ["INBOX", "Sent", "Outbox"]) mkdirSync(join(root, dir));
  deliver(root, "1-plain.eml", message(plain, "<p1@example.net>", "Plain one", null, "2026-03-20T08:00:00Z"));
  deliver(root, "2-plain.eml", message(plain, "<p2@example.net>", "Re: Plain one", null, "2026-03-20T08:05:00Z"));
  deliver(root, "3-es.eml", message(es, "<e1@example.org>", "Hello", ["delivered", "read"], "2026-03-20T09:00:00Z"));
  deliver(root, "4-es.eml", message(es, "<e2@example.org>", "Hello again", ["read"], "2026-03-20T09:10:00Z"));
  deliver(root, "5-quiet.eml", message(quiet, "<q1@example.org>", "No receipts please", [], "2026-03-20T10:00:00Z"));
  return root;
}

/** The receipts es-core wrote into Outbox: [kind, acknowledged Message-ID, recipient]. */
function receipts(root: string): [string, string, string][] {
  return folder(root, "Outbox").map(({ message }) => {
    expect(message.es?.$type).toBe("es.social.receipt");
    const r = message.es as { kind: string; messageId: string };
    return [r.kind, r.messageId, message.to.map((a) => a.address).join(",")];
  });
}

describe("receipt rule", () => {
  it("sends a Delivered receipt once, on arrival, only to an ES sender who asked for it", async () => {
    const root = await mailbox();
    const session = await openSession(root);
    expect(receipts(root)).toEqual([["delivered", "<e1@example.org>", "ema@example.org"]]);
    await session.sync();
    expect(receipts(root)).toHaveLength(1);
    await session.close();
  });

  it("sends exactly one Read receipt per message when the conversation is opened, never to plain senders", async () => {
    const root = await mailbox();
    const session = await openSession(root);
    for (let round = 0; round < 2; round++) {
      for (const view of [...(await session.chats()), ...(await session.others())]) await session.markRead(view.id);
    }
    const read = receipts(root).filter(([kind]) => kind === "read");
    expect(read.sort()).toEqual([
      ["read", "<e1@example.org>", "ema@example.org"],
      ["read", "<e2@example.org>", "ema@example.org"],
    ]);
    expect(receipts(root).every(([, , to]) => to !== plain.address && to !== quiet.address)).toBe(true);
    await session.close();
  });

  it("does not send a receipt twice after a restart", async () => {
    const root = await mailbox();
    const first = await openSession(root);
    for (const view of [...(await first.chats()), ...(await first.others())]) await first.markRead(view.id);
    await first.close();
    const before = receipts(root).length;
    const second = await openSession(root);
    for (const view of [...(await second.chats()), ...(await second.others())]) await second.markRead(view.id);
    expect(receipts(root)).toHaveLength(before);
    expect(before).toBe(3);
    await second.close();
  });

  it("sends no Delivered receipt for a message that is already read (it arrived before; Read covers it)", async () => {
    const root = tempDir("es-receipts-seen-");
    for (const dir of ["INBOX", "Sent", "Outbox"]) mkdirSync(join(root, dir));
    deliver(root, "old.eml", message(es, "<old@example.org>", "Old news", ["delivered", "read"], "2026-03-01T08:00:00Z"));
    writeFileSync(join(root, "INBOX", ".email-social-flags.json"), JSON.stringify({ "old.eml": ["\\Seen"] }));
    const session = await openSession(root);
    expect(receipts(root)).toEqual([]);
    for (const view of [...(await session.chats()), ...(await session.others())]) await session.markRead(view.id);
    expect(receipts(root)).toEqual([["read", "<old@example.org>", "ema@example.org"]]);
    await session.close();
  });

  it("sends a Delivered receipt for an ES message that arrives while running", async () => {
    const root = await mailbox();
    const session = await openSession(root);
    deliver(root, "6-es.eml", message(es, "<e3@example.org>", "Are you there?", ["delivered", "read"], "2026-03-21T09:00:00Z"));
    await session.sync();
    expect(receipts(root).filter(([, id]) => id === "<e3@example.org>")).toEqual([["delivered", "<e3@example.org>", "ema@example.org"]]);
    await session.close();
  });

  it("writes receipts as ordinary messages that thread to the original and are marked automatic", async () => {
    const root = await mailbox();
    const session = await openSession(root);
    const [receipt] = folder(root, "Outbox");
    const text = new TextDecoder().decode(receipt!.raw);
    expect(text).toMatch(/^Auto-Submitted: auto-replied\r$/m);
    expect(receipt!.message.refs.inReplyTo).toEqual(["<e1@example.org>"]);
    expect(receipt!.message.from).toEqual({ name: me.name, address: me.address });
    expect(receipt!.message.text).toContain("Hello");
    await session.close();
  });

  it("never answers the account's own messages or messages in Sent", async () => {
    const root = tempDir("es-receipts-own-");
    for (const dir of ["INBOX", "Sent", "Outbox"]) mkdirSync(join(root, dir));
    deliver(root, "self.eml", message(me, "<self@example.com>", "Note to self", ["delivered", "read"], "2026-03-20T08:00:00Z"));
    const session = await openSession(root);
    for (const view of [...(await session.chats()), ...(await session.others())]) await session.markRead(view.id);
    expect(receipts(root)).toEqual([]);
    await session.close();
  });
});
