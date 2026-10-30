/**
 * The es.social.story record (tasks/04 B, spec section "Stories"): how
 * writeStory writes it and how readRecord reads it back.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEsJson as readRecord, formatEsJson } from "../src/es/schema.js";
import { parseMessage } from "../src/parse.js";
import { writeStory } from "../src/serialize.js";
import type { EsOutgoingStory, EsStoryPart } from "../src/types.js";

const OPTIONS = { date: "2026-03-17T08:00:00Z", messageId: "<story-1@shop.example.org>" };
const STORY: EsOutgoingStory = {
  from: { name: "Shoe Shop", address: "news@shop.example.org" },
  to: [{ name: "Alice", address: "alice@example.com" }],
  title: "Spring sale",
  text: "Spring sale: shoes from 20 EUR.\n",
};

/** The JSON of the ES part of a raw message. */
function recordJson(raw: string): string {
  const base64 = /Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="email-social.json"\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)![1]!;
  return Buffer.from(base64.replace(/\r\n/g, ""), "base64").toString("utf8");
}

const valid = {
  $type: "es.social.story",
  value: { via: "news@shop.example.org", createdAt: "2026-03-17T08:00:00Z", email: { messageId: "<s@shop.example.org>" }, title: "Sale", text: "Sale!" },
};
const withValue = (value: Record<string, unknown>): string => JSON.stringify({ ...valid, value: { ...valid.value, ...value } });

describe("writeStory", () => {
  it("writes an ordinary message: text/plain first, the story record as the ES part, Subject = title", () => {
    const raw = writeStory(STORY, OPTIONS);
    expect(raw).toMatch(/^Subject: Spring sale\r$/m);
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="=_es_[0-9a-f]{24}"/);
    expect(raw.indexOf("Content-Type: text/plain; charset=utf-8")).toBeLessThan(raw.indexOf("Content-Type: application/vnd.email-social.message+json"));
    const parsed = parseMessage(raw);
    expect(parsed.text).toBe(STORY.text);
    expect(parsed.textSource).toBe("plain");
    expect(parsed.attachments).toEqual([]);
  });

  it("writes the record's fields in a fixed order and leaves optional ones out", () => {
    expect(recordJson(writeStory(STORY, OPTIONS))).toBe(
      '{\n  "$type": "es.social.story",\n  "value": {\n    "via": "news@shop.example.org",\n    "createdAt": "2026-03-17T08:00:00.000Z",\n    "email": {\n      "messageId": "<story-1@shop.example.org>"\n    },\n    "title": "Spring sale",\n    "text": "Spring sale: shoes from 20 EUR.\\n"\n  }\n}\n',
    );
    const full = JSON.parse(recordJson(writeStory({ ...STORY, author: "did:es:shop.example.org:abc", expiresAt: "2026-03-20T00:00:00+01:00", unsubscribe: { url: "https://shop.example.org/prefs" } }, OPTIONS)));
    expect(Object.keys(full)).toEqual(["$type", "author", "value"]);
    expect(Object.keys(full.value)).toEqual(["via", "createdAt", "email", "title", "expiresAt", "unsubscribe", "text"]);
    expect(full.value.expiresAt).toBe("2026-03-19T23:00:00.000Z");
  });

  it("never asks for receipts", () => {
    const raw = writeStory(STORY, OPTIONS);
    expect(recordJson(raw)).not.toContain("requestReceipts");
    expect(JSON.stringify(parseMessage(raw).es)).not.toContain("requestReceipts");
  });

  it("writes List-Unsubscribe from the record, so ordinary clients offer it too", () => {
    expect(writeStory({ ...STORY, unsubscribe: { mailto: "Leave@Shop.Example.org" } }, OPTIONS)).toMatch(/^List-Unsubscribe: <mailto:Leave@shop\.example\.org>\r$/m);
    expect(writeStory({ ...STORY, unsubscribe: { url: "https://shop.example.org/prefs?u=1" } }, OPTIONS)).toMatch(/^List-Unsubscribe: <https:\/\/shop\.example\.org\/prefs\?u=1>\r$/m);
    expect(writeStory(STORY, OPTIONS)).not.toContain("List-Unsubscribe");
  });

  it("collapses the title, and refuses an empty one or one over 200 UTF-8 bytes", () => {
    expect(parseMessage(writeStory({ ...STORY, title: "  Spring\t sale \n" }, OPTIONS)).subject).toBe("Spring sale");
    expect(() => writeStory({ ...STORY, title: "  " }, OPTIONS)).toThrow(TypeError);
    expect(() => writeStory({ ...STORY, title: "ž".repeat(101) }, OPTIONS)).toThrow(TypeError);
    expect(() => writeStory({ ...STORY, title: "ž".repeat(100) }, OPTIONS)).not.toThrow();
  });

  it("leaves a text over 10000 UTF-8 bytes out of the record and carries its SHA-256", () => {
    const text = "ž".repeat(5000) + "a";
    const raw = writeStory({ ...STORY, text }, OPTIONS);
    const record = JSON.parse(recordJson(raw));
    expect(record.value).not.toHaveProperty("text");
    expect(record.value.email.textSha256).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    const parsed = parseMessage(raw);
    expect(parsed.text).toBe(text);
    expect(parsed.es).toMatchObject({ $type: "es.social.story", text: null });
  });

  it("refuses a bad unsubscribe, expiresAt, author or a story without recipients", () => {
    for (const bad of [
      { unsubscribe: { url: "javascript:alert(1)" } },
      { unsubscribe: { url: "https://shop.example.org/a b" } },
      { unsubscribe: { mailto: "not an address" } },
      { unsubscribe: {} },
      { expiresAt: "next week" },
      { author: "did:web:shop.example.org" },
      { to: [] },
    ] as Partial<EsOutgoingStory>[]) {
      expect(() => writeStory({ ...STORY, ...bad }, OPTIONS), JSON.stringify(bad)).toThrow(TypeError);
    }
  });

  it("is deterministic", () => {
    expect(writeStory(STORY, OPTIONS)).toBe(writeStory({ ...STORY }, { ...OPTIONS }));
  });
});

describe("readRecord: es.social.story", () => {
  it("reads back what writeStory wrote, through parseMessage (the record belongs to the message)", () => {
    const raw = writeStory({ ...STORY, expiresAt: "2026-03-20T00:00:00Z", unsubscribe: { mailto: "leave@shop.example.org" } }, OPTIONS);
    const expected: EsStoryPart = {
      $type: "es.social.story",
      author: null,
      via: "news@shop.example.org",
      createdAt: "2026-03-17T08:00:00.000Z",
      email: { messageId: "<story-1@shop.example.org>", textSha256: null },
      title: "Spring sale",
      expiresAt: "2026-03-20T00:00:00.000Z",
      unsubscribe: { mailto: "leave@shop.example.org" },
      text: STORY.text,
    };
    expect(parseMessage(raw).es).toEqual(expected);
    expect(readRecord(recordJson(raw))).toEqual(expected);
    expect(formatEsJson(expected)).toBe(recordJson(raw));
  });

  it("rejects a story without a title, with an empty one, one over 200 bytes, or without email.messageId", () => {
    expect(readRecord(JSON.stringify(valid))).not.toBeNull();
    for (const value of [{ title: undefined }, { title: " " }, { title: "x".repeat(201) }, { title: 7 }, { email: {} }, { email: undefined }, { text: undefined }, { via: "nobody" }, { createdAt: "today" }]) {
      expect(readRecord(withValue(value)), JSON.stringify(value)).toBeNull();
    }
  });

  it("drops malformed optional fields instead of rejecting the story", () => {
    const story = readRecord(withValue({ expiresAt: "soon", unsubscribe: { url: "ftp://shop.example.org" }, requestReceipts: ["read"] })) as EsStoryPart;
    expect(story).toMatchObject({ $type: "es.social.story", expiresAt: null, unsubscribe: null });
    expect(story).not.toHaveProperty("requestReceipts");
    expect((readRecord(withValue({ unsubscribe: { mailto: "x" } })) as EsStoryPart).unsubscribe).toBeNull();
    expect((readRecord(withValue({ unsubscribe: { url: "https://shop.example.org/u?a=1" } })) as EsStoryPart).unsubscribe).toEqual({ url: "https://shop.example.org/u?a=1" });
  });

  it("accepts a story whose text is left out when email.textSha256 is given", () => {
    const sha = "a".repeat(64);
    expect(readRecord(withValue({ text: undefined, email: { messageId: "<s@shop.example.org>", textSha256: sha.toUpperCase() } }))).toMatchObject({ text: null, email: { textSha256: sha } });
  });

  it("is not taken from a message whose Message-ID differs from email.messageId", () => {
    const raw = writeStory(STORY, OPTIONS).replace("Message-ID: <story-1@shop.example.org>", "Message-ID: <other@shop.example.org>");
    const parsed = parseMessage(raw);
    expect(parsed.es).toBeNull();
    expect(parsed.attachments.map((a) => a.filename)).toEqual(["email-social.json"]);
  });
});
