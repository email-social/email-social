import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMessage, type EsMessage } from "@email-social/es-core";
import { MaildirAdapter } from "../../src/adapters/maildir.js";
import { DEMO_ACCOUNT, writeDemoMaildir } from "../../src/demo.js";
import { MailSession, type SessionOptions } from "../../src/session.js";

export const NOW = new Date("2026-03-21T10:00:00Z");

/** A fresh temporary directory. */
export function tempDir(prefix = "es-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A maildir with the demo mailbox. */
export async function demoMaildir(): Promise<string> {
  const root = tempDir("es-demo-");
  await writeDemoMaildir(root);
  return root;
}

let ids = 0;

/** A session over a maildir with a fixed clock and predictable Message-IDs. */
export async function openSession(root: string, extra: Partial<SessionOptions> = {}): Promise<MailSession> {
  const adapter = new MaildirAdapter(root, { pollMs: 60_000 });
  return MailSession.start({
    adapter,
    account: { address: DEMO_ACCOUNT.address, name: DEMO_ACCOUNT.name },
    mode: "maildir",
    clock: () => NOW,
    newMessageId: () => `<test-${++ids}@example.com>`,
    ...extra,
  });
}

/** Messages in a maildir folder, parsed, in file-name order. */
export function folder(root: string, name: "INBOX" | "Sent" | "Outbox"): { name: string; raw: Uint8Array; message: EsMessage }[] {
  return readdirSync(join(root, name))
    .filter((n) => n.endsWith(".eml"))
    .sort()
    .map((n) => {
      const raw = new Uint8Array(readFileSync(join(root, name, n)));
      return { name: n, raw, message: parseMessage(raw) };
    });
}

/** Puts a raw message into INBOX (unseen). */
export function deliver(root: string, name: string, raw: string | Uint8Array): void {
  writeFileSync(join(root, "INBOX", name), raw);
}
