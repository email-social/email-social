import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { base64Decode } from "../src/codec/base64.js";
import { decodeEncodedWords } from "../src/codec/encoded-word.js";
import { qpDecode } from "../src/codec/quoted-printable.js";
import { parseAddressList } from "../src/headers/address.js";
import { getHeader, parseHeaderFields, splitHeaderBody, type HeaderField } from "../src/headers/header-block.js";
import { serializeMessage } from "../src/serialize.js";
import type { EsOutgoing, ReceiptKind, SerializeOptions } from "../src/types.js";

// ---------------------------------------------------------------------------
// Inspection helpers: read the serialiser's output back with the low-level
// codecs only (parseMessage is tested separately, including round trips).

interface Part {
  fields: HeaderField[];
  /** Raw (still transfer-encoded) body. */
  raw: string;
}

interface Inspected {
  fields: HeaderField[];
  header: (name: string) => string | null;
  boundary: string;
  preamble: string;
  parts: Part[];
  epilogue: string;
}

function inspect(raw: string): Inspected {
  const { header, body } = splitHeaderBody(new TextEncoder().encode(raw));
  const fields = parseHeaderFields(header);
  const boundary = /boundary="([^"]+)"/.exec(getHeader(fields, "Content-Type") ?? "")?.[1];
  if (boundary === undefined) throw new Error("no boundary");
  const text = new TextDecoder().decode(body);
  // RFC 2046 §5.1.1: the CRLF before "--boundary" belongs to the delimiter.
  const chunks = text.split("\r\n--" + boundary);
  const preamble = chunks[0]!;
  const last = chunks[chunks.length - 1]!;
  if (!last.startsWith("--")) throw new Error("no close delimiter");
  const parts = chunks.slice(1, -1).map((chunk) => {
    if (!chunk.startsWith("\r\n")) throw new Error("delimiter line not followed by CRLF");
    const split = splitHeaderBody(new TextEncoder().encode(chunk.slice(2)));
    return { fields: parseHeaderFields(split.header), raw: new TextDecoder().decode(split.body) };
  });
  return { fields, header: (name) => getHeader(fields, name), boundary, preamble, parts, epilogue: last.slice(2) };
}

/** Decoded text of the text/plain part, with "\n" line endings. */
function textOf(part: Part): string {
  const cte = getHeader(part.fields, "Content-Transfer-Encoding");
  const bytes = new TextEncoder().encode(part.raw);
  const decoded = cte === "quoted-printable" ? qpDecode(bytes) : bytes;
  return new TextDecoder("utf-8", { fatal: true }).decode(decoded).replace(/\r\n/g, "\n");
}

/** The ES record carried by the second part. */
function esOf(raw: string): Record<string, unknown> {
  const part = inspect(raw).parts[1]!;
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64Decode(part.raw))) as Record<string, unknown>;
}

function esValue(raw: string): Record<string, unknown> {
  return esOf(raw).value as Record<string, unknown>;
}

function unfold(value: string): string {
  return value.replace(/\r\n(?=[ \t])/g, "");
}

/** Raw header lines of the top-level header section (unfolded continuation lines kept separate). */
function headerLines(raw: string): string[] {
  return raw.slice(0, raw.indexOf("\r\n\r\n")).split("\r\n");
}

/** Names of the top-level header fields, in order. */
function headerNames(raw: string): string[] {
  return headerLines(raw)
    .filter((line) => !/^[ \t]/.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));
}

function b64(json: string): string {
  return Buffer.from(json, "utf8").toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");
}

function sha24(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 24);
}

const ALICE = { name: "Alice", address: "alice@example.com" };
const BOB = { name: "Bob", address: "bob@example.org" };
const CAROL = { name: "Carol", address: "carol@example.net" };
const OPTIONS: SerializeOptions = { date: "2026-03-02T09:00:00.000Z", messageId: "<m1@example.com>" };

function outgoing(extra: Partial<EsOutgoing> = {}): EsOutgoing {
  return { from: ALICE, to: [BOB], subject: "Hello", text: "Hi Bob.\n", ...extra };
}

// ---------------------------------------------------------------------------

describe("serializeMessage: golden output", () => {
  it("writes a simple ASCII message exactly", () => {
    const raw = serializeMessage(
      {
        from: ALICE,
        to: [BOB],
        subject: "Lunch on Friday?",
        text: "Hi Bob,\n\nlunch on Friday at noon?\n\nAlice\n",
      },
      OPTIONS,
    );
    const json =
      JSON.stringify(
        {
          $type: "es.social.post",
          value: {
            text: "Hi Bob,\n\nlunch on Friday at noon?\n\nAlice\n",
            via: "alice@example.com",
            createdAt: "2026-03-02T09:00:00.000Z",
            email: { messageId: "<m1@example.com>", subject: "Lunch on Friday?" },
          },
        },
        null,
        2,
      ) + "\n";
    const b = "=_es_910f6730af7e84e8f2cd4134";
    const expected =
      "Date: Mon, 2 Mar 2026 09:00:00 +0000\r\n" +
      "From: Alice <alice@example.com>\r\n" +
      "To: Bob <bob@example.org>\r\n" +
      "Subject: Lunch on Friday?\r\n" +
      "Message-ID: <m1@example.com>\r\n" +
      "MIME-Version: 1.0\r\n" +
      `Content-Type: multipart/mixed; boundary="${b}"\r\n` +
      "\r\n" +
      "This is a multi-part message in MIME format.\r\n" +
      "\r\n" +
      `--${b}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Transfer-Encoding: 7bit\r\n" +
      "\r\n" +
      "Hi Bob,\r\n" +
      "\r\n" +
      "lunch on Friday at noon?\r\n" +
      "\r\n" +
      "Alice\r\n" +
      "\r\n" +
      `--${b}\r\n` +
      "Content-Type: application/vnd.email-social.message+json\r\n" +
      "Content-Transfer-Encoding: base64\r\n" +
      'Content-Disposition: attachment; filename="email-social.json"\r\n' +
      "\r\n" +
      b64(json) +
      "\r\n" +
      `--${b}--\r\n`;
    expect(raw).toBe(expected);
  });

  it("writes a Czech reply exactly (RFC 2047 names and subject, quoted-printable text, threading headers)", () => {
    const raw = serializeMessage(
      {
        from: { name: "Jana Nováková", address: "jana@example.com" },
        to: [{ name: "Karel Novák", address: "karel@example.org" }],
        text: "Ahoj Karle,\n\nv pátek mi to vyhovuje.\n\nJana\n",
        inReplyTo: { messageId: "<m2@example.org>", references: ["<m1@example.com>"], subject: "Schůzka v pátek" },
        es: { author: "did:es:example.com:jana", requestReceipts: ["read", "delivered", "read"] },
      },
      { date: "2026-03-02T10:15:30.000Z", messageId: "<m3@example.com>" },
    );
    const json =
      JSON.stringify(
        {
          $type: "es.social.post",
          author: "did:es:example.com:jana",
          value: {
            text: "Ahoj Karle,\n\nv pátek mi to vyhovuje.\n\nJana\n",
            via: "jana@example.com",
            createdAt: "2026-03-02T10:15:30.000Z",
            email: {
              messageId: "<m3@example.com>",
              subject: "Re: Schůzka v pátek",
              inReplyTo: "<m2@example.org>",
              references: ["<m1@example.com>", "<m2@example.org>"],
            },
            requestReceipts: ["delivered", "read"],
          },
        },
        null,
        2,
      ) + "\n";
    const b = "=_es_8ce320f4a70ef44a982cd0ac";
    const expected =
      "Date: Mon, 2 Mar 2026 10:15:30 +0000\r\n" +
      "From: =?UTF-8?B?SmFuYSBOb3bDoWtvdsOh?= <jana@example.com>\r\n" +
      "To: =?UTF-8?Q?Karel_Nov=C3=A1k?= <karel@example.org>\r\n" +
      "Subject: =?UTF-8?B?UmU6IFNjaMWvemthIHYgcMOhdGVr?=\r\n" +
      "Message-ID: <m3@example.com>\r\n" +
      "In-Reply-To: <m2@example.org>\r\n" +
      "References: <m1@example.com> <m2@example.org>\r\n" +
      "MIME-Version: 1.0\r\n" +
      `Content-Type: multipart/mixed; boundary="${b}"\r\n` +
      "\r\n" +
      "This is a multi-part message in MIME format.\r\n" +
      "\r\n" +
      `--${b}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Transfer-Encoding: quoted-printable\r\n" +
      "\r\n" +
      "Ahoj Karle,\r\n" +
      "\r\n" +
      "v p=C3=A1tek mi to vyhovuje.\r\n" +
      "\r\n" +
      "Jana\r\n" +
      "\r\n" +
      `--${b}\r\n` +
      "Content-Type: application/vnd.email-social.message+json\r\n" +
      "Content-Transfer-Encoding: base64\r\n" +
      'Content-Disposition: attachment; filename="email-social.json"\r\n' +
      "\r\n" +
      b64(json) +
      "\r\n" +
      `--${b}--\r\n`;
    expect(raw).toBe(expected);
  });
});

describe("serializeMessage: message structure", () => {
  it("writes the header fields in the fixed order for a reply with Cc", () => {
    const raw = serializeMessage(
      outgoing({ cc: [CAROL], inReplyTo: { messageId: "<p@example.org>", subject: "Hello" } }),
      OPTIONS,
    );
    expect(headerNames(raw)).toEqual([
      "Date",
      "From",
      "To",
      "Cc",
      "Subject",
      "Message-ID",
      "In-Reply-To",
      "References",
      "MIME-Version",
      "Content-Type",
    ]);
  });

  it("leaves out Cc, In-Reply-To and References for a new message, and To when only Cc is given", () => {
    expect(headerNames(serializeMessage(outgoing(), OPTIONS))).toEqual([
      "Date",
      "From",
      "To",
      "Subject",
      "Message-ID",
      "MIME-Version",
      "Content-Type",
    ]);
    const ccOnly = serializeMessage(outgoing({ to: [], cc: [CAROL] }), OPTIONS);
    expect(headerNames(ccOnly)).toEqual(["Date", "From", "Cc", "Subject", "Message-ID", "MIME-Version", "Content-Type"]);
    expect(parseAddressList(inspect(ccOnly).header("Cc")!)).toEqual([CAROL]);
  });

  it("is multipart/mixed with the text/plain part first and the ES part second, never multipart/alternative", () => {
    const raw = serializeMessage(outgoing(), OPTIONS);
    expect(raw).not.toMatch(/multipart\/alternative/i);
    const message = inspect(raw);
    expect(message.header("MIME-Version")).toBe("1.0");
    expect(message.header("Content-Type")).toBe(`multipart/mixed; boundary="${message.boundary}"`);
    expect(message.preamble).toBe("This is a multi-part message in MIME format.\r\n");
    expect(message.epilogue).toBe("\r\n");
    expect(message.parts).toHaveLength(2);
    expect(getHeader(message.parts[0]!.fields, "Content-Type")).toBe("text/plain; charset=utf-8");
    expect(getHeader(message.parts[0]!.fields, "Content-Disposition")).toBeNull();
    expect(textOf(message.parts[0]!)).toBe("Hi Bob.\n");
  });

  it("marks the ES part with its media type, base64 and an attachment disposition with a filename", () => {
    const es = inspect(serializeMessage(outgoing(), OPTIONS)).parts[1]!;
    expect(es.fields.map((f) => [f.name, f.value])).toEqual([
      ["Content-Type", "application/vnd.email-social.message+json"],
      ["Content-Transfer-Encoding", "base64"],
      ["Content-Disposition", 'attachment; filename="email-social.json"'],
    ]);
    expect(es.raw.split("\r\n").every((line) => /^[A-Za-z0-9+/]{1,76}={0,2}$/.test(line))).toBe(true);
  });

  it("carries a post record whose base64 decodes to the expected JSON", () => {
    const raw = serializeMessage(
      outgoing({
        from: { name: "Alice", address: "Alice.Smith@EXAMPLE.COM" },
        text: "Ahoj 👋\nsecond line",
        es: { requestReceipts: ["read"] },
      }),
      OPTIONS,
    );
    expect(esOf(raw)).toEqual({
      $type: "es.social.post",
      value: {
        text: "Ahoj 👋\nsecond line",
        via: "Alice.Smith@example.com",
        createdAt: "2026-03-02T09:00:00.000Z",
        email: { messageId: "<m1@example.com>", subject: "Hello" },
        requestReceipts: ["read"],
      },
    });
  });
});

describe("serializeMessage: line format", () => {
  const cases: Array<[string, EsOutgoing]> = [
    ["plain", outgoing()],
    [
      "long names, many recipients, long subject and text",
      outgoing({
        from: { name: "Jana Nováková-Dvořáčková z Horní Dolní u Kutné Hory 🙂", address: "jana.novakova@example.com" },
        to: Array.from({ length: 12 }, (_, i) => ({
          name: i % 2 === 0 ? `Příjemce číslo ${i}, oddělení` : "",
          address: `recipient-${i}@mail${i}.example.org`,
        })),
        cc: [{ name: "Žluťoučký kůň úpěl ďábelské ódy".repeat(3), address: "kun@example.net" }],
        subject: "Velmi dlouhý předmět zprávy, který se nevejde na jeden řádek hlavičky 📅 ".repeat(4),
        text: "x".repeat(3000) + "\n" + "ž".repeat(500) + " \n.\nFrom here\n\ttab\n",
      }),
    ],
    [
      "long ASCII subject and reply chain",
      outgoing({
        subject: "An ASCII subject that goes on and on ".repeat(6),
        inReplyTo: {
          messageId: "<parent-0123456789abcdef@mail.example.org>",
          references: Array.from({ length: 30 }, (_, i) => `<ref-${i}-0123456789abcdef@mail.example.org>`),
        },
      }),
    ],
  ];

  it.each(cases)("uses CRLF only, 7-bit ASCII only, lines <= 998 and header lines <= 78 (%s)", (_name, out) => {
    const raw = serializeMessage(out, OPTIONS);
    expect(raw.endsWith("\r\n")).toBe(true);
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(raw).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    const lines = raw.split("\r\n");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(998);
    for (const line of headerLines(raw)) expect(line.length, line).toBeLessThanOrEqual(78);
    // No line ends in white space (RFC 5322 §2.2.3 folding and QP rule 3 both avoid it).
    for (const line of lines) expect(line, line).not.toMatch(/[ \t]$/);
    // Every body line fits the 76-character limit of RFC 2045 §6.7 / §6.8.
    const body = raw.slice(raw.indexOf("\r\n\r\n") + 4).split("\r\n");
    for (const line of body) expect(line.length).toBeLessThanOrEqual(78);
  });
});

describe("serializeMessage: transfer encoding of the text part", () => {
  function textPart(text: string, messageId = OPTIONS.messageId): Part {
    return inspect(serializeMessage(outgoing({ text }), { ...OPTIONS, messageId })).parts[0]!;
  }
  const cte = (part: Part): string | null => getHeader(part.fields, "Content-Transfer-Encoding");

  it("writes short printable ASCII lines as 7bit, unchanged apart from CRLF", () => {
    const part = textPart("one\n\ttwo\n\nthree");
    expect(cte(part)).toBe("7bit");
    expect(part.raw).toBe("one\r\n\ttwo\r\n\r\nthree");
  });

  it("switches to quoted-printable above 76 characters per line", () => {
    expect(cte(textPart("a".repeat(76)))).toBe("7bit");
    const part = textPart("a".repeat(77));
    expect(cte(part)).toBe("quoted-printable");
    expect(part.raw.split("\r\n").every((l) => l.length <= 76)).toBe(true);
    expect(textOf(part)).toBe("a".repeat(77));
  });

  it.each([
    ["trailing space", "keep this space \nnext", "keep this space=20\r\nnext"],
    ["trailing tab", "tab\t", "tab=09"],
    ['a line starting with "From "', "Hi\nFrom now on, yes", "Hi\r\n=46rom now on, yes"],
    ['a line starting with "."', "list:\n. item\n.", "list:\r\n=2E item\r\n=2E"],
    ["non-ASCII text", "Příliš žluťoučký kůň", "P=C5=99=C3=ADli=C5=A1 =C5=BElu=C5=A5ou=C4=8Dk=C3=BD k=C5=AF=C5=88"],
    ["a control character", "bell\u0007", "bell=07"],
  ])("uses quoted-printable for %s", (_name, text, encoded) => {
    const part = textPart(text);
    expect(cte(part)).toBe("quoted-printable");
    expect(part.raw).toBe(encoded);
    expect(textOf(part)).toBe(text);
  });

  it("normalises CRLF and lone CR to LF, in the text part and in the ES record", () => {
    const raw = serializeMessage(outgoing({ text: "a\r\nb\rc\n\r\nd" }), OPTIONS);
    expect(textOf(inspect(raw).parts[0]!)).toBe("a\nb\nc\n\nd");
    expect(esValue(raw).text).toBe("a\nb\nc\n\nd");
  });

  it("replaces lone surrogates with U+FFFD, as UTF-8 encoding must, in the part and the ES record alike", () => {
    const raw = serializeMessage(outgoing({ text: "a\uD800b\uDC00", subject: "x\uD83D" }), OPTIONS);
    expect(textOf(inspect(raw).parts[0]!)).toBe("a\uFFFDb\uFFFD");
    expect(esValue(raw).text).toBe("a\uFFFDb\uFFFD");
    expect(esValue(raw).email).toMatchObject({ subject: "x\uFFFD" });
    expect(decodeEncodedWords(inspect(raw).header("Subject")!)).toBe("x\uFFFD");
  });

  it("writes an empty text as an empty part", () => {
    const raw = serializeMessage(outgoing({ text: "" }), OPTIONS);
    const part = inspect(raw).parts[0]!;
    expect(part.raw).toBe("");
    expect(esValue(raw).text).toBe("");
  });
});

describe("serializeMessage: boundary", () => {
  it('is "=_es_" plus the first 24 hex digits of SHA-256(messageId)', () => {
    for (const messageId of ["<m1@example.com>", "<a.b.c-123@mail.example.net>"]) {
      const message = inspect(serializeMessage(outgoing(), { ...OPTIONS, messageId }));
      expect(message.boundary).toBe("=_es_" + sha24(messageId));
    }
  });

  it("switches the text to quoted-printable when 7bit text would contain the boundary", () => {
    const boundary = "=_es_" + sha24(OPTIONS.messageId);
    const text = `line one\n--${boundary}\nline three`;
    const raw = serializeMessage(outgoing({ text }), OPTIONS);
    const message = inspect(raw);
    expect(getHeader(message.parts[0]!.fields, "Content-Transfer-Encoding")).toBe("quoted-printable");
    expect(message.parts).toHaveLength(2);
    expect(textOf(message.parts[0]!)).toBe(text);
    // The boundary occurs only in Content-Type and in the three delimiter lines.
    expect(raw.split(boundary)).toHaveLength(5);
  });
});

describe("serializeMessage: subject", () => {
  const subjectOf = (out: EsOutgoing): string => {
    const raw = serializeMessage(out, OPTIONS);
    return decodeEncodedWords(unfold(inspect(raw).header("Subject")!));
  };

  it('is empty by default and the header is still written as "Subject:"', () => {
    const raw = serializeMessage({ from: ALICE, to: [BOB], text: "x" }, OPTIONS);
    expect(raw).toContain("\r\nSubject:\r\n");
    expect(esValue(raw).email).toEqual({ messageId: "<m1@example.com>", subject: "" });
  });

  it('adds "Re: " to the parent subject once, case-insensitively (RFC 5322 §3.6.5)', () => {
    const reply = (subject: string): string =>
      subjectOf(outgoing({ subject: undefined, inReplyTo: { messageId: "<p@example.org>", subject } }));
    expect(reply("Lunch")).toBe("Re: Lunch");
    expect(reply("Re: Lunch")).toBe("Re: Lunch");
    expect(reply("RE: Lunch")).toBe("RE: Lunch");
    expect(reply("re:Lunch")).toBe("re:Lunch");
    expect(reply("Fwd: Lunch")).toBe("Re: Fwd: Lunch");
    expect(reply("Lunch Re: menu")).toBe("Re: Lunch Re: menu");
    expect(reply("")).toBe("Re:");
    expect(subjectOf(outgoing({ subject: undefined, inReplyTo: { messageId: "<p@example.org>" } }))).toBe("");
    expect(subjectOf(outgoing({ subject: "Own subject", inReplyTo: { messageId: "<p@example.org>", subject: "X" } }))).toBe(
      "Own subject",
    );
  });

  it("writes a non-ASCII subject as RFC 2047 encoded-words that decode back exactly", () => {
    const subject = "Schůzka 📅 v pátek – «důležité» =?utf-8?q?not-a-word?= ".repeat(3).trim();
    const raw = serializeMessage(outgoing({ subject }), OPTIONS);
    const field = inspect(raw).header("Subject")!;
    for (const word of unfold(field).split(" ")) {
      expect(word).toMatch(/^=\?UTF-8\?[QB]\?[^?]*\?=$/);
      expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeEncodedWords(unfold(field))).toBe(subject);
    expect(esValue(raw).email).toMatchObject({ subject });
  });

  it("collapses white space runs and trims, in the header and in the ES record", () => {
    const raw = serializeMessage(outgoing({ subject: "  Lunch \t on\r\n  Friday  " }), OPTIONS);
    expect(inspect(raw).header("Subject")).toBe("Lunch on Friday");
    expect(esValue(raw).email).toMatchObject({ subject: "Lunch on Friday" });
  });

  it("keeps a subject over 500 UTF-8 bytes in the header but not in the ES record", () => {
    const long = "ž".repeat(251); // 502 bytes
    const raw = serializeMessage(outgoing({ subject: long }), OPTIONS);
    expect(decodeEncodedWords(unfold(inspect(raw).header("Subject")!))).toBe(long);
    expect(esValue(raw).email).toEqual({ messageId: "<m1@example.com>" });
    const fits = serializeMessage(outgoing({ subject: "ž".repeat(250) }), OPTIONS);
    expect(esValue(fits).email).toMatchObject({ subject: "ž".repeat(250) });
  });
});

describe("serializeMessage: addresses", () => {
  it("encodes non-ASCII display names and quotes names with specials; both read back unchanged", () => {
    const to = [
      { name: "Jana Nováková", address: "jana@example.com" },
      { name: "Doe, John (Sales)", address: "john.doe@example.org" },
      { name: 'Say "hi"', address: "hi@example.net" },
      { name: "", address: "plain@example.net" },
      { name: "张伟 🙂", address: "zhang@example.com" },
    ];
    const raw = serializeMessage(outgoing({ to }), OPTIONS);
    const field = inspect(raw).header("To")!;
    expect(field).toContain('"Doe, John (Sales)" <john.doe@example.org>');
    expect(field).toContain('"Say \\"hi\\"" <hi@example.net>');
    expect(parseAddressList(field)).toEqual(to);
  });

  it("writes canonical addresses (domain lowercased, local part kept) in headers and in via", () => {
    const raw = serializeMessage(
      outgoing({ from: { name: "", address: " <Alice@Example.COM> " }, to: [{ name: "Bob", address: "Bob@EXAMPLE.org" }] }),
      OPTIONS,
    );
    const message = inspect(raw);
    expect(message.header("From")).toBe("Alice@example.com");
    expect(message.header("To")).toBe("Bob <Bob@example.org>");
    expect(esValue(raw).via).toBe("Alice@example.com");
  });

  it("folds a long recipient list between addresses and every entry reads back", () => {
    const to = Array.from({ length: 20 }, (_, i) => ({ name: `Person ${i}`, address: `person${i}@example.com` }));
    const raw = serializeMessage(outgoing({ to, cc: [CAROL, BOB] }), OPTIONS);
    const message = inspect(raw);
    expect(parseAddressList(message.header("To")!)).toEqual(to);
    expect(parseAddressList(message.header("Cc")!)).toEqual([CAROL, BOB]);
    expect(headerLines(raw).filter((l) => l.startsWith(" ")).length).toBeGreaterThan(3);
  });
});

describe("serializeMessage: threading headers", () => {
  const reply = (inReplyTo: EsOutgoing["inReplyTo"]): string =>
    serializeMessage(outgoing({ inReplyTo }), { ...OPTIONS, messageId: "<new@example.com>" });

  it("sets In-Reply-To to the parent and References to the parent's References plus the parent (RFC 5322 §3.6.4)", () => {
    const raw = reply({ messageId: "<c@example.org>", references: ["<a@example.com>", "<b@example.net>"] });
    const message = inspect(raw);
    expect(message.header("In-Reply-To")).toBe("<c@example.org>");
    expect(message.header("References")).toBe("<a@example.com> <b@example.net> <c@example.org>");
    expect(esValue(raw).email).toEqual({
      messageId: "<new@example.com>",
      subject: "Hello",
      inReplyTo: "<c@example.org>",
      references: ["<a@example.com>", "<b@example.net>", "<c@example.org>"],
    });
  });

  it("writes References with the parent alone when the parent has none", () => {
    const message = inspect(reply({ messageId: "<c@example.org>" }));
    expect(message.header("In-Reply-To")).toBe("<c@example.org>");
    expect(message.header("References")).toBe("<c@example.org>");
  });

  it("removes duplicate ids and keeps the parent last", () => {
    const raw = reply({
      messageId: "<c@example.org>",
      references: ["<a@example.com>", "<c@example.org>", "<a@example.com>", "<b@example.net>"],
    });
    expect(unfold(inspect(raw).header("References")!)).toBe("<a@example.com> <b@example.net> <c@example.org>");
  });

  it("keeps the first and the last 19 ids when there are more than 20", () => {
    const refs = Array.from({ length: 25 }, (_, i) => `<r${i}@example.com>`);
    const raw = reply({ messageId: "<parent@example.com>", references: refs });
    const expected = [refs[0]!, ...refs.slice(7), "<parent@example.com>"];
    expect(expected).toHaveLength(20);
    expect(unfold(inspect(raw).header("References")!).split(" ")).toEqual(expected);
    expect((esValue(raw).email as { references: string[] }).references).toEqual(expected);
    const twenty = Array.from({ length: 19 }, (_, i) => `<s${i}@example.com>`);
    const untouched = reply({ messageId: "<p@example.com>", references: twenty });
    expect(unfold(inspect(untouched).header("References")!).split(" ")).toEqual([...twenty, "<p@example.com>"]);
  });

  it("folds References between ids so lines stay within 78 characters", () => {
    const refs = Array.from({ length: 8 }, (_, i) => `<reference-${i}-abcdefghij@mail.example.org>`);
    const raw = reply({ messageId: "<p@example.org>", references: refs });
    const lines = headerLines(raw);
    const start = lines.findIndex((l) => l.startsWith("References:"));
    expect(lines[start + 1]).toMatch(/^ <reference-/);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("skips reference ids that cannot be written in 7-bit ASCII and rejects such a parent id", () => {
    const raw = reply({ messageId: "<p@example.org>", references: ["<žluť@example.com>", "<ok@example.com>"] });
    expect(inspect(raw).header("References")).toBe("<ok@example.com> <p@example.org>");
    expect(() => reply({ messageId: "<žluť@example.com>" })).toThrow(TypeError);
    expect(() => reply({ messageId: "no brackets@example.com" })).toThrow(TypeError);
  });
});

describe("serializeMessage: ES fields", () => {
  it("normalises requestReceipts to the order delivered, read without duplicates", () => {
    const receipts = (requestReceipts: ReceiptKind[]): unknown =>
      esValue(serializeMessage(outgoing({ es: { requestReceipts } }), OPTIONS)).requestReceipts;
    expect(receipts(["read", "delivered"])).toEqual(["delivered", "read"]);
    expect(receipts(["read", "read"])).toEqual(["read"]);
    expect(receipts([])).toBeUndefined();
    expect(esValue(serializeMessage(outgoing(), OPTIONS)).requestReceipts).toBeUndefined();
  });

  it("writes a valid did:es author and rejects an invalid one", () => {
    const raw = serializeMessage(outgoing({ es: { author: "did:es:example.com:alice" } }), OPTIONS);
    expect(esOf(raw).author).toBe("did:es:example.com:alice");
    expect(esOf(serializeMessage(outgoing(), OPTIONS))).not.toHaveProperty("author");
    expect(() => serializeMessage(outgoing({ es: { author: "did:example:alice" } }), OPTIONS)).toThrow(TypeError);
    expect(() => serializeMessage(outgoing({ es: { author: "did:es:EXAMPLE.com:alice" } }), OPTIONS)).toThrow(TypeError);
  });

  it("uses the Date header instant as createdAt (whole seconds, UTC)", () => {
    const raw = serializeMessage(outgoing(), { ...OPTIONS, date: "2026-03-02T10:00:05.987+01:00" });
    expect(inspect(raw).header("Date")).toBe("Mon, 2 Mar 2026 09:00:05 +0000");
    expect(esValue(raw).createdAt).toBe("2026-03-02T09:00:05.000Z");
    expect(new Date(esValue(raw).createdAt as string).getTime()).toBe(Date.parse(inspect(raw).header("Date")!));
  });
});

describe("serializeMessage: input validation", () => {
  it.each(["m1@example.com", "<m1 x@example.com>", "<m1@example.com", "<a@b@example.com>", "<>", "<nodomain>", "<ž@example.com>"])(
    "rejects the Message-ID %j with a TypeError",
    (messageId) => {
      expect(() => serializeMessage(outgoing(), { ...OPTIONS, messageId })).toThrow(TypeError);
    },
  );

  it("rejects a message without recipients", () => {
    expect(() => serializeMessage(outgoing({ to: [], cc: [] }), OPTIONS)).toThrow(TypeError);
    expect(() => serializeMessage(outgoing({ to: [] }), OPTIONS)).toThrow(TypeError);
  });

  it.each([
    ["from without @", { from: { name: "A", address: "alice.example.com" } }],
    ["to without @", { to: [{ name: "B", address: "bob" }] }],
    ["cc with an empty domain", { cc: [{ name: "C", address: "carol@" }] }],
    ["to with an empty local part", { to: [{ name: "", address: "@example.org" }] }],
    ["a header injection attempt", { to: [{ name: "", address: "bob@example.org\r\nBcc: eve@example.net" }] }],
    ["a non-ASCII address (needs SMTPUTF8)", { to: [{ name: "", address: "jiří@example.com" }] }],
    ["an address with a space", { to: [{ name: "", address: "bob smith@example.org" }] }],
    ["an address with angle brackets inside", { to: [{ name: "", address: "a<b>@example.org" }] }],
  ] as Array<[string, Partial<EsOutgoing>]>)("rejects %s", (_name, extra) => {
    expect(() => serializeMessage(outgoing(extra), OPTIONS)).toThrow(TypeError);
  });

  it("accepts a quoted local part", () => {
    const raw = serializeMessage(outgoing({ to: [{ name: "", address: '"bob smith"@example.org' }] }), OPTIONS);
    expect(parseAddressList(inspect(raw).header("To")!)).toEqual([{ name: "", address: '"bob smith"@example.org' }]);
  });

  it("keeps a text of exactly 10000 UTF-8 bytes in the ES record", () => {
    const text = "ž".repeat(5000);
    const raw = serializeMessage(outgoing({ text }), OPTIONS);
    expect(esValue(raw).text).toBe(text);
    expect(esValue(raw).email).not.toHaveProperty("textSha256");
  });

  it.each([
    ["10001 bytes of Czech text", "ž".repeat(5000) + "a"],
    ["a 20 kB message", ("Dlouhá zpráva, řádek s textem. ".repeat(3) + "\n").repeat(200)],
  ])("sends %s whole as text/plain and leaves it out of the ES record, with its SHA-256", (_name, text) => {
    const raw = serializeMessage(outgoing({ text }), OPTIONS);
    expect(textOf(inspect(raw).parts[0]!)).toBe(text);
    const value = esValue(raw);
    expect(value).not.toHaveProperty("text");
    expect(value.via).toBe("alice@example.com");
    expect((value.email as Record<string, unknown>).textSha256).toBe(
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
  });

  it.each([
    ["an unparseable string", "not a date"],
    ["an invalid Date", new Date(Number.NaN)],
    ["an ISO string without a zone (local time)", "2026-03-02T09:00:00"],
    ["an RFC 5322 string", "Mon, 2 Mar 2026 09:00:00 +0000"],
    ["a year before 1900", "1850-01-01T00:00:00Z"],
  ] as Array<[string, Date | string]>)("rejects %s as the date with a TypeError", (_name, date) => {
    expect(() => serializeMessage(outgoing(), { ...OPTIONS, date })).toThrow(TypeError);
  });
});

describe("serializeMessage: determinism", () => {
  it("gives identical output for identical input, whether the date is a Date or an ISO string", () => {
    const out = outgoing({
      cc: [CAROL],
      subject: "Schůzka",
      text: "Ahoj 👋\n",
      inReplyTo: { messageId: "<p@example.org>", references: ["<r@example.org>"] },
      es: { requestReceipts: ["read"] },
    });
    const first = serializeMessage(out, OPTIONS);
    expect(serializeMessage(structuredClone(out), { ...OPTIONS })).toBe(first);
    expect(serializeMessage(out, { ...OPTIONS, date: new Date(Date.UTC(2026, 2, 2, 9, 0, 0)) })).toBe(first);
  });

  it("does not modify its input", () => {
    const out = outgoing({
      from: { name: "  Alice  ", address: "Alice@EXAMPLE.com" },
      text: "a\r\nb",
      inReplyTo: { messageId: "<p@example.org>", references: ["<r@example.org>", "<r@example.org>"] },
      es: { requestReceipts: ["read", "delivered"] },
    });
    const copy = structuredClone(out);
    serializeMessage(out, OPTIONS);
    expect(out).toEqual(copy);
  });
});

describe("serializeMessage: read by an independent parser (mailparser)", () => {
  const cases: Array<[string, EsOutgoing]> = [
    ["ASCII", outgoing({ subject: "Lunch on Friday?", text: "Hi Bob,\n\nlunch at noon?\n" })],
    [
      "Czech with every quoted-printable trigger",
      outgoing({
        from: { name: "Jana Nováková", address: "jana@example.com" },
        to: [{ name: "Doe, John", address: "john@example.org" }, { name: "", address: "x@example.net" }],
        subject: "Schůzka 📅 v pátek =?utf-8?q?not-a-word?= – «důležité»",
        text: "Ahoj,\n\nFrom now on\n.\ntrailing \n" + "ž".repeat(120) + "\n" + "x".repeat(200),
        inReplyTo: { messageId: "<p@example.org>", references: ["<r@example.org>"] },
      }),
    ],
  ];

  it.each(cases)("gives the same text, subject, addresses and threading headers (%s)", async (_name, out) => {
    const raw = serializeMessage(out, OPTIONS);
    const parsed = await simpleParser(raw);
    expect(parsed.text).toBe(out.text);
    expect(parsed.subject).toBe(out.subject);
    expect(parsed.from?.value.map((a) => ({ name: a.name, address: a.address }))).toEqual([out.from]);
    const to = Array.isArray(parsed.to) ? parsed.to.flatMap((t) => t.value) : (parsed.to?.value ?? []);
    expect(to.map((a) => ({ name: a.name, address: a.address }))).toEqual(out.to);
    expect(parsed.date?.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(parsed.messageId).toBe("<m1@example.com>");
    if (out.inReplyTo !== undefined) {
      expect(parsed.inReplyTo).toBe(out.inReplyTo.messageId);
      expect(parsed.references).toEqual([...(out.inReplyTo.references ?? []), out.inReplyTo.messageId]);
    }
    // The ES part is an ordinary named attachment to such a reader.
    expect(parsed.attachments.map((a) => [a.contentType, a.filename, a.contentDisposition])).toEqual([
      ["application/vnd.email-social.message+json", "email-social.json", "attachment"],
    ]);
    expect(parsed.html).toBe(false);
  });
});

describe("serializeMessage: includeEsPart", () => {
  it("writes the ES part by default and when includeEsPart is true", () => {
    const byDefault = serializeMessage(outgoing(), OPTIONS);
    expect(serializeMessage(outgoing(), { ...OPTIONS, includeEsPart: true })).toBe(byDefault);
    expect(inspect(byDefault).parts).toHaveLength(2);
  });

  it.each([
    ["ASCII text ending in a newline", "Hi Bob.\n"],
    ["ASCII text without a final newline", "ok"],
    ["Czech text with a long line", "Ahoj, " + "ž".repeat(300)],
    ["an empty text", ""],
    ["a last line of exactly 76 characters", "x".repeat(76)],
    ["a last line of 75 characters", "x".repeat(75)],
    ["a last line ending in an encoded character at column 76", "x".repeat(73) + "ž"],
  ])("writes a plain single-part text/plain message without the ES part when false (%s)", async (_name, text) => {
    const raw = serializeMessage(outgoing({ text }), { ...OPTIONS, includeEsPart: false });
    const { header, body } = splitHeaderBody(new TextEncoder().encode(raw));
    const fields = parseHeaderFields(header);
    expect(getHeader(fields, "Content-Type")).toBe("text/plain; charset=utf-8");
    expect(getHeader(fields, "MIME-Version")).toBe("1.0");
    expect(raw).not.toContain("multipart");
    expect(raw).not.toContain("email-social");
    expect(raw).toMatch(/^[\t\r\n\x20-\x7e]*$/);
    expect(raw.endsWith("\r\n")).toBe(true);
    // RFC 2045 §6.7 rule 5: encoded lines, soft line breaks included, are at most 76 characters.
    for (const line of new TextDecoder().decode(body).split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    const cte = getHeader(fields, "Content-Transfer-Encoding");
    const decoded = cte === "quoted-printable" ? qpDecode(body) : body;
    expect(new TextDecoder().decode(decoded).replace(/\r\n/g, "\n")).toBe(text);

    const mail = await simpleParser(raw);
    expect(mail.attachments).toEqual([]);
    // mailparser reads an empty body as undefined or "\n" (see compat-mailparser.test.ts).
    if (text === "") expect(["", "\n"]).toContain(mail.text ?? "");
    else expect(mail.text).toBe(text);
    expect(mail.subject).toBe("Hello");
  });

  it("keeps the other headers of a plain message identical to the ES message", () => {
    const withEs = serializeMessage(outgoing({ inReplyTo: { messageId: "<p@example.org>" } }), OPTIONS);
    const plain = serializeMessage(outgoing({ inReplyTo: { messageId: "<p@example.org>" } }), {
      ...OPTIONS,
      includeEsPart: false,
    });
    const upToMime = (raw: string): string => raw.slice(0, raw.indexOf("MIME-Version:"));
    expect(upToMime(plain)).toBe(upToMime(withEs));
  });
});
