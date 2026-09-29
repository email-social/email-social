import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import { SEEN, type MailEntry } from "../src/adapters/types.js";

const RAW = (subject: string): Uint8Array =>
  new TextEncoder().encode(`From: a@example.com\r\nTo: b@example.org\r\nSubject: ${subject}\r\n\r\nHello\r\n`);

let dirs: string[] = [];
function maildir(): string {
  const dir = mkdtempSync(join(tmpdir(), "es-maildir-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  dirs = [];
});

function names(entries: MailEntry[]): string[] {
  return entries.map((e) => `${e.folder}/${e.uid}`).sort();
}

let counter = 0;
const newName = (): string => `m${++counter}.eml`;

describe("MaildirAdapter: a directory of .eml files per folder", () => {
  it("creates the INBOX, Sent and Outbox folders on open", async () => {
    const root = maildir();
    await new MaildirAdapter(root).open();
    for (const folder of ["INBOX", "Sent", "Outbox"]) expect(existsSync(join(root, folder))).toBe(true);
  });

  it("lists the .eml files of INBOX and Sent with their flags, ignoring other files", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root);
    await adapter.open();
    writeFileSync(join(root, "INBOX", "a.eml"), RAW("a"));
    writeFileSync(join(root, "INBOX", "b.eml"), RAW("b"));
    writeFileSync(join(root, "INBOX", "notes.txt"), "not a message");
    writeFileSync(join(root, "Sent", "c.eml"), RAW("c"));
    writeFileSync(join(root, "Outbox", "d.eml"), RAW("d"));
    writeFileSync(join(root, "INBOX", ".email-social-flags.json"), JSON.stringify({ "b.eml": [SEEN] }));

    const changes = await adapter.listSince(null);
    expect(changes.complete).toBe(true);
    expect(names(changes.entries)).toEqual(["inbox/a.eml", "inbox/b.eml", "sent/c.eml"]);
    expect(changes.entries.find((e) => e.uid === "b.eml")!.flags).toEqual([SEEN]);
    expect(changes.entries.find((e) => e.uid === "a.eml")!.flags).toEqual([]);
  });

  it("lists only new messages since a cursor, and everything for an unknown cursor", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root);
    await adapter.open();
    writeFileSync(join(root, "INBOX", "a.eml"), RAW("a"));
    const first = await adapter.listSince(null);
    writeFileSync(join(root, "INBOX", "b.eml"), RAW("b"));
    const second = await adapter.listSince(first.cursor);
    expect(second.complete).toBe(false);
    expect(names(second.entries)).toEqual(["inbox/b.eml"]);
    expect((await adapter.listSince(second.cursor)).entries).toEqual([]);
    const unknown = await adapter.listSince("gen-999");
    expect(unknown.complete).toBe(true);
    expect(names(unknown.entries)).toEqual(["inbox/a.eml", "inbox/b.eml"]);
  });

  it("returns the raw bytes and refuses names outside the folder", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root);
    await adapter.open();
    writeFileSync(join(root, "INBOX", "a.eml"), RAW("a"));
    expect(await adapter.fetchRaw({ folder: "inbox", uid: "a.eml" })).toEqual(RAW("a"));
    for (const uid of ["../Sent/x.eml", "..", "a.txt", "/etc/passwd", "x/../a.eml"]) {
      await expect(adapter.fetchRaw({ folder: "inbox", uid })).rejects.toThrow();
    }
  });

  it("keeps added flags and keywords in the folder, once each", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root);
    await adapter.open();
    writeFileSync(join(root, "INBOX", "a.eml"), RAW("a"));
    await adapter.addFlags({ folder: "inbox", uid: "a.eml" }, [SEEN, "$EsRead"]);
    await adapter.addFlags({ folder: "inbox", uid: "a.eml" }, [SEEN]);
    const reopened = new MaildirAdapter(root);
    await reopened.open();
    expect((await reopened.listSince(null)).entries[0]!.flags).toEqual([SEEN, "$EsRead"]);
    expect(adapter.keepsKeywords).toBe(true);
  });

  it("appends a sent message to Sent as a new .eml marked \\Seen", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root, { newName });
    await adapter.open();
    const entry = await adapter.appendToSent(RAW("sent"));
    expect(entry.folder).toBe("sent");
    expect(entry.uid).toMatch(/\.eml$/);
    expect(entry.flags).toEqual([SEEN]);
    expect(new Uint8Array(readFileSync(join(root, "Sent", entry.uid)))).toEqual(RAW("sent"));
    expect(names((await adapter.listSince(null)).entries)).toEqual([`sent/${entry.uid}`]);
  });

  it("sends by writing the message to Outbox, which is not listed", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root, { newName });
    await adapter.open();
    await adapter.send(RAW("out"), { from: "a@example.com", to: ["b@example.org"] });
    const outbox = readdirSync(join(root, "Outbox")).filter((n) => n.endsWith(".eml"));
    expect(outbox).toHaveLength(1);
    expect(new Uint8Array(readFileSync(join(root, "Outbox", outbox[0]!)))).toEqual(RAW("out"));
    expect((await adapter.listSince(null)).entries).toEqual([]);
  });

  it("calls the watcher when a new message appears", async () => {
    const root = maildir();
    const adapter = new MaildirAdapter(root, { pollMs: 50 });
    await adapter.open();
    let calls = 0;
    const stop = adapter.watch(() => calls++);
    writeFileSync(join(root, "INBOX", "new.eml"), RAW("new"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    stop();
    expect(calls).toBeGreaterThan(0);
    await adapter.close();
  });
});
