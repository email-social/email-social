/**
 * Mutations of raw messages. Each mutator takes the message as a latin1
 * string (one character per byte, so every byte survives) and a seeded
 * random source, and returns the mutated message. Mutators never look at
 * the parser's output: they only know the shape of RFC 5322/MIME text.
 */
import { pick, randomInt, shuffle } from "../helpers/prng.js";

export type Random = () => number;
export type Mutator = (raw: string, random: Random, corpus: readonly string[]) => string;

export const toLatin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");
export const fromLatin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));

/** Index of the empty line that ends the top-level header (-1 when there is none). */
export function headerEnd(raw: string): number {
  const m = /\r?\n\r?\n/.exec(raw);
  return m === null ? -1 : m.index;
}

/** Start offsets of every line. */
function lineStarts(raw: string, from = 0, to = raw.length): number[] {
  const starts = [from];
  for (let i = raw.indexOf("\n", from); i >= 0 && i + 1 < to; i = raw.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The top-level header as logical fields (a field line with its continuation lines), plus the rest. */
export function splitFields(raw: string): { fields: string[]; rest: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  const end = m === null ? -1 : m.index;
  const head = end < 0 ? raw : raw.slice(0, end);
  const rest = m === null ? "" : raw.slice(end + m[0].length);
  const fields: string[] = [];
  for (const line of head.split(/(?<=\n)/)) {
    if (/^[ \t]/.test(line) && fields.length > 0) fields[fields.length - 1] += line;
    else fields.push(line);
  }
  if (fields.length > 0 && !/\n$/.test(fields[fields.length - 1]!)) fields[fields.length - 1] += "\r\n";
  return { fields, rest };
}

const joinFields = (fields: readonly string[], rest: string): string => fields.join("") + rest;

/** Every boundary parameter value in the message. */
export function boundariesOf(raw: string): string[] {
  const found = new Set<string>();
  for (const m of raw.matchAll(/boundary\s*=\s*(?:"([^"\r\n]*)"|([^\s;"]+))/gi)) found.add(m[1] ?? m[2]!);
  return [...found].filter((b) => b !== "");
}

/** Start offsets of every delimiter line ("--boundary" and "--boundary--"). */
export function delimiterOffsets(raw: string): number[] {
  const boundaries = boundariesOf(raw);
  return lineStarts(raw).filter((start) => boundaries.some((b) => raw.startsWith("--" + b, start)));
}

function insertAt(raw: string, at: number, text: string): string {
  return raw.slice(0, at) + text + raw.slice(at);
}

function randomBodyLineStart(raw: string, random: Random): number {
  const end = headerEnd(raw);
  const starts = lineStarts(raw, end < 0 ? 0 : end + 2);
  return pick(random, starts);
}

const CHARSETS = ["utf-8", "UTF-8", "iso-8859-2", "windows-1250", "windows-1252", "utf-16", "utf-16be", "utf-7", "x-unknown-charset", "", '"', "'utf-8'", "iso-2022-jp", "gb18030", "x-user-defined", "us-ascii", "replacement", "csiso2022kr"];

/** Byte sequences that are not valid UTF-8. */
const BAD_UTF8 = ["\xc3\x28", "\xe2\x82", "\xf0\x9f\x98", "\xc0\xaf", "\xed\xa0\x80", "\xff\xfe", "\xfe\xff\x00", "\x80", "\xf8\x88\x80\x80\x80"];

const CONTENT_TYPES = [
  "multipart/alternative", "multipart/mixed; boundary=", "multipart/digest; boundary=\"x\"", "multipart/related; start=<nope>; boundary=q",
  "message/rfc822", "text/html", "text/plain; format=flowed; delsp=yes", "application/vnd.email-social.message+json",
  "application/vnd.es.social+json; charset=utf-16", "image/png", "text/", "/", "", ";;;", "text/plain; charset",
];

export const MUTATORS: Record<string, Mutator> = {
  "byte-flip": (raw, random) => {
    const bytes = fromLatin1(raw);
    for (let n = randomInt(random, 1, 16); n > 0 && bytes.length > 0; n--) bytes[randomInt(random, 0, bytes.length - 1)]! ^= randomInt(random, 1, 255);
    return toLatin1(bytes);
  },

  "truncate-random": (raw, random) => raw.slice(0, randomInt(random, 0, raw.length)),

  "duplicate-header": (raw, random) => {
    const { fields, rest } = splitFields(raw);
    if (fields.length === 0) return raw;
    for (let n = randomInt(random, 1, 5); n > 0; n--) fields.splice(randomInt(random, 0, fields.length), 0, pick(random, fields));
    return joinFields(fields, "\r\n" + rest);
  },

  "drop-header": (raw, random) => {
    const { fields, rest } = splitFields(raw);
    for (let n = randomInt(random, 1, 3); n > 0 && fields.length > 0; n--) fields.splice(randomInt(random, 0, fields.length - 1), 1);
    return joinFields(fields, "\r\n" + rest);
  },

  "long-header": (raw, random) => {
    const { fields, rest } = splitFields(raw);
    const size = 2 ** 20;
    const kinds = [
      () => "X-Filler: " + "abc def ".repeat(size / 8),
      () => "Subject: " + "=?utf-8?q?=C3=A9?= ".repeat(size / 19),
      () => "References: " + Array.from({ length: size / 24 }, (_, i) => `<r${i}@example.com>`).join(" "),
      () => "From: " + "a@example.com, ".repeat(size / 15),
      () => 'Content-Type: text/plain; name="' + "n".repeat(size) + '"',
      () => "X-Folded: x" + "\r\n x".repeat(size / 4),
      () => "To: " + "\"".repeat(size),
      () => "Date: " + "Mon, 1 Jan 2026 ".repeat(size / 16),
    ];
    fields.splice(randomInt(random, 0, fields.length), 0, pick(random, kinds)() + "\r\n");
    return joinFields(fields, "\r\n" + rest);
  },

  "boundary-in-body": (raw, random) => {
    const boundaries = boundariesOf(raw);
    const b = boundaries.length > 0 ? pick(random, boundaries) : "b";
    let out = raw;
    for (let n = randomInt(random, 1, 4); n > 0; n--) {
      const line = pick(random, [`--${b}`, `--${b}--`, `--${b}X`, `--${b}  \t`, `--${b}--junk`, `-- ${b}`, `--${b.toUpperCase()}`]);
      out = insertAt(out, randomBodyLineStart(out, random), line + pick(random, ["\r\n", "\n", ""]));
    }
    return out;
  },

  "charset-chaos": (raw, random) => {
    let out = raw.replace(/charset\s*=\s*("[^"\r\n]*"|[^\s;]+)/gi, () => "charset=" + pick(random, CHARSETS));
    for (let n = randomInt(random, 1, 12); n > 0; n--) {
      const at = randomInt(random, 0, out.length);
      out = insertAt(out, at, random() < 0.5 ? pick(random, BAD_UTF8) : String.fromCharCode(randomInt(random, 0x80, 0xff)));
    }
    return out;
  },

  "line-endings": (raw, random) => raw.replace(/\r?\n|\r/g, () => pick(random, ["\r\n", "\n", "\r", "\n\r", "\r\r\n"])),

  "qp-corrupt": (raw, random) => {
    let out = raw.replace(/content-transfer-encoding:[^\r\n]*/gi, () => "Content-Transfer-Encoding: quoted-printable");
    for (let n = randomInt(random, 1, 10); n > 0; n--) {
      out = insertAt(out, randomInt(random, headerEnd(out) + 1, out.length), pick(random, ["=", "=G1", "=\r", "=\n", "= \r\n", "=0", "=3D=", "=E2=82", "==", "=\t\r\n", "=FF=FE"]));
    }
    return out;
  },

  "base64-corrupt": (raw, random) => {
    let out = raw.replace(/content-transfer-encoding:[^\r\n]*/gi, () => "Content-Transfer-Encoding: base64");
    for (let n = randomInt(random, 1, 10); n > 0; n--) {
      const at = randomInt(random, headerEnd(out) + 1, out.length);
      out = random() < 0.3 ? out.slice(0, at) + out.slice(at + randomInt(random, 1, 7)) : insertAt(out, at, pick(random, ["!", "=", "==", "\x00", "-", "\xff", " ", "====", "A", "QQ=", "\r\n"]));
    }
    return out;
  },

  "rfc2231-fragments": (raw, random) => {
    const name = pick(random, ["filename", "name", "boundary", "charset"]);
    const count = randomInt(random, 2, 40);
    const pieces = Array.from({ length: count }, (_, i) => {
      const value = pick(random, ["%C3%A9t%C3%A9", "abc", "%ZZ", "%", "%E2%82", "x y", '"q"', "''", "utf-8''%41"]);
      return i === 0 && random() < 0.7 ? `${name}*0*=utf-8'cs'${value}` : `${name}*${pick(random, [String(i), String(i), "00" + i, "99999999999999999999", "-1", ""])}${random() < 0.6 ? "*" : ""}=${value}`;
    });
    if (random() < 0.3) pieces.push(`${name}*=utf-8''dup`, `${name}=plain`);
    const header = `${pick(random, ["Content-Disposition: attachment", "Content-Type: application/octet-stream", "Content-Type: multipart/mixed"])}; ${shuffle(pieces, random).join(";\r\n ")}\r\n`;
    const { fields, rest } = splitFields(raw);
    fields.splice(randomInt(random, 0, fields.length), 0, header);
    return joinFields(fields, "\r\n" + rest);
  },

  "content-type-swap": (raw, random) => raw.replace(/content-type:[^\r\n]*/gi, (m) => (random() < 0.5 ? "Content-Type: " + pick(random, CONTENT_TYPES) : m)),

  splice: (raw, random, corpus) => {
    const other = pick(random, corpus);
    const end = headerEnd(raw);
    const otherEnd = headerEnd(other);
    return (end < 0 ? raw : raw.slice(0, end)) + "\r\n\r\n" + (otherEnd < 0 ? other : other.slice(otherEnd + 2));
  },
};

/**
 * Every truncation the task asks for: before, inside and just after each
 * delimiter line, and at the end of the header.
 */
export function boundaryTruncations(raw: string): number[] {
  const cuts = new Set<number>();
  for (const at of delimiterOffsets(raw)) {
    const lineEnd = raw.indexOf("\n", at);
    for (const cut of [at - 2, at - 1, at, at + 2, at + 5, lineEnd < 0 ? raw.length : lineEnd, lineEnd < 0 ? raw.length : lineEnd + 1]) {
      if (cut >= 0 && cut <= raw.length) cuts.add(cut);
    }
  }
  const end = headerEnd(raw);
  if (end >= 0) for (const cut of [end, end + 1, end + 2]) cuts.add(cut);
  return [...cuts].sort((a, b) => a - b);
}
