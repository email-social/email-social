/**
 * Acceptance (tasks/02b): live updates and a sign-in that shows progress,
 * against an IMAP server on 127.0.0.1 (helpers/fake-imap.ts) with the real
 * imapflow client:
 * - a message delivered while the page is open appears without a reload
 *   (IDLE, or polling on a server without IDLE), and a reload shows it;
 * - with 200 ms per message, the chats are there after the first 50 and the
 *   count of loaded messages changes;
 * - a server that stops answering is reported (and "Try again" works), a
 *   lost connection is re-established.
 */
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ImapSmtpAdapter } from "../src/adapters/imap-smtp.js";
import type { ChatSummary, SessionInfo } from "../src/api-types.js";
import { startBridge, type BridgeOptions, type RunningBridge } from "../src/bridge.js";
import { MemoryStore } from "../src/credentials.js";
import { buildDemoMailbox } from "../src/demo.js";
import { FakeImapServer, FakeSmtp, imapTo } from "./helpers/fake-imap.js";
import { NOW } from "./helpers/session.js";

const LOGIN = {
  address: "alice@example.com",
  name: "Alice Dvořáková",
  password: "app-password",
  imap: { host: "imap.example.com", port: 993, security: "tls" },
  smtp: { host: "smtp.example.com", port: 465, security: "tls" },
  remember: false,
};

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

/** A fake IMAP server holding the demo mailbox (INBOX and Sent, with its flags). */
async function demoServer(options: ConstructorParameters<typeof FakeImapServer>[0] = {}): Promise<FakeImapServer> {
  const server = new FakeImapServer(options);
  for (const m of buildDemoMailbox()) server.deliver(m.folder === "inbox" ? "INBOX" : "Sent", m.raw, { flags: m.seen ? ["\\Seen"] : [] });
  await server.start();
  cleanup.push(() => server.close());
  return server;
}

async function bridgeFor(server: FakeImapServer, extra: Partial<BridgeOptions> & { imapPollMs?: number; backoffMs?: number[] } = {}): Promise<RunningBridge> {
  const smtp = new FakeSmtp();
  const bridge = await startBridge({
    webRoot: null,
    credentials: new MemoryStore(),
    clock: () => NOW,
    log: () => undefined,
    connect: (config) => new ImapSmtpAdapter(config, { imap: imapTo(server), smtp: () => smtp, pollMs: extra.imapPollMs ?? 60_000, backoffMs: extra.backoffMs ?? [100, 200, 400] }),
    ...extra,
  });
  cleanup.push(() => bridge.close());
  return bridge;
}

function call(bridge: RunningBridge, path: string, body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${bridge.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const session = async (bridge: RunningBridge): Promise<SessionInfo> => (await (await call(bridge, "/api/session")).json()) as SessionInfo;
const chats = async (bridge: RunningBridge): Promise<ChatSummary[]> => (await (await call(bridge, "/api/chats")).json()) as ChatSummary[];

async function events(bridge: RunningBridge): Promise<{ next(type: string, ms: number): Promise<number>; close(): void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/api/events?token=${bridge.token}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(async () => ws.close());
  return {
    next: (type, ms) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setTimeout(() => reject(new Error(`no ${type} event within ${ms} ms`)), ms);
        const listener = (data: WebSocket.RawData): void => {
          if ((JSON.parse(String(data)) as { type: string }).type !== type) return;
          clearTimeout(timer);
          ws.off("message", listener);
          resolve(Date.now() - started);
        };
        ws.on("message", listener);
      }),
    close: () => ws.close(),
  };
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`condition not met within ${ms} ms: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const NEW_MAIL =
  "From: Zuzana Veselá <zuzana@example.net>\r\nTo: alice@example.com\r\nSubject: Ahoj\r\nDate: Sat, 21 Mar 2026 11:00:00 +0100\r\nMessage-ID: <new-1@example.net>\r\n\r\nJsem zpátky z hor!\r\n";

describe("live updates", () => {
  it("shows a message delivered while the page is open without a reload (IDLE), and after a reload", async () => {
    const server = await demoServer();
    const bridge = await bridgeFor(server);
    expect((await call(bridge, "/api/login", LOGIN)).status).toBe(200);
    const page = await events(bridge);
    // imapflow idles once the connection has been quiet for a moment.
    await until(async () => server.commands.includes("IDLE"), Boolean, 10_000);
    const changed = page.next("changed", 10_000);
    server.deliver("INBOX", NEW_MAIL);
    expect(await changed).toBeLessThan(5000);
    expect((await chats(bridge))[0]).toMatchObject({ title: "Zuzana Veselá", lastLine: "Jsem zpátky z hor!", unread: 1 });
    // A reload asks again and gets the same.
    expect((await chats(bridge)).find((c) => c.title === "Zuzana Veselá")).toBeDefined();
  }, 30_000);

  it("finds new mail by polling on a server without IDLE, and messages sent from another client in the sent folder", async () => {
    const server = await demoServer({ idle: false });
    const bridge = await bridgeFor(server, { imapPollMs: 500 });
    expect((await call(bridge, "/api/login", LOGIN)).status).toBe(200);
    const page = await events(bridge);
    server.deliver("INBOX", NEW_MAIL);
    expect(await page.next("changed", 5000)).toBeLessThan(3000);
    expect((await chats(bridge)).some((c) => c.title === "Zuzana Veselá")).toBe(true);
    server.deliver(
      "Sent",
      "From: Alice <alice@example.com>\r\nTo: zuzana@example.net\r\nSubject: Re: Ahoj\r\nDate: Sat, 21 Mar 2026 11:05:00 +0100\r\nMessage-ID: <sent-elsewhere@example.com>\r\n\r\nVítej zpátky!\r\n",
      { flags: ["\\Seen"] },
    );
    await page.next("changed", 5000);
    expect((await chats(bridge)).find((c) => c.title === "Zuzana Veselá")).toMatchObject({ lastLine: "Vítej zpátky!", lastFromMe: true, unread: 1 });
  }, 30_000);

  it("re-establishes a lost connection, saying so meanwhile, and then shows what arrived", async () => {
    const server = await demoServer();
    // The first attempt to reconnect waits 1.5 s, long enough to see "reconnecting".
    const bridge = await bridgeFor(server, { backoffMs: [1500, 200] });
    expect((await call(bridge, "/api/login", LOGIN)).status).toBe(200);
    const page = await events(bridge);
    const told = page.next("session", 5000);
    server.dropConnections();
    server.deliver("INBOX", NEW_MAIL);
    await told;
    expect(await session(bridge)).toMatchObject({ state: "ready", sync: { connection: "reconnecting" } });
    await until(() => session(bridge), (info) => info.state === "ready" && info.sync.connection === "online", 10_000);
    await until(() => chats(bridge), (list) => list.some((c) => c.title === "Zuzana Veselá"), 10_000);
  }, 30_000);
});

describe("signing in with progress", () => {
  it("shows chats after the first 50 of 80 messages at 200 ms each, with a count that keeps changing", async () => {
    const server = new FakeImapServer({ delayPerMessageMs: 200 });
    for (let n = 1; n <= 80; n++) {
      server.deliver(
        "INBOX",
        `From: Person ${n} <p${n}@example.org>\r\nTo: alice@example.com\r\nSubject: Message ${n}\r\nDate: Fri, 20 Mar 2026 ${String(Math.floor(n / 60) + 8).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00 +0100\r\nMessage-ID: <p${n}@example.org>\r\n\r\nText ${n}\r\n`,
        { date: new Date(Date.UTC(2026, 2, 20, 7, n)) },
      );
    }
    await server.start();
    cleanup.push(() => server.close());
    const bridge = await bridgeFor(server);
    const counts: number[] = [];
    let polling = true;
    const watcher = (async () => {
      while (polling) {
        const info = await session(bridge);
        if (info.state === "connecting" && info.progress.step === "loading") counts.push(info.progress.loaded);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();
    const started = Date.now();
    const login = await call(bridge, "/api/login", LOGIN);
    const shownAfter = Date.now() - started;
    expect(login.status).toBe(200);
    // 50 messages at 200 ms: about 10 s, not the 16 s all 80 take.
    expect(shownAfter).toBeGreaterThan(9000);
    expect(shownAfter).toBeLessThan(14_000);
    const ready = (await session(bridge)) as Extract<SessionInfo, { state: "ready" }>;
    expect(ready.sync.loading?.total).toBe(80);
    expect(ready.sync.loading!.loaded).toBeGreaterThanOrEqual(50);
    expect(ready.sync.loading!.loaded).toBeLessThan(80);
    const shown = await chats(bridge);
    expect(shown.length).toBeGreaterThanOrEqual(50);
    // The newest came first.
    expect(shown[0]!.title).toBe("Person 80");
    // The count changed at least every second while signing in, and after that too.
    expect(new Set(counts).size).toBeGreaterThanOrEqual(8);
    const loaded = await until(() => session(bridge), (info) => info.state === "ready" && info.sync.loading === null, 15_000);
    expect(loaded.state).toBe("ready");
    expect(await chats(bridge)).toHaveLength(80);
    polling = false;
    await watcher;
  }, 40_000);

  it("reports a server that stops answering during sign-in, well within 60 seconds, and signs in on Try again", async () => {
    const server = await demoServer();
    server.stall();
    const bridge = await bridgeFor(server, { stallMs: 1500 });
    const started = Date.now();
    const login = await call(bridge, "/api/login", LOGIN);
    expect(login.status).toBe(401);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await session(bridge)).toMatchObject({ state: "signed-out", error: expect.stringMatching(/^No answer from the mail server for 2 seconds/), canRetry: true });
    server.resume();
    const retried = await call(bridge, "/api/retry", {});
    expect(retried.status).toBe(200);
    expect(await chats(bridge)).toHaveLength(7);
  }, 20_000);

  it("reports a server that stops answering while older messages load, and finishes on Try again", async () => {
    const server = await demoServer({ delayPerMessageMs: 20 });
    const bridge = await bridgeFor(server, { stallMs: 1000, firstBatch: 10 });
    expect((await call(bridge, "/api/login", LOGIN)).status).toBe(200);
    server.stall();
    const failed = await until(() => session(bridge), (info) => info.state === "ready" && info.sync.error !== null, 10_000);
    expect(failed).toMatchObject({ state: "ready", sync: { error: expect.stringMatching(/^Loading stopped/) } });
    server.resume();
    await until(() => session(bridge), (info) => info.state === "ready" && info.sync.connection === "online", 10_000);
    expect((await call(bridge, "/api/retry", {})).status).toBe(202);
    const done = await until(() => session(bridge), (info) => info.state === "ready" && info.sync.loading === null && info.sync.error === null, 15_000);
    expect(done.state).toBe("ready");
    expect(await chats(bridge)).toHaveLength(7);
  }, 40_000);
});
