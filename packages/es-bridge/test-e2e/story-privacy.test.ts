/**
 * Reading a story tells its sender nothing (spec section 12.5, ST-8): hostile
 * HTML, every trick newsletters and trackers use to make a mail client fetch
 * something, goes through exactly what es-web shows (storyContent's reducer,
 * the frame document of story-document.ts, the sandboxed srcdoc frame) in
 * Chromium, under the page policy es-bridge serves. Two things are recorded:
 * every request the page or the frame starts (even one a policy then blocks),
 * and every request that reaches the network (here: the test's interception).
 *
 * - Shown: no request at all, not even one that a policy blocks.
 * - After Load images: only image requests, and only for the image sources
 *   the reducer held back (CSS backgrounds, styles, frames and the like stay
 *   blocked).
 * - Defence in depth: the same HTML unreduced, in the same frame, still
 *   sends no subresource request to the network (the frame's own policy
 *   blocks each one). Only a navigation of the frame itself (meta refresh)
 *   gets through there, which no policy blocks; the reducer removes it.
 *
 * Needs Chromium (playwright-core), as the other end-to-end tests do.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeHtml } from "../../es-core/src/mime/sanitize-html.js";
import { STORY_SANDBOX, storyDocument } from "../../es-web/src/story-document.js";
import { pagePolicy } from "../src/bridge.js";

const PARENT = "http://story.test/";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const T = "https://t.example.org";

/** name → HTML; `navigates` marks HTML whose only way out is to navigate the frame itself. */
const CORPUS: { name: string; html: string; navigates?: true }[] = [
  { name: "img src", html: `<p>Hi</p><img src="${T}/img.gif" width="1" height="1">` },
  { name: "img srcset only", html: `<img srcset="${T}/srcset.gif 1x, ${T}/srcset2.gif 2x">` },
  { name: "picture and source", html: `<picture><source srcset="${T}/source.webp" type="image/webp"><img src="${T}/picture.gif"></picture>` },
  { name: "upper and mixed case", html: `<IMG SRC="${T}/upper.gif"><ImG sRc=${T}/mixed.gif>` },
  { name: "unquoted, slashes and line breaks", html: `<img/src="${T}/slash.gif"><img\nsrc=${T}/newline.gif\n><img src=${T}/selfclose.gif/>` },
  { name: "entity-encoded URL", html: `<img src="https&#58;//t.example.org/entity.gif"><img src="&#x68;ttps://t.example.org/hexentity.gif">` },
  { name: "protocol-relative and relative after base", html: `<base href="${T}/"><img src="//t.example.org/protocol-relative.gif"><img src="relative.gif">` },
  { name: "style attribute url()", html: `<div style="background:url(${T}/bg.gif)">a</div><div style="background-image:url('${T}/bg2.gif')">b</div>` },
  { name: "style attribute obfuscated", html: `<div style="background:u\\72l(${T}/escaped.gif)">a</div><div style="background:url&#40;${T}/entity-paren.gif)">b</div><div style="background:ur/**/l(${T}/comment.gif)">c</div>` },
  { name: "image-set, list-style, cursor, border-image, content", html: `<div style="background-image:image-set('${T}/set.gif' 1x)">a</div><ul style="list-style-image:url(${T}/list.gif)"><li>x</li></ul><p style="cursor:url(${T}/cursor.cur),auto">c</p><p style="border-image:url(${T}/border.gif) 30">d</p><p style="content:url(${T}/content.gif)">e</p>` },
  { name: "background attributes", html: `<table background="${T}/table.gif"><tr><td background="${T}/td.gif">x</td></tr></table><div background="${T}/div.gif">y</div>` },
  { name: "body background", html: `<html><body background="${T}/body.gif"><p>z</p></body></html>` },
  { name: "style element with @import and @font-face", html: `<style>@import url(${T}/import.css); body { background: url(${T}/style-bg.gif) } @font-face { font-family: x; src: url(${T}/font.woff) }</style><p style="font-family:x">t</p>` },
  { name: "link elements", html: `<link rel="stylesheet" href="${T}/sheet.css"><link rel="preload" as="image" href="${T}/preload.gif"><link rel="prefetch" href="${T}/prefetch"><link rel="icon" href="${T}/icon.ico">` },
  { name: "meta refresh", html: `<meta http-equiv="refresh" content="0;url=${T}/refresh">`, navigates: true },
  { name: "video, audio and track", html: `<video poster="${T}/poster.gif" src="${T}/video.mp4" autoplay></video><audio src="${T}/audio.mp3" autoplay></audio><video><source src="${T}/source.mp4"><track src="${T}/track.vtt"></video>` },
  { name: "input type image and form", html: `<form action="${T}/form"><input type="image" src="${T}/input.gif"><button formaction="${T}/button">Go</button></form>` },
  { name: "svg image and use", html: `<svg width="10" height="10"><image href="${T}/svg-image.gif" width="10" height="10"/><use href="${T}/sprite.svg#a"/></svg>` },
  { name: "object, embed, iframe, frame", html: `<object data="${T}/object"></object><embed src="${T}/embed"><iframe src="${T}/iframe"></iframe><frameset><frame src="${T}/frame"></frameset>` },
  { name: "script src and inline handlers", html: `<script src="${T}/script.js"></script><img src="x" onerror="fetch('${T}/onerror')"><body onload="fetch('${T}/onload')">` },
  { name: "noscript, template, textarea", html: `<noscript><img src="${T}/noscript.gif"></noscript><template><img src="${T}/template.gif"></template><textarea><img src="${T}/textarea.gif"></textarea>` },
  { name: "comment tricks", html: `<!--><img src="${T}/comment-abrupt.gif">--><!-- --!><img src="${T}/comment-bang.gif"> --><![CDATA[<img src="${T}/cdata.gif">]]>` },
  { name: "quote and bracket confusion", html: `<img alt='"><img src=${T}/quote.gif>' src="x"><<img src="${T}/double-lt.gif"><img """ src="${T}/quotes.gif">` },
  { name: "math and xlink", html: `<math><mi xlink:href="${T}/math">x</mi></math><a xlink:href="${T}/xlink">y</a>` },
  { name: "a ping and links (only on click)", html: `<a href="${T}/link" ping="${T}/ping">Open</a> <a href="mailto:a@example.org">Mail</a>` },
  { name: "data: images and javascript: sources", html: `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img src="javascript:fetch('${T}/js')"><img src="data:text/html,<img src=${T}/datahtml.gif>">` },
  { name: "bgsound, marquee, applet", html: `<bgsound src="${T}/bgsound.wav"><marquee style="background:url(${T}/marquee.gif)">m</marquee><applet code="x" codebase="${T}/applet"></applet>` },
];

let browser: Browser;
let page: Page;
let srcdoc = "";
interface Request {
  url: string;
  type: string;
}
/** Started by the page or the frame, blocked by a policy or not. */
const started: Request[] = [];
/** Reached the network. */
const sent: Request[] = [];

/** Shows `doc` in the sandboxed frame of a page served with es-bridge's policy; returns what was started and what was sent. */
async function show(doc: string): Promise<{ started: Request[]; sent: Request[] }> {
  srcdoc = doc;
  started.length = 0;
  sent.length = 0;
  await page.goto(PARENT, { waitUntil: "load" });
  // Give a late request (a refresh, a lazy image) the time to start.
  await page.waitForTimeout(300);
  return { started: [...started], sent: [...sent] };
}

/** The image sources the reducer held back: what Load images may fetch. */
function heldBack(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/ data-src="([^"]*)"/g)) urls.push(m[1]!.replace(/&amp;/g, "&"));
  for (const m of html.matchAll(/ data-srcset="([^"]*)"/g)) for (const c of m[1]!.replace(/&amp;/g, "&").split(",")) urls.push(c.trim().split(/\s+/)[0]!);
  return urls;
}

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  page = await browser.newPage();
  page.on("request", (request) => {
    if (request.url() !== PARENT) started.push({ url: request.url(), type: request.resourceType() });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.url() === PARENT) {
      const escaped = srcdoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "content-security-policy": pagePolicy(1), "referrer-policy": "no-referrer" },
        body: `<!doctype html><html><body><iframe id="story" sandbox="${STORY_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escaped}"></iframe></body></html>`,
      });
    }
    sent.push({ url: request.url(), type: request.resourceType() });
    if (request.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.abort();
  });
});

afterAll(async () => {
  await browser?.close();
});

describe("a story's HTML in the browser", () => {
  it("the corpus exercises every trick: unreduced and with images allowed by both policies, it would reach the tracker", async () => {
    // Without the reducer and with the frame's img-src relaxed, plain image tags do go out: the test can see a leak.
    const leaked = await show(storyDocument(CORPUS[0]!.html, true));
    expect(leaked.sent.map((r) => r.url)).toContain(`${T}/img.gif`);
  });

  it.each(CORPUS)("$name: shown, it makes no request", async ({ html }) => {
    const reduced = sanitizeHtml(html).html;
    expect(await show(storyDocument(reduced, false))).toEqual({ started: [], sent: [] });
  });

  it.each(CORPUS)("$name: after Load images, only the held-back images are fetched", async ({ html }) => {
    const reduced = sanitizeHtml(html).html;
    const allowed = heldBack(reduced);
    const { started: fetched } = await show(storyDocument(reduced, true));
    for (const request of fetched) {
      expect(request.type, request.url).toBe("image");
      expect(allowed, request.url).toContain(request.url);
    }
  });

  it.each(CORPUS.filter((c) => c.navigates !== true))("$name: unreduced, the frame's policy still lets no subresource out", async ({ html }) => {
    expect((await show(storyDocument(html, false))).sent).toEqual([]);
  });

  it.each(CORPUS.filter((c) => c.navigates === true))("$name: unreduced, only the frame's own navigation goes out, which the reducer removes", async ({ html }) => {
    const { sent: out } = await show(storyDocument(html, false));
    expect(out.every((r) => r.type === "document"), JSON.stringify(out)).toBe(true);
    expect(sanitizeHtml(html).html).toBe("");
  });

  it("the story fixtures, through storyContent, make no request until Load images", async () => {
    const { readFileSync } = await import("node:fs");
    const { storyContent } = await import("../../es-core/src/parse.js");
    for (const name of ["newsletter-one-click", "newsletter-mailto-bulk", "expired-newsletter"]) {
      const raw = readFileSync(new URL(`../../es-core/fixtures/stories/${name}.eml`, import.meta.url));
      const content = storyContent(raw);
      if (content.html === null) continue;
      expect(await show(storyDocument(content.html, false)), name).toEqual({ started: [], sent: [] });
      const allowed = heldBack(content.html);
      const { sent: fetched } = await show(storyDocument(content.html, true));
      expect(fetched.length, name).toBeGreaterThan(0);
      for (const request of fetched) expect(allowed, `${name}: ${request.url}`).toContain(request.url);
    }
  });
});
