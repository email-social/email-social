import { request } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import type { ChatSummary, ChatView, ContactDetail, OtherSummary, OtherView, SendResult, SessionInfo } from "../src/api-types.js";
import { startBridge, type BridgeOptions, type RunningBridge } from "../src/bridge.js";
import { MemoryStore, type AccountConfig } from "../src/credentials.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { NOW, demoMaildir, tempDir } from "./helpers/session.js";

const running: RunningBridge[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()!.close();
});

function webRoot(): string {
  const root = tempDir("es-web-");
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<!doctype html><title>Email Social</title><script type="module" src="./assets/app.js"></script>');
  writeFileSync(join(root, "assets", "app.js"), "console.log('app');");
  return root;
}

async function start(extra: Partial<BridgeOptions> = {}): Promise<RunningBridge> {
  const bridge = await startBridge({ webRoot: webRoot(), clock: () => NOW, log: () => undefined, ...extra });
  running.push(bridge);
  return bridge;
}

async function demoBridge(extra: Partial<BridgeOptions> = {}): Promise<RunningBridge> {
  return start({ maildir: { root: await demoMaildir(), account: DEMO_ACCOUNT, pollMs: 60_000 }, ...extra });
}

function api(bridge: RunningBridge, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${bridge.token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
  });
}

async function json<T>(response: Response): Promise<T> {
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  return (await response.json()) as T;
}

/** A raw request with a chosen Host header (fetch does not allow setting it). */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("local API: where and to whom it answers", () => {
  it("listens on 127.0.0.1 only, on a random port, with a per-session token in the URL", async () => {
    const a = await demoBridge();
    const b = await demoBridge();
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{43}$/);
    expect(a.address).toBe("127.0.0.1");
    expect(a.port).not.toBe(b.port);
    expect(a.token).not.toBe(b.token);
  });

  it("refuses API calls without the session token", async () => {
    const bridge = await demoBridge();
    const base = `http://127.0.0.1:${bridge.port}`;
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
    expect((await fetch(`${base}/api/session`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(`${base}/api/session?token=${bridge.token}`)).status).toBe(200);
    expect((await api(bridge, "/api/session")).status).toBe(200);
  });

  it("refuses requests addressed to another host name (DNS rebinding)", async () => {
    const bridge = await demoBridge();
    const auth = { authorization: `Bearer ${bridge.token}` };
    expect(await rawGet(bridge.port, "/api/session", { ...auth, host: `attacker.example.com:${bridge.port}` })).toBe(403);
    expect(await rawGet(bridge.port, "/", { host: `attacker.example.com:${bridge.port}` })).toBe(403);
    expect(await rawGet(bridge.port, "/api/session", { ...auth, host: `localhost:${bridge.port}` })).toBe(200);
  });

  it("serves the web client with a policy that allows nothing but this origin", async () => {
    const bridge = await demoBridge();
    const page = await fetch(`http://127.0.0.1:${bridge.port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await page.text()).toContain("<title>Email Social</title>");
    const csp = page.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${bridge.port} ws://localhost:${bridge.port}`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const script = await fetch(`http://127.0.0.1:${bridge.port}/assets/app.js`);
    expect(script.headers.get("content-type")).toMatch(/^text\/javascript/);
    for (const path of ["/assets/%2e%2e/%2e%2e/package.json", "/nope.js", "/assets/missing.js", "/assets/sub/app.js"]) {
      expect((await fetch(`http://127.0.0.1:${bridge.port}${path}`)).status, path).toBe(404);
    }
    // fetch() removes "../" before sending; a raw request keeps it.
    expect(await rawGet(bridge.port, "/assets/../../package.json", { host: `127.0.0.1:${bridge.port}` })).toBe(404);
  });
});

describe("local API: the mailbox as chats", () => {
  it("lists chats and Other mail, opens a chat, marks it read and lists contacts", async () => {
    const bridge = await demoBridge();
    const session = await json<SessionInfo>(await api(bridge, "/api/session"));
    expect(session).toEqual({
      state: "ready",
      account: { address: "alice@example.com", name: "Alice Dvořáková" },
      mode: "maildir",
      remembered: false,
      sync: { loading: null, connection: "online", error: null },
    });
    const list = await json<ChatSummary[]>(await api(bridge, "/api/chats"));
    expect(list).toHaveLength(7);
    const anna = list.find((c) => c.title === "Anna Becker")!;
    expect(anna.unread).toBe(2);
    const chat = await json<ChatView>(await api(bridge, `/api/chats/${anna.id}`));
    expect(chat.messages).toHaveLength(5);
    expect((await api(bridge, `/api/chats/${anna.id}/read`, { method: "POST", body: "{}" })).status).toBe(204);
    const after = await json<ChatSummary[]>(await api(bridge, "/api/chats"));
    expect(after.find((c) => c.id === anna.id)!.unread).toBe(0);
    expect((await api(bridge, "/api/chats/chat-unknown")).status).toBe(404);
    expect((await api(bridge, "/api/chats/chat-unknown/read", { method: "POST", body: "{}" })).status).toBe(404);
    const others = await json<OtherSummary[]>(await api(bridge, "/api/other"));
    expect(others.map((o) => o.title)).toEqual(["dev-list@lists.example.org", "Garden Club"]);
    const news = await json<OtherView>(await api(bridge, `/api/other/${others[1]!.id}`));
    expect(news.messages[0]!.textSource).toBe("html");
    expect((await api(bridge, `/api/other/${others[1]!.id}/read`, { method: "POST", body: "{}" })).status).toBe(204);
    const contacts = await json<{ address: string }[]>(await api(bridge, "/api/contacts"));
    expect(contacts.map((c) => c.address)).toContain("karel@example.org");
    const bob = await json<ContactDetail>(await api(bridge, "/api/contacts/bob%40example.org"));
    expect(bob).toMatchObject({ address: "bob@example.org", count: 15, firstDate: "2026-03-02T08:15:42.000Z" });
    expect(bob.attachments).toHaveLength(3);
    expect((await api(bridge, "/api/contacts/nobody%40example.org")).status).toBe(404);
  });

  it("sends a reply or starts a new chat, and checks the request", async () => {
    const bridge = await demoBridge();
    const [first] = await json<ChatSummary[]>(await api(bridge, "/api/chats"));
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      api(bridge, "/api/messages", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });
    const sent = await post({ chatId: first!.id, text: "On my way" });
    expect(sent.status).toBe(201);
    expect(await json<SendResult>(sent)).toMatchObject({ chatId: first!.id, message: { mine: true, fresh: "On my way" } });
    const created = await json<SendResult>(await post({ to: ["zuzana@example.net"], text: "Hello Zuzana" }));
    expect(created.message.subject).toBe("Hello Zuzana");
    // Both messages carry the test clock's time, so the order between the two chats is not the point here.
    expect((await json<ChatSummary[]>(await api(bridge, "/api/chats"))).find((c) => c.id === created.chatId)).toMatchObject({ lastLine: "Hello Zuzana", lastFromMe: true });
    expect((await post({ chatId: first!.id, text: "  " })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ text: "x" })).status).toBe(400);
    expect((await post({ chatId: first!.id, to: ["a@example.org"], text: "x" })).status).toBe(400);
    expect((await post({ to: "a@example.org", text: "x" })).status).toBe(400);
    expect((await post({ to: ["not an address"], text: "x" })).status).toBe(400);
    expect((await post({ chatId: first!.id, text: "x" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ chatId: "chat-unknown", text: "x" })).status).toBe(404);
  });

  it("serves attachments and originals as downloads, never as pages", async () => {
    const bridge = await demoBridge();
    const list = await json<ChatSummary[]>(await api(bridge, "/api/chats"));
    const chat = await json<ChatView>(await api(bridge, `/api/chats/${list.find((c) => c.title === "Bob Svoboda")!.id}`));
    const message = chat.messages.find((m) => m.attachments.some((a) => a.filename === "Návrh smlouvy.pdf"))!;
    const pdf = await fetch(`http://127.0.0.1:${bridge.port}${message.attachments[0]!.path}?token=${bridge.token}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/octet-stream");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("content-disposition")).toBe(`attachment; filename="N_vrh smlouvy.pdf"; filename*=UTF-8''N%C3%A1vrh%20smlouvy.pdf`);
    expect(new TextDecoder().decode(await pdf.arrayBuffer()).startsWith("%PDF-")).toBe(true);
    const original = await fetch(`http://127.0.0.1:${bridge.port}${message.originalPath}?token=${bridge.token}`);
    expect(original.headers.get("content-type")).toBe("message/rfc822");
    expect(original.headers.get("content-disposition")).toMatch(/^attachment; filename="[^"]+\.eml"/);
    expect((await fetch(`http://127.0.0.1:${bridge.port}/api/messages/inbox%3Anope.eml/original?token=${bridge.token}`)).status).toBe(404);
  });

  it("pushes change events over a WebSocket that needs the token and this origin", async () => {
    const bridge = await demoBridge();
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/api/events?token=${bridge.token}`, { origin: `http://127.0.0.1:${bridge.port}` });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const event = new Promise<string>((resolve) => ws.on("message", (data) => JSON.parse(String(data)).type === "changed" && resolve(String(data))));
    const [first] = await json<ChatSummary[]>(await api(bridge, "/api/chats"));
    await api(bridge, "/api/messages", { method: "POST", body: JSON.stringify({ chatId: first!.id, text: "ping" }) });
    expect(JSON.parse(await event)).toEqual({ type: "changed" });
    ws.close();

    for (const [url, origin] of [
      [`ws://127.0.0.1:${bridge.port}/api/events`, `http://127.0.0.1:${bridge.port}`],
      [`ws://127.0.0.1:${bridge.port}/api/events?token=${bridge.token}`, "http://attacker.example.com"],
    ] as const) {
      const refused = new WebSocket(url, { origin });
      const status = await new Promise<number>((resolve) => {
        refused.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        refused.once("open", () => resolve(101));
        refused.once("error", () => resolve(-1));
      });
      expect(status).toBe(403);
    }
  });
});

describe("local API: signing in to an IMAP account", () => {
  const LOGIN = {
    address: "alice@example.com",
    name: "Alice Dvořáková",
    password: "app-password-123",
    imap: { host: "imap.example.com", port: 993, security: "tls" },
    smtp: { host: "smtp.example.com", port: 465, security: "tls" },
  };

  async function imapBridge(store: MemoryStore, fail = false) {
    const root = await demoMaildir();
    const seen: AccountConfig[] = [];
    const bridge = await start({
      credentials: store,
      connect: (config) => {
        seen.push(config);
        if (fail) {
          return Object.assign(new MaildirAdapter(root), { open: async () => Promise.reject(new Error("IMAP imap.example.com: authentication failed")) });
        }
        return new MaildirAdapter(root, { pollMs: 60_000 });
      },
    });
    return { bridge, seen };
  }

  it("starts signed out with provider presets", async () => {
    const { bridge } = await imapBridge(new MemoryStore());
    const info = await json<Extract<SessionInfo, { state: "signed-out" }>>(await api(bridge, "/api/session"));
    expect(info.state).toBe("signed-out");
    expect(info.presets.map((p) => p.id)).toEqual(["gmail", "seznam", "other"]);
  });

  it("signs in with the settings from the form and keeps them only in memory unless asked", async () => {
    const store = new MemoryStore();
    const { bridge, seen } = await imapBridge(store);
    const response = await api(bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: false }) });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain(LOGIN.password);
    expect(JSON.parse(body)).toMatchObject({ state: "ready", mode: "imap", remembered: false });
    expect(seen[0]).toMatchObject({ address: "alice@example.com", password: LOGIN.password, username: "", appendToSent: true });
    expect(await store.load()).toBeNull();
    expect(await json<ChatSummary[]>(await api(bridge, "/api/chats"))).toHaveLength(7);
  });

  it("remembers the account when asked, signs in with it at the next start, and forgets it on request", async () => {
    const store = new MemoryStore();
    const first = await imapBridge(store);
    await api(first.bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: true }) });
    expect(await store.load()).toMatchObject({ address: "alice@example.com", password: LOGIN.password });
    const second = await imapBridge(store);
    await second.bridge.ready;
    expect(await json<SessionInfo>(await api(second.bridge, "/api/session"))).toMatchObject({ state: "ready", remembered: true });
    const out = await json<SessionInfo>(await api(second.bridge, "/api/logout", { method: "POST", body: JSON.stringify({ forget: true }) }));
    expect(out.state).toBe("signed-out");
    expect(await store.load()).toBeNull();
    expect((await api(second.bridge, "/api/chats")).status).toBe(409);
  });

  it("reports a failed sign-in without echoing the password", async () => {
    const { bridge } = await imapBridge(new MemoryStore(), true);
    const response = await api(bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: true }) });
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).toContain("authentication failed");
    expect(body).not.toContain(LOGIN.password);
    expect(await json<SessionInfo>(await api(bridge, "/api/session"))).toMatchObject({
      state: "signed-out",
      error: expect.stringContaining("authentication failed"),
      canRetry: true,
    });
  });
  it("tries the last sign-in again on request, with the settings kept in memory", async () => {
    let attempts = 0;
    const root = await demoMaildir();
    const bridge = await start({
      credentials: new MemoryStore(),
      connect: () => {
        attempts++;
        const adapter = new MaildirAdapter(root, { pollMs: 60_000 });
        return attempts === 1 ? Object.assign(adapter, { open: async () => Promise.reject(new Error("IMAP imap.example.com: timed out")) }) : adapter;
      },
    });
    expect((await api(bridge, "/api/retry", { method: "POST", body: "{}" })).status).toBe(409);
    expect((await api(bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: false }) })).status).toBe(401);
    const retried = await api(bridge, "/api/retry", { method: "POST", body: "{}" });
    expect(retried.status).toBe(200);
    expect(await json<SessionInfo>(retried)).toMatchObject({ state: "ready" });
    expect(attempts).toBe(2);
    expect((await api(bridge, "/api/retry", { method: "POST", body: "{}" })).status).toBe(202);
    await api(bridge, "/api/logout", { method: "POST", body: "{}" });
    expect(await json<SessionInfo>(await api(bridge, "/api/session"))).toMatchObject({ state: "signed-out", canRetry: false });
  });

  it("reports progress while signing in: connecting, listing, then a changing count of loaded messages", async () => {
    const root = await demoMaildir();
    const bridge = await start({ credentials: new MemoryStore(), firstBatch: 20, connect: () => new MaildirAdapter(root, { pollMs: 60_000 }) });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/api/events?token=${bridge.token}`, { origin: `http://127.0.0.1:${bridge.port}` });
    await new Promise((resolve) => ws.once("open", resolve));
    const seen: string[] = [];
    ws.on("message", () => {
      void api(bridge, "/api/session")
        .then((r) => r.json())
        .then((info: SessionInfo) => {
          if (info.state === "connecting") seen.push(`${info.progress.step} ${info.progress.loaded}/${info.progress.total ?? "?"}`);
        });
    });
    const response = await api(bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: false }) });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => /^(connecting|listing|loading) \d+\/(\?|45)$/.test(s))).toBe(true);
  });

  it("rejects incomplete sign-in requests", async () => {
    const { bridge } = await imapBridge(new MemoryStore());
    for (const body of [{}, { ...LOGIN, address: "no-at-sign" }, { ...LOGIN, imap: { host: "", port: 993, security: "tls" } }, { ...LOGIN, smtp: { host: "smtp.example.com", port: 25, security: "none" } }]) {
      expect((await api(bridge, "/api/login", { method: "POST", body: JSON.stringify(body) })).status, JSON.stringify(body)).toBe(400);
    }
  });
});
