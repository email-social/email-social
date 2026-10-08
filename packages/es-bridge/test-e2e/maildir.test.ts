/**
 * Acceptance (tasks/02, 02b, 02c and 02d): end to end with the Maildir
 * adapter, the built web client in Chromium.
 *
 * Task 2: the chats in the right order with the right unread counts, bubbles
 * on the correct sides, a reply that starts with text/plain and is readable
 * by mailparser, keyboard use, downloads, nothing loaded from elsewhere.
 *
 * Task 2b: one chat per person whatever the subjects; a deliberate reply to a
 * plain sender has the attribution line and the quoted parent below the
 * text, a reply to an Email Social sender does not; the contact page shows
 * dates, count and attachments; newsletters appear only under "Other mail".
 *
 * Task 2c: no quoted text under any bubble; pressing a card scrolls to the
 * answered message and highlights it; a reply quoting 40 lines shows only
 * its fresh text and "Open original" downloads the raw message.
 *
 * Task 2d: (1) typing in a chat sends a continuation: no card, In-Reply-To,
 * "Re: <base>", no quote, the footer; (2) "Reply" shows a chip, the sent
 * bubble shows the card, the .eml quotes at most 5 lines; (3) of three
 * replies from a plain sender only the one quoting one interior sentence
 * gets a card, and the point-by-point one shows its quotes muted in place;
 * (4) "+ Topic" starts a named topic, chips mark runs, "All topics" filters
 * and binds the composer, the same name again re-enters it; (5) a chat
 * started with "Invoice 114" keeps "Re: Invoice 114" through a tagged reply,
 * which gets a subject note, and shows chips once a second topic exists;
 * (6) an auto-reply goes to Other mail and changes nothing in the chat;
 * (7) a new chat has no subject field and gets the carrier subject; (8) an
 * Email Social message carrying replyTo shows its card even when the target
 * is not in the mailbox, and one without replyTo shows none.
 *
 * Needs the built web client (npm run build) and Chromium (playwright-core).
 */
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPart, groupByParticipants, parseMessage, serializeMessage, splitQuoted, type EsAddress, type EsMessage, type EsOutgoing } from "@email-social/es-core";
import { startBridge, type RunningBridge } from "../src/bridge.js";
import { DEMO_ACCOUNT } from "../src/demo.js";
import { EXPECTED_CHATS, EXPECTED_OTHER } from "../test/helpers/demo-expected.js";
import { NOW, deliver, demoMaildir } from "../test/helpers/session.js";

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

const FOOTER = "Sent with Email Social. Reply as you normally would; this is an ordinary e-mail.";
const ALICE: EsAddress = { name: "Alice Dvořáková", address: "alice@example.com" };
const BOB: EsAddress = { name: "Bob Svoboda", address: "bob@example.org" };
const KAREL: EsAddress = { name: "Karel Holub", address: "karel@example.org" };
const TEREZA: EsAddress = { name: "Tereza Malá", address: "tereza@example.net" };

/** A message to Alice put into INBOX while the page is open; plain unless `es` is given. */
function seed(name: string, out: Omit<EsOutgoing, "to"> & { to?: EsAddress[] }, date: string, id: string, extraHeaders = ""): EsMessage {
  const raw = serializeMessage({ to: [ALICE], ...out }, { date, messageId: id, includeEsPart: out.es !== undefined });
  deliver(root, name, extraHeaders + raw);
  return parseMessage(raw);
}

/** The demo message whose text starts with `start`. */
function demo(start: string): EsMessage {
  const found = mailbox().find((m) => splitQuoted(m).fresh.startsWith(start));
  if (found === undefined) throw new Error(`no demo message starting with ${start}`);
  return found;
}

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

  it("2d (8): shows the card of an Email Social message carrying replyTo whose target is not in the mailbox, and none without replyTo", async () => {
    const d8 = demo("Vidím tě!");
    seed("es-reply-to.eml", { from: KAREL, subject: "Re: Kdy dorazíš?", text: "Tak jsem ho našel.", inReplyTo: { messageId: "<gone-umbrella@example.org>" }, es: { replyTo: { messageId: "<gone-umbrella@example.org>", from: KAREL, excerpt: "Nevíš, kde mám deštník?" } } }, "2026-03-20T18:00:00Z", "<es-seed-1@example.org>");
    seed("es-no-reply-to.eml", { from: KAREL, subject: "Re: Kdy dorazíš?", text: "Jsem tu za pět minut.", inReplyTo: { messageId: d8.id }, es: {} }, "2026-03-20T18:05:00Z", "<es-seed-2@example.org>");
    await page.waitForSelector("li.bubble:has-text('Jsem tu za pět minut.')");
    const carried = page.locator("li.bubble", { hasText: "Tak jsem ho našel." });
    expect(await carried.locator(".quote-card").evaluate((el) => el.tagName)).toBe("P");
    expect(await carried.locator(".quote-card .quote-from").textContent()).toBe("Karel Holub");
    expect(await carried.locator(".quote-card .quote-excerpt").textContent()).toBe("Nevíš, kde mám deštník?");
    expect(await carried.locator("button.quote-card").count()).toBe(0);
    expect(await page.locator("li.bubble", { hasText: "Jsem tu za pět minut." }).locator(".quote-card").count()).toBe(0);
  });

  it("2d (4): '+ Topic' starts a named topic; chips mark the runs; All topics filters and binds the composer; the same name again re-enters it", async () => {
    expect(await page.locator("li.bubble .topic-run").count()).toBe(0);
    expect(await page.locator("button.topics-button").count()).toBe(0);
    await page.click("form.composer button.topic-chip:has-text('+ Topic')");
    await page.fill("#reply-topic", "Výlet na Sněžku");
    const root = parseMessage(await reply("Pojedeme v létě?"));
    expect(root.subject).toBe("Výlet na Sněžku");
    expect(root.refs.inReplyTo).toEqual([]);
    expect(root.refs.references).toEqual([]);
    expect(root.es).toMatchObject({ $type: "es.social.post", email: { topicRoot: root.id, topicLabel: "Výlet na Sněžku", replyTo: null } });
    await page.waitForSelector("li.bubble .topic-run");
    expect(await page.$$eval("li.bubble .topic-run", (els) => els.map((e) => e.textContent))).toEqual(["Topic: Ongoing chat", "Topic: Výlet na Sněžku"]);
    expect(await page.locator("li.bubble", { hasText: "Pojedeme v létě?" }).locator(".topic-run").count()).toBe(1);
    const all = await page.locator("li.bubble").count();

    await page.click("button.topics-button");
    expect(await page.$$eval("#topics-filter-list button", (els) => els.map((e) => e.textContent))).toEqual([`All topics (${all})`, `Ongoing chat (${all - 1})`, "Výlet na Sněžku (1)"]);
    await page.click("#topics-filter-list button:has-text('Výlet na Sněžku')");
    await page.waitForFunction(() => document.querySelectorAll("li.bubble").length === 1);
    expect(await page.textContent("button.topics-button")).toBe("Výlet na Sněžku ▾");
    expect(await page.locator("li.bubble .topic-run").count()).toBe(0);
    expect(await page.textContent("form.composer button.topic-chip")).toBe("Topic: Výlet na Sněžku ▾");
    await page.click("button.topics-button");
    await page.click("#topics-filter-list button:has-text('All topics')");
    await page.waitForFunction((n) => document.querySelectorAll("li.bubble").length === n, all);

    await page.click("form.composer button.topic-chip");
    await page.click("#reply-topics button.new-topic");
    await page.fill("#reply-topic", "výlet na sněžku");
    const again = parseMessage(await reply("Třeba v červenci."));
    expect(again.subject).toBe("Re: Výlet na Sněžku");
    expect(again.refs.inReplyTo).toEqual([root.id]);
    expect(again.es).toMatchObject({ email: { topicRoot: root.id, topicLabel: "Výlet na Sněžku" } });
    await page.click("button.topics-button");
    expect(await page.$$eval("#topics-filter-list button", (els) => els.length)).toBe(3);
    await page.click("button.topics-button");
  });

  it("2d: shows one chat with a person who used four subjects as four topics: a chip at each run, no separators, All topics with counts", async () => {
    await openChat("Bob Svoboda");
    expect(await page.$$eval("li.bubble", (els) => els.length)).toBe(10);
    expect(await page.$$eval("li.subject-separator, .quote-card.subject", (els) => els.length)).toBe(0);
    expect(await page.$$eval("li.bubble .topic-run", (els) => els.map((e) => e.textContent))).toEqual([
      "Topic: Faktura za únor",
      "Topic: Víkend na chatě",
      "Topic: Návrh smlouvy",
      "Topic: Kolo na prodej",
    ]);
    await page.click("button.topics-button");
    expect(await page.$$eval("#topics-filter-list button", (els) => els.map((e) => e.textContent))).toEqual([
      "All topics (10)",
      "Faktura za únor (2)",
      "Víkend na chatě (2)",
      "Návrh smlouvy (5)",
      "Kolo na prodej (1)",
    ]);
    await page.click("button.topics-button");
    // The composer continues the topic of Alice's own newest message.
    expect(await page.textContent("form.composer button.topic-chip")).toBe("Topic: Návrh smlouvy ▾");
  });

  it("2d: draws cards only above deliberate replies (Alice's quoted replies), never above a client's whole-message quote, and no quoted text anywhere", async () => {
    const whole = page.locator("li.bubble", { hasText: "Jedu! Dřevo se hodí" });
    expect(await whole.locator(".quote-card").count()).toBe(0);
    expect(await whole.locator(":scope > .text").textContent()).toBe("Jedu! Dřevo se hodí, já vezmu jídlo.\n\nBob");
    const html = await whole.innerHTML();
    expect(html).not.toContain("wrote:");
    expect(html).not.toContain("&gt; Ahoj Bobe");
    expect(html).not.toContain("Show quoted text");
    const named = page.locator("li.bubble", { hasText: "Díky, zaplatím ji v pátek." });
    expect(await named.locator(".quote-card .quote-from").textContent()).toBe("Bob Svoboda");
    expect(await named.locator(".quote-card .quote-excerpt").textContent()).toBe("Ahoj Alice, posílám fakturu za únor, splatná je do konce března. Bob");
    expect(await named.locator(".quote-card .quote-attachment").textContent()).toBe("📎 Attachment: Faktura 2026-02.pdf");
    expect(await page.$$eval("li.bubble .quote-card", (els) => els.length)).toBe(3);
    // No bubble in the whole chat shows quoted text.
    expect(await page.$$eval("ol.messages", (els) => els.map((e) => e.textContent ?? "").join(""))).not.toMatch(/wrote:|napsal|^> /m);
  });

  it("2c (2): pressing the card scrolls to the answered message and highlights it for a second", async () => {
    await page.$eval("ol.messages", (list) => list.scrollTo({ top: list.scrollHeight }));
    const parent = page.locator("li.bubble", { hasText: "posílám fakturu za únor" }).first();
    await page.locator("li.bubble", { hasText: "Díky, zaplatím ji v pátek." }).locator("button.quote-card").click();
    await page.waitForFunction(() => document.querySelector("li.bubble.highlight") !== null);
    expect(await parent.evaluate((el) => el.classList.contains("highlight"))).toBe(true);
    expect(await parent.evaluate((el) => document.activeElement === el)).toBe(true);
    // The list scrolls smoothly: wait until the answered message is inside its visible part.
    await parent.evaluate(
      (el) =>
        new Promise<void>((resolve, reject) => {
          const list = el.closest("ol.messages")!;
          const started = performance.now();
          const check = (): void => {
            const box = el.getBoundingClientRect();
            const view = list.getBoundingClientRect();
            if (box.top >= view.top - 1 && box.bottom <= view.bottom + 1) resolve();
            else if (performance.now() - started > 2000) reject(new Error(`not scrolled into view: ${box.top}..${box.bottom} in ${view.top}..${view.bottom}`));
            else requestAnimationFrame(check);
          };
          check();
        }),
    );
    await page.waitForFunction(() => document.querySelector("li.bubble.highlight") === null, undefined, { timeout: 3000 });
  });

  it("2c (3): shows a reply whose parent is not in the mailbox without a card, and its changed subject as a note (a fixture arriving while the page is open)", async () => {
    copyFileSync(replyFixture, join(root, "INBOX", "gmail-web-de.eml"));
    await page.waitForFunction(() => [...document.querySelectorAll("button.chat-row .title")].some((e) => e.textContent === "Anna Becker" && e.closest("button")?.querySelector(".badge")?.textContent === "3"));
    await openChat("Anna Becker");
    const bubble = page.locator("li.bubble", { hasText: "ich muss noch zwei Zahlen prüfen" });
    expect(await bubble.locator(":scope > .text").textContent()).toBe("Hallo Alice,\n\ndie Übersicht kommt am Donnerstag, ich muss noch zwei Zahlen prüfen.\n\nViele Grüße\nAnna");
    expect(await bubble.locator(".quote-card").count()).toBe(0);
    expect(await bubble.locator(".subject-note").textContent()).toBe("Subject: Projektübersicht");
    expect(await page.locator("li.bubble .subject-note").count()).toBe(1);
    expect(await bubble.innerHTML()).not.toContain("schrieb");
  });

  it("2b (4), 2c (6) and 2d (2): Reply on an older message shows a chip, quotes at most 5 lines in the .eml, and the card in our chat", async () => {
    // The first bubble with this text is Anna's message itself (Alice's reply below it carries it in its card).
    const older = page.locator("li.bubble", { hasText: "anbei die Projektübersicht" }).first();
    await older.locator("details.message-menu summary").click();
    await older.locator("button.menu-reply").click();
    expect(await page.textContent(".reply-chip span")).toMatch(/^Replying to Anna Becker — Hallo Alice, anbei die Projektübersicht für das zweite Quartal\./);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("reply");
    const raw = await reply("Danke, Anna!");
    expect(await page.locator(".reply-chip").count()).toBe(0);
    const message = parseMessage(raw);
    expect(message.es).toBeNull();
    expect(extractPart(raw, "1")?.contentType).toBe("text/plain");
    expect(message.subject).toBe("Re: Projektübersicht Q2");
    expect(message.refs.inReplyTo).toEqual([demo("Hallo Alice,\n\nanbei die Projektübersicht").id]);
    const lines = message.text.split("\n");
    expect(lines.slice(0, 3)).toEqual(["Danke, Anna!", "", "On Tue, 3 Mar 2026 at 08:47, Anna Becker <anna.becker@example.net> wrote:"]);
    const quoted = lines.filter((line) => line.startsWith(">"));
    expect(quoted.length).toBeLessThanOrEqual(6);
    expect(quoted.filter((line) => line !== "> [...]").length).toBeLessThanOrEqual(5);
    expect(quoted).toContain("> anbei die Projektübersicht für das zweite Quartal. Bitte prüfe die Meilensteine bis Freitag.");
    expect(message.text.endsWith(`\n\n-- \n${FOOTER}`)).toBe(true);
    expect((await simpleParser(Buffer.from(raw))).text).toContain("> anbei die Projektübersicht");
    // In our chat: only what was written, with the card of the message answered.
    const mine = page.locator("li.bubble.mine", { hasText: "Danke, Anna!" });
    expect(await mine.locator(":scope > .text").textContent()).toBe("Danke, Anna!");
    expect(await mine.locator(".quote-card .quote-from").textContent()).toBe("Anna Becker");
    expect(await mine.locator(".quote-card .quote-excerpt").textContent()).toMatch(/^Hallo Alice, anbei die Projektübersicht/);
    expect(await mine.innerHTML()).not.toContain("wrote:");
    expect(await mine.locator("details.signature").count()).toBe(0);
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
    expect((await simpleParser(Buffer.from(raw))).text).toBe(`Tak v pátek!\n\n-- \n${FOOTER}`);
    groupReplyDate = message.date;
  });

  it("(3) and 2d (7): starts a new chat to a new address without a subject field: text/plain first, the carrier subject, and the chat appears", async () => {
    await page.click("button.new-chat-button");
    await page.waitForSelector("#recipient");
    expect(await page.$("#subject")).toBeNull();
    expect(await page.textContent("form.new-chat")).not.toMatch(/subject/i);
    expect(await page.locator("form.new-chat button.topic-chip").textContent()).toBe("+ Topic");
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
    expect(message.subject).toBe("Message from Alice Dvořáková");
    expect(message.to).toEqual([{ name: "", address: "zuzana@example.net" }]);
    expect(message.refs.inReplyTo).toEqual([]);
    expect((await simpleParser(Buffer.from(raw))).text).toBe(`${text}\n\n-- \n${FOOTER}`);
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

  it("2d (3): of three replies from a plain sender, only the one quoting one interior sentence gets a card; the point-by-point one shows its quotes muted in place", async () => {
    const i4 = demo("Mám dvě připomínky k článku 4");
    const k1 = demo("Ahoj Bobe, jedeš o víkendu na chatu?");
    const attribution = (date: string) => `On ${date} Alice Dvořáková <alice@example.com> wrote:`;
    seed("bob-full.eml", { from: BOB, subject: "Re: Návrh smlouvy", text: `OK, počkám.\n\n${attribution("Tue, Mar 10, 2026 at 3:30 PM")}\n\n> Mám dvě připomínky k článku 4, pošlu je zítra.\n`, inReplyTo: { messageId: i4.id, references: i4.refs.references } }, "2026-03-20T09:00:00Z", "<bob-full@example.org>");
    seed("bob-fragment.eml", { from: BOB, subject: "Re: Víkend na chatě", text: `Jasně, beru.\n\n${attribution("Sat, Mar 7, 2026 at 9:30 AM")}\n\n> jedeš o víkendu na chatu?\n`, inReplyTo: { messageId: k1.id } }, "2026-03-20T09:05:00Z", "<bob-fragment@example.org>");
    seed("bob-points.eml", { from: BOB, subject: "Re: Návrh smlouvy", text: "> Mám dvě připomínky k článku 4,\n\nJasně, pošli je.\n\n> pošlu je zítra.\n\nStačí v pondělí.\n\nBob\n", inReplyTo: { messageId: i4.id, references: i4.refs.references } }, "2026-03-20T09:10:00Z", "<bob-points@example.org>");
    await page.waitForSelector("li.bubble:has-text('Stačí v pondělí.')");
    await page.waitForSelector("li.bubble:has-text('Jasně, beru.')");
    const full = page.locator("li.bubble", { hasText: "OK, počkám." });
    expect(await full.locator(".quote-card").count()).toBe(0);
    expect(await full.innerHTML()).not.toContain("připomínky");
    const fragment = page.locator("li.bubble", { hasText: "Jasně, beru." });
    expect(await fragment.locator(".quote-card .quote-from").textContent()).toBe("You");
    expect(await fragment.locator(".quote-card .quote-excerpt").textContent()).toBe("jedeš o víkendu na chatu?");
    const points = page.locator("li.bubble", { hasText: "Stačí v pondělí." });
    expect(await points.locator(".quote-card").count()).toBe(0);
    expect(await points.locator(".note").first().textContent()).toBe("answered point by point");
    expect(await points.locator(".quoted-line").allTextContents()).toEqual(["Mám dvě připomínky k článku 4,", "pošlu je zítra."]);
    expect(await points.locator(".quoted-line").first().evaluate((el) => getComputedStyle(el).color)).not.toBe(await points.locator(".plain-line").first().evaluate((el) => getComputedStyle(el).color));
    expect(await points.innerText()).not.toContain("> ");
    // No other bubble shows a quoted line.
    expect(await page.locator("li.bubble .quoted-line").count()).toBe(2);
  });

  it("2d (1): typing in the chat sends a continuation: a bubble without a card; the .eml answers the topic's newest message, 'Re: <base>', no quote, the footer", async () => {
    // The composer stayed on "Návrh smlouvy" while the replies above arrived.
    expect(await page.textContent("form.composer button.topic-chip")).toBe("Topic: Návrh smlouvy ▾");
    const raw = await reply("Dobře, v pondělí.");
    const message = parseMessage(raw);
    expect(message.subject).toBe("Re: Návrh smlouvy");
    expect(message.refs.inReplyTo).toEqual(["<bob-points@example.org>"]);
    expect(splitQuoted(message)).toEqual({ fresh: "Dobře, v pondělí.", quoted: "", signature: `-- \n${FOOTER}` });
    expect(message.text).toBe(`Dobře, v pondělí.\n\n-- \n${FOOTER}`);
    expect(new TextDecoder().decode(raw)).toContain("Content-Transfer-Encoding: quoted-printable");
    const mine = page.locator("li.bubble.mine", { hasText: "Dobře, v pondělí." });
    expect(await mine.locator(".quote-card").count()).toBe(0);
    expect(await mine.locator("details.signature").count()).toBe(0);
    // It continues the run of "Návrh smlouvy" that Bob's point-by-point reply started.
    expect(await mine.locator(".topic-run").count()).toBe(0);
  });

  it("2d (5) and (6): a chat started with 'Invoice 114' keeps 'Re: Invoice 114' through a tagged reply, which gets a note; an auto-reply goes to Other mail; chips once a second topic exists", async () => {
    const invoice = seed("tereza-1.eml", { from: TEREZA, subject: "Invoice 114", text: "Hello Alice,\n\ninvoice 114 is attached.\n\nTereza" }, "2026-03-20T10:00:00Z", "<tereza-1@example.net>");
    await page.waitForFunction(() => [...document.querySelectorAll("button.chat-row .title")].some((e) => e.textContent === "Tereza Malá"));
    await openChat("Tereza Malá");
    expect(await page.locator("li.bubble .topic-run").count()).toBe(0);
    const first = parseMessage(await reply("Thanks, paying today."));
    expect(first.subject).toBe("Re: Invoice 114");
    expect(first.refs.inReplyTo).toEqual([invoice.id]);

    seed("tereza-2.eml", { from: TEREZA, subject: "Re: Invoice 114 [EXTERNAL]", text: "Received, thank you.", inReplyTo: { messageId: first.id } }, "2026-03-21T12:00:00Z", "<tereza-2@example.net>");
    const auto = "Auto-Submitted: auto-replied\r\n";
    seed("tereza-auto.eml", { from: TEREZA, subject: "Automatic reply: Re: Invoice 114", text: "I am out of the office until Monday.", inReplyTo: { messageId: first.id } }, "2026-03-21T12:01:00Z", "<tereza-auto@example.net>", auto);
    await page.waitForSelector("li.bubble:has-text('Received, thank you.')");
    const tagged = page.locator("li.bubble", { hasText: "Received, thank you." });
    expect(await tagged.locator(".subject-note").textContent()).toBe("Subject: Invoice 114 [EXTERNAL]");
    expect(await page.locator("li.bubble .subject-note").count()).toBe(1);
    expect(await page.locator("li.bubble .quote-card").count()).toBe(0);
    // The auto-reply is not in the chat, and changed neither its topics nor the next subject.
    await page.waitForFunction(() => [...document.querySelectorAll("details.other-mail button.chat-row .title")].some((e) => e.textContent === "Tereza Malá"));
    expect(await page.locator("li.bubble", { hasText: "out of the office" }).count()).toBe(0);
    expect(await page.locator("button.topics-button").count()).toBe(0);
    const second = parseMessage(await reply("Great."));
    expect(second.subject).toBe("Re: Invoice 114");

    seed("tereza-3.eml", { from: TEREZA, subject: "Office keys", text: "Do you still have the office keys?" }, "2026-03-21T12:10:00Z", "<tereza-3@example.net>");
    await page.waitForSelector("li.bubble:has-text('office keys')");
    expect(await page.$$eval("li.bubble .topic-run", (els) => els.map((e) => e.textContent))).toEqual(["Topic: Invoice 114", "Topic: Office keys"]);
    expect(await page.textContent("form.composer button.topic-chip")).toBe("Topic: Invoice 114 ▾");
    const third = parseMessage(await reply("Paid, by the way."));
    expect(third.subject).toBe("Re: Invoice 114");

    await page.$eval("details.other-mail", (details) => ((details as HTMLDetailsElement).open = true));
    await page.click("details.other-mail button.chat-row:has(.title:text-is('Tereza Malá'))");
    await page.waitForSelector("li.bubble:has-text('out of the office')");
    expect(await page.locator("li.bubble .subject-note, li.bubble .quote-card, li.bubble .topic-run").count()).toBe(0);
  });

  it("2c (5): shows only the fresh text of a reply quoting 40 lines, without a card, and Open original downloads the raw message", async () => {
    copyFileSync(longQuoteFixture, join(root, "INBOX", "gmail-long-quote.eml"));
    await openChat("Bob Svoboda");
    await page.waitForSelector("li.bubble:has-text('the tent')");
    const bubble = page.locator("li.bubble", { hasText: "the tent" });
    expect(await bubble.locator(":scope > .text").textContent()).toBe("Looks good, I'll bring the tent.\n\nBob");
    // A whole-message quote of something not in the mailbox: no card; its own subject shows as a note.
    expect(await bubble.locator(".quote-card").count()).toBe(0);
    expect(await bubble.locator(".subject-note").textContent()).toBe("Subject: Club weekend");
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
