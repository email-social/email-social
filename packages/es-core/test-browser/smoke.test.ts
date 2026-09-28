/**
 * Browser smoke test: the Vite bundle (dist/es-core.js, built by
 * `npm run test:browser`) runs in Chromium with browser APIs only and gives
 * the same result as in Node. Set CHROMIUM_PATH to use another Chromium
 * binary than the one playwright-core installs.
 */
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";

const bundle = readFileSync(new URL("../dist/es-core.js", import.meta.url), "utf8");
const fixture = readFileSync(new URL("../fixtures/gmail-web-reply.eml", import.meta.url), "utf8");

let browser: Browser;

interface SmokeResult {
  nodeGlobals: string[];
  message: ReturnType<typeof parseMessage>;
  reply: { text: string; inReplyTo: string[]; es: string | undefined };
  conversations: number;
}

/**
 * Runs in the page. Kept as a string so the test runner's module transform
 * does not rewrite it; it imports the bundle from a Blob URL like any
 * browser app would load an ES module.
 */
const PAGE_SCRIPT = `
window.smoke = async (raw) => {
  const url = URL.createObjectURL(new Blob([window.bundle], { type: "text/javascript" }));
  const esCore = await import(url);
  const message = esCore.parseMessage(new TextEncoder().encode(raw));
  const reply = esCore.parseMessage(
    esCore.serializeMessage(
      { from: message.to[0], to: [message.from], text: "Platí, v pátek ve 12.", inReplyTo: esCore.replyTargetOf(message) },
      { date: "2026-03-02T12:00:00Z", messageId: "<browser-1@mail.example.com>" },
    ),
  );
  return {
    nodeGlobals: [typeof globalThis.Buffer, typeof globalThis.process],
    message,
    reply: { text: reply.text, inReplyTo: reply.refs.inReplyTo, es: reply.es?.$type },
    conversations: esCore.threadMessages([message, reply]).length,
  };
};
`;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

afterAll(async () => {
  await browser?.close();
});

describe("es-core in a browser", () => {
  it("parses a fixture with browser APIs only, exactly as in Node", async () => {
    const page = await browser.newPage();
    await page.evaluate(`window.bundle = ${JSON.stringify(bundle)};`);
    await page.evaluate(PAGE_SCRIPT);
    const result = (await page.evaluate(`window.smoke(${JSON.stringify(fixture)})`)) as SmokeResult;
    expect(result.nodeGlobals).toEqual(["undefined", "undefined"]);
    expect(result.message).toEqual(parseMessage(fixture));
    expect(result.message.subject).toBe("Re: Oběd v pátek");
    expect(result.reply).toEqual({
      text: "Platí, v pátek ve 12.",
      inReplyTo: [result.message.id],
      es: "es.social.post",
    });
    expect(result.conversations).toBe(1);
    await page.close();
  });
});
