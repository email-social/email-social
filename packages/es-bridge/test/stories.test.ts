/**
 * Acceptance (tasks/04 D, E, F): GET /api/stories, POST /api/stories/open,
 * POST /api/stories/unsubscribe and POST/DELETE /api/stories/hide, with
 * every connection and DNS query of the process recorded. Listing and
 * opening stories reach nobody; the one-click request goes to a local
 * server standing in for the sender's.
 */
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeMessage } from "@email-social/es-core";
import type { HiddenSenders, OtherSummary, StorySender, StoryView, UnsubscribeResult } from "../src/api-types.js";
import { startBridge, type BridgeOptions, type RunningBridge } from "../src/bridge.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { AccountSettings } from "../src/settings.js";
import { guardNetwork, type Attempt } from "./helpers/network-guard.js";
import { NOW, deliver, demoMaildir, folder, tempDir } from "./helpers/session.js";

const STORY_FIXTURES = ["newsletter-one-click", "newsletter-mailto-bulk", "expired-newsletter", "discussion-list", "order-confirmation", "password-reset", "bounce"];
const SHOP = "<20260319073000.7f3a2c@mail.shop.example.org>";
const CLUB = "<weekly-2026-12@club.example.net>";

let guard: { attempts: Attempt[]; restore(): void };
const ports: number[] = [];
const bridges: RunningBridge[] = [];
const servers: Server[] = [];

beforeEach(() => {
  guard = guardNetwork(() => ports);
});
afterEach(async () => {
  while (bridges.length > 0) await bridges.pop()!.close();
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  guard.restore();
  ports.length = 0;
});

/** The demo mailbox plus every story fixture in its INBOX. */
async function mailbox(): Promise<string> {
  const root = await demoMaildir();
  for (const name of STORY_FIXTURES) deliver(root, `story-${name}.eml`, readFileSync(new URL(`../../es-core/fixtures/stories/${name}.eml`, import.meta.url)));
  return root;
}

async function start(root: string, extra: Partial<BridgeOptions> = {}): Promise<RunningBridge> {
  const bridge = await startBridge({ webRoot: null, maildir: { root, account: DEMO_ACCOUNT, pollMs: 60_000 }, clock: () => NOW, newMessageId: () => "<unsubscribe-1@example.com>", log: () => undefined, ...extra });
  bridges.push(bridge);
  ports.push(bridge.port);
  return bridge;
}

function call(bridge: RunningBridge, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${bridge.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response;
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return (await r.json()) as T;
}

/** A local server standing in for the sender's unsubscribe endpoint; `answer` decides each response. */
async function endpoint(answer: (req: IncomingMessage, res: ServerResponse, count: number) => void): Promise<{ requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[]; port: number }> {
  const requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      answer(req, res, requests.length);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  ports.push(port);
  return { requests, port };
}

/** Points every one-click URL at the local endpoint, keeping its path and query. */
const toLocal = (port: number) => (url: URL): URL => new URL(`http://127.0.0.1:${port}${url.pathname}${url.search}`);

describe("GET /api/stories", () => {
  it("lists the stories shown now, one entry per sender, newest first; expired stories and automated mail are left out", async () => {
    const bridge = await start(await mailbox());
    const stories = await json<StorySender[]>(call(bridge, "/api/stories"));
    expect(stories).toEqual([
      {
        sender: { address: "news@club.example.net", name: "Hiking Club" },
        stories: [{ messageId: CLUB, title: "Weekend walks, 21-22 March", receivedAt: "2026-03-20T17:05:00.000Z", expiresAt: "2026-03-27T17:05:00.000Z", unsubscribe: "mailto", seen: false }],
        seen: false,
        chat: false,
      },
      {
        sender: { address: "news@shop.example.org", name: "Shoe Shop" },
        stories: [{ messageId: SHOP, title: "Spring sale: shoes from 20 €", receivedAt: "2026-03-19T07:30:00.000Z", expiresAt: "2026-03-26T07:30:00.000Z", unsubscribe: "oneClick", seen: false }],
        seen: false,
        chat: false,
      },
    ]);
  });

  it("Other mail keeps every story, also the expired one", async () => {
    const bridge = await start(await mailbox());
    const titles = (await json<OtherSummary[]>(call(bridge, "/api/other"))).map((o) => o.title);
    expect(titles).toEqual(expect.arrayContaining(["Shoe Shop", "Hiking Club", "Garden Centre"]));
  });

  it("listing and opening stories makes no request to anyone: no connection, no DNS query", async () => {
    const bridge = await start(await mailbox());
    await json<StorySender[]>(call(bridge, "/api/stories"));
    await json<StoryView>(call(bridge, "/api/stories/open", { messageId: SHOP }));
    await json<StoryView>(call(bridge, "/api/stories/open", { messageId: CLUB }));
    await json<StorySender[]>(call(bridge, "/api/stories"));
    expect(guard.attempts).toEqual([]);
  });
});

describe("POST /api/stories/open", () => {
  it("gives the text and the reduced HTML, images held back, and the way to unsubscribe", async () => {
    const bridge = await start(await mailbox());
    const view = await json<StoryView>(call(bridge, "/api/stories/open", { messageId: SHOP }));
    expect(view).toMatchObject({
      messageId: SHOP,
      sender: { address: "news@shop.example.org", name: "Shoe Shop" },
      title: "Spring sale: shoes from 20 €",
      images: 2,
      unsubscribe: { kind: "oneClick", url: "https://shop.example.org/u/7f3a2c?l=spring", host: "shop.example.org" },
    });
    expect(view.text).toContain("Walking shoes, trail runners and sandals");
    expect(view.html).toContain('data-src="https://img.shop.example.org/2026/spring/hero.jpg"');
    expect(view.html).not.toMatch(/<style|\ssrc=/);
    const club = await json<StoryView>(call(bridge, "/api/stories/open", { messageId: CLUB }));
    expect(club).toMatchObject({ html: null, images: 0, unsubscribe: { kind: "mailto", address: "leave@club.example.net", subject: "unsubscribe weekly" } });
  });

  it("marks the message \\Seen and sends no receipt, even when its ES part asks for one", async () => {
    const root = await mailbox();
    // A newsletter written by an Email Social client that asks for receipts.
    const post = serializeMessage(
      { from: { name: "Shoe Shop", address: "news@shop.example.org" }, to: [{ name: "", address: DEMO_ACCOUNT.address }], subject: "Members' preview", text: "Preview for members.\n", es: { requestReceipts: ["delivered", "read"] } },
      { date: "2026-03-20T09:00:00Z", messageId: "<preview@shop.example.org>" },
    ).replace("\r\nMIME-Version:", "\r\nList-Unsubscribe: <mailto:leave@shop.example.org>\r\nMIME-Version:");
    deliver(root, "story-es.eml", post);
    const bridge = await start(root);
    await json<StoryView>(call(bridge, "/api/stories/open", { messageId: "<preview@shop.example.org>" }));
    const shop = (await json<StorySender[]>(call(bridge, "/api/stories"))).find((s) => s.sender.address === "news@shop.example.org")!;
    expect(shop.stories.map((s) => [s.messageId, s.seen])).toEqual([
      ["<preview@shop.example.org>", true],
      [SHOP, false],
    ]);
    const other = (await json<OtherSummary[]>(call(bridge, "/api/other"))).find((o) => o.title === "Shoe Shop")!;
    expect((await call(bridge, `/api/other/${other.id}/read`, {})).status).toBe(204);
    // The demo's own Email Social posts got their Delivered receipts at start; the newsletter got none.
    expect(folder(root, "Outbox").filter((m) => m.message.to.some((a) => a.address === "news@shop.example.org"))).toEqual([]);
  });

  it("answers 404 for an expired story, a message that is not a story and an unknown id, and 400 without an id", async () => {
    const bridge = await start(await mailbox());
    for (const messageId of ["<newsletter-2026-11@garden.example.com>", "<order-10-4471.confirm@shop.example.org>", "<nope@example.org>"]) {
      expect((await call(bridge, "/api/stories/open", { messageId })).status, messageId).toBe(404);
      expect((await call(bridge, "/api/stories/unsubscribe", { messageId })).status, messageId).toBe(404);
    }
    expect((await call(bridge, "/api/stories/open", {})).status).toBe(400);
    expect((await call(bridge, "/api/stories/hide", { sender: "nobody" })).status).toBe(400);
  });
});

describe("POST /api/stories/unsubscribe", () => {
  it("one-click: exactly one POST with List-Unsubscribe=One-Click and nothing else, then the sender is hidden", async () => {
    const server = await endpoint((_, res) => res.writeHead(200).end("ok"));
    const root = await mailbox();
    const bridge = await start(root, { unsubscribeRewrite: toLocal(server.port) });
    const outbox = folder(root, "Outbox").length;
    const result = await json<UnsubscribeResult>(call(bridge, "/api/stories/unsubscribe", { messageId: SHOP }));
    expect(result).toEqual({ done: "oneClick", host: "shop.example.org", status: 200, hidden: true });
    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request).toMatchObject({ method: "POST", url: "/u/7f3a2c?l=spring", body: "List-Unsubscribe=One-Click" });
    expect(Object.keys(request!.headers).sort()).toEqual(["connection", "content-length", "content-type", "host"]);
    expect(request!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect((await json<StorySender[]>(call(bridge, "/api/stories"))).map((s) => s.sender.address)).toEqual(["news@club.example.net"]);
    expect(folder(root, "Outbox")).toHaveLength(outbox);
    expect(guard.attempts).toEqual([]);
  });

  it("one-click: follows one redirect to https with the same POST, never a second one, and hides nobody on failure", async () => {
    const once = await endpoint((_, res, n) => (n === 1 ? res.writeHead(307, { location: "https://shop.example.org/u/done" }).end() : res.writeHead(204).end()));
    let bridge = await start(await mailbox(), { unsubscribeRewrite: toLocal(once.port) });
    expect(await json<UnsubscribeResult>(call(bridge, "/api/stories/unsubscribe", { messageId: SHOP }))).toMatchObject({ done: "oneClick", status: 204 });
    expect(once.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", "/u/7f3a2c?l=spring", "List-Unsubscribe=One-Click"],
      ["POST", "/u/done", "List-Unsubscribe=One-Click"],
    ]);

    const loop = await endpoint((_, res) => res.writeHead(302, { location: "https://shop.example.org/again" }).end());
    bridge = await start(await mailbox(), { unsubscribeRewrite: toLocal(loop.port) });
    const failed = await call(bridge, "/api/stories/unsubscribe", { messageId: SHOP });
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toBe("shop.example.org redirected the request more than once");
    expect(loop.requests).toHaveLength(2);
    expect((await json<StorySender[]>(call(bridge, "/api/stories"))).map((s) => s.sender.address)).toContain("news@shop.example.org");

    const plain = await endpoint((_, res) => res.writeHead(301, { location: "http://shop.example.org/u" }).end());
    bridge = await start(await mailbox(), { unsubscribeRewrite: toLocal(plain.port) });
    expect((await call(bridge, "/api/stories/unsubscribe", { messageId: SHOP })).status).toBe(502);
    expect(plain.requests).toHaveLength(1);
  });

  it("one-click: gives up after the time limit and an error answer", async () => {
    const silent = await endpoint(() => undefined);
    let bridge = await start(await mailbox(), { unsubscribeRewrite: toLocal(silent.port), unsubscribeTimeoutMs: 200 });
    const slow = await call(bridge, "/api/stories/unsubscribe", { messageId: SHOP });
    expect(slow.status).toBe(502);
    expect(((await slow.json()) as { error: string }).error).toBe("shop.example.org did not answer in time");
    const refused = await endpoint((_, res) => res.writeHead(500).end());
    bridge = await start(await mailbox(), { unsubscribeRewrite: toLocal(refused.port) });
    const error = await call(bridge, "/api/stories/unsubscribe", { messageId: SHOP });
    expect(((await error.json()) as { error: string }).error).toBe("shop.example.org answered the unsubscribe request with status 500");
  });

  it("mailto: one plain message with the header's subject and an empty body, no copy in Sent; no other request", async () => {
    const root = await mailbox();
    const sentBefore = folder(root, "Sent").length;
    const bridge = await start(root);
    const before = folder(root, "Outbox").length;
    expect(await json<UnsubscribeResult>(call(bridge, "/api/stories/unsubscribe", { messageId: CLUB }))).toEqual({
      done: "mailto",
      address: "leave@club.example.net",
      subject: "unsubscribe weekly",
      hidden: true,
    });
    const outbox = folder(root, "Outbox").slice(before);
    expect(outbox).toHaveLength(1);
    const message = outbox[0]!.message;
    expect(message).toMatchObject({ to: [{ name: "", address: "leave@club.example.net" }], subject: "unsubscribe weekly", text: "", es: null, attachments: [] });
    expect(message.from?.address).toBe(DEMO_ACCOUNT.address);
    expect(folder(root, "Sent")).toHaveLength(sentBefore);
    expect(guard.attempts).toEqual([]);
  });

  it("link: no request at all, the page for the reader to open; 409 when the sender gives no way", async () => {
    const root = await mailbox();
    const page = (unsubscribe: string, id: string): string =>
      `From: Book Club <news@books.example.org>\r\nTo: ${DEMO_ACCOUNT.address}\r\nSubject: New titles\r\nDate: Fri, 20 Mar 2026 08:00:00 +0000\r\nMessage-ID: ${id}\r\n${unsubscribe}Content-Type: text/plain\r\n\r\nNew titles this week.\r\n`;
    deliver(root, "story-link.eml", page("List-Unsubscribe: <http://books.example.org/leave>\r\n", "<books-1@books.example.org>"));
    deliver(root, "story-none.eml", page("List-Unsubscribe: <tel:+1-555-0100>\r\n", "<books-2@books.example.org>"));
    const bridge = await start(root);
    const before = folder(root, "Outbox").length;
    expect(await json<UnsubscribeResult>(call(bridge, "/api/stories/unsubscribe", { messageId: "<books-1@books.example.org>" }))).toEqual({ done: "link", url: "http://books.example.org/leave", hidden: true });
    expect(folder(root, "Outbox")).toHaveLength(before);
    expect(guard.attempts).toEqual([]);
    await json<HiddenSenders>(call(bridge, "/api/stories/hide", { sender: "news@books.example.org" }, "DELETE"));
    expect((await call(bridge, "/api/stories/unsubscribe", { messageId: "<books-2@books.example.org>" })).status).toBe(409);
  });
});

describe("POST and DELETE /api/stories/hide", () => {
  it("hides a sender's stories in a per-account file readable by its owner only; Other mail keeps the messages", async () => {
    const root = await mailbox();
    const dir = tempDir("es-settings-");
    let bridge = await start(root, { settingsDir: dir });
    expect(await json<HiddenSenders>(call(bridge, "/api/stories/hide", { sender: "news@Shop.Example.org" }))).toEqual({ hidden: ["news@shop.example.org"] });
    expect((await json<StorySender[]>(call(bridge, "/api/stories"))).map((s) => s.sender.address)).toEqual(["news@club.example.net"]);
    expect((await json<OtherSummary[]>(call(bridge, "/api/other"))).map((o) => o.title)).toContain("Shoe Shop");
    const settings = await AccountSettings.open(dir, DEMO_ACCOUNT.address);
    expect(settings.hidden).toEqual(["news@shop.example.org"]);
    const [file] = (await import("node:fs")).readdirSync(dir);
    expect(file).toMatch(/^settings-[0-9a-f]{16}\.json$/);
    expect(readFileSync(join(dir, file!), "utf8")).not.toContain(DEMO_ACCOUNT.address);
    if (process.platform !== "win32") expect(statSync(join(dir, file!)).mode & 0o777).toBe(0o600);

    await bridge.close();
    bridges.length = 0;
    bridge = await start(root, { settingsDir: dir });
    expect((await json<StorySender[]>(call(bridge, "/api/stories"))).map((s) => s.sender.address)).toEqual(["news@club.example.net"]);
    expect(await json<HiddenSenders>(call(bridge, "/api/stories/hide", { sender: "news@shop.example.org" }, "DELETE"))).toEqual({ hidden: [] });
    expect((await json<StorySender[]>(call(bridge, "/api/stories"))).map((s) => s.sender.address)).toEqual(["news@club.example.net", "news@shop.example.org"]);
  });

  it("keeps the receipt setting in the same file: --receipts writes it, the next start reads it", async () => {
    const root = await mailbox();
    const dir = tempDir("es-settings-");
    let bridge = await start(root, { settingsDir: dir, receipts: "none" });
    expect((await AccountSettings.open(dir, DEMO_ACCOUNT.address)).receipts).toBe("none");
    await bridge.close();
    bridges.length = 0;
    // The demo mailbox holds Email Social posts that ask for receipts: with "none" remembered, opening them sends none.
    bridge = await start(root, { settingsDir: dir });
    const chats = await json<{ id: string }[]>(call(bridge, "/api/chats"));
    for (const chat of chats) await call(bridge, `/api/chats/${chat.id}/read`, {});
    expect(folder(root, "Outbox")).toEqual([]);
    expect((await AccountSettings.open(dir, DEMO_ACCOUNT.address)).receipts).toBe("none");
  });
});
