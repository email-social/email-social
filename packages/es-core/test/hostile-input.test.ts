/**
 * Defects found by the fuzz harness (test/fuzz/), one test each, with the
 * smallest input that showed them. Most are cost blow-ups: input that a
 * hostile sender can put in a mailbox and that made one step quadratic, so
 * the parser hung for seconds to hours, or ran out of memory. Times are
 * bounded loosely (10× above what the fixed code needs), so the tests
 * separate linear from quadratic without depending on the machine.
 */
import { describe, expect, it } from "vitest";
import { parseMessage, splitQuoted, threadMessages, topicsOf } from "../src/index.js";
import { decodeText, decoderCacheSize } from "../src/codec/charset.js";
import { parseEsJson } from "../src/es/schema.js";
import { parseHeaderFields } from "../src/headers/header-block.js";
import { parseContentType } from "../src/headers/params.js";
import { htmlToText } from "../src/mime/html-to-text.js";
import type { EsMessage } from "../src/types.js";
import { msg } from "./helpers/messages.js";

function timed<T>(f: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = f();
  return { value, ms: performance.now() - started };
}

describe("hostile input: cost stays linear", () => {
  it("splitQuoted: 40 000 attribution + quote blocks with nothing fresh between them (quotes.ts)", () => {
    // Each block scanned every line before it for fresh text: 16 000 blocks took 3 s, 40 000 about 20 s.
    const text = "On Mon, 2 Mar 2026, a@example.com wrote:\n> x\n".repeat(40_000);
    const { value, ms } = timed(() => splitQuoted({ text }));
    expect(ms).toBeLessThan(1500);
    expect(value.fresh).toBe("");
    expect(value.quoted.split("\n").length).toBe(80_000);
  });

  it("Content-Type with 60 000 RFC 2231 fragments in reverse order (params.ts)", () => {
    // The duplicate-section test scanned every earlier fragment: 16 000 fragments took 0.5 s, 60 000 about 6 s.
    const n = 60_000;
    const value = "application/octet-stream; " + Array.from({ length: n }, (_, i) => `name*${n - 1 - i}*=%41`).join("; ") + "; name*0*=dup";
    const { value: parsed, ms } = timed(() => parseContentType(value));
    expect(ms).toBeLessThan(1500);
    expect(parsed.params.name).toBe("A".repeat(n));
  });

  it("htmlToText: 100 000 nested <blockquote>, each with a line (html-to-text.ts)", () => {
    // Every line repeated "> " once per enclosing quote: n²/2 marks. 1 MB of HTML exhausted a 4 GB heap.
    const html = "<blockquote>x".repeat(100_000);
    const { value, ms } = timed(() => htmlToText(html));
    expect(ms).toBeLessThan(2000);
    expect(value.length).toBeLessThan(8 * html.length);
    // Up to 32 levels keep one mark each; deeper quotes are drawn at depth 32.
    const lines = value.split("\n");
    expect(lines[0]).toBe("> x");
    expect(lines[31]).toBe("> ".repeat(32) + "x");
    expect(lines[99_999]).toBe("> ".repeat(32) + "x");
  });

  it("a header value with 64 000 inner spaces (header-block.ts)", () => {
    // /[ \t\r\n]+$/ retried from every space of the run: 32 000 spaces took 1.5 s, a 1 MB line about half an hour.
    const raw = "Subject: a" + " ".repeat(64_000) + "b\r\nTo: x <" + "\t".repeat(64_000) + "y@example.com>\r\n\r\nbody";
    const { value, ms } = timed(() => parseMessage(raw));
    expect(ms).toBeLessThan(500);
    expect(value.subject).toBe("a b");
    expect(parseHeaderFields(new TextEncoder().encode("X: \t a  b \t\r\n"))[0]!.value).toBe("a  b");
  });

  it("threading a reply chain of 20 000 messages (thread.ts)", () => {
    // Each message walked up the whole chain twice (loop check, then its root): 15 s.
    const messages = Array.from({ length: 20_000 }, (_, i) =>
      msg({ id: `<c${i}@example.com>`, from: "a@example.com", subject: "Chain", date: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), inReplyTo: i > 0 ? [`<c${i - 1}@example.com>`] : [] }),
    );
    const { value, ms } = timed(() => threadMessages(messages));
    expect(ms).toBeLessThan(3000);
    expect(value).toHaveLength(1);
    expect(value[0]!.rootMessageId).toBe("<c0@example.com>");
  });

  it("threading one message whose References holds 20 000 ids (thread.ts)", () => {
    // Linking id k walked the k ids before it to rule out a loop: 10 000 ids took 1.7 s.
    const references = Array.from({ length: 20_000 }, (_, i) => `<r${i}@example.com>`);
    const { value, ms } = timed(() => threadMessages([msg({ id: "<m@example.com>", from: "a@example.com", references })]));
    expect(ms).toBeLessThan(1000);
    expect(value[0]!.rootMessageId).toBe("<r0@example.com>");
  });

  it("References that loop back to the message itself and to each other still give one conversation each", () => {
    const messages = [
      msg({ id: "<a@example.com>", from: "a@example.com", subject: "x", references: ["<b@example.com>", "<a@example.com>"], inReplyTo: ["<a@example.com>"] }),
      msg({ id: "<b@example.com>", from: "a@example.com", subject: "x", references: ["<a@example.com>"] }),
    ];
    const conversations = threadMessages(messages);
    expect(conversations.flatMap((c) => c.messageIds).sort()).toEqual(["<a@example.com>", "<b@example.com>"]);
  });

  it("threading 20 000 messages without a subject from distinct senders (thread.ts)", () => {
    // Every group was compared with every earlier subject-less conversation: 12 s.
    const messages = Array.from({ length: 20_000 }, (_, i) => msg({ id: `<n${i}@example.com>`, from: `s${i}@example.com`, to: ["me@example.org"], subject: "" }));
    const { value, ms } = timed(() => threadMessages(messages));
    expect(ms).toBeLessThan(4000);
    expect(value).toHaveLength(20_000);
    // Same participants still share one conversation, in any order.
    const pair = [msg({ id: "<p1@example.com>", from: "x@example.com", to: ["y@example.com"] }), msg({ id: "<p2@example.com>", from: "y@example.com", to: ["x@example.com"] })];
    expect(threadMessages(pair)).toHaveLength(1);
  });

  // Same-subject groups are matched by a linear scan of every conversation with that subject
  // (thread.ts `candidates.find(fits)`); an index for "subset either way" is not a local fix.
  it.fails("threading 8 000 unrelated messages that share one subject (bulk mail) in under 1 s", { timeout: 60_000 }, () => {
    // Measured: 2 000 → 0.16 s, 4 000 → 0.7 s, 20 000 → 11.5 s.
    const messages: EsMessage[] = Array.from({ length: 8_000 }, (_, i) => msg({ id: `<h${i}@example.com>`, from: `s${i}@example.com`, to: [`r${i}@example.org`], subject: "Hello" }));
    const { ms } = timed(() => threadMessages(messages));
    expect(ms).toBeLessThan(1000);
  });

  it("topicsOf: one chat of 80 000 messages with distinct subjects (topics.ts)", () => {
    // Rule 3 scanned every earlier topic (computing its subject key) for each message: 5.9 s.
    const messages = Array.from({ length: 80_000 }, (_, i) =>
      msg({ id: `<t${i}@example.com>`, from: "news@example.com", to: "me@example.org", subject: `Issue ${i}`, date: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }),
    );
    // A later message without threading headers joins the newest topic with its subject.
    messages.push(msg({ id: "<again@example.com>", from: "news@example.com", to: "me@example.org", subject: "RE: Issue 5", date: "2026-12-31T00:00:00.000Z" }));
    const { value, ms } = timed(() => topicsOf(messages));
    expect(ms).toBeLessThan(1500);
    expect(value.topics).toHaveLength(80_000);
    expect(value.of["<again@example.com>"]!.rootId).toBe("<t5@example.com>");
  });

  it("an ES part whose email.references holds 100 000 ids (es/schema.ts)", () => {
    // The duplicate test was Array.includes over the ids kept so far: 5 × 10⁹ comparisons.
    const references = [...Array.from({ length: 100_000 }, (_, i) => `<r${i}@example.com>`), "<r0@example.com>", " <r1@example.com> "];
    const json = JSON.stringify({ $type: "es.social.post", value: { text: "x", via: "a@example.com", createdAt: "2026-03-02T09:00:00Z", email: { references } } });
    const { value, ms } = timed(() => parseEsJson(json));
    expect(ms).toBeLessThan(1000);
    expect(value?.$type === "es.social.post" && value.email.references.length).toBe(100_000);
  });
});

describe("hostile input: memory stays bounded", () => {
  it("decoding with 5 000 distinct unknown charset labels does not grow the decoder cache (charset.ts)", () => {
    // Every label ever seen was cached, so a mailbox with many invented labels grew a module-level Map for the life of the process.
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    decodeText(bytes, "iso-8859-2");
    const before = decoderCacheSize();
    for (let i = 0; i < 5000; i++) expect(decodeText(bytes, `x-invented-${i}-${"q".repeat(200)}`)).toBe("café");
    expect(decoderCacheSize()).toBe(before);
    expect(decodeText(bytes, "ISO-8859-2")).toBe("café");
  });
});
