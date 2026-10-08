import { describe, expect, it } from "vitest";
import { formatEsJson, isEsMediaType, isRfc3339DateTime, parseEsJson } from "../src/es/schema.js";
import { canonicalAddress } from "../src/headers/canonical.js";
import { isValidMessageId, normalizeMessageId, parseMessageIds } from "../src/headers/message-id.js";
import type { EsPostPart, EsReceiptPart } from "../src/types.js";

const post: EsPostPart = {
  $type: "es.social.post",
  author: "did:es:example.com:ff8d9819fc0e12bf0d24892e45987e24",
  text: "Ahoj, jak se máš? 👋",
  via: "alice@example.com",
  createdAt: "2026-03-01T10:15:00.000Z",
  email: {
    messageId: "<m1@example.com>",
    subject: "Oběd",
    inReplyTo: "<m0@example.com>",
    references: ["<m0@example.com>"],
    textSha256: null,
    topicRoot: null,
    topicLabel: null,
    replyTo: null,
  },
  requestReceipts: ["delivered", "read"],
};

describe("ES part JSON", () => {
  it("round-trips a direct message record", () => {
    expect(parseEsJson(formatEsJson(post))).toEqual(post);
  });

  it("writes a fixed key order and omits empty optional fields", () => {
    const minimal: EsPostPart = {
      ...post,
      author: null,
      email: { messageId: null, subject: null, inReplyTo: null, references: [], textSha256: null, topicRoot: null, topicLabel: null, replyTo: null },
      requestReceipts: [],
    };
    expect(formatEsJson(minimal)).toBe(
      '{\n  "$type": "es.social.post",\n  "value": {\n    "text": "Ahoj, jak se máš? 👋",\n    "via": "alice@example.com",\n    "createdAt": "2026-03-01T10:15:00.000Z"\n  }\n}\n',
    );
  });

  it("writes topicRoot, topicLabel and replyTo after the other email fields, in that order, and reads them back", () => {
    const named: EsPostPart = {
      ...post,
      author: null,
      requestReceipts: [],
      email: {
        ...post.email,
        topicRoot: "<root@example.com>",
        topicLabel: "Trip",
        replyTo: { messageId: "<m0@example.com>", from: { name: "Bob", address: "bob@example.org" }, excerpt: "Shall we go?" },
      },
    };
    expect(formatEsJson(named)).toBe(
      "{\n" +
        '  "$type": "es.social.post",\n' +
        '  "value": {\n' +
        '    "text": "Ahoj, jak se máš? 👋",\n' +
        '    "via": "alice@example.com",\n' +
        '    "createdAt": "2026-03-01T10:15:00.000Z",\n' +
        '    "email": {\n' +
        '      "messageId": "<m1@example.com>",\n' +
        '      "subject": "Oběd",\n' +
        '      "inReplyTo": "<m0@example.com>",\n' +
        '      "references": [\n        "<m0@example.com>"\n      ],\n' +
        '      "topicRoot": "<root@example.com>",\n' +
        '      "topicLabel": "Trip",\n' +
        '      "replyTo": {\n' +
        '        "messageId": "<m0@example.com>",\n' +
        '        "from": {\n          "name": "Bob",\n          "address": "bob@example.org"\n        },\n' +
        '        "excerpt": "Shall we go?"\n' +
        "      }\n" +
        "    }\n" +
        "  }\n" +
        "}\n",
    );
    expect(parseEsJson(formatEsJson(named))).toEqual(named);
  });

  it("writes a replyTo without a Message-ID with messageId null, and reads it back", () => {
    const noId: EsPostPart = { ...post, email: { ...post.email, replyTo: { messageId: null, from: { name: "", address: "bob@example.org" }, excerpt: "" } } };
    expect(JSON.parse(formatEsJson(noId)).value.email.replyTo).toEqual({ messageId: null, from: { name: "", address: "bob@example.org" }, excerpt: "" });
    expect(parseEsJson(formatEsJson(noId))).toEqual(noId);
  });

  it("reads the topic and reply fields liberally", () => {
    const read = (email: unknown) => (parseEsJson(JSON.stringify({ $type: "es.social.post", value: { text: "x", via: "a@example.com", createdAt: "2026-01-01T00:00:00Z", email } })) as EsPostPart).email;
    expect(read({ topicRoot: 5, topicLabel: ["Trip"], replyTo: "x" })).toMatchObject({ topicRoot: null, topicLabel: null, replyTo: null });
    expect(read({ topicRoot: " root@Example.com ", topicLabel: "Trip" })).toMatchObject({ topicRoot: "<root@Example.com>", topicLabel: "Trip" });
    for (const replyTo of [{ messageId: "<a@example.net>" }, { from: {} }, { from: { address: 7 } }, { from: { address: "no-at" } }, { from: "bob@example.org" }]) {
      expect(read({ replyTo }).replyTo, JSON.stringify(replyTo)).toBeNull();
    }
    expect(read({ replyTo: { messageId: " m0@example.com", from: { name: 3, address: "Bob@EXAMPLE.org" }, excerpt: 5, extra: true } }).replyTo).toEqual({
      messageId: "<m0@example.com>",
      from: { name: "", address: "Bob@example.org" },
      excerpt: "",
    });
    expect(read({ replyTo: { messageId: 9, from: { name: "Bob", address: "bob@example.org" }, excerpt: "Hi" } }).replyTo).toEqual({ messageId: null, from: { name: "Bob", address: "bob@example.org" }, excerpt: "Hi" });
  });

  it("reads a record written before these fields existed, with all three null", () => {
    const old = { $type: "es.social.post", value: { text: "x", via: "a@example.com", createdAt: "2026-01-01T00:00:00Z", email: { messageId: "<m@example.com>" } } };
    expect((parseEsJson(JSON.stringify(old)) as EsPostPart).email).toEqual({ messageId: "<m@example.com>", subject: null, inReplyTo: null, references: [], textSha256: null, topicRoot: null, topicLabel: null, replyTo: null });
  });

  it("round-trips both receipt kinds", () => {
    for (const kind of ["delivered", "read"] as const) {
      const receipt: EsReceiptPart = {
        $type: "es.social.receipt",
        author: null,
        kind,
        messageId: "<m1@example.com>",
        via: "bob@example.org",
        createdAt: "2026-03-01T10:16:00.000Z",
      };
      expect(parseEsJson(formatEsJson(receipt))).toEqual(receipt);
    }
  });

  it("accepts the draft record envelope (spec 4.1) and ignores uri, cid and signature", () => {
    const draft = {
      $type: "es.social.post",
      uri: "at://did:es:mail.example.com:abc123/es.social.post/3k2a4b5c6d",
      cid: "bafyreihxr2je5dnp6oq3y3za4xqw27qpg7kvr3rmso7fmxjkybqpwv6lt4",
      value: {
        text: "Hello Email.Social!\n\nThis is a test message.",
        createdAt: "2024-10-10T12:00:00.000Z",
        via: "user@example.com",
        email: { messageId: "<unique-id@mail.example.com>", subject: "Hello Email.Social!" },
      },
      author: "did:es:mail.example.com:abc123",
      signature: { type: "ES256K", created: "2024-10-10T12:00:00Z", verificationMethod: "x", signatureValue: "..." },
    };
    expect(parseEsJson(JSON.stringify(draft))).toEqual({
      $type: "es.social.post",
      author: "did:es:mail.example.com:abc123",
      text: "Hello Email.Social!\n\nThis is a test message.",
      via: "user@example.com",
      createdAt: "2024-10-10T12:00:00.000Z",
      email: {
        messageId: "<unique-id@mail.example.com>",
        subject: "Hello Email.Social!",
        inReplyTo: null,
        references: [],
        textSha256: null,
        topicRoot: null,
        topicLabel: null,
        replyTo: null,
      },
      requestReceipts: [],
    });
  });

  it("rejects records without required fields, unknown types and invalid JSON", () => {
    const base = { $type: "es.social.post", value: { text: "x", via: "a@example.com", createdAt: "2026-01-01T00:00:00Z" } };
    expect(parseEsJson(JSON.stringify(base))).not.toBeNull();
    for (const bad of [
      "{",
      "[]",
      "null",
      JSON.stringify({ ...base, $type: "es.social.reaction" }),
      JSON.stringify({ ...base, value: { ...base.value, text: 5 } }),
      JSON.stringify({ ...base, value: { ...base.value, via: "no-at-sign" } }),
      JSON.stringify({ ...base, value: { ...base.value, createdAt: "yesterday" } }),
      JSON.stringify({ ...base, value: { ...base.value, createdAt: "2026-13-01T00:00:00Z" } }),
      JSON.stringify({ $type: "es.social.receipt", value: { kind: "seen", messageId: "<a@b>", via: "a@example.com", createdAt: "2026-01-01T00:00:00Z" } }),
    ]) {
      expect(parseEsJson(bad), bad).toBeNull();
    }
  });

  it("drops malformed optional fields instead of rejecting the record", () => {
    const parsed = parseEsJson(
      JSON.stringify({
        $type: "es.social.post",
        author: "not-a-did",
        value: {
          text: "x",
          via: "Alice@EXAMPLE.com",
          createdAt: "2026-01-01T00:00:00+01:00",
          email: { messageId: 7, references: ["<a@example.com>", 3, "b@example.com", "<a@example.com>"] },
          requestReceipts: ["read", "seen", "read"],
          facets: [],
        },
      }),
    );
    expect(parsed).toMatchObject({
      author: null,
      via: "Alice@example.com",
      email: { messageId: null, references: ["<a@example.com>", "<b@example.com>"] },
      requestReceipts: ["read"],
    });
  });

  it("reads a post that leaves out a long text and carries its SHA-256 instead", () => {
    const hash = "a".repeat(64);
    const value = { via: "a@example.com", createdAt: "2026-01-01T00:00:00Z", email: { textSha256: hash } };
    for (const record of [
      { $type: "es.social.post", value },
      { $type: "es.social.post", value: { ...value, text: null } },
    ]) {
      expect(parseEsJson(JSON.stringify(record))).toMatchObject({ text: null, email: { textSha256: hash } });
    }
    // Upper-case hex is read in canonical lower case.
    expect(
      parseEsJson(JSON.stringify({ $type: "es.social.post", value: { ...value, email: { textSha256: hash.toUpperCase() } } })),
    ).toMatchObject({ text: null, email: { textSha256: hash } });
  });

  it("rejects a post with neither text nor a valid textSha256", () => {
    const value = { via: "a@example.com", createdAt: "2026-01-01T00:00:00Z" };
    for (const email of [undefined, {}, { textSha256: "abc" }, { textSha256: "g".repeat(64) }, { textSha256: 5 }]) {
      expect(parseEsJson(JSON.stringify({ $type: "es.social.post", value: { ...value, email } })), JSON.stringify(email)).toBeNull();
    }
  });

  it("writes a post without text as a record with email.textSha256 and no text field", () => {
    const long: EsPostPart = {
      ...post,
      text: null,
      email: { ...post.email, textSha256: "0".repeat(64) },
    };
    const wire = JSON.parse(formatEsJson(long)) as { value: Record<string, unknown> };
    expect(wire.value).not.toHaveProperty("text");
    expect(wire.value.email).toMatchObject({ textSha256: "0".repeat(64) });
    expect(parseEsJson(formatEsJson(long))).toEqual(long);
  });

  it("recognises the ES media types, including the draft's", () => {
    expect(isEsMediaType("application/vnd.email-social.message+json")).toBe(true);
    expect(isEsMediaType("Application/VND.Email-Social.Message+JSON; charset=utf-8")).toBe(true);
    expect(isEsMediaType("application/vnd.es.social+json; version=2.0")).toBe(true);
    expect(isEsMediaType("application/json")).toBe(false);
  });

  it("validates RFC 3339 timestamps", () => {
    expect(isRfc3339DateTime("2024-10-10T12:00:00.000Z")).toBe(true);
    expect(isRfc3339DateTime("2024-10-10t12:00:00z")).toBe(true);
    expect(isRfc3339DateTime("2024-10-10T12:00:00+02:00")).toBe(true);
    expect(isRfc3339DateTime("2024-10-10 12:00:00Z")).toBe(false);
    expect(isRfc3339DateTime("2024-10-10T25:00:00Z")).toBe(false);
  });
});

describe("addresses and message ids", () => {
  it("lowercases only the domain of an address (RFC 5321 §2.4)", () => {
    expect(canonicalAddress(" Alice.Smith@Example.COM ")).toBe("Alice.Smith@example.com");
    expect(canonicalAddress("<bob@EXAMPLE.org>")).toBe("bob@example.org");
    expect(canonicalAddress('"a@b"@Example.net')).toBe('"a@b"@example.net');
    expect(canonicalAddress("undisclosed-recipients")).toBe("undisclosed-recipients");
  });

  it("extracts message ids liberally (RFC 5322 §3.6.4)", () => {
    expect(parseMessageIds("<a@example.com> <b@example.com>\r\n <a@example.com>")).toEqual(["<a@example.com>", "<b@example.com>"]);
    expect(parseMessageIds('Your message of "Mon, 1 Jan 2024" <c@example.com>')).toEqual(["<c@example.com>"]);
    expect(parseMessageIds("<long-id-folded\r\n @example.com>")).toEqual(["<long-id-folded@example.com>"]);
    expect(parseMessageIds("d@example.com (comment)")).toEqual(["<d@example.com>"]);
    expect(parseMessageIds("")).toEqual([]);
    expect(normalizeMessageId(" <x@example.com> ")).toBe("<x@example.com>");
    expect(isValidMessageId("<x.1+2=3@mail.example.com>")).toBe(true);
    expect(isValidMessageId("x@example.com")).toBe(false);
    expect(isValidMessageId("<x y@example.com>")).toBe(false);
    expect(isValidMessageId("<x@y@example.com>")).toBe(false);
  });
});
