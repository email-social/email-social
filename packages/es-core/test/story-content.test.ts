/**
 * What a story shows (tasks/04 G, spec section 12.5): sanitizeHtml, the
 * allow-list reducer, and storyContent on the story fixtures.
 */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/mime/sanitize-html.js";
import { parseMessage, storyContent } from "../src/parse.js";
import { writeStory } from "../src/serialize.js";
import { readFixture } from "./helpers/fixtures.js";

const clean = (html: string): string => sanitizeHtml(html).html;

describe("sanitizeHtml: an allow-list that runs nothing and loads nothing", () => {
  it("leaves out scripts, styles, the head, iframes, objects, embeds, svg and their content", () => {
    expect(
      clean(
        '<html><head><title>T</title><style>p{color:red}</style><meta http-equiv="refresh" content="0;url=https://x.example.org"><base href="https://x.example.org/"><link rel="stylesheet" href="https://x.example.org/a.css"></head>' +
          '<body><p>Hi</p><script>alert(1)</script><iframe src="https://x.example.org">frame</iframe><object data="x.swf"><p>fallback</p></object><embed src="x.swf"><svg><a href="https://x.example.org">s</a></svg><noscript><img src="https://t.example.org/p.gif"></noscript><p>end</p></body></html>',
      ),
    ).toBe("<p>Hi</p><p>end</p>");
  });

  it("leaves out forms and their controls, keeping the text around them", () => {
    expect(clean('<form action="https://x.example.org/s" method="post"><p>Rate us</p><input name="r"><button>Send</button><select><option>1</option></select><textarea>t</textarea></form>')).toBe(
      "<p>Rate us</p>",
    );
  });

  it("leaves out every event handler, id, class, background and unknown attribute", () => {
    expect(clean('<div onclick="x()" onmouseover=y() id="a" class="b" data-x="1" background="https://t.example.org/bg.png" align="center" title="T">x</div>')).toBe(
      '<div align="center" title="T">x</div>',
    );
    expect(clean('<table background="https://t.example.org/bg.png" bgcolor="#fff" width="600"><tr><td background="b.png" colspan="2">c</td></tr></table>')).toBe(
      '<table bgcolor="#fff" width="600"><tr><td colspan="2">c</td></tr></table>',
    );
  });

  it("keeps style declarations that load nothing and drops those that could", () => {
    expect(clean('<p style="color: red; background-image: url(https://t.example.org/x.png); font-size:14px">a</p>')).toBe('<p style="color: red; font-size:14px">a</p>');
    expect(clean('<p style="width: expression(alert(1)); color: blue; x: u\\72l(a); b: image-set(&quot;a.png&quot; 1x)">a</p>')).toBe('<p style="color: blue">a</p>');
    expect(clean('<p style="background: url&#40;https://t.example.org/x.png)">a</p>')).toBe("<p>a</p>");
    expect(clean('<p style="color:/**/red">a</p>')).toBe("<p>a</p>");
  });

  it("moves image sources to data-src and data-srcset, and counts the images held back", () => {
    expect(sanitizeHtml('<img src="https://shop.example.org/hero.jpg" srcset="https://shop.example.org/hero-2x.jpg 2x" alt="Shoes" width="600" onerror="x()"><img src="cid:logo@shop.example.org" alt="logo">')).toEqual({
      html: '<img data-src="https://shop.example.org/hero.jpg" data-srcset="https://shop.example.org/hero-2x.jpg 2x" alt="Shoes" width="600"><img alt="logo">',
      images: 1,
    });
    expect(clean('<img src="javascript:alert(1)"><img src=" data:image/png;base64,iVBORw0KGgo=">')).toBe('<img><img data-src="data:image/png;base64,iVBORw0KGgo=">');
    expect(clean('<img src="https://a.example.org/a.png" srcset="https://a.example.org/b.png 2x, javascript:x 3x">')).toBe('<img data-src="https://a.example.org/a.png">');
    expect(clean('<img data-src="https://t.example.org/p.gif">')).toBe("<img>");
  });

  it("keeps http, https and mailto links, opening in a new tab without a referrer", () => {
    expect(clean('<a href="https://shop.example.org/sale?a=1&amp;b=2" target="_self" rel="opener">Sale</a>')).toBe(
      '<a href="https://shop.example.org/sale?a=1&amp;b=2" rel="noreferrer noopener" target="_blank">Sale</a>',
    );
    expect(clean('<a href="mailto:help@shop.example.org">Mail</a>')).toBe('<a href="mailto:help@shop.example.org" rel="noreferrer noopener" target="_blank">Mail</a>');
  });

  it("drops javascript:, data: and obfuscated link targets", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "javascript&#58;alert(1)", "&#106;avascript:alert(1)", "data:text/html,<b>x</b>", " vbscript:x", "//t.example.org/x"]) {
      expect(clean(`<a href="${href.replace(/"/g, "&quot;")}">x</a>`), href).toBe('<a rel="noreferrer noopener" target="_blank">x</a>');
    }
  });

  it("escapes what it writes: quotes in attributes, < and > in text", () => {
    expect(clean('<p title=\'a"b<c\'>1 < 2 > 0 &amp; ok</p>')).toBe('<p title="a&quot;b&lt;c">1 &lt; 2 &gt; 0 &amp; ok</p>');
    expect(clean("<p>a</p><unknown-tag>b</unknown-tag><font face=\"Arial\" color=red>c</font>")).toBe('<p>a</p>b<font face="Arial" color="red">c</font>');
  });

  it("leaves out comments, doctypes and conditional comments", () => {
    expect(clean('<!DOCTYPE html><!--[if mso]><img src="https://t.example.org/o.gif"><![endif]--><p>x</p><?xml version="1.0"?>')).toBe("<p>x</p>");
  });

  it("never throws, and an unterminated tag hides the rest", () => {
    expect(clean("<p>a</p><img src=\"https://t.example.org/x")).toBe("<p>a</p>");
    expect(clean("<svg><p>never closed")).toBe("");
    for (const html of ["", "<", "<<<>>>", "</p>", "<a href=>", "<p a=\"", "&#xffffffff;", "<script>"]) expect(() => sanitizeHtml(html)).not.toThrow();
  });
});

describe("storyContent", () => {
  it("the one-click newsletter: reduced text, HTML without its style block, every image held back", () => {
    const raw = readFixture("stories/newsletter-one-click.eml");
    const content = storyContent(raw);
    expect(content.text).toBe(parseMessage(raw).text);
    expect(content.html).not.toBeNull();
    expect(content.html).not.toMatch(/<style|<script|\ssrc=|\ssrcset=|\son[a-z]+=/i);
    expect(content.html).toContain('data-src="https://img.shop.example.org/2026/spring/hero.jpg"');
    expect(content.html).toContain('data-srcset="https://img.shop.example.org/2026/spring/hero-2x.jpg 2x"');
    expect(content.html).toMatch(/<a href="https:\/\/shop\.example\.org\/[^"]*" rel="noreferrer noopener" target="_blank">/);
    expect(content.html).toContain('<img data-src="https://open.mail.shop.example.org/o/7f3a2c.gif" width="1" height="1" alt="">');
    expect(content.images).toBe(2);
  });

  it("a text-only message has no HTML", () => {
    const raw = readFixture("stories/newsletter-mailto-bulk.eml");
    expect(storyContent(raw)).toEqual({ text: parseMessage(raw).text, textSource: "plain", html: null, images: 0 });
    const story = writeStory(
      { from: { name: "Shop", address: "news@shop.example.org" }, to: [{ name: "", address: "alice@example.com" }], title: "Sale", text: "Sale!\n" },
      { date: "2026-03-17T08:00:00Z", messageId: "<s@shop.example.org>" },
    );
    expect(storyContent(story)).toEqual({ text: "Sale!\n", textSource: "plain", html: null, images: 0 });
  });

  it("never throws", () => {
    for (const raw of ["", "Content-Type: text/html\r\n\r\n<p", new Uint8Array([0xff, 0xfe, 0x00])]) expect(() => storyContent(raw)).not.toThrow();
  });
});
