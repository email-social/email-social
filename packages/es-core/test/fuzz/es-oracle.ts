/**
 * An independent reading of spec/es-protocol.md section 5.4 ("Reading a
 * record"), written from the spec text and not from src/es/schema.ts, so
 * the fuzz test can compare the two. It shares only the helpers the spec
 * itself points to: canonical addresses (3.1), msg-id normalisation (3.2)
 * and did:es (3.3).
 */
import { canonicalAddress, isValidDid } from "../../src/index.js";
import { normalizeMessageId } from "../../src/headers/message-id.js";
import type { EsPart } from "../../src/types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" ? normalizeMessageId(v) : null);

/** Step 4: RFC 3339 §5.6 date-time, month 1–12, day 1–31, hour ≤ 23, minute ≤ 59, second ≤ 60, offset ≤ 23:59. */
export function specDateTime(s: string): boolean {
  const m = /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:[Zz]|[+-](\d\d):(\d\d))$/.exec(s);
  if (m === null) return false;
  const n = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const [, month, day, hour, minute, second, offH, offM] = n as [number, number, number, number, number, number, number, number];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 60 && offH <= 23 && offM <= 59;
}

/** Steps 3 and 5 (replyTo): a string whose canonical form contains "@". */
function address(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const a = canonicalAddress(v);
  return a.includes("@") ? a : null;
}

/** What section 5.4 says the reader returns for an already-parsed JSON value. */
export function specRead(root: unknown): EsPart | null {
  if (!isObj(root) || !isObj(root.value)) return null; // step 1
  const v = root.value;
  const author = typeof root.author === "string" && isValidDid(root.author) ? root.author : null; // step 2
  const via = address(v.via); // step 3
  if (via === null) return null;
  if (typeof v.createdAt !== "string" || !specDateTime(v.createdAt)) return null; // step 4
  const createdAt = v.createdAt;

  if (root.$type === "es.social.post") {
    const e: Obj = isObj(v.email) ? v.email : {};
    const references = Array.isArray(e.references) ? [...new Set(e.references.map(id).filter((ref) => ref !== null))] : [];
    const textSha256 = typeof e.textSha256 === "string" && /^[0-9a-fA-F]{64}$/.test(e.textSha256) ? e.textSha256.toLowerCase() : null;
    let replyTo = null;
    if (isObj(e.replyTo) && isObj(e.replyTo.from)) {
      const from = e.replyTo.from;
      const a = address(from.address);
      if (a !== null) replyTo = { messageId: id(e.replyTo.messageId), from: { name: str(from.name) ?? "", address: a }, excerpt: str(e.replyTo.excerpt) ?? "" };
    }
    let text: string | null;
    if (typeof v.text === "string") text = v.text;
    else if ((v.text === undefined || v.text === null) && textSha256 !== null) text = null;
    else return null;
    const rr = v.requestReceipts;
    return {
      $type: "es.social.post",
      author,
      text,
      via,
      createdAt,
      email: {
        messageId: id(e.messageId),
        subject: str(e.subject),
        inReplyTo: id(e.inReplyTo),
        references,
        textSha256,
        topicRoot: id(e.topicRoot),
        topicLabel: str(e.topicLabel),
        replyTo,
      },
      requestReceipts: Array.isArray(rr) ? (["delivered", "read"] as const).filter((k) => rr.includes(k)) : [],
    };
  }
  if (root.$type === "es.social.receipt") {
    const messageId = id(v.messageId);
    if ((v.kind !== "delivered" && v.kind !== "read") || messageId === null) return null; // step 6
    return { $type: "es.social.receipt", author, kind: v.kind, messageId, via, createdAt };
  }
  return null; // step 7
}
