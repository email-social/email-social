/**
 * Acceptance (tasks/02, 02b and 02c): end to end with the Maildir adapter,
 * the built web client in Chromium.
 *
 * Task 2: the chats in the right order with the right unread counts, bubbles
 * on the correct sides, a reply that starts with text/plain and is readable
 * by mailparser, keyboard use, downloads, nothing loaded from elsewhere.
 *
 * Task 2b: one chat per person whatever the subjects; "New chat" to a new
 * address writes a message whose first part is text/plain, with the derived
 * subject, and the chat appears; a reply to a plain sender has the
 * attribution line and the quoted parent below the text, a reply to an
 * Email Social sender does not; the contact page shows dates, count and
 * attachments; newsletters appear only under "Other mail".
 *
 * Task 2c: (1) a reply whose parent is in the mailbox shows a card with the
 * parent's name and excerpt, and no quoted text anywhere in the bubble;
 * (2) pressing the card scrolls to the parent and highlights it; (3) a reply
 * to a message not in the mailbox shows the subject card; (4) a person who
 * used four subjects: subject cards at each change, no separators; (5) a
 * reply quoting 40 lines shows only its fresh text, and "Open original"
 * downloads the raw message; (6) a sent reply to a plain sender shows the
 * card in our chat while the written .eml contains the quoted parent.
 *
 * Needs the built web client (npm run build) and Chromium (playwright-core).
 */
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPart, groupByParticipants, parseMessage, splitQuoted } from "@email-social/es-core";
import { startBridge, type RunningBridge } from "../src/bridge.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { EXPECTED_CHATS, EXPECTED_OTHER } from "../test/helpers/demo-expected.js";
import { NOW, demoMaildir } from "../test/helpers/session.js";

const webRoot = fileURLToPath(new URL("../../es-web/dist/", import.meta.url));
const replyFixture = fileURLToPath(new URL("../../es-core/fixtures/replies/gmail-web-de.eml", import.meta.url));
const longQuoteFixture = fileURLToPath(new URL("../../es-core/fixtures/replies/gmail-long-quote.eml", import.meta.url));

let browser: Browser;
let bridge: RunningBridge;
let root: string;
let page: Page;
const requests: string[] = [];
const problems: string[] = [];
/** Date of the reply sent to the group with Bob, the newest message Bob is in. */
let groupReplyDate: string | null = null;

beforeAll(async () => {
  if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web client first: npm run build");
  root = await demoMaildir();
  // A clock that moves on a minute per message sent, so what is sent later is newer.
  let tick = 0;
  bridge = await startBridge({
    webRoot,
    maildir: { root, account: DEMO_ACCOUNT, pollMs: 200 },
    clock: () => new Date(NOW.getTime() + 60_000 * tick++),
    timeZone: "Europe/Prague",
    log: () => undefined,
  });
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

async function chatRows() {
  return page.$$eval("ul.chats[aria-label='Chats'] button.chat-row", (buttons) =>
    buttons.map((b) => ({
      id: b.getAttribute("data-id")!,
      title: b.querySelector(".title")!.textContent!,
      badge: b.querySelector(".badge")?.textContent ?? "",
      spoken: b.querySelector(".sr-only")?.textContent ?? "",
      lastLine: b.querySelector(".last-line")!.textContent!.replace(/^Group of \d+ · /, ""),
    })),
  );
}

async function openChat(title: string): Promise<void> {
  await page.click(`ul.chats[aria-label='Chats'] button.chat-row:has(.title:text-is("${title}"))`);
  await page.waitForFunction((t) => document.querySelector("#thread-title")?.textContent === t, title);
  await page.waitForSelector("li.bubble");
}

/** The visible text of each bubble: what the sender wrote. */
async function bubbles() {
  return page.$$eval("li.bubble", (items) => items.map((li) => [li.getAttribute("data-side"), li.querySelector(":scope > .text")?.textContent ?? ""]));
}

/** Sends from the open chat and returns the new Sent file. */
async function reply(text: string): Promise<Uint8Array> {
  const before = sentFiles();
  await page.fill("#reply", text);
  await page.focus("#reply");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction((t) => [...document.querySelectorAll("li.bubble.mine > .text")].some((e) => e.textContent === t), text);
  const added = sentFiles().filter((n) => !before.includes(n));
  expect(added).toHaveLength(1);
  return new Uint8Array(readFileSync(join(root, "Sent", added[0]!)));
}

describe("email-social in a browser, on the seeded maildir", () => {
  it("shows the 7 chats newest first, with the right unread counts in numbers and words", async () => {
    await page.waitForFunction(() => document.querySelectorAll("ul.chats[aria-label='Chats'] button.chat-row").length === 7);
    const rows = await chatRows();
    expect(rows.map((r) => r.title)).toEqual(EXPECTED_CHATS.map((e) => e.title));
    expect(rows.map((r) => (r.badge === "" ? 0 : Number(r.badge)))).toEqual(EXPECTED_CHATS.map((e) => e.unread));
    for (const [i, row] of rows.entries()) {
      const n = EXPECTED_CHATS[i]!.unread;
      expect(row.spoken).toBe(n === 0 ? "" : `${n} unread message${n === 1 ? "" : "s"}`);
    }
    expect(page.url()).not.toContain("token=");
    expect(await page.title()).toBe("(11) Email Social");
  });

  it("(6) lists newsletters and mailing lists only under a collapsed Other mail, read-only", async () => {
    const titles = (await chatRows()).map((r) => r.title);
    expect(titles).not.toContain("Garden Club");
    expect(titles.some((t) => t.includes("dev-list"))).toBe(false);
    expect(await page.$eval("details.other-mail", (d) => (d as HTMLDetailsElement).open)).toBe(false);
    expect(await page.textContent("details.other-mail summary")).toBe("Other mail · 3 unread messages");
    await page.click("details.other-mail summary");
    const others = await page.$$eval("details.other-mail button.chat-row .title", (els) => els.map((e) => e.textContent));
    expect(others).toEqual(EXPECTED_OTHER.map((o) => o.title));
    await page.click("details.other-mail button.chat-row:has-text('Garden Club')");
    await page.waitForSelector("li.bubble .note");
    expect(await page.textContent("li.bubble .note")).toContain("Shown as plain text.");
    expect(await page.getAttribute("li.bubble .note a", "href")).toMatch(/^\/api\/messages\/[^/]+\/original\?token=/);
    expect(await page.textContent("li.bubble > .text")).toContain("Pruning workshop & seed swap");
    expect(await page.$("#reply")).toBeNull();
    expect(await page.textContent(".thread-header .people")).toContain("Read only");
  });

  it("is used with the keyboard: arrows move through the list, Enter opens, focus goes to the chat", async () => {
    await page.focus("ul.chats[aria-label='Chats'] button.chat-row >> nth=0");
    await page.keyboard.press("ArrowDown");
    const rows = await chatRows();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(rows[1]!.id);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Karel Holub");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("thread-title");
  });

  it("shows the opened chat as bubbles: the account's messages on the right, the others on the left", async () => {
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
    await page.waitForFunction(() => document.querySelector('button.chat-row[aria-current="true"] .badge') === null);
  });

  it("(4) replies to an Email Social sender with the ES part and no quote; the reply is text/plain first and readable by mailparser", async () => {
    const [karel] = await chatRows();
    const text = "Už jsem tady, stojím u vchodu.";
    const raw = await reply(text);
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    const message = parseMessage(raw);
    expect(message).toMatchObject({ text, textSource: "plain", subject: "Re: Kdy dorazíš?" });
    expect(message.es).toMatchObject({ $type: "es.social.post", requestReceipts: ["delivered", "read"] });
    expect(splitQuoted(message).quoted).toBe("");
    const chats = groupByParticipants(mailbox(), { self: DEMO_ACCOUNT.address });
    expect(chats.find((c) => c.messages.some((m) => m.id === message.id))!.id).toBe(karel!.id);
    const mail = await simpleParser(Buffer.from(raw));
    expect(mail.text).toBe(text);
    expect(mail.subject).toBe("Re: Kdy dorazíš?");
    expect((await chatRows())[0]!.lastLine).toBe(`You: ${text}`);
  });

  it("returns focus to the list with Escape", async () => {
    const [karel] = await chatRows();
    await page.focus("#reply");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(karel!.id);
  });

  it("2c (4): shows one chat with a person who used four subjects, a subject card at each change and no separators", async () => {
    await openChat("Bob Svoboda");
    expect(await page.$$eval("li.bubble", (els) => els.length)).toBe(10);
    expect(await page.$$eval("li.subject-separator", (els) => els.length)).toBe(0);
    expect(await page.$$eval("li.bubble .quote-card.subject", (els) => els.map((e) => e.textContent))).toEqual([
      "Faktura za únor",
      "Víkend na chatě",
      "Návrh smlouvy",
      "Kolo na prodej",
    ]);
  });

  it("2c (1): shows a reply whose parent is in the mailbox with a card naming the parent and its first lines, and no quoted text", async () => {
    const bubble = page.locator("li.bubble", { hasText: "Jedu! Dřevo se hodí" });
    expect(await bubble.locator(".quote-card .quote-from").textContent()).toBe("You");
    expect(await bubble.locator(".quote-card .quote-excerpt").textContent()).toBe("Ahoj Bobe, jedeš o víkendu na chatu? Můžu vzít dřevo.");
    expect(await bubble.locator(":scope > .text").textContent()).toBe("Jedu! Dřevo se hodí, já vezmu jídlo.\n\nBob");
    const html = await bubble.innerHTML();
    expect(html).not.toContain("wrote:");
    expect(html).not.toContain("&gt; Ahoj Bobe");
    expect(html).not.toContain("Show quoted text");
    const named = page.locator("li.bubble", { hasText: "Díky, zaplatím ji v pátek." });
    expect(await named.locator(".quote-card .quote-from").textContent()).toBe("Bob Svoboda");
    expect(await named.locator(".quote-card .quote-excerpt").textContent()).toBe("Ahoj Alice, posílám fakturu za únor, splatná je do konce března.");
    expect(await named.locator(".quote-card .quote-attachment").textContent()).toBe("📎 Attachment: Faktura 2026-02.pdf");
    // No bubble in the whole chat shows quoted text.
    expect(await page.$$eval("ol.messages", (els) => els.map((e) => e.textContent ?? "").join(""))).not.toMatch(/wrote:|napsal|^> /m);
  });

  it("2c (2): pressing the card scrolls to the answered message and highlights it for a second", async () => {
    await page.$eval("ol.messages", (list) => list.scrollTo({ top: list.scrollHeight }));
    const parent = page.locator("li.bubble", { hasText: "Ahoj Bobe, jedeš o víkendu na chatu?" }).first();
    await page.locator("li.bubble", { hasText: "Jedu! Dřevo se hodí" }).locator("button.quote-card").click();
    await page.waitForFunction(() => document.querySelector("li.bubble.highlight") !== null);
    expect(await parent.evaluate((el) => el.classList.contains("highlight"))).toBe(true);
    expect(await parent.evaluate((el) => document.activeElement === el)).toBe(true);
    const box = await parent.boundingBox();
    const list = await page.locator("ol.messages").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(list!.y - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(list!.y + list!.height + 1);
    await page.waitForFunction(() => document.querySelector("li.bubble.highlight") === null, undefined, { timeout: 3000 });
  });

  it("2c (3): shows the subject card for a reply whose parent is not in the mailbox (a reply fixture arriving while the page is open)", async () => {
    copyFileSync(replyFixture, join(root, "INBOX", "gmail-web-de.eml"));
    await page.waitForFunction(() => [...document.querySelectorAll("button.chat-row .title")].some((e) => e.textContent === "Anna Becker" && e.closest("button")?.querySelector(".badge")?.textContent === "3"));
    await openChat("Anna Becker");
    const bubble = page.locator("li.bubble", { hasText: "ich muss noch zwei Zahlen prüfen" });
    expect(await bubble.locator(":scope > .text").textContent()).toBe("Hallo Alice,\n\ndie Übersicht kommt am Donnerstag, ich muss noch zwei Zahlen prüfen.\n\nViele Grüße\nAnna");
    expect(await bubble.locator(".quote-card").getAttribute("class")).toBe("quote-card subject");
    expect(await bubble.locator(".quote-card").textContent()).toBe("Projektübersicht");
    expect(await bubble.innerHTML()).not.toContain("schrieb");
  });

  it("2b (4) and 2c (6): replies to a plain sender with the quoted parent below the text in the .eml, and the card in our chat", async () => {
    const raw = await reply("Danke, Anna!");
    const message = parseMessage(raw);
    expect(message.es).toBeNull();
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    expect(message.text).toBe(
      "Danke, Anna!\n\nOn Fri, 6 Mar 2026 at 14:30, Anna Becker <anna.becker@example.net> wrote:\n> Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.\n>\n> Anna",
    );
    expect((await simpleParser(Buffer.from(raw))).text).toContain("> Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.");
    // 2c (6): in our chat the reply shows only what was written, with the card of the message it answers.
    const mine = page.locator("li.bubble.mine", { hasText: "Danke, Anna!" });
    expect(await mine.locator(":scope > .text").textContent()).toBe("Danke, Anna!");
    expect(await mine.locator(".quote-card .quote-from").textContent()).toBe("Anna Becker");
    expect(await mine.locator(".quote-card .quote-excerpt").textContent()).toBe("Nachtrag: Meilenstein 3 verschiebt sich um eine Woche. Anna");
    expect(await mine.innerHTML()).not.toContain("wrote:");
  });

  it("shows a group with every sender named, and replies to all of them as plain text/plain e-mail", async () => {
    await openChat("Bob Svoboda, Jana Nováková");
    expect(await page.textContent(".thread-header .people")).toBe("Group of 3: Bob Svoboda, Jana Nováková, you");
    const names = await page.$$eval("li.bubble.theirs .who", (els) => els.map((e) => e.textContent));
    expect(names).toEqual(["Bob Svoboda", "Jana Nováková", "Bob Svoboda"]);
    const raw = await reply("Tak v pátek!");
    const message = parseMessage(raw);
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    expect(message.es).toBeNull();
    expect(message.attachments).toEqual([]);
    expect(message.to.map((a) => a.address).sort()).toEqual(["bob@example.org", "jana@example.net"]);
    expect(splitQuoted(message).fresh).toBe("Tak v pátek!");
    expect((await simpleParser(Buffer.from(raw))).text).toMatch(/^Tak v pátek!\n\nOn Mon, 2 Mar 2026 at 11:05, Bob Svoboda <bob@example\.org> wrote:/);
    groupReplyDate = message.date;
  });

  it("(3) starts a new chat to a new address: text/plain first, the derived subject, and the chat appears", async () => {
    await page.click("button.new-chat-button");
    await page.waitForSelector("#recipient");
    await page.fill("#recipient", "zuzana@example.net");
    await page.press("#recipient", "Enter");
    expect(await page.textContent("ul.recipients li")).toContain("zuzana@example.net");
    const text = "Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z vrcholu Sněžky.\n\nAlice";
    await page.fill("#text", text);
    const before = sentFiles();
    await page.click("form.new-chat button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "zuzana@example.net");
    const added = sentFiles().filter((n) => !before.includes(n));
    expect(added).toHaveLength(1);
    const raw = new Uint8Array(readFileSync(join(root, "Sent", added[0]!)));
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    const message = parseMessage(raw);
    expect(message.subject).toBe("Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z");
    expect(message.to).toEqual([{ name: "", address: "zuzana@example.net" }]);
    expect(message.refs.inReplyTo).toEqual([]);
    expect((await simpleParser(Buffer.from(raw))).text).toBe(text);
    expect((await chatRows())[0]).toMatchObject({ title: "zuzana@example.net", lastLine: "You: Ahoj Zuzano, posílám slíbené fotky z hor, ty nejlepší jsou z vrcholu Sněžky." });
  });

  it("(5) opens a person's page from their name: names, address, first and last message, count, attachments, groups", async () => {
    await openChat("Bob Svoboda");
    await page.click("li.bubble.theirs button.person >> nth=0");
    await page.waitForFunction(() => document.querySelector("#contact-title")?.textContent === "Bob Svoboda");
    expect(await page.textContent(".contact .thread-header .people")).toBe("bob@example.org");
    const facts = await page.$$eval(".facts dt, .facts dd", (els) => els.map((e) => e.textContent));
    expect(facts.slice(0, 2)).toEqual(["Messages", "16 messages"]);
    expect(await page.getAttribute(".facts dd:nth-of-type(2) time", "datetime")).toBe("2026-03-02T08:15:42.000Z");
    expect(await page.getAttribute(".facts dd:nth-of-type(3) time", "datetime")).toBe(groupReplyDate);
    const attachments = await page.$$eval(".contact ul.attachments li a", (els) => els.map((e) => e.textContent));
    expect(attachments).toEqual(["Návrh smlouvy v2.pdf", "Návrh smlouvy.pdf", "Faktura 2026-02.pdf"]);
    const href = (await page.getAttribute(".contact ul.attachments li a >> nth=1", "href"))!;
    const download = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { type: response.headers.get("content-type"), start: (await response.text()).slice(0, 5) };
    }, href);
    expect(download).toEqual({ type: "application/octet-stream", start: "%PDF-" });
    expect(await page.$$eval(".contact ul.groups button", (els) => els.map((e) => e.textContent))).toEqual(["Bob Svoboda, Jana Nováková"]);
    await page.click(".contact .actions button:has-text('Open chat')");
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Bob Svoboda");
  });

  it("2c (5): shows only the fresh text of a reply quoting 40 lines, and Open original downloads the raw message", async () => {
    copyFileSync(longQuoteFixture, join(root, "INBOX", "gmail-long-quote.eml"));
    await openChat("Bob Svoboda");
    await page.waitForSelector("li.bubble:has-text('the tent')");
    const bubble = page.locator("li.bubble", { hasText: "the tent" });
    expect(await bubble.locator(":scope > .text").textContent()).toBe("Looks good, I'll bring the tent.\n\nBob");
    expect(await bubble.locator(".quote-card").textContent()).toBe("Club weekend");
    const html = await bubble.innerHTML();
    expect(html).not.toContain("Item 1:");
    expect(html).not.toContain("wrote:");
    expect((await bubble.innerText()).split("\n").filter((line) => line.trim() !== "").length).toBeLessThan(8);
    await bubble.locator("details.message-menu summary").click();
    const [download] = await Promise.all([page.waitForEvent("download"), bubble.locator("details.message-menu a", { hasText: "Open original" }).click()]);
    const saved = readFileSync((await download.path())!);
    expect(saved.equals(readFileSync(longQuoteFixture))).toBe(true);
    expect(download.suggestedFilename()).toBe("Re_ Club weekend.eml");
  });

  it("loaded nothing from anywhere but the bridge, and had no errors", () => {
    const origin = `127.0.0.1:${bridge.port}/`;
    expect(requests.length).toBeGreaterThan(5);
    expect(requests.filter((url) => !url.startsWith(`http://${origin}`) && !url.startsWith(`ws://${origin}`))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
