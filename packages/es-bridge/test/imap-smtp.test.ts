import { describe, expect, it } from "vitest";
import { ImapSmtpAdapter, imapOptions, smtpOptions, type ImapClient, type SmtpTransport } from "../src/adapters/imap-smtp.js";
import { SEEN } from "../src/adapters/types.js";
import type { AccountConfig } from "../src/credentials.js";

const CONFIG: AccountConfig = {
  address: "alice@example.com",
  name: "Alice",
  username: "",
  password: "app-password",
  imap: { host: "imap.example.com", port: 993, security: "tls" },
  smtp: { host: "smtp.example.com", port: 465, security: "tls" },
  appendToSent: true,
};

interface Box {
  uidValidity: bigint;
  uidNext: number;
  permanentFlags: Set<string>;
  messages: { uid: number; flags: Set<string>; source: Buffer }[];
}

/** An in-memory stand-in for the ImapFlow methods the adapter uses. */
class FakeImap implements ImapClient {
  boxes = new Map<string, Box>();
  listing: { path: string; specialUse?: string }[] = [
    { path: "INBOX", specialUse: "\\Inbox" },
    { path: "Sent Mail", specialUse: "\\Sent" },
  ];
  mailbox: ImapClient["mailbox"] = false;
  selected: string[] = [];
  stored: [string, string, string[]][] = [];
  listeners = new Map<string, Set<() => void>>();
  loggedOut = false;
  failConnect: Error | null = null;

  constructor() {
    const raw = (n: number) => Buffer.from(`Subject: ${n}\r\n\r\nbody ${n}\r\n`);
    this.boxes.set("INBOX", {
      uidValidity: 7n,
      uidNext: 13,
      permanentFlags: new Set(["\\Seen", "\\*"]),
      messages: [10, 11, 12].map((uid) => ({ uid, flags: new Set(uid === 10 ? [SEEN] : []), source: raw(uid) })),
    });
    this.boxes.set("Sent Mail", { uidValidity: 3n, uidNext: 5, permanentFlags: new Set(["\\Seen"]), messages: [{ uid: 4, flags: new Set([SEEN]), source: raw(4) }] });
  }

  async connect(): Promise<void> {
    if (this.failConnect !== null) throw this.failConnect;
  }
  async list(): Promise<{ path: string; specialUse?: string }[]> {
    return this.listing;
  }
  async mailboxCreate(path: string): Promise<unknown> {
    this.boxes.set(path, { uidValidity: 1n, uidNext: 1, permanentFlags: new Set(), messages: [] });
    this.listing.push({ path });
    return {};
  }
  async mailboxOpen(path: string): Promise<unknown> {
    const box = this.boxes.get(path)!;
    this.selected.push(path);
    this.mailbox = { path, uidValidity: box.uidValidity, uidNext: box.uidNext, permanentFlags: box.permanentFlags, exists: box.messages.length };
    return this.mailbox;
  }
  async getMailboxLock(path: string): Promise<{ release(): void }> {
    await this.mailboxOpen(path);
    return { release: () => undefined };
  }
  private box(): Box {
    return this.boxes.get((this.mailbox as { path: string }).path)!;
  }
  private select(range: string): Box["messages"] {
    const box = this.box();
    const out: Box["messages"] = [];
    for (const piece of range.split(",")) {
      const [a, b] = piece.split(":");
      const max = Math.max(0, ...box.messages.map((m) => m.uid));
      const lo = Number(a);
      const hi = b === undefined ? lo : b === "*" ? max : Number(b);
      for (const m of box.messages) if (m.uid >= Math.min(lo, hi) && m.uid <= Math.max(lo, hi) && !out.includes(m)) out.push(m);
    }
    return out;
  }
  async search(): Promise<number[]> {
    return this.box().messages.map((m) => m.uid);
  }
  async *fetch(range: string): AsyncGenerator<{ uid: number; flags?: Set<string> }> {
    for (const m of this.select(range)) yield { uid: m.uid, flags: new Set(m.flags) };
  }
  async fetchOne(uid: string): Promise<{ uid: number; source?: Buffer } | false> {
    const m = this.select(uid)[0];
    return m === undefined ? false : { uid: m.uid, source: m.source };
  }
  async messageFlagsAdd(uid: string, flags: string[]): Promise<boolean> {
    this.stored.push([(this.mailbox as { path: string }).path, uid, flags]);
    return true;
  }
  async append(path: string, content: Buffer, flags: string[]): Promise<{ uid?: number; uidValidity?: bigint } | false> {
    const box = this.boxes.get(path)!;
    const uid = box.uidNext++;
    box.messages.push({ uid, flags: new Set(flags), source: content });
    return { uid, uidValidity: box.uidValidity };
  }
  on(event: string, listener: () => void): void {
    (this.listeners.get(event) ?? this.listeners.set(event, new Set()).get(event)!).add(listener);
  }
  off(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string): void {
    for (const l of this.listeners.get(event) ?? []) l();
  }
  async logout(): Promise<void> {
    this.loggedOut = true;
  }
}

class FakeSmtp implements SmtpTransport {
  sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  verified = false;
  failVerify: Error | null = null;
  async verify(): Promise<true> {
    if (this.failVerify !== null) throw this.failVerify;
    this.verified = true;
    return true;
  }
  async sendMail(message: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown> {
    this.sent.push(message);
    return {};
  }
  close(): void {}
}

async function opened(config: AccountConfig = CONFIG, prepare?: (imap: FakeImap, smtp: FakeSmtp) => void) {
  const imap = new FakeImap();
  const smtp = new FakeSmtp();
  prepare?.(imap, smtp);
  const adapter = new ImapSmtpAdapter(config, { imap: () => imap, smtp: () => smtp, maxMessages: 500, pollMs: 60_000 });
  await adapter.open();
  return { adapter, imap, smtp };
}

describe("IMAP and SMTP settings", () => {
  it("uses TLS from the first byte, or requires STARTTLS, and never falls back to plain text", () => {
    expect(imapOptions(CONFIG)).toMatchObject({ host: "imap.example.com", port: 993, secure: true, auth: { user: "alice@example.com", pass: "app-password" }, logger: false });
    expect(imapOptions({ ...CONFIG, imap: { host: "imap.example.com", port: 143, security: "starttls" } })).toMatchObject({ secure: false, doSTARTTLS: true });
    expect(smtpOptions(CONFIG)).toMatchObject({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "alice@example.com", pass: "app-password" } });
    expect(smtpOptions({ ...CONFIG, smtp: { host: "smtp.example.com", port: 587, security: "starttls" } })).toMatchObject({ secure: false, requireTLS: true });
    expect(imapOptions({ ...CONFIG, username: "alice" }).auth).toEqual({ user: "alice", pass: "app-password" });
  });
});

describe("ImapSmtpAdapter", () => {
  it("logs in, checks SMTP, finds the sent folder by its special use (RFC 6154) and learns about keywords", async () => {
    const { adapter, smtp } = await opened();
    expect(smtp.verified).toBe(true);
    expect(adapter.keepsKeywords).toBe(true);
    const { entries, complete } = await adapter.listSince(null);
    expect(complete).toEqual(["inbox", "sent"]);
    expect(entries).toEqual([
      { folder: "inbox", uid: "7.10", flags: [SEEN] },
      { folder: "inbox", uid: "7.11", flags: [] },
      { folder: "inbox", uid: "7.12", flags: [] },
      { folder: "sent", uid: "3.4", flags: [SEEN] },
    ]);
  });

  it("finds a sent folder by name, or creates one when copies must be stored", async () => {
    const byName = await opened(CONFIG, (imap) => {
      imap.boxes.set("Sent Items", imap.boxes.get("Sent Mail")!);
      imap.listing = [{ path: "INBOX" }, { path: "Sent Items" }];
    });
    expect((await byName.adapter.listSince(null)).entries.some((e) => e.folder === "sent")).toBe(true);
    const created = await opened(CONFIG, (imap) => {
      imap.listing = [{ path: "INBOX" }];
    });
    expect(created.imap.boxes.has("Sent")).toBe(true);
    expect(created.adapter.keepsKeywords).toBe(true);
  });

  it("reports both an IMAP and an SMTP failure at login", async () => {
    await expect(
      opened(CONFIG, (imap, smtp) => {
        imap.failConnect = new Error("IMAP says no");
        smtp.failVerify = new Error("SMTP says no");
      }),
    ).rejects.toThrow(/IMAP says no[\s\S]*SMTP says no/);
  });

  it("lists only messages newer than the cursor, and everything again after a UIDVALIDITY change (RFC 9051 §2.3.1.1)", async () => {
    const { adapter, imap } = await opened();
    const first = await adapter.listSince(null);
    const box = imap.boxes.get("INBOX")!;
    box.messages.push({ uid: 13, flags: new Set(), source: Buffer.from("Subject: 13\r\n\r\n") });
    box.uidNext = 14;
    const second = await adapter.listSince(first.cursor);
    expect(second).toMatchObject({ complete: [], entries: [{ folder: "inbox", uid: "7.13", flags: [] }] });
    expect((await adapter.listSince(second.cursor)).entries).toEqual([]);
    box.uidValidity = 8n;
    const third = await adapter.listSince(second.cursor);
    expect(third.complete).toEqual(["inbox"]);
    expect(third.entries.filter((e) => e.folder === "inbox").map((e) => e.uid)).toEqual(["8.10", "8.11", "8.12", "8.13"]);
  });

  it("lists at most maxMessages per folder, the newest", async () => {
    const imap = new FakeImap();
    const adapter = new ImapSmtpAdapter(CONFIG, { imap: () => imap, smtp: () => new FakeSmtp(), maxMessages: 2, pollMs: 60_000 });
    await adapter.open();
    expect((await adapter.listSince(null)).entries.filter((e) => e.folder === "inbox").map((e) => e.uid)).toEqual(["7.11", "7.12"]);
  });

  it("fetches raw messages and refuses a uid from an old UIDVALIDITY", async () => {
    const { adapter, imap } = await opened();
    expect(new TextDecoder().decode(await adapter.fetchRaw({ folder: "inbox", uid: "7.11" }))).toContain("body 11");
    expect(new TextDecoder().decode(await adapter.fetchRaw({ folder: "sent", uid: "3.4" }))).toContain("body 4");
    await expect(adapter.fetchRaw({ folder: "inbox", uid: "6.11" })).rejects.toThrow();
    await expect(adapter.fetchRaw({ folder: "inbox", uid: "7.99" })).rejects.toThrow();
    expect(imap.selected[imap.selected.length - 1]).toBe("INBOX");
  });

  it("adds flags with UID STORE and stores sent copies marked \\Seen, then selects INBOX again for IDLE", async () => {
    const { adapter, imap } = await opened();
    await adapter.addFlags({ folder: "inbox", uid: "7.11" }, [SEEN, "$EsRead"]);
    expect(imap.stored).toEqual([["INBOX", "11", [SEEN, "$EsRead"]]]);
    const entry = await adapter.appendToSent(new TextEncoder().encode("Subject: sent\r\n\r\nhi\r\n"));
    expect(entry).toEqual({ folder: "sent", uid: "3.5", flags: [SEEN] });
    expect(imap.selected[imap.selected.length - 1]).toBe("INBOX");
  });

  it("sends through SMTP with the given envelope", async () => {
    const { adapter, smtp } = await opened();
    await adapter.send(new TextEncoder().encode("Subject: x\r\n\r\ny\r\n"), { from: "alice@example.com", to: ["bob@example.org"] });
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]!.envelope).toEqual({ from: "alice@example.com", to: ["bob@example.org"] });
    expect(smtp.sent[0]!.raw.toString()).toContain("Subject: x");
  });

  it("calls the watcher when INBOX gets a new message (IDLE, RFC 2177) and stops on request", async () => {
    const { adapter, imap } = await opened();
    let calls = 0;
    const stop = adapter.watch(() => calls++);
    imap.emit("exists");
    expect(calls).toBe(1);
    stop();
    imap.emit("exists");
    expect(calls).toBe(1);
    await adapter.close();
    expect(imap.loggedOut).toBe(true);
  });
});
