import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { base64Decode } from "../src/codec/base64.js";
import { decodeEncodedWords } from "../src/codec/encoded-word.js";
import { qpDecode } from "../src/codec/quoted-printable.js";
import { getHeader, parseHeaderFields, splitHeaderBody, type HeaderField } from "../src/headers/header-block.js";
import { replyTargetOf, serializeMessage, serializeReceipt } from "../src/serialize.js";
import type { EsMessage, EsOutgoingReceipt, ReplyTarget, SerializeOptions } from "../src/types.js";

// Reads the output back with the low-level codecs only (no parseMessage).

interface Part {
  fields: HeaderField[];
  raw: string;
}

function inspect(raw: string): { fields: HeaderField[]; parts: Part[] } {
  const { header, body } = splitHeaderBody(new TextEncoder().encode(raw));
  const fields = parseHeaderFields(header);
  const boundary = /boundary="([^"]+)"/.exec(getHeader(fields, "Content-Type") ?? "")![1]!;
  const chunks = new TextDecoder().decode(body).split("\r\n--" + boundary);
  const parts = chunks.slice(1, -1).map((chunk) => {
    const split = splitHeaderBody(new TextEncoder().encode(chunk.slice(2)));
    return { fields: parseHeaderFields(split.header), raw: new TextDecoder().decode(split.body) };
  });
  expect(chunks[chunks.length - 1]).toBe("--\r\n");
  return { fields, parts };
}

function header(raw: string, name: string): string | null {
  return getHeader(inspect(raw).fields, name);
}

function textOf(raw: string): string {
  const part = inspect(raw).parts[0]!;
  const bytes = new TextEncoder().encode(part.raw);
  const qp = getHeader(part.fields, "Content-Transfer-Encoding") === "quoted-printable";
  return new TextDecoder("utf-8", { fatal: true }).decode(qp ? qpDecode(bytes) : bytes).replace(/\r\n/g, "\n");
}

function esOf(raw: string): unknown {
  const part = inspect(raw).parts[1]!;
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64Decode(part.raw)));
}

const ALICE = { name: "Alice", address: "alice@example.com" };
const BOB = { name: "Bob", address: "bob@example.org" };
const ORIGINAL: ReplyTarget = { messageId: "<m1@example.com>", references: ["<m0@example.com>"], subject: "Lunch on Friday?" };
const OPTIONS: SerializeOptions = { date: "2026-03-02T09:05:00.000Z", messageId: "<rcpt1@example.org>" };

function receipt(extra: Partial<EsOutgoingReceipt> = {}): EsOutgoingReceipt {
  return { kind: "read", from: BOB, to: ALICE, original: ORIGINAL, ...extra };
}

describe("serializeReceipt", () => {
  it("writes the header section of a read receipt exactly", () => {
    const raw = serializeReceipt(receipt(), OPTIONS);
    const boundary = "=_es_" + createHash("sha256").update("<rcpt1@example.org>").digest("hex").slice(0, 24);
    expect(raw.slice(0, raw.indexOf("\r\n\r\n") + 4)).toBe(
      "Date: Mon, 2 Mar 2026 09:05:00 +0000\r\n" +
        "From: Bob <bob@example.org>\r\n" +
        "To: Alice <alice@example.com>\r\n" +
        "Subject: Read: Lunch on Friday?\r\n" +
        "Message-ID: <rcpt1@example.org>\r\n" +
        "In-Reply-To: <m1@example.com>\r\n" +
        "References: <m0@example.com> <m1@example.com>\r\n" +
        "Auto-Submitted: auto-replied\r\n" +
        "MIME-Version: 1.0\r\n" +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` +
        "\r\n",
    );
  });

  it("has the same layout as a message: text/plain first, then the ES part as an attachment", () => {
    const { parts } = inspect(serializeReceipt(receipt(), OPTIONS));
    expect(parts).toHaveLength(2);
    expect(getHeader(parts[0]!.fields, "Content-Type")).toBe("text/plain; charset=utf-8");
    expect(parts[1]!.fields.map((f) => [f.name, f.value])).toEqual([
      ["Content-Type", "application/vnd.email-social.message+json"],
      ["Content-Transfer-Encoding", "base64"],
      ["Content-Disposition", 'attachment; filename="email-social.json"'],
    ]);
  });

  it("uses a Delivered: subject for delivery receipts", () => {
    const raw = serializeReceipt(receipt({ kind: "delivered" }), OPTIONS);
    expect(header(raw, "Subject")).toBe("Delivered: Lunch on Friday?");
    expect(header(raw, "Auto-Submitted")).toBe("auto-replied");
  });

  it("falls back to a fixed subject when the original has none", () => {
    const original = { messageId: "<m1@example.com>" };
    expect(header(serializeReceipt(receipt({ original }), OPTIONS), "Subject")).toBe("Read receipt");
    expect(header(serializeReceipt(receipt({ kind: "delivered", original }), OPTIONS), "Subject")).toBe("Delivery receipt");
    const blank = { messageId: "<m1@example.com>", subject: "  " };
    expect(header(serializeReceipt(receipt({ original: blank }), OPTIONS), "Subject")).toBe("Read receipt");
  });

  it("encodes a non-ASCII original subject and keeps the output 7-bit", () => {
    const raw = serializeReceipt(receipt({ original: { messageId: "<m1@example.com>", subject: "Schůzka v pátek" } }), OPTIONS);
    expect(raw).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    expect(decodeEncodedWords(header(raw, "Subject")!.replace(/\r\n(?=[ \t])/g, ""))).toBe("Read: Schůzka v pátek");
    expect(textOf(raw)).toContain('"Schůzka v pátek"');
  });

  it("says in plain English what happened, for both kinds", () => {
    expect(textOf(serializeReceipt(receipt(), OPTIONS))).toBe(
      'Read receipt: the message "Lunch on Friday?" (<m1@example.com>) was opened by bob@example.org' +
        " on Mon, 2 Mar 2026 09:05:00 +0000.\n",
    );
    expect(textOf(serializeReceipt(receipt({ kind: "delivered" }), OPTIONS))).toBe(
      'Delivery receipt: the message "Lunch on Friday?" (<m1@example.com>) was received by the Email Social' +
        " client of bob@example.org on Mon, 2 Mar 2026 09:05:00 +0000.\n",
    );
    expect(textOf(serializeReceipt(receipt({ original: { messageId: "<m1@example.com>" } }), OPTIONS))).toBe(
      "Read receipt: the message <m1@example.com> was opened by bob@example.org on Mon, 2 Mar 2026 09:05:00 +0000.\n",
    );
  });

  it("carries an es.social.receipt record for both kinds", () => {
    for (const kind of ["read", "delivered"] as const) {
      const raw = serializeReceipt(
        receipt({ kind, from: { name: "Bob", address: "Bob@EXAMPLE.org" }, author: "did:es:example.org:bob" }),
        OPTIONS,
      );
      expect(esOf(raw)).toEqual({
        $type: "es.social.receipt",
        author: "did:es:example.org:bob",
        value: { kind, messageId: "<m1@example.com>", via: "Bob@example.org", createdAt: "2026-03-02T09:05:00.000Z" },
      });
    }
    expect(esOf(serializeReceipt(receipt(), OPTIONS))).not.toHaveProperty("author");
  });

  it("never requests receipts itself", () => {
    const raw = serializeReceipt(receipt(), OPTIONS);
    expect(JSON.stringify(esOf(raw))).not.toContain("requestReceipts");
  });

  it("threads to the original: References from the original's chain, trimmed to 20 ids", () => {
    const references = Array.from({ length: 22 }, (_, i) => `<r${i}@example.com>`);
    const raw = serializeReceipt(receipt({ original: { messageId: "<m1@example.com>", references } }), OPTIONS);
    const written = header(raw, "References")!.replace(/\r\n(?=[ \t])/g, "").split(" ");
    expect(written).toEqual([references[0]!, ...references.slice(4), "<m1@example.com>"]);
    expect(header(raw, "In-Reply-To")).toBe("<m1@example.com>");
    const noChain = serializeReceipt(receipt({ original: { messageId: "<m1@example.com>" } }), OPTIONS);
    expect(header(noChain, "References")).toBe("<m1@example.com>");
  });

  it("rejects invalid input with a TypeError", () => {
    const bad: Array<Partial<EsOutgoingReceipt>> = [
      { kind: "seen" as never },
      { original: { messageId: "m1@example.com" } },
      { original: { messageId: "<ž@example.com>" } },
      { from: { name: "", address: "bob" } },
      { to: { name: "", address: "alice@" } },
      { author: "did:web:example.org" },
    ];
    for (const extra of bad) expect(() => serializeReceipt(receipt(extra), OPTIONS), JSON.stringify(extra)).toThrow(TypeError);
    expect(() => serializeReceipt(receipt(), { ...OPTIONS, messageId: "<bad id@example.org>" })).toThrow(TypeError);
    expect(() => serializeReceipt(receipt(), { ...OPTIONS, date: "yesterday" })).toThrow(TypeError);
  });

  it("reads the same in an independent parser (mailparser)", async () => {
    const raw = serializeReceipt(receipt({ original: { messageId: "<m1@example.com>", subject: "Žluťoučký kůň" } }), OPTIONS);
    const parsed = await simpleParser(raw);
    expect(parsed.subject).toBe("Read: Žluťoučký kůň");
    expect(parsed.text).toBe(textOf(raw));
    expect(parsed.inReplyTo).toBe("<m1@example.com>");
    expect(parsed.headers.get("auto-submitted")).toBe("auto-replied");
    expect(parsed.attachments.map((a) => a.filename)).toEqual(["email-social.json"]);
  });

  it("is deterministic", () => {
    const first = serializeReceipt(receipt({ kind: "delivered" }), OPTIONS);
    expect(serializeReceipt(structuredClone(receipt({ kind: "delivered" })), { ...OPTIONS })).toBe(first);
    expect(serializeReceipt(receipt({ kind: "delivered" }), { ...OPTIONS, date: new Date(OPTIONS.date) })).toBe(first);
  });
});

function message(refs: Partial<EsMessage["refs"]>, subject = "Lunch"): EsMessage {
  return {
    id: refs.messageId ?? "sha256:" + "0".repeat(64),
    from: ALICE,
    to: [BOB],
    cc: [],
    replyTo: [],
    date: "2026-03-02T09:00:00.000Z",
    subject,
    text: "",
    textSource: "none",
    es: null,
    attachments: [],
    refs: { messageId: null, inReplyTo: [], references: [], ...refs },
  };
}

describe("replyTargetOf", () => {
  it("uses the message's References when it has them", () => {
    const target = replyTargetOf(
      message({ messageId: "<c@example.com>", inReplyTo: ["<b@example.com>"], references: ["<a@example.com>", "<b@example.com>"] }),
    );
    expect(target).toEqual({ messageId: "<c@example.com>", references: ["<a@example.com>", "<b@example.com>"], subject: "Lunch" });
  });

  it("uses a single In-Reply-To id when there are no References (RFC 5322 §3.6.4)", () => {
    const target = replyTargetOf(message({ messageId: "<c@example.com>", inReplyTo: ["<b@example.com>"] }));
    expect(target.references).toEqual(["<b@example.com>"]);
  });

  it("uses no references when In-Reply-To has several ids or none", () => {
    expect(replyTargetOf(message({ messageId: "<c@example.com>", inReplyTo: ["<a@example.com>", "<b@example.com>"] })).references).toEqual([]);
    expect(replyTargetOf(message({ messageId: "<c@example.com>" })).references).toEqual([]);
  });

  it("throws a TypeError when the message has no Message-ID", () => {
    expect(() => replyTargetOf(message({ references: ["<a@example.com>"] }))).toThrow(TypeError);
  });

  it("returns copies, so changing the target does not change the message", () => {
    const parent = message({ messageId: "<c@example.com>", references: ["<a@example.com>"] });
    replyTargetOf(parent).references!.push("<x@example.com>");
    expect(parent.refs.references).toEqual(["<a@example.com>"]);
  });

  it("feeds serializeMessage so the reply continues the parent's chain", () => {
    const parent = message({ messageId: "<c@example.com>", references: ["<a@example.com>", "<b@example.com>"] }, "RE: Lunch");
    const raw = serializeMessage(
      { from: BOB, to: [ALICE], text: "Yes.\n", inReplyTo: replyTargetOf(parent) },
      { date: "2026-03-02T10:00:00Z", messageId: "<d@example.org>" },
    );
    expect(header(raw, "Subject")).toBe("RE: Lunch");
    expect(header(raw, "In-Reply-To")).toBe("<c@example.com>");
    expect(header(raw, "References")).toBe("<a@example.com> <b@example.com> <c@example.com>");
  });
});

describe("serializeReceipt: includeEsPart", () => {
  it("keeps the ES part in a receipt even when includeEsPart is false", () => {
    const receipt: EsOutgoingReceipt = { kind: "read", from: BOB, to: ALICE, original: ORIGINAL };
    const raw = serializeReceipt(receipt, { ...OPTIONS, includeEsPart: false });
    expect(raw).toBe(serializeReceipt(receipt, OPTIONS));
    expect(esOf(raw)).toMatchObject({ $type: "es.social.receipt", value: { kind: "read" } });
  });
});
