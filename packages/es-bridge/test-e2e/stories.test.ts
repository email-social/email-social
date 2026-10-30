/**
 * Acceptance (tasks/04, end to end): the demo mailbox plus the story
 * fixtures, the built web client in Chromium.
 *
 * (1) the strip shows two newsletters and neither the order confirmation
 * nor the discussion list; (2) opening a story shows its text and the Load
 * images control, and the page made no request outside 127.0.0.1; (3) Load
 * images issues image requests only after the tap; (4) Unsubscribe on the
 * one-click story sends one POST to the mock URL and the sender leaves the
 * strip; (5) the story dated 8 days ago is absent from the strip and present
 * under Other mail; (6) Hide sender removes the circle.
 *
 * Every request of the page goes through page.route: requests to the bridge
 * pass, image requests are answered with a 1×1 PNG and recorded, anything
 * else is recorded and refused. Needs the built web client (npm run build)
 * and Chromium (playwright-core).
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBridge, type RunningBridge } from "../src/bridge.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { NOW, deliver, demoMaildir } from "../test/helpers/session.js";

const webRoot = fileURLToPath(new URL("../../es-web/dist/", import.meta.url));
const STORY_FIXTURES = ["newsletter-one-click", "newsletter-mailto-bulk", "expired-newsletter", "discussion-list", "order-confirmation", "password-reset", "bounce"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let browser: Browser;
let bridge: RunningBridge;
let page: Page;
let mock: Server;
const mockRequests: { method: string; url: string; body: string; cookie: string | undefined }[] = [];
/** Requests the page made to anything but the bridge. */
const outside: string[] = [];
const problems: string[] = [];

async function strip(): Promise<string[]> {
  return page.$$eval("section.stories button.story-circle", (buttons) => buttons.map((b) => b.getAttribute("data-sender")!));
}

async function openStory(sender: string): Promise<void> {
  await page.click(`section.stories button[data-sender="${sender}"]`);
  await page.waitForSelector("section.story-viewer h2");
}

beforeAll(async () => {
  if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web client first: npm run build");
  const root = await demoMaildir();
  for (const name of STORY_FIXTURES) deliver(root, `story-${name}.eml`, readFileSync(new URL(`../../es-core/fixtures/stories/${name}.eml`, import.meta.url)));
  // The sender's one-click endpoint, on this machine.
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      mockRequests.push({ method: req.method ?? "", url: req.url ?? "", body, cookie: req.headers.cookie });
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  bridge = await startBridge({
    webRoot,
    maildir: { root, account: DEMO_ACCOUNT, pollMs: 200 },
    clock: () => NOW,
    timeZone: "Europe/Prague",
    log: () => undefined,
    unsubscribeRewrite: (url) => new URL(`http://127.0.0.1:${mockPort}${url.pathname}${url.search}`),
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  page = await browser.newPage();
  page.on("pageerror", (error) => problems.push(String(error)));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "about:" || url.protocol === "data:" || (url.hostname === "127.0.0.1" && url.port === String(bridge.port))) return route.continue();
    outside.push(route.request().url());
    if (route.request().resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.abort();
  });
  await page.goto(bridge.url);
  await page.waitForSelector("section.stories");
});

afterAll(async () => {
  await browser?.close();
  await bridge?.close();
  await new Promise((resolve) => mock?.close(resolve));
});

describe("stories in the web client", () => {
  it("(1) shows the two newsletters in the strip, not the order confirmation or the discussion list", async () => {
    expect(await strip()).toEqual(["news@club.example.net", "news@shop.example.org"]);
    expect(await page.$$eval("section.stories .initials", (spans) => spans.map((s) => s.textContent))).toEqual(["HC", "SS"]);
    expect(await page.$$eval("section.stories button.story-circle.unseen", (b) => b.length)).toBe(2);
  });

  it("(2) opens a story with its text and the Load images control, without any request outside 127.0.0.1", async () => {
    await openStory("news@shop.example.org");
    expect(await page.textContent("section.story-viewer h2")).toBe("Spring sale: shoes from 20 €");
    const frame = page.frameLocator("iframe.story-frame");
    await expect.poll(async () => frame.locator("body").textContent()).toContain("Walking shoes, trail runners and sandals are 30");
    expect(await page.isVisible('.story-images button:text-is("Load images")')).toBe(true);
    expect(await page.getAttribute("iframe.story-frame", "sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    // Opening marks it seen: the ring goes.
    await page.waitForSelector('section.stories button.story-circle[data-sender="news@shop.example.org"]:not(.unseen)');
    expect(outside).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("(3) loads images only after the reader asks, and only for that story", async () => {
    await page.waitForTimeout(300);
    expect(outside).toEqual([]);
    await page.click('.story-images button:text-is("Load images")');
    expect(await page.textContent(".story-images p")).toContain("Loading images tells the sender that you opened this message.");
    expect(outside).toEqual([]);
    await page.click('.story-images p button:text-is("Load images")');
    await expect.poll(() => outside.length).toBeGreaterThanOrEqual(2);
    expect(outside.every((u) => /^https:\/\/(?:img|open\.mail)\.shop\.example\.org\//.test(u))).toBe(true);
    expect(outside).toContain("https://open.mail.shop.example.org/o/7f3a2c.gif");
    // Another story shows no images until asked again.
    const before = outside.length;
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("section.story-viewer h2")?.textContent === "Weekend walks, 21-22 March");
    await page.click("section.stories button[data-sender='news@shop.example.org']");
    await page.waitForFunction(() => document.querySelector("section.story-viewer h2")?.textContent?.startsWith("Spring sale") === true);
    await page.waitForTimeout(300);
    expect(outside).toHaveLength(before);
    expect(await page.isVisible('.story-images button:text-is("Load images")')).toBe(true);
  });

  it("(4) Unsubscribe (one tap) asks first, then sends one POST to the sender's URL; the sender leaves the strip", async () => {
    await page.click('.story-actions button:text-is("Unsubscribe (one tap)")');
    expect(await page.textContent(".story-confirm")).toContain("Send an unsubscribe request to shop.example.org?");
    expect(mockRequests).toEqual([]);
    await page.click('.story-confirm button:text-is("Unsubscribe")');
    await page.waitForSelector(".story-notice");
    expect(await page.textContent(".story-notice")).toBe("Unsubscribe request sent to shop.example.org. This sender's stories are hidden; their messages stay under Other mail.");
    expect(mockRequests).toEqual([{ method: "POST", url: "/u/7f3a2c?l=spring", body: "List-Unsubscribe=One-Click", cookie: undefined }]);
    await expect.poll(strip).toEqual(["news@club.example.net"]);
  });

  it("(5) the story dated 8 days ago is not in the strip but is under Other mail", async () => {
    expect(await strip()).not.toContain("news@garden.example.com");
    await page.click("details.other-mail > summary");
    const titles = await page.$$eval("ul.chats[aria-label='Other mail'] .title", (spans) => spans.map((s) => s.textContent));
    expect(titles).toEqual(expect.arrayContaining(["Garden Centre", "Shoe Shop", "Hiking Club"]));
  });

  it("(6) Hide sender removes the circle; the strip goes when no story is left", async () => {
    await openStory("news@club.example.net");
    expect(await page.textContent(".story-text")).toContain("Saturday");
    await page.click('.story-actions button:text-is("Hide sender")');
    await page.waitForSelector(".story-notice");
    await page.waitForSelector("section.stories", { state: "detached" });
    expect(outside.filter((u) => !/shop\.example\.org/.test(u))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
