/**
 * The properties every input must satisfy. Each check returns a list of
 * problems (empty when the input passes), so one test can report every
 * failing case with what is needed to reproduce it.
 */
import { isDeepStrictEqual } from "node:util";
import {
  canonicalAddress,
  classifyMessage,
  extractPart,
  isInterleaved,
  isValidDid,
  normalizeSubject,
  parseMessage,
  quoteForReply,
  quotedFragmentOf,
  splitQuoted,
  threadMessages,
  unquotedLines,
} from "../../src/index.js";
import { formatEsJson, isRfc3339DateTime, parseEsJson } from "../../src/es/schema.js";
import { normalizeMessageId } from "../../src/headers/message-id.js";
import { parseMessageUnguarded } from "../../src/parse.js";
import type { EsMessage, EsPart } from "../../src/types.js";
import { limitMs } from "./config.js";
import { shuffle } from "../helpers/prng.js";

const describeError = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));

/** Non-blank lines (as `splitQuoted` sees them) with their counts. */
function lineCounts(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (line.trim() !== "") counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return counts;
}

/** splitQuoted keeps every non-blank line in exactly one of its three parts (and adds none). */
export function splitProblems(message: { text: string; es?: EsPart | null }): string[] {
  const split = splitQuoted(message);
  const before = lineCounts([message.text]);
  const after = lineCounts([split.fresh, split.quoted, split.signature]);
  if (isDeepStrictEqual(before, after)) return [];
  const diff: string[] = [];
  for (const [line, n] of new Map([...before, ...after])) {
    if ((before.get(line) ?? 0) !== (after.get(line) ?? 0)) diff.push(`${JSON.stringify(line.slice(0, 60))}: ${before.get(line) ?? 0} → ${after.get(line) ?? 0}`);
    if (diff.length >= 3) break;
    void n;
  }
  return [`splitQuoted lost or duplicated lines: ${diff.join("; ")}`];
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === "string";
const isMsgIdOrNull = (v: unknown): boolean => v === null || (isStr(v) && normalizeMessageId(v) === v);

/** The shape the spec (section 5.4 and the EsPart type) promises for a record that was read. */
export function esShapeProblems(es: EsPart): string[] {
  const p: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) p.push(`ES part: ${what}`);
  };
  check(es.author === null || (isStr(es.author) && isValidDid(es.author)), "author");
  check(isStr(es.via) && es.via.includes("@") && canonicalAddress(es.via) === es.via, "via");
  check(isStr(es.createdAt) && isRfc3339DateTime(es.createdAt), "createdAt");
  if (es.$type === "es.social.post") {
    check(isStrOrNull(es.text), "text");
    check(es.text !== null || es.email.textSha256 !== null, "text null without textSha256");
    const e = es.email;
    check(isMsgIdOrNull(e.messageId) && isMsgIdOrNull(e.inReplyTo) && isMsgIdOrNull(e.topicRoot), "email ids");
    check(isStrOrNull(e.subject) && isStrOrNull(e.topicLabel), "email strings");
    check(e.textSha256 === null || /^[0-9a-f]{64}$/.test(e.textSha256), "textSha256");
    check(Array.isArray(e.references) && e.references.every((r) => isMsgIdOrNull(r) && r !== null) && new Set(e.references).size === e.references.length, "references");
    check(
      e.replyTo === null ||
        (isMsgIdOrNull(e.replyTo.messageId) && isStr(e.replyTo.from.name) && isStr(e.replyTo.excerpt) && isStr(e.replyTo.from.address) && e.replyTo.from.address.includes("@")),
      "replyTo",
    );
    check(Array.isArray(es.requestReceipts) && isDeepStrictEqual(es.requestReceipts, ["delivered", "read"].filter((k) => (es.requestReceipts as string[]).includes(k))), "requestReceipts");
  } else if (es.$type === "es.social.receipt") {
    check(es.kind === "delivered" || es.kind === "read", "kind");
    check(isMsgIdOrNull(es.messageId) && es.messageId !== null, "messageId");
  } else {
    p.push(`ES part: unknown $type ${JSON.stringify((es as { $type: unknown }).$type)}`);
  }
  // Reading what es-core would write gives the same record back.
  if (p.length === 0 && !isDeepStrictEqual(parseEsJson(formatEsJson(es)), es)) p.push("ES part: does not survive formatEsJson → parseEsJson");
  return p;
}

/** The fields of an EsMessage have the types and invariants the type promises. */
function shapeProblems(m: EsMessage): string[] {
  const p: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) p.push(`shape: ${what}`);
  };
  check(isStr(m.id) && m.id.length > 0, "id");
  check(m.id === m.refs.messageId || (m.refs.messageId === null && /^sha256:[0-9a-f]{64}$/.test(m.id)), "id vs refs.messageId");
  check(m.from === null || (isStr(m.from.name) && m.from.address.includes("@")), "from");
  for (const list of [m.to, m.cc, m.replyTo]) check(Array.isArray(list) && list.every((a) => isStr(a.name) && a.address.includes("@")), "address list");
  check(m.date === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.date), "date");
  check(isStr(m.subject) && !/[\r\n]/.test(m.subject), "subject");
  check(isStr(m.text) && !m.text.includes("\r"), "text has CR");
  check((m.textSource === "none") === (m.text === "") && ["plain", "html", "none"].includes(m.textSource), "textSource");
  for (const a of m.attachments) {
    check(isStr(a.contentType) && (a.filename === null || isStr(a.filename)), "attachment strings");
    check(a.disposition === "inline" || a.disposition === "attachment", "attachment disposition");
    check(Number.isSafeInteger(a.size) && a.size >= 0, "attachment size");
    check(/^\d+(\.\d+)*$/.test(a.partId), "attachment partId");
  }
  check(new Set(m.attachments.map((a) => a.partId)).size === m.attachments.length, "duplicate partId");
  for (const ids of [m.refs.inReplyTo, m.refs.references]) check(ids.every((id) => normalizeMessageId(id) === id) && new Set(ids).size === ids.length, "refs");
  check(m.delivery.listHeaders.every(isStr), "delivery");
  if (m.es !== null) p.push(...esShapeProblems(m.es));
  return p;
}

/** At most this many attachments are re-extracted per message (each extraction parses the message again). */
const MAX_EXTRACT = 20;

/**
 * Every property of one raw message. `label` names the case (fixture,
 * mutator, round, seed) so a failure can be reproduced.
 */
export function checkMessage(raw: Uint8Array, label: string): { problems: string[]; message: EsMessage | null } {
  const problems: string[] = [];
  const started = performance.now();
  let unguarded: EsMessage | null = null;
  try {
    unguarded = parseMessageUnguarded(raw);
  } catch (e) {
    // es-core defines no parse error types: parseMessage is documented never to throw, so any exception is a defect.
    problems.push(`parseMessageUnguarded threw ${describeError(e)}`);
  }
  let m: EsMessage;
  try {
    m = parseMessage(raw);
  } catch (e) {
    return { problems: [`${label}: parseMessage threw ${describeError(e)}`], message: null };
  }
  if (unguarded !== null && !isDeepStrictEqual(unguarded, m)) problems.push("parseMessage and parseMessageUnguarded disagree");
  problems.push(...shapeProblems(m));
  try {
    problems.push(...splitProblems(m));
    isInterleaved(m);
    unquotedLines(splitQuoted(m).quoted);
    quoteForReply(m);
    quotedFragmentOf(m, m);
    normalizeSubject(m.subject);
    classifyMessage(m);
  } catch (e) {
    problems.push(`a reader of the parsed message threw ${describeError(e)}`);
  }
  const elapsed = performance.now() - started;
  if (elapsed > limitMs(raw.length)) problems.push(`took ${elapsed.toFixed(0)} ms for ${raw.length} bytes (limit ${limitMs(raw.length).toFixed(0)} ms)`);

  for (const a of m.attachments.slice(0, MAX_EXTRACT)) {
    const part = extractPart(raw, a.partId);
    if (part === null) problems.push(`attachment ${a.partId} listed but extractPart gives null`);
    else if (part.bytes.length !== a.size || part.contentType !== a.contentType) {
      problems.push(`attachment ${a.partId}: size ${a.size} / ${a.contentType}, extractPart gives ${part.bytes.length} / ${part.contentType}`);
    }
  }
  return { problems: problems.map((p) => `${label}: ${p}`), message: m };
}

/** The problems of `checkMessage` alone. */
export function messageProblems(raw: Uint8Array, label: string): string[] {
  return checkMessage(raw, label).problems;
}

/**
 * threadMessages puts each distinct id in exactly one conversation, and the
 * result does not depend on the order of its input.
 */
export function threadingProblems(messages: readonly EsMessage[], random: () => number, label: string): string[] {
  const problems: string[] = [];
  const started = performance.now();
  const conversations = threadMessages(messages);
  const elapsed = performance.now() - started;
  // 0.5 s plus 50 µs per message and per referenced id: linear threading needs a tenth of that.
  const idCount = messages.reduce((n, m) => n + 1 + m.refs.references.length + m.refs.inReplyTo.length, 0);
  if (elapsed > 500 + idCount / 20) problems.push(`threading ${messages.length} messages (${idCount} ids) took ${elapsed.toFixed(0)} ms`);
  const ids = conversations.flatMap((c) => c.messageIds);
  const distinct = new Set(messages.map((m) => m.id));
  if (ids.length !== distinct.size || new Set(ids).size !== ids.length) problems.push(`threading: ${ids.length} ids placed, ${distinct.size} distinct`);
  if (!isDeepStrictEqual(threadMessages(shuffle(messages, random)), conversations)) problems.push("threading depends on input order");
  return problems.map((p) => `${label}: ${p}`);
}
