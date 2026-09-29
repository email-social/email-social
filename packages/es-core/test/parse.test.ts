import { describe, expect, it, vi } from "vitest";
import { parseMessage, parseMessageUnguarded } from "../src/parse.js";
import type { EsMessage } from "../src/types.js";
import { sha256Hex } from "../src/util/sha256.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";
import { mulberry32, pick, randomInt } from "./helpers/prng.js";

const enc = new TextEncoder();
/** A raw message from lines, joined with CRLF. */
const raw = (...lines: string[]): string => lines.join("\r\n");
const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

const ES_TYPE = "application/vnd.email-social.message+json";
const CREATED = "2026-03-01T10:00:00.000Z";

/** Asserts the full shape of an EsMessage (every field present, right types). */
function expectEsMessage(m: EsMessage): void {
  expect(typeof m.id).toBe("string");
  expect(m.id.length).toBeGreaterThan(0);
  expect(m.from === null || (typeof m.from.name === "string" && m.from.address.includes("@"))).toBe(true);
  for (const list of [m.to, m.cc, m.replyTo]) {
    expect(Array.isArray(list)).toBe(true);
    for (const a of list) expect(a.address).toContain("@");
  }
  expect(m.date === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.date)).toBe(true);
  expect(typeof m.subject).toBe("string");
  expect(typeof m.text).toBe("string");
  expect(["plain", "html", "none"]).toContain(m.textSource);
  expect(m.textSource === "none").toBe(m.text === "");
  expect(m.es === null || typeof m.es.$type === "string").toBe(true);
  for (const a of m.attachments) {
    expect(typeof a.contentType).toBe("string");
    expect(["inline", "attachment"]).toContain(a.disposition);
    expect(Number.isInteger(a.size) && a.size >= 0).toBe(true);
    expect(a.partId).toMatch(/^\d+(\.\d+)*$/);
  }
  expect(Array.isArray(m.refs.inReplyTo) && Array.isArray(m.refs.references)).toBe(true);
  expect(m.id === m.refs.messageId || (m.refs.messageId === null && m.id.startsWith("sha256:"))).toBe(true);
}

// ---------------------------------------------------------------- headers

describe("parseMessage: input handling and header fields", () => {
  it("returns an empty message for empty input, with the SHA-256 of no bytes as id", () => {
    const expected: EsMessage = {
      id: "sha256:" + sha256Hex(new Uint8Array(0)),
      from: null,
      to: [],
      cc: [],
      replyTo: [],
      date: null,
      subject: "",
      text: "",
      textSource: "none",
      es: null,
      attachments: [],
      refs: { messageId: null, inReplyTo: [], references: [] },
    };
    expect(parseMessage(new Uint8Array(0))).toEqual(expected);
    expect(parseMessage("")).toEqual(expected);
  });

  it("reads a message that has headers but no empty line and no body", () => {
    const m = parseMessage(raw("From: Alice <alice@example.com>", "Subject: Only headers", "Message-ID: <h1@example.com>"));
    expect(m.from).toEqual({ name: "Alice", address: "alice@example.com" });
    expect(m.subject).toBe("Only headers");
    expect(m.id).toBe("<h1@example.com>");
    expect(m.text).toBe("");
    expect(m.textSource).toBe("none");
    expect(m.attachments).toEqual([]);
  });

  it("returns a complete EsMessage for random bytes", () => {
    const random = mulberry32(7);
    for (let n = 0; n < 50; n++) {
      const bytes = Uint8Array.from({ length: randomInt(random, 0, 2000) }, () => randomInt(random, 0, 255));
      expect(() => parseMessageUnguarded(bytes)).not.toThrow();
      expectEsMessage(parseMessage(bytes));
    }
  });

  it("gives the same result for a string and for its UTF-8 bytes", () => {
    const text = raw("From: Jana Nováková <jana@example.net>", "Subject: Čau", "", "Ahoj 👋", "");
    expect(parseMessage(text)).toEqual(parseMessage(enc.encode(text)));
    expect(parseMessage(text).text).toBe("Ahoj 👋\n");
  });

  it("gives from = null when From is missing or has no address, without falling back to Sender", () => {
    expect(parseMessage(raw("Sender: s@example.com", "To: t@example.org", "", "x")).from).toBeNull();
    expect(parseMessage(raw("From: undisclosed:;", "", "x")).from).toBeNull();
  });

  it("takes the first From, Subject, Date and Message-ID and concatenates every To, Cc and Reply-To", () => {
    const m = parseMessage(
      raw(
        "From: First <first@example.com>",
        "From: Second <second@example.com>",
        "To: a@example.com, B <b@example.com>",
        "Subject: first subject",
        "To: c@example.com",
        "Cc: d@example.org",
        "Subject: second subject",
        "Cc: E <e@example.org>",
        "Reply-To: r1@example.net",
        "Reply-To: r2@example.net",
        "Date: Mon, 2 Mar 2026 10:00:00 +0000",
        "Date: Tue, 3 Mar 2026 10:00:00 +0000",
        "Message-ID: <one@example.com>",
        "Message-ID: <two@example.com>",
        "",
        "body",
      ),
    );
    expect(m.from).toEqual({ name: "First", address: "first@example.com" });
    expect(m.to.map((a) => a.address)).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(m.cc).toEqual([
      { name: "", address: "d@example.org" },
      { name: "E", address: "e@example.org" },
    ]);
    expect(m.replyTo.map((a) => a.address)).toEqual(["r1@example.net", "r2@example.net"]);
    expect(m.subject).toBe("first subject");
    expect(m.date).toBe("2026-03-02T10:00:00.000Z");
    expect(m.id).toBe("<one@example.com>");
  });

  it("decodes RFC 2047 subjects and collapses folding and white space runs, trimming the ends", () => {
    const m = parseMessage(
      raw("Subject:   =?UTF-8?Q?P=C5=99=C3=ADli=C5=A1?=", "  =?UTF-8?B?IMW+bHXFpW91xI1rw70=?=   k\tůň  ", "", ""),
    );
    expect(m.subject).toBe("Příliš žluťoučký k ůň");
    expect(parseMessage(raw("To: a@example.com", "", "")).subject).toBe("");
  });

  it("gives date = null for an unparseable Date", () => {
    expect(parseMessage(raw("Date: sometime next week", "", "")).date).toBeNull();
    expect(parseMessage(raw("Date: Mon, 2 Mar 26 09:30:00 EST", "", "")).date).toBe("2026-03-02T14:30:00.000Z");
  });

  it("reads Message-ID, In-Reply-To (also with prose around it) and References without duplicates", () => {
    const m = parseMessage(
      raw(
        "Message-ID:  <self@example.com> ",
        'In-Reply-To: Your message of "Mon, 2 Mar" <parent@example.com>',
        "References: <root@example.com>",
        "  <mid@example.com> <root@example.com>",
        "  <parent@example.com>",
        "",
        "",
      ),
    );
    expect(m.id).toBe("<self@example.com>");
    expect(m.refs).toEqual({
      messageId: "<self@example.com>",
      inReplyTo: ["<parent@example.com>"],
      references: ["<root@example.com>", "<mid@example.com>", "<parent@example.com>"],
    });
  });

  it("uses 'sha256:' plus the hex SHA-256 of the raw bytes as id when there is no Message-ID", () => {
    const bytes = enc.encode(raw("Subject: no id", "", "x"));
    expect(parseMessage(bytes).id).toBe("sha256:" + sha256Hex(bytes));
    expect(parseMessage(bytes).refs.messageId).toBeNull();
  });
});

// ---------------------------------------------------------------- body text

describe("parseMessage: body text", () => {
  it("decodes quoted-printable in the part's charset, turns CRLF and lone CR into LF and trims nothing", () => {
    const m = parseMessage(
      raw(
        "Content-Type: text/plain; charset=windows-1250",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "  Dobr=FD den,=20",
        "=84uvozovky=93 a=0Dold Mac=",
        " line",
        "",
        "",
      ),
    );
    expect(m.text).toBe("  Dobrý den, \n„uvozovky“ a\nold Mac line\n\n");
    expect(m.textSource).toBe("plain");
  });

  it("decodes base64 text in a single-byte charset", () => {
    const latin2 = Uint8Array.from([0x4e, 0x65, 0x6a, 0x73, 0x70, 0xed, 0xb9, 0x0d, 0x0a]); // "Nejspíš\r\n" in iso-8859-2
    const m = parseMessage(
      raw(
        "Content-Type: text/plain; charset=iso-8859-2",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(latin2).toString("base64"),
      ),
    );
    expect(m.text).toBe("Nejspíš\n");
  });

  it("unwraps format=flowed after removing quoted-printable, honouring DelSp=yes", () => {
    const m = parseMessage(
      raw(
        'Content-Type: text/plain; charset="utf-8"; format="Flowed"; delsp=yes',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        // A literal trailing space would be transport padding (RFC 2045 §6.7 rule 3), so senders write "=20".
        "Dlouh=C3=A1 v=C4=9B=20",
        "ta.",
        "> cit=20",
        "> ace",
        "",
      ),
    );
    expect(m.text).toBe("Dlouhá věta.\n> citace\n");
  });

  it("in multipart/alternative takes the first text/plain, even when HTML comes first", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/alternative; boundary=a",
        "",
        "--a",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>HTML first</p>",
        "--a",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Plain second",
        "--a",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Plain third",
        "--a--",
      ),
    );
    expect(m.text).toBe("Plain second");
    expect(m.textSource).toBe("plain");
    expect(m.attachments).toEqual([]);
  });

  it("in multipart/alternative without text/plain converts the LAST HTML alternative (RFC 2046 §5.1.4)", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/alternative; boundary=a",
        "",
        "--a",
        "Content-Type: text/html",
        "",
        "<p>simple</p>",
        "--a",
        "Content-Type: text/html",
        "",
        "<p>rich &amp; <b>best</b></p>",
        "--a--",
      ),
    );
    expect(m.text).toBe("rich & best");
    expect(m.textSource).toBe("html");
  });

  it("uses the HTML alternative when the text/plain alternative is blank", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/alternative; boundary=a",
        "",
        "--a",
        "Content-Type: text/plain",
        "",
        "  ",
        "",
        "--a",
        "Content-Type: text/html",
        "",
        "<p>Rich content</p>",
        "--a--",
      ),
    );
    expect(m.text).toBe("Rich content");
    expect(m.textSource).toBe("html");
  });

  it("in multipart/related uses the part named by the start parameter, else the first part", () => {
    const related = (start: string | null, first: string, second: string): string =>
      raw(
        `Content-Type: multipart/related; boundary=r${start === null ? "" : `; start="${start}"`}`,
        "",
        "--r",
        first,
        "--r",
        second,
        "--r--",
      );
    const html = raw("Content-Type: text/html", "Content-ID: <root@example.com>", "", "<p>Root</p>");
    const plain = raw("Content-Type: text/plain", "Content-ID: <other@example.com>", "", "Other");
    expect(parseMessage(related("<root@example.com>", plain, html)).text).toBe("Root");
    expect(parseMessage(related("root@example.com", plain, html)).text).toBe("Root");
    expect(parseMessage(related(null, plain, html)).text).toBe("Other");
    expect(parseMessage(related("<missing@example.com>", html, plain)).text).toBe("Root");
  });

  it("in multipart/mixed joins every text part in order, adding a line break only where one is missing", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Part one",
        "--b",
        "Content-Type: image/png",
        "Content-Disposition: inline; filename=a.png",
        "Content-Transfer-Encoding: base64",
        "",
        "iVBORw0KGgo=",
        "--b",
        "Content-Type: text/plain",
        "",
        "Part two",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Part three",
        "--b--",
      ),
    );
    expect(m.text).toBe("Part one\nPart two\nPart three");
    expect(m.attachments.map((a) => a.partId)).toEqual(["2"]);
  });

  it("ignores HTML body parts when the message has text/plain body text, and does not list them as attachments", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Plain",
        "--b",
        "Content-Type: text/html",
        "",
        "<p>Html</p>",
        "--b--",
      ),
    );
    expect(m.text).toBe("Plain");
    expect(m.textSource).toBe("plain");
    expect(m.attachments).toEqual([]);
  });

  it("never uses a text part with a filename or with disposition attachment as body text", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Body",
        "--b",
        "Content-Type: text/plain",
        "Content-Disposition: inline; filename=notes.txt",
        "",
        "notes",
        "--b",
        "Content-Type: text/plain",
        "Content-Disposition: attachment",
        "",
        "attached",
        "--b",
        "Content-Type: text/html; name=page.html",
        "",
        "<p>page</p>",
        "--b--",
      ),
    );
    expect(m.text).toBe("Body");
    expect(m.attachments.map((a) => [a.filename, a.contentType, a.disposition, a.partId])).toEqual([
      ["notes.txt", "text/plain", "inline", "2"],
      [null, "text/plain", "attachment", "3"],
      ["page.html", "text/html", "attachment", "4"],
    ]);
  });

  it("gives text '' and textSource 'none' when there is no body text", () => {
    const m = parseMessage(
      raw("Content-Type: text/plain", "Content-Disposition: attachment; filename=a.txt", "", "file content"),
    );
    expect(m.text).toBe("");
    expect(m.textSource).toBe("none");
    expect(m.attachments).toHaveLength(1);
  });

  it("lists a message/rfc822 part as an attachment and never takes body text or an ES part from inside it", () => {
    const inner = raw(
      "From: Carol <carol@example.net>",
      "Content-Type: multipart/mixed; boundary=inner",
      "",
      "--inner",
      "Content-Type: text/plain",
      "",
      "Inner text",
      "--inner",
      `Content-Type: ${ES_TYPE}`,
      "",
      JSON.stringify({ $type: "es.social.post", value: { text: "x", via: "carol@example.net", createdAt: CREATED } }),
      "--inner--",
    );
    const m = parseMessage(
      raw(
        "From: Dan <dan@example.com>",
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "See the forwarded message.",
        "--b",
        "Content-Type: message/rfc822",
        'Content-Disposition: attachment; filename="fwd.eml"',
        "",
        inner,
        "--b--",
      ),
    );
    expect(m.text).toBe("See the forwarded message.");
    expect(m.es).toBeNull();
    expect(m.attachments).toEqual([
      { filename: "fwd.eml", contentType: "message/rfc822", disposition: "attachment", size: enc.encode(inner).length, contentId: null, partId: "2" },
    ]);
  });

  it("reads the text of a multipart/signed message and lists the second part as an attachment", () => {
    const m = parseMessage(
      raw(
        'Content-Type: multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha256; boundary=s',
        "",
        "--s",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Signed text",
        "--s",
        'Content-Type: application/pgp-signature; name="signature.asc"',
        "",
        "c2lnbmF0dXJl",
        "--s--",
      ),
    );
    expect(m.text).toBe("Signed text");
    expect(m.attachments.map((a) => [a.filename, a.contentType, a.partId])).toEqual([
      ["signature.asc", "application/pgp-signature", "2"],
    ]);
  });
});

// ---------------------------------------------------------------- ES part

interface EsMessageInit {
  from?: string | null;
  messageId?: string | null;
  parts: string[];
}

function esMessage({ from = "Alice <alice@example.com>", messageId = "<m1@example.com>", parts }: EsMessageInit): string {
  const headers = [
    ...(from === null ? [] : [`From: ${from}`]),
    "To: bob@example.org",
    "Subject: Hi",
    ...(messageId === null ? [] : [`Message-ID: ${messageId}`]),
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=es",
  ];
  const body = ["--es", "Content-Type: text/plain; charset=utf-8", "", "Hi"];
  for (const part of parts) body.push("--es", part);
  body.push("--es--", "");
  return raw(...headers, "", ...body);
}

function esPart(json: string, type = ES_TYPE): string {
  return raw(`Content-Type: ${type}`, 'Content-Disposition: attachment; filename="email-social.json"', "", json);
}

function postJson(via: string, messageId?: string): string {
  return JSON.stringify({
    $type: "es.social.post",
    value: { text: "Hi", via, createdAt: CREATED, ...(messageId === undefined ? {} : { email: { messageId } }) },
  });
}

describe("parseMessage: the ES part", () => {
  it("accepts an ES part whose via is the From address and whose messageId is the Message-ID", () => {
    const m = parseMessage(esMessage({ parts: [esPart(postJson("alice@example.com", "<m1@example.com>"))] }));
    expect(m.es).toEqual({
      $type: "es.social.post",
      author: null,
      text: "Hi",
      via: "alice@example.com",
      createdAt: CREATED,
      email: { messageId: "<m1@example.com>", subject: null, inReplyTo: null, references: [], textSha256: null },
      requestReceipts: [],
    });
    expect(m.attachments).toEqual([]);
    expect(m.text).toBe("Hi");
  });

  it("compares via with the canonical From address (domain case ignored, local part case kept)", () => {
    expect(parseMessage(esMessage({ from: "alice@EXAMPLE.com", parts: [esPart(postJson("alice@example.COM"))] })).es).not.toBeNull();
    expect(parseMessage(esMessage({ from: "Alice@example.com", parts: [esPart(postJson("alice@example.com"))] })).es).toBeNull();
  });

  it("rejects an ES part whose via is not the From address and lists it as an attachment", () => {
    const json = postJson("mallory@example.net", "<m1@example.com>");
    const m = parseMessage(esMessage({ parts: [esPart(json)] }));
    expect(m.es).toBeNull();
    expect(m.attachments).toEqual([
      {
        filename: "email-social.json",
        contentType: ES_TYPE,
        disposition: "attachment",
        size: enc.encode(json).length,
        contentId: null,
        partId: "2",
      },
    ]);
  });

  it("rejects a post whose email.messageId differs from the Message-ID, and skips the check when either is missing", () => {
    expect(parseMessage(esMessage({ parts: [esPart(postJson("alice@example.com", "<other@example.com>"))] })).es).toBeNull();
    expect(
      parseMessage(esMessage({ messageId: null, parts: [esPart(postJson("alice@example.com", "<other@example.com>"))] })).es,
    ).not.toBeNull();
    expect(parseMessage(esMessage({ parts: [esPart(postJson("alice@example.com"))] })).es).not.toBeNull();
  });

  it("lists an ES part with invalid JSON or an unknown record as an attachment", () => {
    for (const json of ["{not json", '{"$type":"es.social.unknown","value":{}}', ""]) {
      const m = parseMessage(esMessage({ parts: [esPart(json)] }));
      expect(m.es).toBeNull();
      expect(m.attachments.map((a) => a.contentType)).toEqual([ES_TYPE]);
    }
  });

  it("accepts a receipt about another message, checking only via", () => {
    const receipt = (via: string): string =>
      JSON.stringify({
        $type: "es.social.receipt",
        value: { kind: "read", messageId: "<original@example.org>", via, createdAt: CREATED },
      });
    const m = parseMessage(esMessage({ parts: [esPart(receipt("alice@example.com"))] }));
    expect(m.es).toEqual({
      $type: "es.social.receipt",
      author: null,
      kind: "read",
      messageId: "<original@example.org>",
      via: "alice@example.com",
      createdAt: CREATED,
    });
    expect(parseMessage(esMessage({ parts: [esPart(receipt("bob@example.org"))] })).es).toBeNull();
  });

  it("skips the via check when the message has no From", () => {
    const m = parseMessage(esMessage({ from: null, parts: [esPart(postJson("alice@example.com"))] }));
    expect(m.from).toBeNull();
    expect(m.es?.$type).toBe("es.social.post");
  });

  it("considers only the first ES part; later ones are attachments", () => {
    const m = parseMessage(
      esMessage({ parts: [esPart(postJson("mallory@example.net")), esPart(postJson("alice@example.com"))] }),
    );
    expect(m.es).toBeNull();
    expect(m.attachments.map((a) => a.partId)).toEqual(["2", "3"]);
  });

  it("accepts the draft media type and a base64-encoded ES part", () => {
    const part = raw(
      "Content-Type: application/vnd.es.social+json; version=2.0",
      "Content-Transfer-Encoding: base64",
      "",
      b64(postJson("alice@example.com", "<m1@example.com>")),
    );
    const m = parseMessage(esMessage({ parts: [part] }));
    expect(m.es?.$type).toBe("es.social.post");
    expect(m.attachments).toEqual([]);
  });
});

// ---------------------------------------------------------------- attachments

describe("parseMessage: attachments", () => {
  it("describes every non-text leaf: filename, type, disposition, decoded size, Content-ID and IMAP part number", () => {
    const m = parseMessage(
      raw(
        "Content-Type: multipart/mixed; boundary=m",
        "",
        "--m",
        "Content-Type: multipart/related; boundary=r",
        "",
        "--r",
        "Content-Type: text/html; charset=utf-8",
        "",
        '<p>Logo: <img src="cid:logo@example.com"></p>',
        "--r",
        "Content-Type: image/png",
        "Content-ID: <logo@example.com>",
        "Content-Transfer-Encoding: base64",
        "",
        "iVBORw0KGgo=",
        "--r--",
        "--m",
        'Content-Type: application/pdf; name="=?UTF-8?B?TsOhdnJoLnBkZg==?="',
        "Content-Transfer-Encoding: base64",
        "",
        "JVBERi0xLjQK",
        "--m",
        'Content-Type: application/octet-stream; name="ignored.bin"',
        'Content-Disposition: attachment; filename="chosen.bin"',
        "",
        "raw",
        "--m--",
      ),
    );
    expect(m.text).toBe("Logo:");
    expect(m.textSource).toBe("html");
    expect(m.attachments).toEqual([
      { filename: null, contentType: "image/png", disposition: "inline", size: 8, contentId: "<logo@example.com>", partId: "1.2" },
      { filename: "Návrh.pdf", contentType: "application/pdf", disposition: "attachment", size: 9, contentId: null, partId: "2" },
      { filename: "chosen.bin", contentType: "application/octet-stream", disposition: "attachment", size: 3, contentId: null, partId: "3" },
    ]);
  });

  it("gives part number '1' to a single-part message that is an attachment", () => {
    const m = parseMessage(
      raw("Content-Type: application/pdf", 'Content-Disposition: attachment; filename="a.pdf"', "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQK"),
    );
    expect(m.attachments).toEqual([
      { filename: "a.pdf", contentType: "application/pdf", disposition: "attachment", size: 9, contentId: null, partId: "1" },
    ]);
    expect(m.textSource).toBe("none");
  });
});

// ---------------------------------------------------------------- fuzz

/** Byte strings that steer mutations towards the parser's decision points. */
const TOKENS = [
  "\r\n", "\n", "\r\n\r\n", "--", "=?", "?=", "=?utf-8?b?", "=", "=\r\n", ":", ";", '"', "\\", "<", ">", "&", "&#",
  "boundary=", "multipart/mixed", "multipart/alternative", "message/rfc822", "base64", "quoted-printable",
  "format=flowed; delsp=yes", "charset=utf-16", "charset=x-unknown", ES_TYPE, "text/html", "ÿþ", "\u0000",
].map((t) => enc.encode(t));

function mutate(source: Uint8Array, random: () => number): Uint8Array {
  let bytes = source;
  const operations = randomInt(random, 1, 8);
  for (let op = 0; op < operations; op++) {
    const at = randomInt(random, 0, bytes.length);
    const insert = (chunk: Uint8Array): Uint8Array => {
      const out = new Uint8Array(bytes.length + chunk.length);
      out.set(bytes.subarray(0, at));
      out.set(chunk, at);
      out.set(bytes.subarray(at), at + chunk.length);
      return out;
    };
    switch (randomInt(random, 0, 5)) {
      case 0: // overwrite a few bytes
        bytes = Uint8Array.from(bytes);
        for (let k = 0; k < randomInt(random, 1, 16) && bytes.length > 0; k++) {
          bytes[randomInt(random, 0, bytes.length - 1)] = randomInt(random, 0, 255);
        }
        break;
      case 1: // insert random bytes
        bytes = insert(Uint8Array.from({ length: randomInt(random, 1, 32) }, () => randomInt(random, 0, 255)));
        break;
      case 2: // delete a range
        bytes = Uint8Array.from([...bytes.subarray(0, at), ...bytes.subarray(Math.min(bytes.length, at + randomInt(random, 1, 200)))]);
        break;
      case 3: // duplicate a range somewhere else
        {
          const from = randomInt(random, 0, bytes.length);
          bytes = insert(Uint8Array.from(bytes.subarray(from, from + randomInt(random, 1, 400))));
        }
        break;
      case 4: // insert a syntax token
        bytes = insert(pick(random, TOKENS));
        break;
      default: // truncate
        bytes = bytes.subarray(0, at);
    }
  }
  return bytes;
}

describe("parseMessage: last-resort error handling", () => {
  it("returns a message with only its SHA-256 id if an internal error escapes", async () => {
    vi.resetModules();
    vi.doMock("../src/mime/tree.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/mime/tree.js")>()),
      parseMimeTree: () => {
        throw new Error("simulated internal error");
      },
    }));
    try {
      const guarded = await import("../src/parse.js");
      const bytes = enc.encode(raw("Message-ID: <x@example.com>", "Subject: s", "", "text"));
      expect(() => guarded.parseMessageUnguarded(bytes)).toThrow("simulated internal error");
      const m = guarded.parseMessage(bytes);
      expect(m.id).toBe("sha256:" + sha256Hex(bytes));
      expect(m.text).toBe("");
      expect(m.textSource).toBe("none");
      expectEsMessage(m);
    } finally {
      vi.doUnmock("../src/mime/tree.js");
      vi.resetModules();
    }
  });
});

describe("parseMessage: fuzzing", () => {
  it("never throws and always returns a complete EsMessage for 200 mutated fixtures (seeded)", () => {
    const random = mulberry32(0x5eed2026);
    const fixtures = listFixtures().map(readFixture);
    for (let n = 0; n < 200; n++) {
      const bytes = mutate(pick(random, fixtures), random);
      expect(() => parseMessageUnguarded(bytes), `case ${n}`).not.toThrow();
      expectEsMessage(parseMessage(bytes));
    }
  });
});
