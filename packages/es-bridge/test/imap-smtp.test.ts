/**
 * ImapSmtpAdapter with the real imapflow client against a small IMAP server
 * on 127.0.0.1 (helpers/fake-imap.ts), and a recording SMTP transport.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ImapSmtpAdapter, imapOptions, smtpOptions } from "../src/adapters/imap-smtp.js";
import { SEEN, type ConnectionStatus } from "../src/adapters/types.js";
import type { AccountConfig } from "../src/credentials.js";
import { FakeImapServer, FakeSmtp, imapTo } from "./helpers/fake-imap.js";

const CONFIG: AccountConfig = {
  address: "alice@example.com",
  name: "Alice",
  username: "",
  password: "app-password",
  imap: { host: "imap.example.com", port: 993, security: "tls" },
  smtp: { host: "smtp.example.com", port: 465, security: "tls" },
  appendToSent: true,
};

const message = (n: number): string => `From: bob@example.org\r\nTo: alice@example.com\r\nSubject: ${n}\r\nMessage-ID: <m${n}@example.org>\r\n\r\nbody ${n}\r\n`;

const servers: FakeImapServer[] = [];
const adapters: ImapSmtpAdapter[] = [];

afterEach(async () => {
  while (adapters.length > 0) await adapters.pop()!.close();
  while (servers.length > 0) await servers.pop()!.close();
});

async function setUp(prepare?: (server: FakeImapServer) => void, options: { maxMessages?: number; pollMs?: number } = {}) {
  const server = new FakeImapServer();
  servers.push(server);
  prepare?.(server);
  await server.start();
  const smtp = new FakeSmtp();
  const adapter = new ImapSmtpAdapter(CONFIG, { imap: imapTo(server), smtp: () => smtp, maxMessages: options.maxMessages ?? 500, pollMs: options.pollMs ?? 60_000, backoffMs: [50, 100] });
  adapters.push(adapter);
  return { server, smtp, adapter };
}

function seed(server: FakeImapServer): void {
  server.deliver("INBOX", message(1), { flags: [SEEN], date: new Date("2026-03-02T09:00:00Z") });
  server.deliver("INBOX", message(2), { date: new Date("2026-03-03T09:00:00Z") });
  server.deliver("INBOX", message(3), { date: new Date("2026-03-04T09:00:00Z") });
  server.deliver("Sent", message(4), { flags: [SEEN], date: new Date("2026-03-03T10:00:00Z") });
}

const until = async (condition: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe("IMAP and SMTP settings", () => {
  it("uses TLS from the first byte, or requires STARTTLS, and never falls back to plain text", () => {
    expect(imapOptions(CONFIG)).toMatchObject({ host: "imap.example.com", port: 993, secure: true, auth: { user: "alice@example.com", pass: "app-password" }, logger: false });
    expect(imapOptions({ ...CONFIG, imap: { host: "imap.example.com", port: 143, security: "starttls" } })).toMatchObject({ secure: false, doSTARTTLS: true });
    expect(smtpOptions(CONFIG)).toMatchObject({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "alice@example.com", pass: "app-password" } });
    expect(smtpOptions({ ...CONFIG, smtp: { host: "smtp.example.com", port: 587, security: "starttls" } })).toMatchObject({ secure: false, requireTLS: true });
    expect(imapOptions({ ...CONFIG, username: "alice" }).auth).toEqual({ user: "alice", pass: "app-password" });
  });

  it("gives up on a server that does not answer within a minute", () => {
    expect(imapOptions(CONFIG).connectionTimeout).toBeLessThanOrEqual(60_000);
    expect(imapOptions(CONFIG).greetingTimeout).toBeLessThanOrEqual(60_000);
    expect(smtpOptions(CONFIG).connectionTimeout).toBeLessThanOrEqual(60_000);
  });
});

describe("ImapSmtpAdapter against an IMAP server", () => {
  it("logs in, checks SMTP, finds the sent folder by its special use (RFC 6154) and learns about keywords", async () => {
    const { adapter, smtp } = await setUp(seed);
    await adapter.open();
    expect(smtp.verified).toBe(true);
    expect(adapter.keepsKeywords).toBe(true);
    const { entries, complete } = await adapter.listSince(null);
    expect(complete).toEqual(["inbox", "sent"]);
    expect(entries).toEqual([
      { folder: "inbox", uid: "1700000001.1", flags: [SEEN], date: "2026-03-02T09:00:00.000Z" },
      { folder: "inbox", uid: "1700000001.2", flags: [], date: "2026-03-03T09:00:00.000Z" },
      { folder: "inbox", uid: "1700000001.3", flags: [], date: "2026-03-04T09:00:00.000Z" },
      { folder: "sent", uid: "1700000002.1", flags: [SEEN], date: "2026-03-03T10:00:00.000Z" },
    ]);
  });

  it("finds a sent folder by name, or creates one when copies must be stored", async () => {
    const byName = await setUp((server) => {
      const sent = server.mailboxes.get("Sent")!;
      server.mailboxes.delete("Sent");
      server.mailboxes.set("Sent Items", { ...sent, name: "Sent Items", specialUse: null });
      server.deliver("Sent Items", message(9));
    });
    await byName.adapter.open();
    expect((await byName.adapter.listSince(null)).entries.map((e) => e.folder)).toEqual(["sent"]);
    const created = await setUp((server) => server.mailboxes.delete("Sent"));
    await created.adapter.open();
    expect(created.server.mailboxes.has("Sent")).toBe(true);
  });

  it("reports both an IMAP and an SMTP failure at login", async () => {
    const { adapter, smtp } = await setUp();
    const wrong = new ImapSmtpAdapter({ ...CONFIG, password: "wrong" }, { imap: imapTo(servers[0]!), smtp: () => smtp });
    smtp.failVerify = new Error("SMTP says no");
    await expect(wrong.open()).rejects.toThrow(/IMAP imap\.example\.com: [\s\S]*SMTP smtp\.example\.com: SMTP says no/);
    await adapter.close();
  });

  it("finds a message that arrived while INBOX stayed selected (its UIDNEXT from SELECT is stale by then)", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    const first = await adapter.listSince(null);
    server.deliver("INBOX", message(5));
    const second = await adapter.listSince(first.cursor);
    expect(second.complete).toEqual([]);
    expect(second.entries.map((e) => e.uid)).toEqual(["1700000001.4"]);
    expect((await adapter.listSince(second.cursor)).entries).toEqual([]);
    server.deliver("INBOX", message(6));
    server.deliver("Sent", message(7));
    expect((await adapter.listSince(second.cursor)).entries.map((e) => `${e.folder} ${e.uid}`)).toEqual(["inbox 1700000001.5", "sent 1700000002.2"]);
  });

  it("lists everything again after a UIDVALIDITY change (RFC 9051 §2.3.1.1)", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    const first = await adapter.listSince(null);
    server.mailboxes.get("INBOX")!.uidValidity = 1700000099;
    server.dropConnections();
    await until(() => server.connectionCount > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const again = await adapter.listSince(first.cursor);
    expect(again.complete).toEqual(["inbox"]);
    expect(again.entries.map((e) => e.uid)).toEqual(["1700000099.1", "1700000099.2", "1700000099.3"]);
  });

  it("lists at most maxMessages per folder, the newest", async () => {
    const { adapter } = await setUp(seed, { maxMessages: 2 });
    await adapter.open();
    expect((await adapter.listSince(null)).entries.filter((e) => e.folder === "inbox").map((e) => e.uid)).toEqual(["1700000001.2", "1700000001.3"]);
  });

  it("fetches one or many raw messages and refuses a uid from an old UIDVALIDITY", async () => {
    const { adapter, server } = await setUp((s) => {
      seed(s);
      for (let n = 10; n < 70; n++) s.deliver("INBOX", message(n));
    });
    await adapter.open();
    expect(new TextDecoder().decode(await adapter.fetchRaw({ folder: "inbox", uid: "1700000001.2" }))).toContain("body 2");
    expect(new TextDecoder().decode(await adapter.fetchRaw({ folder: "sent", uid: "1700000002.1" }))).toContain("body 4");
    await expect(adapter.fetchRaw({ folder: "inbox", uid: "1700000000.2" })).rejects.toThrow(/renumbered/);
    await expect(adapter.fetchRaw({ folder: "inbox", uid: "1700000001.999" })).rejects.toThrow();
    const got: string[] = [];
    const refs = Array.from({ length: 63 }, (_, i) => ({ folder: "inbox" as const, uid: `1700000001.${i + 1}` }));
    await adapter.fetchMany([...refs, { folder: "sent", uid: "1700000002.1" }], (ref, raw) => got.push(`${ref.uid} ${new TextDecoder().decode(raw).length > 0}`));
    expect(got).toHaveLength(64);
    // Single fetches: 2, and 1 for uid 999. fetchMany: 63 inbox messages in batches of 25, and 1 sent message.
    expect(server.commands.filter((c) => c.startsWith("UID FETCH") && c.includes("BODY.PEEK[]")).length).toBe(3 + 3 + 1);
  });

  it("adds flags with UID STORE and stores sent copies marked \\Seen, then selects INBOX again for IDLE", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    await adapter.addFlags({ folder: "inbox", uid: "1700000001.2" }, [SEEN, "$EsRead"]);
    expect(server.mailboxes.get("INBOX")!.messages[1]!.flags).toEqual([SEEN, "$EsRead"]);
    const entry = await adapter.appendToSent(new TextEncoder().encode("Subject: sent\r\n\r\nhi\r\n"));
    expect(entry).toEqual({ folder: "sent", uid: "1700000002.2", flags: [SEEN] });
    await adapter.fetchRaw({ folder: "sent", uid: "1700000002.1" });
    expect(server.commands.filter((c) => c.startsWith("SELECT")).at(-1)).toBe("SELECT INBOX");
  });

  it("sends through SMTP with the given envelope", async () => {
    const { adapter, smtp } = await setUp();
    await adapter.open();
    await adapter.send(new TextEncoder().encode("Subject: x\r\n\r\ny\r\n"), { from: "alice@example.com", to: ["bob@example.org"] });
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]!.envelope).toEqual({ from: "alice@example.com", to: ["bob@example.org"] });
    expect(smtp.sent[0]!.raw.toString()).toContain("Subject: x");
  });
});

describe("live updates and lost connections", () => {
  it("calls the watcher when INBOX gets a new message while idling (IDLE, RFC 2177), and stops on request", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    let calls = 0;
    const stop = adapter.watch(() => calls++);
    // imapflow starts IDLE after a quiet moment.
    await until(() => server.commands.includes("IDLE"), 20_000);
    server.deliver("INBOX", message(8));
    await until(() => calls === 1);
    stop();
    server.deliver("INBOX", message(9));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(1);
  }, 30_000);

  it("checks every folder on a timer, for servers without IDLE and for the sent folder", async () => {
    const { adapter } = await setUp(seed, { pollMs: 100 });
    await adapter.open();
    let calls = 0;
    const stop = adapter.watch(() => calls++);
    await until(() => calls >= 2, 2000);
    stop();
  });

  it("reconnects after the connection is lost, telling the watcher, and then reports a change", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    const statuses: ConnectionStatus["state"][] = [];
    let calls = 0;
    adapter.watch(
      () => calls++,
      (status) => statuses.push(status.state),
    );
    server.dropConnections();
    await until(() => statuses.at(-1) === "online" && statuses.includes("reconnecting"));
    expect(statuses).toEqual(["online", "reconnecting", "online"]);
    await until(() => calls >= 1);
    server.deliver("INBOX", message(5));
    expect((await adapter.listSince(null)).entries.filter((e) => e.folder === "inbox")).toHaveLength(4);
  });

  it("drops a connection that stopped answering: waiting operations fail, and it connects again", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    const statuses: string[] = [];
    adapter.watch(
      () => undefined,
      (status) => statuses.push(status.state === "online" ? "online" : `reconnecting: ${status.error}`),
    );
    server.stall();
    const hanging = adapter.fetchRaw({ folder: "inbox", uid: "1700000001.2" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    adapter.reconnect("no answer for 45 s");
    await expect(hanging).rejects.toThrow();
    expect(statuses).toContain("reconnecting: no answer for 45 s");
    server.resume();
    await until(() => statuses.at(-1) === "online");
    expect(new TextDecoder().decode(await adapter.fetchRaw({ folder: "inbox", uid: "1700000001.2" }))).toContain("body 2");
  });

  it("closes at once even when the server stopped answering", async () => {
    const { adapter, server } = await setUp(seed);
    await adapter.open();
    server.stall();
    const started = Date.now();
    await adapter.close();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
