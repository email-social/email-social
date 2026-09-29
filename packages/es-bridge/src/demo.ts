/**
 * A demo mailbox: 40 messages in 9 conversations, written in the formats of
 * the clients reconstructed in Task 1 (packages/es-core/fixtures): Gmail web,
 * Thunderbird (format=flowed), Outlook (German, French; one without
 * References, one without any threading header), Apple Mail, iOS Mail, mutt
 * (8-bit ISO-8859-2, a patch attachment), Seznam.cz webmail, a Mailman list,
 * an HTML-only newsletter, and Email Social itself (es-core's serializer).
 *
 * The mailbox belongs to Alice (alice@example.com). It is the seed of the
 * end-to-end test and of `email-social --demo`. Everything is fixed: the same
 * bytes on every run, example domains only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeMessage, type EsAddress } from "@email-social/es-core";

export const DEMO_ACCOUNT: EsAddress = { name: "Alice Dvořáková", address: "alice@example.com" };

export type DemoStyle =
  | "gmail"
  | "thunderbird"
  | "outlook"
  | "apple-mail"
  | "ios-mail"
  | "mutt"
  | "seznam"
  | "mailman"
  | "newsletter"
  | "email-social";

export interface DemoMessage {
  /** Which conversation of the script (A–I) the message belongs to. */
  conversation: string;
  style: DemoStyle;
  folder: "inbox" | "sent";
  seen: boolean;
  /** File name in the maildir. */
  name: string;
  raw: Uint8Array;
}

// ---------------------------------------------------------------------------
// Encoding helpers (RFC 2045 quoted-printable and base64, RFC 2047 words)

const CRLF = "\r\n";
type Encoder = (text: string) => Uint8Array;

const utf8: Encoder = (text) => new Uint8Array(Buffer.from(text, "utf8"));
const latin1: Encoder = (text) => new Uint8Array(Buffer.from(text, "latin1"));
const LATIN2: Record<string, number> = {
  á: 0xe1, č: 0xe8, ď: 0xef, é: 0xe9, ě: 0xec, í: 0xed, ň: 0xf2, ó: 0xf3, ř: 0xf8, š: 0xb9, ť: 0xbb, ú: 0xfa,
  ů: 0xf9, ý: 0xfd, ž: 0xbe, Á: 0xc1, Č: 0xc8, Ď: 0xcf, É: 0xc9, Ě: 0xcc, Í: 0xcd, Ň: 0xd2, Ó: 0xd3, Ř: 0xd8,
  Š: 0xa9, Ť: 0xab, Ú: 0xda, Ů: 0xd9, Ý: 0xdd, Ž: 0xae,
};
/** ISO-8859-2 for Czech text (the characters used in this mailbox). */
const latin2: Encoder = (text) =>
  new Uint8Array(
    Array.from(text, (ch) => {
      const code = ch.charCodeAt(0);
      if (code < 0x80) return code;
      const byte = LATIN2[ch];
      if (byte === undefined) throw new Error(`No ISO-8859-2 byte for ${ch}`);
      return byte;
    }),
  );

function hex(byte: number): string {
  return "=" + byte.toString(16).toUpperCase().padStart(2, "0");
}

/** Quoted-printable (RFC 2045 §6.7): lines of at most 76 characters, "\n" as hard line breaks. */
function qp(text: string, encode: Encoder): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const bytes = encode(line);
    let current = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const last = i === bytes.length - 1;
      const literal = (b >= 0x21 && b <= 0x7e && b !== 0x3d) || ((b === 0x20 || b === 0x09) && !last);
      const token = literal ? String.fromCharCode(b) : hex(b);
      if (current.length + token.length > 75) {
        out.push(current + "=");
        current = "";
      }
      current += token;
    }
    out.push(current);
  }
  return out.join(CRLF);
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/.{76}(?=.)/g, "$&" + CRLF);
}

/** An RFC 2047 encoded-word when the text is not ASCII. */
function word(text: string, charset: string, mode: "B" | "Q", encode: Encoder = utf8): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const bytes = encode(text);
  const payload =
    mode === "B"
      ? Buffer.from(bytes).toString("base64")
      : Array.from(bytes, (b) => (b === 0x20 ? "_" : /[A-Za-z0-9!*+\-/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : hex(b))).join("");
  const encoded = `=?${charset}?${mode}?${payload}?=`;
  if (encoded.length > 75) throw new Error(`Encoded word too long for the demo: ${text}`);
  return encoded;
}

function mailbox(a: EsAddress, charset = "UTF-8", encode: Encoder = utf8): string {
  if (a.name === "") return a.address;
  if (/^[\x20-\x7e]*$/.test(a.name)) return `"${a.name}" <${a.address}>`;
  return `${word(a.name, charset, "Q", encode)} <${a.address}>`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 5322 §3.3 date in a given UTC offset (minutes). */
function rfcDate(iso: string, offset: number, comment = ""): string {
  const local = new Date(Date.parse(iso) + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const zone = sign + String(Math.floor(abs / 60)).padStart(2, "0") + String(abs % 60).padStart(2, "0");
  const time = [local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  return `${DAYS[local.getUTCDay()]}, ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} ${time} ${zone}${comment}`;
}

function html(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div dir="ltr">${escaped.split("\n").join("<br>\n")}</div>\n`;
}

/** A short deterministic hex string derived from a seed (for boundaries and similar ids). */
function hexOf(seed: string, length: number): string {
  let h = 2166136261;
  let out = "";
  while (out.length < length) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
    seed += "+";
  }
  return out.slice(0, length);
}

/** Format=flowed (RFC 3676): long lines wrapped at 72 with a trailing space as soft break. */
function flowed(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (line.length <= 72) return [line.startsWith("From ") || line.startsWith(" ") ? " " + line : line];
      const out: string[] = [];
      let current = "";
      for (const w of line.split(" ")) {
        if (current !== "" && current.length + w.length + 1 > 72) {
          out.push(current + " ");
          current = w;
        } else current = current === "" ? w : current + " " + w;
      }
      out.push(current);
      return out;
    })
    .join(CRLF);
}

// ---------------------------------------------------------------------------
// Client formats

interface Spec {
  from: EsAddress;
  to: EsAddress[];
  cc?: EsAddress[];
  subject: string;
  text: string;
  date: string;
  id: string;
  /** The message this one answers (its id and References), when it is a reply. */
  parent?: { id: string; references: string[] };
  attachment?: { name: string; type: string; bytes: Uint8Array };
  receipts?: boolean;
  es?: boolean;
}

function refs(spec: Spec): string[] {
  if (spec.parent === undefined) return [];
  return [...spec.parent.references, spec.parent.id];
}

function threading(spec: Spec, mode: "full" | "in-reply-to" | "none" = "full"): string[] {
  if (spec.parent === undefined || mode === "none") return [];
  if (mode === "in-reply-to") return [`In-Reply-To: ${spec.parent.id}`];
  return [`References: ${refs(spec).join(CRLF + " ")}`, `In-Reply-To: ${spec.parent.id}`];
}

function addressLines(spec: Spec, charset = "UTF-8", encode: Encoder = utf8): string[] {
  const lines = [`To: ${spec.to.map((a) => mailbox(a, charset, encode)).join(", ")}`];
  if (spec.cc !== undefined && spec.cc.length > 0) lines.push(`Cc: ${spec.cc.map((a) => mailbox(a, charset, encode)).join(", ")}`);
  return lines;
}

function gmail(spec: Spec): string {
  const b = "000000000000" + hexOf(spec.id, 16);
  const alternative = [
    `--${b}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(spec.text, utf8),
    "",
    `--${b}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(html(spec.text), utf8),
    `--${b}--`,
  ];
  const head = [
    "MIME-Version: 1.0",
    ...threading(spec),
    `From: ${mailbox(spec.from)}`,
    `Date: ${rfcDate(spec.date, 60)}`,
    `Message-ID: ${spec.id}`,
    `Subject: ${word(spec.subject, "UTF-8", "B")}`,
    ...addressLines(spec),
  ];
  if (spec.attachment === undefined) {
    return [...head, `Content-Type: multipart/alternative; boundary="${b}"`, "", ...alternative, ""].join(CRLF);
  }
  const m = "000000000000" + hexOf(spec.id + "mixed", 16);
  const a = spec.attachment;
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${m}"`,
    "",
    `--${m}`,
    `Content-Type: multipart/alternative; boundary="${b}"`,
    "",
    ...alternative,
    "",
    `--${m}`,
    `Content-Type: ${a.type}; name="${word(a.name, "UTF-8", "B")}"`,
    `Content-Disposition: attachment; filename="${word(a.name, "UTF-8", "B")}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <f_${hexOf(spec.id, 10)}0>`,
    `X-Attachment-Id: f_${hexOf(spec.id, 10)}0`,
    "",
    base64(a.bytes),
    `--${m}--`,
    "",
  ].join(CRLF);
}

function thunderbird(spec: Spec): string {
  return [
    `Message-ID: ${spec.id}`,
    `Date: ${rfcDate(spec.date, 60)}`,
    "MIME-Version: 1.0",
    "User-Agent: Mozilla Thunderbird",
    "Content-Language: cs",
    ...addressLines(spec),
    `From: ${mailbox(spec.from)}`,
    `Subject: ${word(spec.subject, "UTF-8", "Q")}`,
    ...threading(spec),
    "Content-Type: text/plain; charset=UTF-8; format=flowed",
    "Content-Transfer-Encoding: 8bit",
    "",
    flowed(spec.text),
    "",
  ].join(CRLF);
}

function outlook(spec: Spec, mode: "in-reply-to" | "none", lang: string, charset: "iso-8859-1" | "windows-1252"): string {
  const b = `----=_NextPart_000_${hexOf(spec.id, 4).toUpperCase()}_01DCAAF1.${hexOf(spec.id, 8).toUpperCase()}`;
  const encode = latin1;
  return [
    `From: ${mailbox(spec.from, charset, encode)}`,
    ...addressLines(spec, charset, encode),
    ...threading(spec, mode),
    `Subject: ${word(spec.subject, charset, "Q", encode)}`,
    `Date: ${rfcDate(spec.date, 60)}`,
    `Message-ID: ${spec.id}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative;${CRLF}\tboundary="${b}"`,
    "X-Mailer: Microsoft Outlook 16.0",
    `Thread-Index: ${Buffer.from(hexOf(spec.subject, 22), "hex").toString("base64")}`,
    `Content-Language: ${lang}`,
    "",
    "This is a multipart message in MIME format.",
    "",
    `--${b}`,
    `Content-Type: text/plain;${CRLF}\tcharset="${charset}"`,
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(spec.text, encode),
    "",
    `--${b}`,
    `Content-Type: text/html;${CRLF}\tcharset="${charset}"`,
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(`<html><body>${html(spec.text)}</body></html>`, encode),
    "",
    `--${b}--`,
    "",
  ].join(CRLF);
}

function appleMail(spec: Spec): string {
  const b = `Apple-Mail=_${hexOf(spec.id, 8).toUpperCase()}-4E5F-4A6B-8C7D-${hexOf(spec.id + "b", 12).toUpperCase()}`;
  return [
    `Content-Type: multipart/alternative;${CRLF}\tboundary="${b}"`,
    "Mime-Version: 1.0 (Mac OS X Mail 16.0 \\(3774.600.62\\))",
    `Subject: ${word(spec.subject, "utf-8", "Q")}`,
    `From: ${mailbox(spec.from, "utf-8")}`,
    ...(spec.parent === undefined ? [] : [`In-Reply-To: ${spec.parent.id}`]),
    `Date: ${rfcDate(spec.date, 60)}`,
    ...(spec.cc === undefined ? [] : [`Cc: ${spec.cc.map((a) => mailbox(a, "utf-8")).join(", ")}`]),
    `Message-Id: ${spec.id}`,
    ...(spec.parent === undefined ? [] : [`References: ${refs(spec).join(CRLF + " ")}`]),
    `To: ${spec.to.map((a) => mailbox(a, "utf-8")).join(", ")}`,
    "X-Mailer: Apple Mail (2.3774.600.62)",
    "",
    "",
    `--${b}`,
    "Content-Transfer-Encoding: quoted-printable",
    "Content-Type: text/plain;",
    "\tcharset=utf-8",
    "",
    qp(spec.text, utf8),
    "",
    `--${b}`,
    "Content-Transfer-Encoding: quoted-printable",
    "Content-Type: text/html;",
    "\tcharset=utf-8",
    "",
    qp(`<html><body>${html(spec.text)}</body></html>`, utf8),
    `--${b}--`,
    "",
  ].join(CRLF);
}

function iosMail(spec: Spec): string {
  return [
    "Content-Type: text/plain;",
    "\tcharset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    `From: ${mailbox(spec.from, "utf-8")}`,
    "Mime-Version: 1.0 (1.0)",
    `Subject: ${word(spec.subject, "utf-8", "Q")}`,
    `Date: ${rfcDate(spec.date, 60)}`,
    `Message-Id: ${spec.id}`,
    ...(spec.parent === undefined ? [] : [`References: ${refs(spec).join(CRLF + " ")}`, `In-Reply-To: ${spec.parent.id}`]),
    ...(spec.cc === undefined ? [] : [`Cc: ${spec.cc.map((a) => mailbox(a, "utf-8")).join(", ")}`]),
    `To: ${spec.to.map((a) => mailbox(a, "utf-8")).join(", ")}`,
    "X-Mailer: iPhone Mail (22D82)",
    "",
    qp(spec.text, utf8),
    "",
  ].join(CRLF);
}

/** mutt with `send_charset="us-ascii:iso-8859-2:utf-8"`: 8-bit Latin-2, one encoded word per non-ASCII word. */
function mutt(spec: Spec): string {
  const subject = spec.subject
    .split(" ")
    .map((w) => word(w, "iso-8859-2", "Q", latin2))
    .join(" ");
  const head = [
    `Date: ${rfcDate(spec.date, 60)}`,
    `From: ${mailbox(spec.from, "iso-8859-2", latin2)}`,
    ...addressLines(spec, "iso-8859-2", latin2),
    `Subject: ${subject}`,
    `Message-ID: ${spec.id}`,
    ...threading(spec),
    `Mail-Followup-To: ${[...spec.to, spec.from].map((a) => a.address).join(", ")}`,
    "MIME-Version: 1.0",
  ];
  const text = latin2(spec.text.replace(/\n/g, CRLF));
  if (spec.attachment === undefined) {
    const header = [...head, "Content-Type: text/plain; charset=iso-8859-2", "Content-Disposition: inline", "Content-Transfer-Encoding: 8bit", "User-Agent: Mutt/2.2.12 (2023-09-09)", "", ""];
    return Buffer.concat([Buffer.from(header.join(CRLF), "latin1"), Buffer.from(text), Buffer.from(CRLF)]).toString("latin1");
  }
  const b = hexOf(spec.id, 16).replace(/^(.{4})/, "$1/");
  const a = spec.attachment;
  const parts = [
    ...head,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "Content-Disposition: inline",
    "User-Agent: Mutt/2.2.12 (2023-09-09)",
    "",
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=iso-8859-2",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: 8bit",
    "",
    "",
  ].join(CRLF);
  const tail = [
    "",
    "",
    `--${b}`,
    `Content-Type: ${a.type}; charset=us-ascii`,
    `Content-Disposition: attachment; filename="${a.name}"`,
    "",
    Buffer.from(a.bytes).toString("latin1").replace(/\r?\n/g, CRLF),
    `--${b}--`,
    "",
  ].join(CRLF);
  return Buffer.concat([Buffer.from(parts, "latin1"), Buffer.from(text), Buffer.from(tail, "latin1")]).toString("latin1");
}

function seznam(spec: Spec): string {
  const b = `=_${hexOf(spec.id, 24)}`;
  return [
    `Date: ${rfcDate(spec.date, 60, " (CET)")}`,
    `From: ${mailbox(spec.from, "utf-8")}`,
    `To: ${spec.to.map((a) => mailbox(a, "utf-8")).join(", ")}`,
    `Subject: ${word(spec.subject, "utf-8", "Q")}`,
    `Message-ID: ${spec.id}`,
    ...threading(spec),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${b}"`,
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(utf8(spec.text.replace(/\n/g, CRLF))),
    `--${b}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(utf8(html(spec.text))),
    `--${b}--`,
    "",
  ].join(CRLF);
}

/** A post to a Mailman 2.1 list: subject tag, list headers, and the footer as a separate part. */
function mailman(spec: Spec, inner: "thunderbird" | "mutt" | "apple-mail"): string {
  const b = `===============${hexOf(spec.id, 19).replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10))}==`;
  const agent = { thunderbird: "User-Agent: Mozilla Thunderbird", mutt: "User-Agent: Mutt/2.2.12 (2023-09-09)", "apple-mail": "X-Mailer: Apple Mail (2.3774.600.62)" }[inner];
  return [
    `From: ${mailbox(spec.from)}`,
    "To: dev-list@lists.example.org",
    `Subject: ${word("[dev-list] " + spec.subject, "UTF-8", "Q")}`,
    `Date: ${rfcDate(spec.date, 60)}`,
    `Message-ID: ${spec.id}`,
    ...threading(spec),
    agent,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "List-Id: Development of the project <dev-list.lists.example.org>",
    "List-Post: <mailto:dev-list@lists.example.org>",
    "Precedence: list",
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(spec.text, utf8),
    `--${b}`,
    'Content-Type: text/plain; charset="us-ascii"',
    "MIME-Version: 1.0",
    "Content-Transfer-Encoding: 7bit",
    "Content-Disposition: inline",
    "",
    "_______________________________________________",
    "dev-list mailing list",
    "dev-list@lists.example.org",
    `--${b}--`,
    "",
  ].join(CRLF);
}

function newsletter(spec: Spec): string {
  const body = `<!doctype html><html><head><title>${spec.subject}</title><style>p{margin:0 0 1em}</style></head><body>
<h1>March news</h1>
<p>Dear members,<br>the new season starts on <b>Saturday 21 March</b> &ndash; see you at the garden!</p>
<ul><li>Pruning workshop &amp; seed swap</li><li>Compost day</li></ul>
<p>Garden club&nbsp;committee</p>
</body></html>
`;
  return [
    `From: ${mailbox(spec.from)}`,
    `To: ${spec.to.map((a) => mailbox(a)).join(", ")}`,
    `Subject: ${spec.subject}`,
    `Date: ${rfcDate(spec.date, 0)}`,
    `Message-ID: ${spec.id}`,
    "MIME-Version: 1.0",
    "List-Unsubscribe: <https://news.example.org/unsubscribe>",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(utf8(body)),
    "",
  ].join(CRLF);
}

function emailSocial(spec: Spec): string {
  return serializeMessage(
    {
      from: spec.from,
      to: spec.to,
      ...(spec.cc === undefined ? {} : { cc: spec.cc }),
      subject: spec.subject,
      text: spec.text,
      ...(spec.parent === undefined ? {} : { inReplyTo: { messageId: spec.parent.id, references: spec.parent.references } }),
      ...(spec.receipts === true ? { es: { requestReceipts: ["delivered", "read"] as const } } : {}),
    },
    { date: spec.date, messageId: spec.id, includeEsPart: spec.es === true },
  );
}

// ---------------------------------------------------------------------------
// The script

const alice = DEMO_ACCOUNT;
const bob: EsAddress = { name: "Bob Svoboda", address: "bob@example.org" };
const jana: EsAddress = { name: "Jana Nováková", address: "jana@example.net" };
const anna: EsAddress = { name: "Anna Becker", address: "anna.becker@example.net" };
const camille: EsAddress = { name: "Camille Lefèvre", address: "camille@example.org" };
const julien: EsAddress = { name: "Julien Moreau", address: "julien@example.org" };
const karel: EsAddress = { name: "Karel Holub", address: "karel@example.org" };
const news: EsAddress = { name: "Garden Club", address: "news@news.example.org" };
const martin: EsAddress = { name: "Martin Horák", address: "martin.horak@example.net" };
const eva: EsAddress = { name: "Eva Malá", address: "eva@example.net" };
const list: EsAddress = { name: "", address: "dev-list@lists.example.org" };
const petr: EsAddress = { name: "Petr Novák", address: "petr.novak@example.org" };
const ondrej: EsAddress = { name: "Ondřej Beneš", address: "ondrej@host.example.com" };

const PDF = utf8("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const PATCH = utf8(
  "diff --git a/backup/rotate.sh b/backup/rotate.sh\n--- a/backup/rotate.sh\n+++ b/backup/rotate.sh\n@@ -1,3 +1,3 @@\n-KEEP=7\n+KEEP=14\n",
);

interface Step {
  key: string;
  style: DemoStyle;
  variant?: "in-reply-to" | "none" | "de" | "fr" | "thunderbird" | "mutt" | "apple-mail";
  seen?: boolean;
  from: EsAddress;
  to: EsAddress[];
  cc?: EsAddress[];
  subject: string;
  date: string;
  text: string;
  replyTo?: string;
  attachment?: Spec["attachment"];
  es?: boolean;
  receipts?: boolean;
}

const SCRIPT: Step[] = [
  // A: lunch, a group of three, started in Thunderbird.
  { key: "A1", style: "thunderbird", from: alice, to: [bob], cc: [jana], subject: "Oběd v pátek", date: "2026-03-02T08:15:42Z",
    text: "Ahoj Bobe,\n\nnechceš v pátek zajít na oběd? Myslela jsem, že bychom mohli zkusit to nové bistro na rohu u nádraží, prý tam mají výborné polední menu.\n\nAlice" },
  { key: "A2", style: "gmail", seen: true, from: bob, to: [alice], cc: [jana], subject: "Re: Oběd v pátek", date: "2026-03-02T09:02:17Z", replyTo: "A1",
    text: "Ahoj Alice,\n\nv pátek můžu, 12:30 je super. Zarezervuju stůl pro tři.\n\nBob" },
  { key: "A3", style: "ios-mail", seen: true, from: jana, to: [bob], cc: [alice], subject: "Re: Oběd v pátek", date: "2026-03-02T09:20:05Z", replyTo: "A2",
    text: "Jdu taky! 👍\n\nOdesláno z iPhonu" },
  { key: "A4", style: "email-social", from: alice, to: [bob, jana], subject: "Re: Oběd v pátek", date: "2026-03-02T09:45:00Z", replyTo: "A3",
    text: "Super, tak v pátek ve 12:30 u nádraží." },
  { key: "A5", style: "gmail", seen: false, from: bob, to: [alice], cc: [jana], subject: "Re: Oběd v pátek", date: "2026-03-02T10:05:00Z", replyTo: "A4",
    text: "Stůl je zarezervovaný na jméno Svoboda." },

  // B: German Outlook; its replies carry only In-Reply-To.
  { key: "B1", style: "outlook", variant: "de", seen: true, from: anna, to: [alice], subject: "Projektübersicht Q2", date: "2026-03-03T07:47:12Z",
    text: "Hallo Alice,\n\nanbei die Projektübersicht für das zweite Quartal. Bitte prüfe die Meilensteine bis Freitag.\n\nViele Grüße\nAnna" },
  { key: "B2", style: "email-social", from: alice, to: [anna], subject: "Re: Projektübersicht Q2", date: "2026-03-03T08:10:00Z", replyTo: "B1",
    text: "Hallo Anna, danke! Ich schaue es mir bis Donnerstag an." },
  { key: "B3", style: "outlook", variant: "in-reply-to", seen: true, from: anna, to: [alice], subject: "AW: Projektübersicht Q2", date: "2026-03-03T08:31:40Z", replyTo: "B2",
    text: "Danke, Alice. Meilenstein 2 ist der wichtigste.\n\nGruß\nAnna" },
  { key: "B4", style: "outlook", variant: "in-reply-to", seen: false, from: anna, to: [alice], subject: "AW: Projektübersicht Q2", date: "2026-03-06T13:02:00Z", replyTo: "B3",
    text: "Hallo Alice,\n\nhast du schon Zeit gehabt? Die Übersicht geht am Montag an die Geschäftsführung.\n\nAnna" },
  { key: "B5", style: "outlook", variant: "in-reply-to", seen: false, from: anna, to: [alice], subject: "AW: Projektübersicht Q2", date: "2026-03-06T13:30:00Z", replyTo: "B4",
    text: "Nachtrag: Meilenstein 3 verschiebt sich um eine Woche.\n\nAnna" },

  // C: French; Julien's Outlook reply has no threading headers at all.
  { key: "C1", style: "apple-mail", seen: true, from: camille, to: [alice], cc: [julien], subject: "Réunion de lundi", date: "2026-03-04T15:42:09Z",
    text: "Bonjour Alice,\n\nla réunion de lundi est déplacée à 14 h 30, salle B.\n\nBonne soirée,\nCamille" },
  { key: "C2", style: "outlook", variant: "none", seen: true, from: julien, to: [camille], cc: [alice], subject: "RE : Réunion de lundi", date: "2026-03-05T06:15:27Z",
    text: "Bonjour Camille,\n\nc'est noté, je serai là.\n\nJulien" },
  { key: "C3", style: "email-social", from: alice, to: [camille, julien], subject: "Re: Réunion de lundi", date: "2026-03-05T06:40:00Z", replyTo: "C2",
    text: "Merci, à lundi 14 h 30 !" },
  { key: "C4", style: "apple-mail", seen: true, from: camille, to: [alice, julien], subject: "Re: Réunion de lundi", date: "2026-03-05T07:00:00Z", replyTo: "C3",
    text: "Parfait, à lundi.\n\nCamille" },

  // D: both sides use Email Social; Karel asks for receipts.
  { key: "D1", style: "email-social", es: true, receipts: true, seen: true, from: karel, to: [alice], subject: "Kdy dorazíš?", date: "2026-03-18T08:00:00Z",
    text: "Ahoj Alice, kdy dorazíš v sobotu?" },
  { key: "D2", style: "email-social", es: true, receipts: true, from: alice, to: [karel], subject: "Re: Kdy dorazíš?", date: "2026-03-18T08:05:00Z", replyTo: "D1",
    text: "Kolem desáté, vlakem." },
  { key: "D3", style: "email-social", es: true, receipts: true, seen: true, from: karel, to: [alice], subject: "Re: Kdy dorazíš?", date: "2026-03-18T08:07:00Z", replyTo: "D2",
    text: "Super, vyzvednu tě na nádraží." },
  { key: "D4", style: "email-social", es: true, receipts: true, from: alice, to: [karel], subject: "Re: Kdy dorazíš?", date: "2026-03-19T16:30:00Z", replyTo: "D3",
    text: "Mám vzít něco s sebou?" },
  { key: "D5", style: "email-social", es: true, receipts: true, seen: true, from: karel, to: [alice], subject: "Re: Kdy dorazíš?", date: "2026-03-19T16:45:00Z", replyTo: "D4",
    text: "Jen dobrou náladu." },
  { key: "D6", style: "email-social", es: true, receipts: true, seen: false, from: karel, to: [alice], subject: "Re: Kdy dorazíš?", date: "2026-03-20T16:00:00Z", replyTo: "D5",
    text: "Vlak má zpoždění?" },
  { key: "D7", style: "email-social", es: true, receipts: true, seen: false, from: karel, to: [alice], subject: "Re: Kdy dorazíš?", date: "2026-03-20T16:30:00Z", replyTo: "D6",
    text: "Tak já čekám u vchodu." },
  { key: "D8", style: "email-social", es: true, receipts: true, seen: false, from: karel, to: [alice], subject: "Re: Kdy dorazíš?", date: "2026-03-20T17:00:00Z", replyTo: "D7",
    text: "Vidím tě! 🚆" },

  // E: an HTML-only newsletter.
  { key: "E1", style: "newsletter", seen: false, from: news, to: [alice], subject: "March news from the garden club", date: "2026-03-12T06:00:00Z", text: "" },

  // F: a Mailman list.
  { key: "F1", style: "mailman", variant: "thunderbird", seen: true, from: martin, to: [list], subject: "Release plan", date: "2026-03-13T07:00:00Z",
    text: "Hi all,\n\nI propose to release 1.4 on Friday. Objections?\n\nMartin" },
  { key: "F2", style: "mailman", variant: "mutt", seen: true, from: eva, to: [list], subject: "Re: Release plan", date: "2026-03-13T08:10:00Z", replyTo: "F1",
    text: "Fine with me, the migration notes are ready." },
  { key: "F3", style: "mailman", variant: "apple-mail", seen: false, from: martin, to: [list], subject: "Re: Release plan", date: "2026-03-13T09:48:22Z", replyTo: "F2",
    text: "Great. Alice, can you check the changelog?" },
  { key: "F4", style: "email-social", from: alice, to: [list], subject: "Re: [dev-list] Re: Release plan", date: "2026-03-13T10:30:00Z", replyTo: "F3",
    text: "Changelog checked, two typos fixed." },
  { key: "F5", style: "mailman", variant: "mutt", seen: false, from: eva, to: [list], subject: "Re: Release plan", date: "2026-03-13T11:02:00Z", replyTo: "F4",
    text: "Thanks Alice! Tagging tonight." },

  // G: Seznam.cz webmail.
  { key: "G1", style: "email-social", from: alice, to: [petr], subject: "Vyúčtování za březen", date: "2026-03-09T08:00:00Z",
    text: "Dobrý den, posílám vyúčtování za březen. Alice Dvořáková" },
  { key: "G2", style: "seznam", seen: true, from: petr, to: [alice], subject: "Re: Vyúčtování za březen", date: "2026-03-11T18:14:37Z", replyTo: "G1",
    text: "Dobrý den,\n\nděkuji, vše v pořádku. Platbu odešlu zítra.\n\nS pozdravem\nPetr Novák" },
  { key: "G3", style: "email-social", from: alice, to: [petr], subject: "Re: Vyúčtování za březen", date: "2026-03-11T19:00:00Z", replyTo: "G2",
    text: "Děkuji, na shledanou." },

  // H: mutt in ISO-8859-2, with a patch attached.
  { key: "H1", style: "email-social", from: alice, to: [ondrej], subject: "Zálohování serveru", date: "2026-03-10T07:00:00Z",
    text: "Ahoj Ondřeji, zálohy se nám nevejdou na disk. Nešlo by je rotovat?" },
  { key: "H2", style: "mutt", seen: true, from: ondrej, to: [alice], subject: "Re: Zálohování serveru", date: "2026-03-10T08:30:00Z", replyTo: "H1",
    text: "Ahoj Alice,\n\nmrknu na to večer, rotaci umím upravit.\n\nOndřej" },
  { key: "H3", style: "mutt", seen: true, from: ondrej, to: [alice], subject: "Re: Zálohování serveru", date: "2026-03-11T20:14:05Z", replyTo: "H2",
    text: "Posílám patch, drží čtrnáct záloh místo sedmi.\n\nOndřej", attachment: { name: "rotation.patch", type: "text/x-diff", bytes: PATCH } },
  { key: "H4", style: "mutt", seen: false, from: ondrej, to: [alice], subject: "Re: Zálohování serveru", date: "2026-03-15T09:00:00Z", replyTo: "H3",
    text: "Nasazeno, první rotace proběhla v noci bez chyb.\n\nOndřej" },

  // I: Gmail with PDF attachments.
  { key: "I1", style: "gmail", seen: true, from: bob, to: [alice], subject: "Návrh smlouvy", date: "2026-03-10T12:22:03Z",
    text: "Ahoj Alice,\n\nv příloze posílám návrh smlouvy k připomínkám.\n\nBob", attachment: { name: "Návrh smlouvy.pdf", type: "application/pdf", bytes: PDF } },
  { key: "I2", style: "email-social", from: alice, to: [bob], subject: "Re: Návrh smlouvy", date: "2026-03-10T13:00:00Z", replyTo: "I1",
    text: "Díky, projdu to do zítřka." },
  { key: "I3", style: "gmail", seen: true, from: bob, to: [alice], subject: "Re: Návrh smlouvy", date: "2026-03-10T14:10:00Z", replyTo: "I2",
    text: "Bez spěchu, stačí do pátku." },
  { key: "I4", style: "email-social", from: alice, to: [bob], subject: "Re: Návrh smlouvy", date: "2026-03-10T14:30:00Z", replyTo: "I3",
    text: "Mám dvě připomínky k článku 4, pošlu je zítra." },
  { key: "I5", style: "gmail", seen: true, from: bob, to: [alice], subject: "Re: Návrh smlouvy", date: "2026-03-16T08:00:00Z", replyTo: "I4",
    text: "Upravená verze je v příloze.\n\nBob", attachment: { name: "Návrh smlouvy v2.pdf", type: "application/pdf", bytes: PDF } },
];

function messageId(step: Step): string {
  const host = { gmail: "mail.example.com", outlook: "example.net", seznam: "email.example.net" }[step.style as string] ?? step.from.address.split("@")[1];
  return `<${step.key.toLowerCase()}.${hexOf(step.key, 12)}@${host}>`;
}

/** The 40 messages of the demo mailbox, in script order. */
export function buildDemoMailbox(): DemoMessage[] {
  const specs = new Map<string, Spec>();
  const out: DemoMessage[] = [];
  for (const step of SCRIPT) {
    const parent = step.replyTo === undefined ? undefined : specs.get(step.replyTo);
    const spec: Spec = {
      from: step.from,
      to: step.to,
      ...(step.cc === undefined ? {} : { cc: step.cc }),
      subject: step.subject,
      text: step.text,
      date: step.date,
      id: messageId(step),
      ...(parent === undefined ? {} : { parent: { id: parent.id, references: refs(parent) } }),
      ...(step.attachment === undefined ? {} : { attachment: step.attachment }),
      ...(step.es === undefined ? {} : { es: step.es }),
      ...(step.receipts === undefined ? {} : { receipts: step.receipts }),
    };
    specs.set(step.key, spec);
    const raw =
      step.style === "gmail" ? gmail(spec)
      : step.style === "thunderbird" ? thunderbird(spec)
      : step.style === "outlook" ? step.variant === "de" ? outlook(spec, "in-reply-to", "de-DE", "iso-8859-1")
        : step.variant === "in-reply-to" ? outlook(spec, "in-reply-to", "de-DE", "iso-8859-1")
        : outlook(spec, "none", "fr-FR", "windows-1252")
      : step.style === "apple-mail" ? appleMail(spec)
      : step.style === "ios-mail" ? iosMail(spec)
      : step.style === "mutt" ? mutt(spec)
      : step.style === "seznam" ? seznam(spec)
      : step.style === "mailman" ? mailman(spec, (step.variant ?? "thunderbird") as "thunderbird" | "mutt" | "apple-mail")
      : step.style === "newsletter" ? newsletter(spec)
      : emailSocial(spec);
    const mine = step.from.address === DEMO_ACCOUNT.address;
    out.push({
      conversation: step.key[0]!,
      style: step.style,
      folder: mine ? "sent" : "inbox",
      seen: mine || step.seen === true,
      name: `${step.key}-${step.style}.eml`,
      // mutt writes 8-bit ISO-8859-2 (its template returns one character per byte); the rest is ASCII or 8-bit UTF-8.
      raw: new Uint8Array(Buffer.from(raw, step.style === "mutt" ? "latin1" : "utf8")),
    });
  }
  return out;
}

/** Writes the demo mailbox as a maildir for MaildirAdapter (INBOX/, Sent/, flags files). */
export async function writeDemoMaildir(root: string): Promise<void> {
  const messages = buildDemoMailbox();
  for (const [folder, dir] of [["inbox", "INBOX"], ["sent", "Sent"]] as const) {
    await mkdir(join(root, dir), { recursive: true });
    const flags: Record<string, string[]> = {};
    for (const m of messages.filter((x) => x.folder === folder)) {
      await writeFile(join(root, dir, m.name), m.raw);
      if (m.seen) flags[m.name] = ["\\Seen"];
    }
    await writeFile(join(root, dir, ".email-social-flags.json"), JSON.stringify(flags, null, 2) + "\n");
  }
  await mkdir(join(root, "Outbox"), { recursive: true });
}
