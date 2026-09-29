/**
 * Acceptance (tasks/02): end to end with the Maildir adapter. A seeded
 * maildir with 40 messages in 9 conversations → the web client shows 9
 * conversations in the right order with the right unread counts; opening one
 * shows bubbles on the correct sides with the right text; sending a reply
 * appends an .eml to Sent that starts with text/plain, threads under the
 * conversation when read again, and is readable by mailparser.
 *
 * Needs the built web client (npm run build) and Chromium (playwright-core).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPart, parseMessage, threadMessages } from "@email-social/es-core";
import { startBridge, type RunningBridge } from "../src/bridge.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { EXPECTED } from "../test/helpers/demo-expected.js";
import { NOW, demoMaildir } from "../test/helpers/session.js";

const webRoot = fileURLToPath(new URL("../../es-web/dist/", import.meta.url));

let browser: Browser;
let bridge: RunningBridge;
let root: string;
let page: Page;
const requests: string[] = [];
const problems: string[] = [];

beforeAll(async () => {
  if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web client first: npm run build");
  root = await demoMaildir();
  bridge = await startBridge({ webRoot, maildir: { root, account: DEMO_ACCOUNT, pollMs: 200 }, clock: () => NOW, log: () => undefined });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  page = await browser.newPage();
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await page.goto(bridge.url);
});

afterAll(async () => {
  await browser?.close();
  await bridge?.close();
});

function sentFiles(): string[] {
  return readdirSync(join(root, "Sent")).filter((n) => n.endsWith(".eml")).sort();
}

function mailbox() {
  return ["INBOX", "Sent"].flatMap((dir) =>
    readdirSync(join(root, dir))
      .filter((n) => n.endsWith(".eml"))
      .map((n) => parseMessage(new Uint8Array(readFileSync(join(root, dir, n))))),
  );
}

async function listRows() {
  return page.$$eval("button.conversation", (buttons) =>
    buttons.map((b) => ({
      id: b.getAttribute("data-id")!,
      subject: b.querySelector(".subject")!.textContent!.replace(/^Group of \d+ · /, ""),
      badge: b.querySelector(".badge")?.textContent ?? "",
      spoken: b.querySelector(".sr-only")?.textContent ?? "",
    })),
  );
}

async function bubbles() {
  return page.$$eval("li.bubble", (items) => items.map((li) => [li.getAttribute("data-side"), li.querySelector(".text")!.textContent]));
}

/** Sends a reply from the open conversation and returns the new Sent file. */
async function reply(text: string): Promise<Uint8Array> {
  const before = sentFiles();
  await page.fill("#reply", text);
  await page.focus("#reply");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction((t) => [...document.querySelectorAll("li.bubble.mine .text")].some((e) => e.textContent === t), text);
  const added = sentFiles().filter((n) => !before.includes(n));
  expect(added).toHaveLength(1);
  return new Uint8Array(readFileSync(join(root, "Sent", added[0]!)));
}

describe("email-social in a browser, on the seeded maildir", () => {
  it("shows the 9 conversations newest first, with the right unread counts in numbers and words", async () => {
    await page.waitForFunction(() => document.querySelectorAll("button.conversation").length === 9);
    const rows = await listRows();
    expect(rows.map((r) => r.subject)).toEqual(EXPECTED.map((e) => e.subject));
    expect(rows.map((r) => (r.badge === "" ? 0 : Number(r.badge)))).toEqual(EXPECTED.map((e) => e.unread));
    for (const [i, row] of rows.entries()) {
      const n = EXPECTED[i]!.unread;
      expect(row.spoken).toBe(n === 0 ? "" : `${n} unread message${n === 1 ? "" : "s"}`);
    }
    expect(page.url()).not.toContain("token=");
    expect(await page.title()).toBe("(10) Email Social");
  });

  it("is used with the keyboard: arrows move through the list, Enter opens, focus goes to the conversation", async () => {
    await page.focus("button.conversation >> nth=0");
    await page.keyboard.press("ArrowDown");
    const rows = await listRows();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(rows[1]!.id);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForSelector("li.bubble");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("thread-title");
  });

  it("shows the opened conversation as bubbles: the account's messages on the right, the others on the left", async () => {
    expect(await page.textContent("#thread-title")).toBe("Karel Holub");
    expect(await bubbles()).toEqual([
      ["left", "Ahoj Alice, kdy dorazíš v sobotu?"],
      ["right", "Kolem desáté, vlakem."],
      ["left", "Super, vyzvednu tě na nádraží."],
      ["right", "Mám vzít něco s sebou?"],
      ["left", "Jen dobrou náladu."],
      ["left", "Vlak má zpoždění?"],
      ["left", "Tak já čekám u vchodu."],
      ["left", "Vidím tě! 🚆"],
    ]);
    await page.waitForFunction(() => document.querySelector('button.conversation[aria-current="true"] .badge') === null);
  });

  it("sends a reply that starts with text/plain, threads under the conversation and is readable by mailparser", async () => {
    const [d] = await listRows();
    const text = "Už jsem tady, stojím u vchodu.";
    const raw = await reply(text);

    // (a) The first MIME part is text/plain: multipart/mixed with text first, then the ES part.
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    const message = parseMessage(raw);
    expect(message).toMatchObject({ text, textSource: "plain", subject: "Re: Kdy dorazíš?" });
    expect(message.es).toMatchObject({ $type: "es.social.post", requestReceipts: ["delivered", "read"] });

    // (b) Read again with everything else, it threads under the same conversation.
    const conversations = threadMessages(mailbox());
    expect(conversations).toHaveLength(9);
    expect(conversations.find((c) => c.messageIds.includes(message.id))!.id).toBe(d!.id);

    // (c) An independent parser reads the same text and subject.
    const mail = await simpleParser(Buffer.from(raw));
    expect(mail.text).toBe(text);
    expect(mail.subject).toBe("Re: Kdy dorazíš?");

    expect(await page.textContent("button.conversation >> nth=0 >> .last-line")).toBe(`You: ${text}`);
  });

  it("returns focus to the list with Escape", async () => {
    const [d] = await listRows();
    await page.focus("#reply");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(d!.id);
  });

  it("shows a group with every sender named, and replies to it as plain text/plain e-mail", async () => {
    await page.click("button.conversation:has-text('Oběd v pátek')");
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Bob Svoboda, Jana Nováková");
    expect(await page.textContent(".thread-header .people")).toBe("Group of 3: Bob Svoboda, Jana Nováková, you");
    const names = await page.$$eval("li.bubble.theirs .who", (els) => els.map((e) => e.textContent));
    expect(names).toEqual(["Bob Svoboda", "Jana Nováková", "Bob Svoboda"]);
    const raw = await reply("Tak v pátek!");
    const message = parseMessage(raw);
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    expect(message.es).toBeNull();
    expect(message.attachments).toEqual([]);
    expect(message.to.map((a) => a.address).sort()).toEqual(["bob@example.org", "jana@example.net"]);
    expect((await simpleParser(Buffer.from(raw))).text).toBe("Tak v pátek!");
    expect(threadMessages(mailbox())).toHaveLength(9);
  });

  it("shows HTML-only mail as text with an Open original link, and attachments as download links", async () => {
    await page.click("button.conversation:has-text('March news from the garden club')");
    await page.waitForSelector("li.bubble .note");
    expect(await page.textContent("li.bubble .note")).toContain("Shown as plain text.");
    expect(await page.getAttribute("li.bubble .note a", "href")).toMatch(/^\/api\/messages\/[^/]+\/original\?token=/);
    expect(await page.textContent("li.bubble .text")).toContain("Pruning workshop & seed swap");

    await page.click("button.conversation:has-text('Návrh smlouvy')");
    await page.waitForSelector("li.bubble .attachments a");
    const href = (await page.getAttribute("li.bubble .attachments a", "href"))!;
    expect(await page.textContent("li.bubble .attachments a")).toBe("Návrh smlouvy.pdf");
    const download = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { type: response.headers.get("content-type"), start: (await response.text()).slice(0, 5) };
    }, href);
    expect(download).toEqual({ type: "application/octet-stream", start: "%PDF-" });
  });

  it("loaded nothing from anywhere but the bridge, and had no errors", () => {
    const origin = `127.0.0.1:${bridge.port}/`;
    expect(requests.length).toBeGreaterThan(5);
    expect(requests.filter((url) => !url.startsWith(`http://${origin}`) && !url.startsWith(`ws://${origin}`))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
