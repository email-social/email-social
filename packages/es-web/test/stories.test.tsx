/** The stories strip and viewer (tasks/04 H, I), rendered to HTML. */
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { StorySender, StoryView } from "@email-social/es-bridge/api";
import { initials, storyDocument, storyPolicy, StoriesStrip, StoryViewer, unsubscribeLabel, unsubscribeQuestion, withImages } from "../src/Stories.js";

const NOW = new Date("2026-03-21T10:00:00Z");
const noop = (): void => undefined;
const asyncNoop = async (): Promise<void> => undefined;

const story = (messageId: string, receivedAt: string, seen: boolean) => ({
  messageId,
  title: `Story ${messageId}`,
  receivedAt,
  expiresAt: "2026-03-27T00:00:00.000Z",
  unsubscribe: "oneClick" as const,
  seen,
});

const senders: StorySender[] = [
  { sender: { address: "news@club.example.net", name: "Hiking Club" }, stories: [story("<c1@club.example.net>", "2026-03-20T17:05:00.000Z", false)], seen: false, chat: false },
  { sender: { address: "karel@example.org", name: "Karel Holub" }, stories: [story("<k1@example.org>", "2026-03-20T12:00:00.000Z", false)], seen: false, chat: true },
  {
    sender: { address: "news@shop.example.org", name: "Shoe Shop" },
    stories: [story("<s2@shop.example.org>", "2026-03-19T09:00:00.000Z", true), story("<s1@shop.example.org>", "2026-03-18T09:00:00.000Z", true)],
    seen: true,
    chat: false,
  },
];

const html = '<p>Sale</p><img data-src="https://img.shop.example.org/hero.jpg" data-srcset="https://img.shop.example.org/hero-2x.jpg 2x" alt="Shoes"><p>data-src="https://t.example.org/x" stays text</p>';

const view: StoryView = {
  messageId: "<s2@shop.example.org>",
  sender: { address: "news@shop.example.org", name: "Shoe Shop" },
  title: "Spring sale: shoes from 20 €",
  receivedAt: "2026-03-19T07:30:00.000Z",
  expiresAt: "2026-03-26T07:30:00.000Z",
  text: "Spring sale\n\nShop the sale",
  html,
  images: 1,
  unsubscribe: { kind: "oneClick", url: "https://shop.example.org/u/7f3a2c?l=spring", host: "shop.example.org" },
};

const viewer = (overrides: Partial<StoryView> = {}, images = false): string =>
  render(
    <StoryViewer
      view={{ ...view, ...overrides }}
      now={NOW}
      images={images}
      onLoadImages={noop}
      onUnsubscribe={asyncNoop}
      onHide={asyncNoop}
      onPrevious={null}
      onNext={noop}
      onClose={noop}
      notice={null}
    />,
  );

describe("StoriesStrip", () => {
  it("shows one circle per sender, newest first, with initials and a ring while unseen; chat partners are left out", () => {
    const out = render(<StoriesStrip senders={senders} open={null} onOpen={noop} />);
    expect([...out.matchAll(/data-sender="([^"]+)"/g)].map((m) => m[1])).toEqual(["news@club.example.net", "news@shop.example.org"]);
    expect(out).toContain('class="story-circle unseen" data-sender="news@club.example.net"');
    expect(out).toContain('class="story-circle" data-sender="news@shop.example.org"');
    expect(out).toContain('aria-label="Hiking Club: 1 new"');
    expect(out).toContain('aria-label="Shoe Shop: seen"');
    expect(out).toContain(">HC<");
    expect(out).not.toContain("Karel");
  });

  it("is not there when there is no story to show", () => {
    expect(render(<StoriesStrip senders={[]} open={null} onOpen={noop} />)).toBe("");
    expect(render(<StoriesStrip senders={[senders[1]!]} open={null} onOpen={noop} />)).toBe("");
  });

  it("makes initials from the first two words, else from the address", () => {
    expect(initials("Shoe Shop", "news@shop.example.org")).toBe("SS");
    expect(initials("Zahradnictví Čapek a syn", "z@example.org")).toBe("ZČ");
    expect(initials("", "news@shop.example.org")).toBe("N");
    expect(initials("(Club)", "c@example.org")).toBe("C");
  });
});

describe("storyDocument", () => {
  it("forbids every request until images are asked for, then allows https images only", () => {
    expect(storyPolicy(false)).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect(storyPolicy(true)).toBe("default-src 'none'; img-src data: https:; style-src 'unsafe-inline'");
    const doc = storyDocument(html, false);
    expect(doc.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(doc.indexOf("<body"));
    expect(doc).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`);
    expect(doc).not.toMatch(/<img[^>]* src=/);
  });

  it("Load images puts the sources back in <img> tags only", () => {
    expect(withImages(html)).toBe('<p>Sale</p><img src="https://img.shop.example.org/hero.jpg" srcset="https://img.shop.example.org/hero-2x.jpg 2x" alt="Shoes"><p>data-src="https://t.example.org/x" stays text</p>');
    expect(storyDocument(html, true)).toContain(`img-src data: https:`);
    expect(storyDocument(html, true)).toContain('<img src="https://img.shop.example.org/hero.jpg"');
  });
});

describe("StoryViewer", () => {
  it("shows the HTML in a frame that may run nothing, submit nothing and reach nothing", () => {
    const out = viewer();
    const frame = out.slice(out.indexOf("<iframe"), out.indexOf("</iframe>"));
    expect(frame).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
    expect(frame).not.toMatch(/allow-scripts|allow-same-origin|allow-forms/);
    expect(frame).toContain('referrerpolicy="no-referrer"');
    expect(frame).toContain("srcdoc=");
    expect(frame).toMatch(/default-src (?:'|&#39;)none(?:'|&#39;); img-src data:;/);
    expect(frame).not.toMatch(/&lt;img[^>]* src=/);
    expect(out).toContain(">Load images</button>");
  });

  it("with images asked for, the frame's policy allows https images and the button is gone", () => {
    const out = viewer({}, true);
    expect(out).toContain("img-src data: https:");
    expect(out).not.toContain(">Load images</button>");
  });

  it("shows the text of a text-only message, without a frame", () => {
    const out = viewer({ html: null, images: 0, text: "Weekend walks\n\nSaturday: the ridge." });
    expect(out).not.toContain("<iframe");
    expect(out).toContain('<div class="story-text">Weekend walks\n\nSaturday: the ridge.</div>');
  });

  it("names the kind of unsubscribe, and asks before it with where it goes", () => {
    expect(viewer()).toContain(">Unsubscribe (one tap)</button>");
    expect(viewer({ unsubscribe: { kind: "mailto", address: "leave@club.example.net", subject: "unsubscribe weekly" } })).toContain(">Unsubscribe by e-mail</button>");
    expect(viewer({ unsubscribe: { kind: "link", url: "https://books.example.org/leave" } })).toContain(">Unsubscribe (opens a page)</button>");
    expect(viewer({ unsubscribe: null })).toContain("This sender gives no way to unsubscribe.");
    expect(viewer()).toContain(">Hide sender</button>");
    expect(unsubscribeLabel({ kind: "oneClick", url: "https://a.example.org/u", host: "a.example.org" })).toBe("Unsubscribe (one tap)");
    expect(unsubscribeQuestion({ kind: "oneClick", url: "https://a.example.org/u", host: "a.example.org" })).toBe("Send an unsubscribe request to a.example.org?");
    expect(unsubscribeQuestion({ kind: "mailto", address: "leave@club.example.net", subject: "unsubscribe weekly" })).toBe("Send an unsubscribe e-mail to leave@club.example.net (subject “unsubscribe weekly”)?");
    expect(unsubscribeQuestion({ kind: "link", url: "https://books.example.org/leave?u=1" })).toBe("Open the sender's unsubscribe page (books.example.org) in a new window?");
  });

  it("has previous and next controls for moving between stories", () => {
    const out = viewer();
    expect(out).toMatch(/<button type="button" disabled aria-label="Previous story">/);
    expect(out).toMatch(/<button type="button" aria-label="Next story">/);
  });
});
