/**
 * Acceptance: "the bridge makes no outbound connection other than the
 * configured IMAP/SMTP hosts (mock DNS/sockets), and no message body is
 * written under the cache dir" (tasks/02).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { extractPart, parseMessage } from "@email-social/es-core";
import type { ConversationSummary, ThreadView } from "../src/api-types.js";
import { startBridge, type RunningBridge } from "../src/bridge.js";
import { MemoryStore } from "../src/credentials.js";
import { DEMO_ACCOUNT, buildDemoMailbox } from "../src/demo.js";
import { guardNetwork, type Attempt } from "./helpers/network-guard.js";
import { NOW, demoMaildir, tempDir } from "./helpers/session.js";

let guard: { attempts: Attempt[]; restore(): void };
const ports: number[] = [];
const bridges: RunningBridge[] = [];

beforeEach(() => {
  guard = guardNetwork(() => ports);
});
afterEach(async () => {
  while (bridges.length > 0) await bridges.pop()!.close();
  guard.restore();
  ports.length = 0;
});

async function start(options: Parameters<typeof startBridge>[0]): Promise<RunningBridge> {
  const bridge = await startBridge({ clock: () => NOW, log: () => undefined, ...options });
  bridges.push(bridge);
  ports.push(bridge.port);
  return bridge;
}

function call(bridge: RunningBridge, path: string, body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${bridge.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Uses everything the web client uses: list, threads, read marks, replies, downloads, contacts, events. */
async function exercise(bridge: RunningBridge, reply: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/api/events?token=${bridge.token}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const list = (await (await call(bridge, "/api/conversations")).json()) as ConversationSummary[];
  expect(list).toHaveLength(9);
  for (const conversation of list) {
    const thread = (await (await call(bridge, `/api/conversations/${conversation.id}`)).json()) as ThreadView;
    expect((await call(bridge, `/api/conversations/${conversation.id}/read`, {})).status).toBe(204);
    for (const message of thread.messages) {
      expect((await call(bridge, message.originalPath)).status).toBe(200);
      for (const attachment of message.attachments) expect((await call(bridge, attachment.path)).status).toBe(200);
    }
  }
  expect((await call(bridge, `/api/conversations/${list[0]!.id}/messages`, { text: reply })).status).toBe(201);
  expect((await call(bridge, "/api/contacts")).status).toBe(200);
  expect((await fetch(`http://127.0.0.1:${bridge.port}/`)).status).toBe(404);
  ws.close();
}

describe("nothing leaves the machine", () => {
  it("(control) the guard sees and stops any outbound connection or DNS query", async () => {
    await expect(fetch("http://collector.example.net/ping")).rejects.toThrow();
    await expect(import("node:dns").then((d) => d.promises.resolve4("cdn.example.org"))).rejects.toThrow();
    expect(guard.attempts.map((a) => a.host).sort()).toEqual(["cdn.example.org", "collector.example.net"]);
  });

  it("a maildir session makes no outbound connection and no DNS query at all", async () => {
    const bridge = await start({ webRoot: null, maildir: { root: await demoMaildir(), account: DEMO_ACCOUNT, pollMs: 60_000 } });
    await exercise(bridge, "Nic neodchází.");
    expect(guard.attempts).toEqual([]);
  });

  it("an IMAP sign-in connects only to the configured IMAP and SMTP hosts", async () => {
    const bridge = await start({ webRoot: null, credentials: new MemoryStore() });
    const response = await call(bridge, "/api/login", {
      address: "alice@example.com",
      password: "app-password",
      imap: { host: "imap.example.com", port: 993, security: "tls" },
      smtp: { host: "smtp.example.com", port: 465, security: "tls" },
      remember: false,
    });
    // The guard refuses the connections, so the sign-in fails; what matters is where it tried to go.
    expect(response.status).toBe(401);
    const targets = new Set(guard.attempts.map((a) => a.host));
    expect([...targets].sort()).toEqual(["imap.example.com", "smtp.example.com"]);
    for (const attempt of guard.attempts.filter((a) => a.kind === "connect")) {
      expect(`${attempt.host}:${attempt.port}`).toMatch(/^(imap\.example\.com:993|smtp\.example\.com:465)$/);
    }
    expect(guard.attempts.some((a) => a.host === "imap.example.com")).toBe(true);
    expect(guard.attempts.some((a) => a.host === "smtp.example.com")).toBe(true);
  });
});

describe("the metadata cache keeps no message body", () => {
  /** Lines of text that belong to bodies (text parts, ES text, attachments), not to headers. */
  function bodyLines(extra: string[]): string[] {
    const messages = buildDemoMailbox().map((m) => ({ raw: m.raw, message: parseMessage(m.raw) }));
    const metadata = JSON.stringify(messages.map(({ message }) => ({ ...message, text: "", es: null })));
    const lines = new Set<string>(extra);
    for (const { raw, message } of messages) {
      for (const line of message.text.split("\n")) lines.add(line.trim());
      for (const a of message.attachments) lines.add(new TextDecoder().decode(extractPart(raw, a.partId)!.bytes).split("\n")[0]!.trim());
    }
    return [...lines].filter((l) => l.length >= 12 && !metadata.includes(l));
  }

  it("stores headers and flags under --cache-dir, never text, and still shows the text after a restart", async () => {
    const root = await demoMaildir();
    const cacheDir = tempDir("es-cache-");
    const reply = "Tahle odpověď nesmí skončit v cache.";
    const first = await start({ webRoot: null, cacheDir, maildir: { root, account: DEMO_ACCOUNT, pollMs: 60_000 } });
    await exercise(first, reply);
    await first.close();
    bridges.splice(bridges.indexOf(first), 1);

    const files = readdirSync(cacheDir);
    expect(files.length).toBeGreaterThan(0);
    const contents = files.map((f) => readFileSync(join(cacheDir, f), "utf8")).join("\n");
    expect(contents).toContain("karel@example.org");
    expect(contents).toContain("Kdy dorazíš?");
    const needles = bodyLines([reply]);
    expect(needles.length).toBeGreaterThan(40);
    for (const needle of needles) {
      expect(contents.includes(needle) || contents.includes(JSON.stringify(needle).slice(1, -1)), needle).toBe(false);
    }

    const second = await start({ webRoot: null, cacheDir, maildir: { root, account: DEMO_ACCOUNT, pollMs: 60_000 } });
    const list = (await (await call(second, "/api/conversations")).json()) as ConversationSummary[];
    expect(list[0]).toMatchObject({ lastLine: reply, lastFromMe: true });
    const thread = (await (await call(second, `/api/conversations/${list[0]!.id}`)).json()) as ThreadView;
    expect(thread.messages[thread.messages.length - 1]!.text).toBe(reply);
    expect(guard.attempts).toEqual([]);
  });
});
