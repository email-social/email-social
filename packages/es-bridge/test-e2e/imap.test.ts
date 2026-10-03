/**
 * Acceptance (tasks/02b), in the browser, against the IMAP test server
 * (test/helpers/fake-imap.ts) with the real imapflow client:
 * - with 200 ms per message the page shows a changing count while signing
 *   in, then the chats after the first 50, while older messages keep
 *   loading with a visible count;
 * - a message delivered while the page is open appears without a reload,
 *   and a reload shows it;
 * - a server that stops answering: the page shows the error and a
 *   "Try again" button that works once the server answers again.
 *
 * Needs the built web client (npm run build) and Chromium (playwright-core).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ImapSmtpAdapter } from "../src/adapters/imap-smtp.js";
import { startBridge, type BridgeOptions, type RunningBridge } from "../src/bridge.js";
import { MemoryStore } from "../src/credentials.js";
import { buildDemoMailbox } from "../src/demo.js";
import { FakeImapServer, FakeSmtp, imapTo } from "../test/helpers/fake-imap.js";
import { NOW } from "../test/helpers/session.js";

const webRoot = fileURLToPath(new URL("../../es-web/dist/", import.meta.url));

let browser: Browser;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web client first: npm run build");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

afterAll(async () => {
  await browser?.close();
});

async function serve(server: FakeImapServer, extra: Partial<BridgeOptions> = {}): Promise<{ bridge: RunningBridge; page: Page; problems: string[] }> {
  const smtp = new FakeSmtp();
  const bridge = await startBridge({
    webRoot,
    credentials: new MemoryStore(),
    clock: () => NOW,
    log: () => undefined,
    connect: (config) => new ImapSmtpAdapter(config, { imap: imapTo(server), smtp: () => smtp, pollMs: 60_000, backoffMs: [200, 400] }),
    ...extra,
  });
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));
  cleanup.push(async () => {
    await page.close();
    await bridge.close();
    await server.close();
  });
  await page.goto(bridge.url);
  return { bridge, page, problems };
}

/** Fills the sign-in form for "Other provider" (the test server stands in for it) and submits. */
async function signIn(page: Page): Promise<void> {
  await page.waitForSelector("#provider");
  await page.selectOption("#provider", "other");
  await page.fill("#address", "alice@example.com");
  await page.fill("#password", "app-password");
  await page.fill("#imap-host", "imap.example.com");
  await page.fill("#smtp-host", "smtp.example.com");
  await page.click("form.login button[type=submit]");
}

const chatTitles = (page: Page): Promise<string[]> => page.$$eval("ul.chats[aria-label='Chats'] button.chat-row .title", (els) => els.map((e) => e.textContent ?? ""));

describe("signing in and live mail in the browser, against an IMAP server", () => {
  it("shows a changing count while signing in, the chats after the first 50 messages, then the rest with a count", async () => {
    const server = new FakeImapServer({ delayPerMessageMs: 200 });
    for (let n = 1; n <= 80; n++) {
      server.deliver(
        "INBOX",
        `From: Person ${n} <p${n}@example.org>\r\nTo: alice@example.com\r\nSubject: Message ${n}\r\nDate: Fri, 20 Mar 2026 ${String(8 + Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00 +0100\r\nMessage-ID: <p${n}@example.org>\r\n\r\nText ${n}\r\n`,
        { date: new Date(Date.UTC(2026, 2, 20, 7, n)) },
      );
    }
    await server.start();
    const { page, problems } = await serve(server);
    await signIn(page);

    // While signing in, the status names a number that keeps changing.
    const lines: string[] = [];
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      const status = await page.$eval("[role=status]", (e) => e.textContent ?? "").catch(() => "");
      if (status.includes("Signing in")) lines.push(status);
      if ((await page.$("ul.chats")) !== null) break;
      await page.waitForTimeout(500);
    }
    const counts = lines.map((l) => /Loading messages: (\d+) of 80/.exec(l)?.[1]).filter((c) => c !== undefined);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(5);
    // Nothing that says only "Signing in…" for five seconds: every second there is a new number.
    expect(lines.every((l) => /\d/.test(l.replace("alice@example.com", "")))).toBe(true);

    // The chats are there after the first 50, and the rest loads with a visible count.
    const shown = await chatTitles(page);
    expect(shown.length).toBeGreaterThanOrEqual(50);
    expect(shown.length).toBeLessThan(80);
    expect(shown[0]).toBe("Person 80");
    expect(await page.textContent(".status-bar")).toMatch(/Loading older messages: \d+ of 80/);
    await page.waitForFunction(() => document.querySelectorAll("ul.chats[aria-label='Chats'] button.chat-row").length === 80, undefined, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector(".status-bar") === null);
    expect(problems).toEqual([]);
  }, 90_000);

  it("shows a message delivered while the page is open without a reload, and after a reload", async () => {
    const server = new FakeImapServer();
    for (const m of buildDemoMailbox()) server.deliver(m.folder === "inbox" ? "INBOX" : "Sent", m.raw, { flags: m.seen ? ["\\Seen"] : [] });
    await server.start();
    const { page, problems } = await serve(server);
    await signIn(page);
    await page.waitForFunction(() => document.querySelectorAll("ul.chats[aria-label='Chats'] button.chat-row").length === 7);
    await page.waitForFunction(() => document.title === "(11) Email Social");
    // imapflow idles once the connection has been quiet for a moment.
    const idle = Date.now();
    while (!server.commands.includes("IDLE") && Date.now() - idle < 10_000) await page.waitForTimeout(100);
    server.deliver(
      "INBOX",
      "From: Zuzana Veselá <zuzana@example.net>\r\nTo: alice@example.com\r\nSubject: Ahoj\r\nDate: Sat, 21 Mar 2026 11:00:00 +0100\r\nMessage-ID: <new-1@example.net>\r\n\r\nJsem zpátky z hor!\r\n",
    );
    await page.waitForFunction(() => document.querySelector("ul.chats[aria-label='Chats'] button.chat-row .title")?.textContent === "Zuzana Veselá", undefined, { timeout: 10_000 });
    expect(await page.title()).toBe("(12) Email Social");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("ul.chats[aria-label='Chats'] button.chat-row .title")?.textContent === "Zuzana Veselá", undefined, { timeout: 10_000 });
    expect(problems).toEqual([]);
  }, 60_000);

  it("shows the error and Try again when the server stops answering, and signs in once it answers again", async () => {
    const server = new FakeImapServer();
    for (const m of buildDemoMailbox()) server.deliver(m.folder === "inbox" ? "INBOX" : "Sent", m.raw, { flags: m.seen ? ["\\Seen"] : [] });
    await server.start();
    server.stall();
    const { page } = await serve(server, { stallMs: 3000 });
    const started = Date.now();
    await signIn(page);
    await page.waitForSelector("form.login [role=alert]", { timeout: 20_000 });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(await page.textContent("form.login [role=alert]")).toMatch(/^No answer from the mail server for 3 seconds/);
    server.resume();
    await page.click("form.login button.retry");
    await page.waitForFunction(() => document.querySelectorAll("ul.chats[aria-label='Chats'] button.chat-row").length === 7, undefined, { timeout: 20_000 });
  }, 60_000);

  it("says Reconnecting… when the connection to the mail server is lost, and carries on when it is back", async () => {
    const server = new FakeImapServer();
    for (const m of buildDemoMailbox()) server.deliver(m.folder === "inbox" ? "INBOX" : "Sent", m.raw, { flags: m.seen ? ["\\Seen"] : [] });
    await server.start();
    const { page } = await serve(server, {
      connect: (config) => new ImapSmtpAdapter(config, { imap: imapTo(server), smtp: () => new FakeSmtp(), pollMs: 60_000, backoffMs: [2000, 200] }),
    });
    await signIn(page);
    await page.waitForFunction(() => document.querySelectorAll("ul.chats[aria-label='Chats'] button.chat-row").length === 7);
    server.dropConnections();
    await page.waitForFunction(() => document.querySelector(".status-bar")?.textContent?.includes("Reconnecting…") === true, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector(".status-bar") === null, undefined, { timeout: 10_000 });
  }, 60_000);
});
