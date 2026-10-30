/**
 * Fuzz: hostile inputs built from scratch rather than from fixtures. Long
 * character runs in every header field (ReDoS sweep), 10 000 nested and
 * 10 000 sibling multiparts, Message-ID and References loops of 10 000 ids,
 * ES parts that are valid JSON with wrong types, and a flood of ">" quote
 * prefixes.
 */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parseMessage, splitQuoted, unquotedLines } from "../../src/index.js";
import { parseEsJson } from "../../src/es/schema.js";
import { htmlToText } from "../../src/mime/html-to-text.js";
import type { EsMessage } from "../../src/types.js";
import { mulberry32, pick, randomInt } from "../helpers/prng.js";
import { HEADER_RUN, LONG, QUOTE_FLOOD_BYTES, limitMs, seedFor } from "./config.js";
import { specRead } from "./es-oracle.js";
import { fromLatin1 } from "./mutate.js";
import { esShapeProblems, messageProblems, splitProblems, threadingProblems } from "./properties.js";

const latin1 = (text: string): Uint8Array => fromLatin1(text);

describe("fuzz: character runs in header fields (ReDoS sweep)", () => {
  const FIELDS = [
    "From: ", "To: a <", "Cc: \"", "Reply-To: (", "Subject: =?utf-8?q?", "Subject: a", "Date: Mon, 1 ", "Message-ID: <", "References: <a@example.com> ",
    "In-Reply-To: ", "Content-Type: text/plain; name*0*=", "Content-Type: text/plain; charset=\"", "Content-Type: multipart/mixed; boundary=",
    "Content-Disposition: attachment; filename=\"", "Content-Transfer-Encoding: ", "Content-ID: ", "List-Id: ", "Return-Path: <", "Auto-Submitted: ",
  ];
  const CHARS = [" ", "\t", "'", '"', "(", ")", "<", ">", "=", "?", "a", "-", "@", ",", ";", "\\", "*", "%", ":", ".", "[", "!", "0", "\xe9", "\r\n "];
  it(`${FIELDS.length} fields × ${CHARS.length} characters, runs of ${HEADER_RUN}`, { timeout: 300_000 }, () => {
    const problems: string[] = [];
    for (const field of FIELDS) {
      for (const ch of CHARS) {
        const raw = `${field}${ch.repeat(Math.ceil(HEADER_RUN / ch.length))}x\r\nFrom: a@example.com\r\nContent-Type: text/plain\r\n\r\nbody\r\n`;
        problems.push(...messageProblems(latin1(raw), `${JSON.stringify(field)} + run of ${JSON.stringify(ch)}`));
      }
    }
    expect(problems.slice(0, 15)).toEqual([]);
  });
});

/** A multipart nested `depth` levels deep, built without recursion. */
function nested(depth: number, opts: { boundary: (i: number) => string; type: (i: number) => string; close: boolean; sibling: boolean; leaf: string }): string {
  const out: string[] = [`From: a@example.com\r\nMessage-ID: <nested@example.com>\r\nContent-Type: ${opts.type(0)}; boundary="${opts.boundary(0)}"\r\n\r\n`];
  for (let i = 0; i < depth; i++) {
    if (opts.sibling) out.push(`--${opts.boundary(i)}\r\nContent-Type: text/plain\r\n\r\nlevel ${i}\r\n`);
    out.push(`--${opts.boundary(i)}\r\nContent-Type: ${opts.type(i + 1)}; boundary="${opts.boundary(i + 1)}"\r\n\r\n`);
  }
  out.push(`--${opts.boundary(depth)}\r\n${opts.leaf}\r\n`);
  if (opts.close) for (let i = depth; i >= 0; i--) out.push(`--${opts.boundary(i)}--\r\n`);
  return out.join("");
}

describe("fuzz: deep and wide MIME trees", () => {
  const ES_LEAF = 'Content-Type: application/vnd.email-social.message+json\r\n\r\n{"$type":"es.social.post","value":{"text":"hi","via":"a@example.com","createdAt":"2026-01-01T00:00:00Z"}}';
  const cases: [string, string][] = [
    ["10 000 nested, distinct boundaries", nested(10_000, { boundary: (i) => `b${i}`, type: () => "multipart/mixed", close: true, sibling: false, leaf: "Content-Type: text/plain\r\n\r\nleaf" })],
    ["10 000 nested, one boundary for all", nested(10_000, { boundary: () => "b", type: () => "multipart/mixed", close: true, sibling: false, leaf: "\r\nleaf" })],
    ["10 000 nested, never closed", nested(10_000, { boundary: (i) => `b${i}`, type: () => "multipart/alternative", close: false, sibling: false, leaf: ES_LEAF })],
    ["10 000 nested alternative/related with siblings", nested(10_000, { boundary: (i) => `b${i}`, type: (i) => (i % 2 ? "multipart/related" : "multipart/alternative"), close: true, sibling: true, leaf: "Content-Type: text/html\r\n\r\n<p>leaf" })],
    ["10 000 nested digests", nested(10_000, { boundary: (i) => `d${i}`, type: () => "multipart/digest", close: true, sibling: true, leaf: "\r\nx" })],
    ["10 000 siblings", "Content-Type: multipart/mixed; boundary=w\r\n\r\n" + Array.from({ length: 10_000 }, (_, i) => `--w\r\nContent-Type: ${i % 3 ? "text/plain" : "application/octet-stream"}\r\n\r\npart ${i}\r\n`).join("") + "--w--\r\n"],
    ["10 000 empty siblings", "Content-Type: multipart/mixed; boundary=w\r\n\r\n" + "--w\r\n".repeat(10_000)],
    ["boundary as a prefix of every body line", "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n\r\n" + "--bb\r\n--b-\r\n--b--x\r\n".repeat(20_000) + "--b--\r\n"],
  ];
  it.each(cases)("%s", (label, raw) => {
    expect(messageProblems(latin1(raw), label)).toEqual([]);
  });
});

describe("fuzz: Message-ID and References loops", () => {
  const N = 10_000;
  const ids = Array.from({ length: N }, (_, i) => `<loop${i}@example.com>`);
  const message = (id: string, references: readonly string[], inReplyTo: string, subject = "Loop"): string =>
    `From: a@example.com\r\nTo: b@example.org\r\nSubject: ${subject}\r\nDate: Mon, 2 Mar 2026 09:00:00 +0000\r\nMessage-ID: ${id}\r\nIn-Reply-To: ${inReplyTo}\r\nReferences: ${references.join("\r\n ")}\r\n\r\nx\r\n`;
  it(`threads messages whose ${N}-id References loop through each other and themselves`, { timeout: 120_000 }, () => {
    const raws = [
      message(ids[0]!, [...ids.slice(1), ids[0]!, ...ids.slice(1)], ids[0]!),
      message(ids[1]!, [...ids].reverse(), ids[0]!, "Re: Loop"),
      message(ids[N - 1]!, ids, ids[N - 1]!, "Re: Loop"),
      message("<a@example.com>", ["<b@example.com>"], "<c@example.com>"),
      message("<b@example.com>", ["<c@example.com>"], "<a@example.com>"),
      message("<c@example.com>", ["<a@example.com>"], "<b@example.com>"),
      ...Array.from({ length: 50 }, (_, k) => message(ids[k * 97]!, ids.slice(k * 97 + 1).concat(ids.slice(0, k * 97 + 1)), ids[(k * 31) % N]!, `Re: Re: Loop ${k % 3}`)),
    ];
    const problems: string[] = [];
    const messages: EsMessage[] = [];
    raws.forEach((raw, i) => {
      problems.push(...messageProblems(latin1(raw), `loop message ${i}`));
      messages.push(parseMessage(raw));
    });
    const started = performance.now();
    problems.push(...threadingProblems(messages, mulberry32(seedFor("loops")), "loops"));
    const elapsed = performance.now() - started;
    if (elapsed > 5000) problems.push(`threading the loops took ${elapsed.toFixed(0)} ms`);
    expect(problems.slice(0, 15)).toEqual([]);
  });
});

describe("fuzz: ES parts that are valid JSON with wrong types", () => {
  const POST = {
    $type: "es.social.post",
    author: "did:es:example.com:alice",
    value: {
      text: "Hello",
      via: "Alice@Example.com",
      createdAt: "2026-03-02T09:00:00.000Z",
      email: {
        messageId: "<p1@example.com>", subject: "Hi", inReplyTo: "<p0@example.com>", references: ["<p0@example.com>", " <p0@example.com>"],
        textSha256: "AB".repeat(32), topicRoot: "<p0@example.com>", topicLabel: "Trip",
        replyTo: { messageId: "<p0@example.com>", from: { name: "Bob", address: "bob@example.org" }, excerpt: "x" },
      },
      requestReceipts: ["read", "delivered", "read"],
    },
  };
  const RECEIPT = { $type: "es.social.receipt", value: { kind: "read", messageId: "<p1@example.com>", via: "bob@example.org", createdAt: "2026-03-02T09:05:00+01:00" } };
  const deep = (n: number): unknown => JSON.parse("[".repeat(n) + "]".repeat(n));
  const WRONG: unknown[] = [
    undefined, null, 0, -1, 1.5, 1e308, true, false, "", " ", "x", "@", "<>", "<a@example.com>", "did:es:x", "2026-02-31T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z", "2026-01-01t00:00:60z", "2026-01-01T00:00:00+24:00", [], [null], ["x"], ["read"], {}, { a: 1 }, { from: {} }, { address: "a@example.com" },
    "a".repeat(100_000), deep(1000),
  ];

  /** Every path to a value in the record. */
  function paths(value: unknown, prefix: string[] = []): string[][] {
    if (typeof value !== "object" || value === null) return [prefix];
    return [prefix, ...Object.entries(value).flatMap(([k, v]) => paths(v, [...prefix, k]))];
  }
  function replaced(record: unknown, path: readonly string[], value: unknown): unknown {
    if (path.length === 0) return value;
    const copy = structuredClone(record) as Record<string, unknown>;
    let target = copy;
    for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
    if (value === undefined) delete target[path[path.length - 1]!];
    else target[path[path.length - 1]!] = value;
    return copy;
  }
  function compare(json: string, label: string): string[] {
    const got = parseEsJson(json);
    const want = specRead(JSON.parse(json));
    const problems: string[] = [];
    if (!isDeepStrictEqual(got, want)) problems.push(`${label}: reader ${JSON.stringify(got)?.slice(0, 200)} but spec 5.4 ${JSON.stringify(want)?.slice(0, 200)}`);
    if (got !== null) problems.push(...esShapeProblems(got).map((p) => `${label}: ${p}`));
    return problems;
  }

  it("each field of a post and a receipt replaced by each wrong value: the reader agrees with spec 5.4", () => {
    const problems: string[] = [];
    let count = 0;
    for (const record of [POST, RECEIPT, { ...POST, value: { ...POST.value, text: undefined } }]) {
      for (const path of paths(record)) {
        for (const value of WRONG) {
          const mutated = replaced(record, path, value);
          if (mutated === undefined) continue;
          problems.push(...compare(JSON.stringify(mutated), `${JSON.stringify(record.$type)} ${path.join(".") || "(root)"} = ${JSON.stringify(value)?.slice(0, 30)}`));
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(problems.slice(0, 15)).toEqual([]);
  });

  it("random JSON records: the reader agrees with spec 5.4", { timeout: LONG ? 600_000 : 30_000 }, () => {
    const random = mulberry32(seedFor("es-random"));
    const leaf = (): unknown => structuredClone(pick(random, WRONG.slice(0, -2)));
    const gen = (depth: number): unknown => {
      if (depth > 3 || random() < 0.3) return leaf();
      if (random() < 0.3) return Array.from({ length: randomInt(random, 0, 3) }, () => gen(depth + 1));
      const keys = ["$type", "value", "author", "text", "via", "createdAt", "email", "kind", "messageId", "references", "replyTo", "from", "address", "name", "requestReceipts", "textSha256", "__proto__", "constructor"];
      return Object.fromEntries(Array.from({ length: randomInt(random, 0, 6) }, () => [pick(random, keys), gen(depth + 1)]));
    };
    const problems: string[] = [];
    for (let n = 0; n < (LONG ? 100_000 : 3000); n++) {
      const base = structuredClone(pick(random, [POST, RECEIPT])) as Record<string, any>;
      const target = random() < 0.5 ? base : base.value;
      target[pick(random, Object.keys(target).concat(["email", "kind"]))] = gen(0);
      if (random() < 0.3 && typeof base.value === "object" && base.value !== null && typeof base.value.email === "object" && base.value.email !== null) base.value.email[pick(random, ["references", "replyTo", "textSha256", "messageId"])] = gen(1);
      const json = JSON.stringify(base);
      if (json !== undefined) problems.push(...compare(json, `random record ${n}`));
    }
    expect(problems.slice(0, 15)).toEqual([]);
  });

  it("long arrays (100 000 references, 100 000 requestReceipts) are read in linear time", () => {
    const refs = Array.from({ length: 100_000 }, (_, i) => `<r${i}@example.com>`);
    const json = JSON.stringify(replaced(replaced(POST, ["value", "email", "references"], refs), ["value", "requestReceipts"], refs));
    const started = performance.now();
    parseEsJson(json);
    expect(performance.now() - started).toBeLessThan(limitMs(json.length));
    expect(compare(json, "long arrays")).toEqual([]);
  });

  it("an ES part read through parseMessage is the record parseEsJson gives", () => {
    const json = JSON.stringify(replaced(POST, ["value", "via"], "a@example.com"));
    for (const cte of ["7bit", "base64", "quoted-printable"]) {
      const body = cte === "base64" ? Buffer.from(json).toString("base64") : json;
      const raw = `From: a@example.com\r\nMessage-ID: <p1@example.com>\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nHello\r\n--b\r\nContent-Type: application/vnd.email-social.message+json; charset=utf-16\r\nContent-Transfer-Encoding: ${cte}\r\n\r\n${body}\r\n--b--\r\n`;
      expect(parseMessage(raw).es).toEqual(parseEsJson(json));
    }
  });
});

describe(`fuzz: quote-prefix flood (${(QUOTE_FLOOD_BYTES / 2 ** 20).toFixed(0)} MB)`, () => {
  const size = QUOTE_FLOOD_BYTES;
  const repeatTo = (unit: string): string => unit.repeat(Math.max(1, Math.floor(size / unit.length)));
  const floods: [string, () => string][] = [
    ["one line of >", () => ">".repeat(size)],
    ["lines of '> '", () => repeatTo("> \n")],
    ["deep quotes with text", () => repeatTo(">>>>>>>>>>>>>>>>>>>> > > > > x\n")],
    ["attribution and quote, repeated", () => repeatTo("On Mon, 2 Mar 2026, a@example.com wrote:\n> x\n")],
    ["fresh and quote, alternating", () => repeatTo("a\n> b\n\n")],
    ["CR-only lines of >", () => repeatTo(">\r")],
  ];
  it.each(floods)("%s: splitQuoted keeps every line and stays linear", { timeout: LONG ? 600_000 : 60_000 }, (label, make) => {
    const text = make();
    const started = performance.now();
    const problems = splitProblems({ text });
    unquotedLines(splitQuoted({ text }).quoted);
    const elapsed = performance.now() - started;
    // Two splits, one check and one unquote: four passes over the text.
    if (elapsed > 4 * limitMs(text.length)) problems.push(`${label}: ${elapsed.toFixed(0)} ms for ${text.length} characters`);
    expect(problems).toEqual([]);
  });

  it("the flood as the body of a message, and nested <blockquote> as HTML", { timeout: LONG ? 600_000 : 60_000 }, () => {
    const body = repeatTo("> > > quoted\r\n");
    expect(messageProblems(latin1(`From: a@example.com\r\nContent-Type: text/plain\r\n\r\n${body}`), "flood body")).toEqual([]);
    const html = "<blockquote>x".repeat(Math.floor(size / 13));
    const started = performance.now();
    const text = htmlToText(html);
    expect(performance.now() - started).toBeLessThan(limitMs(html.length));
    // Each 13-byte "<blockquote>x" gives one line of at most 32 "> " marks: output stays linear.
    expect(text.length).toBeLessThan(8 * html.length);
  });
});
