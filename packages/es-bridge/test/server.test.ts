import { request } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MaildirAdapter } from "../src/adapters/maildir.js";
import type { ConversationSummary, MessageView, SessionInfo, ThreadView } from "../src/api-types.js";
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

describe("local API: the mailbox as conversations", () => {
  it("lists conversations, opens a thread, marks it read and lists contacts", async () => {
    const bridge = await demoBridge();
    const session = await json<SessionInfo>(await api(bridge, "/api/session"));
    expect(session).toEqual({ state: "ready", account: { address: "alice@example.com", name: "Alice Dvořáková" }, mode: "maildir", remembered: false });
    const list = await json<ConversationSummary[]>(await api(bridge, "/api/conversations"));
    expect(list).toHaveLength(9);
    const b = list.find((c) => c.subject === "Projektübersicht Q2")!;
    expect(b.unread).toBe(2);
    const thread = await json<ThreadView>(await api(bridge, `/api/conversations/${b.id}`));
    expect(thread.messages).toHaveLength(5);
    expect((await api(bridge, `/api/conversations/${b.id}/read`, { method: "POST", body: "{}" })).status).toBe(204);
    const after = await json<ConversationSummary[]>(await api(bridge, "/api/conversations"));
    expect(after.find((c) => c.id === b.id)!.unread).toBe(0);
    expect((await api(bridge, "/api/conversations/conv-unknown")).status).toBe(404);
    const contacts = await json<{ address: string }[]>(await api(bridge, "/api/contacts"));
    expect(contacts.map((c) => c.address)).toContain("karel@example.org");
  });

  it("sends a reply and checks the request", async () => {
    const bridge = await demoBridge();
    const [first] = await json<ConversationSummary[]>(await api(bridge, "/api/conversations"));
    const sent = await api(bridge, `/api/conversations/${first!.id}/messages`, { method: "POST", body: JSON.stringify({ text: "On my way" }) });
    expect(sent.status).toBe(201);
    expect(await json<MessageView>(sent)).toMatchObject({ mine: true, text: "On my way" });
    expect((await api(bridge, `/api/conversations/${first!.id}/messages`, { method: "POST", body: JSON.stringify({ text: "  " }) })).status).toBe(400);
    expect((await api(bridge, `/api/conversations/${first!.id}/messages`, { method: "POST", body: "not json" })).status).toBe(400);
    expect(
      (await api(bridge, `/api/conversations/${first!.id}/messages`, { method: "POST", body: JSON.stringify({ text: "x" }), headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    expect((await api(bridge, `/api/conversations/conv-unknown/messages`, { method: "POST", body: JSON.stringify({ text: "x" }) })).status).toBe(404);
  });

  it("serves attachments and originals as downloads, never as pages", async () => {
    const bridge = await demoBridge();
    const list = await json<ConversationSummary[]>(await api(bridge, "/api/conversations"));
    const thread = await json<ThreadView>(await api(bridge, `/api/conversations/${list.find((c) => c.subject === "Návrh smlouvy")!.id}`));
    const message = thread.messages[0]!;
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
    const event = new Promise<string>((resolve) => ws.once("message", (data) => resolve(String(data))));
    const [first] = await json<ConversationSummary[]>(await api(bridge, "/api/conversations"));
    await api(bridge, `/api/conversations/${first!.id}/messages`, { method: "POST", body: JSON.stringify({ text: "ping" }) });
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
    expect(await json<ConversationSummary[]>(await api(bridge, "/api/conversations"))).toHaveLength(9);
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
    expect((await api(second.bridge, "/api/conversations")).status).toBe(409);
  });

  it("reports a failed sign-in without echoing the password", async () => {
    const { bridge } = await imapBridge(new MemoryStore(), true);
    const response = await api(bridge, "/api/login", { method: "POST", body: JSON.stringify({ ...LOGIN, remember: true }) });
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).toContain("authentication failed");
    expect(body).not.toContain(LOGIN.password);
    expect(await json<SessionInfo>(await api(bridge, "/api/session"))).toMatchObject({ state: "signed-out", error: expect.stringContaining("authentication failed") });
  });

  it("rejects incomplete sign-in requests", async () => {
    const { bridge } = await imapBridge(new MemoryStore());
    for (const body of [{}, { ...LOGIN, address: "no-at-sign" }, { ...LOGIN, imap: { host: "", port: 993, security: "tls" } }, { ...LOGIN, smtp: { host: "smtp.example.com", port: 25, security: "none" } }]) {
      expect((await api(bridge, "/api/login", { method: "POST", body: JSON.stringify(body) })).status, JSON.stringify(body)).toBe(400);
    }
  });
});
