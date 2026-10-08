/**
 * Which message a message deliberately answers, for the quote card a
 * messenger shows above it.
 *
 * Every mail client quotes the whole message it answers by default, so a
 * quote alone says nothing about intent. A sender who wanted to answer one
 * point either uses Email Social (which records the target in its ES part)
 * or cuts the quote down to that point; `quotedFragmentOf` recognises the
 * second.
 */

import { canonicalAddress } from "./headers/canonical.js";
import { isInterleaved, splitQuoted, unquote, unquotedLines } from "./quotes.js";
import { isAutomatic } from "./topics.js";
import type { EsMessage, EsPostPart, EsReplyToCard, ReplyCard } from "./types.js";
import { collapse, excerpt } from "./util/text.js";

/** A quoted line, as in quotes.ts: ">" after at most three spaces or the U+FEFF iOS Mail writes. */
const QUOTE = /^[ \t\ufeff]{0,3}>/;

const nonBlank = (lines: readonly string[]): number => lines.filter((line) => line.trim() !== "").length;

/**
 * The fragment of `parent` that `message` quotes, when the sender singled one
 * out; null otherwise. With `s` the lines of the message's quote
 * (`unquotedLines`), `q` those lines collapsed into one, and `p` the parent's
 * fresh text without its own ">" lines, collapsed, the quote is a fragment
 * when all of these hold:
 *
 * - `q` is a part of `p` and not all of it (a default reply quotes it all);
 * - it is at most 3 non-empty lines;
 * - it is neither the start nor the end of `p` (a client that cuts a long
 *   quote keeps its start), unless the parent wrote at most 3 non-empty lines;
 * - the parent's text is not HTML reduced to text (the quote would have been
 *   made from a rendering we do not have);
 * - the reply is not interleaved (a point-by-point answer has a quote per
 *   point, none of them the target).
 *
 * Returns `q` cut to 140 characters at a word boundary. A pure function of
 * the two messages: dates and the order of messages play no part.
 */
export function quotedFragmentOf(message: Pick<EsMessage, "text" | "es" | "textSource">, parent: Pick<EsMessage, "text" | "es" | "textSource">): string | null {
  if (parent.textSource === "html" || isInterleaved(message)) return null;
  const s = unquotedLines(splitQuoted(message).quoted);
  const q = collapse(s.join(" "));
  if (q === "" || nonBlank(s) > 3) return null;
  const own = splitQuoted(parent)
    .fresh.split("\n")
    .filter((line) => !QUOTE.test(line));
  const p = collapse(own.join(" "));
  if (q === p || !p.includes(q)) return null;
  if ((p.startsWith(q) || p.endsWith(q)) && nonBlank(own) > 3) return null;
  return excerpt(q);
}

/** Options of `replyCardOf`. */
export interface ReplyCardOptions {
  /** EsMessage.id of every message of the chat being shown; only a target in it makes a card clickable, or a plain card at all. */
  inChat: ReadonlySet<string>;
  /** The account owner's address, or all of its addresses (aliases); compared in canonical form. */
  self: string | readonly string[];
}

/** The `email.replyTo` an Email Social post carries, when it has a usable sender address. */
function carriedReplyTo(es: EsPostPart): EsReplyToCard | null {
  const value = (es.email as { replyTo?: unknown }).replyTo as Partial<EsReplyToCard> | null | undefined;
  if (typeof value !== "object" || value === null || typeof value.from?.address !== "string" || value.from.address === "") return null;
  return {
    messageId: typeof value.messageId === "string" ? value.messageId : null,
    from: { name: typeof value.from.name === "string" ? value.from.name : "", address: value.from.address },
    excerpt: typeof value.excerpt === "string" ? value.excerpt : "",
  };
}

/** The Message-ID a message answers: the first In-Reply-To id, else the last References id (RFC 5322 §3.6.4); never its own. */
function answeredId(message: EsMessage): string | null {
  const id = message.refs.inReplyTo[0] ?? message.refs.references[message.refs.references.length - 1] ?? null;
  return id === null || id === message.id ? null : id;
}

/** Display name, else address, else "". */
function senderOf(message: Pick<EsMessage, "from">): string {
  const name = collapse(message.from?.name ?? "");
  return name !== "" ? name : (message.from?.address ?? "");
}

/**
 * The quote card above `message`, or null. A card appears only above a
 * deliberate reply, one that answers a specific message:
 *
 * - an Email Social post whose ES part carries `email.replyTo` always gets
 *   one, from the carried sender and excerpt, whether the target is held or
 *   not; it is clickable when the target is held and in `inChat`;
 * - an Email Social post without `email.replyTo` never gets one, whatever
 *   In-Reply-To says: it continues its topic;
 * - the owner's own message without an ES part (its Sent copy in a chat of
 *   plain e-mail, where Email Social quotes only on a deliberate reply) gets
 *   one when it quotes and its parent (In-Reply-To, else the last References
 *   id) is held and in `inChat`: the quoted fragment, else the start of the
 *   quote;
 * - anyone else's message without an ES part gets one when its parent is
 *   held, in `inChat`, and it quotes a fragment of it (`quotedFragmentOf`),
 *   never for the whole-message quote every client writes by default.
 *
 * Auto-Submitted messages get none. `lookup` finds held messages by
 * EsMessage.id, in any folder.
 */
export function replyCardOf(message: EsMessage, lookup: (messageId: string) => EsMessage | null | undefined, options: ReplyCardOptions): ReplyCard | null {
  if (isAutomatic(message)) return null;
  if (message.es !== null) {
    const carried = message.es.$type === "es.social.post" ? carriedReplyTo(message.es) : null;
    if (carried === null) return null;
    const target = carried.messageId === null ? null : (lookup(carried.messageId) ?? null);
    const name = collapse(carried.from.name);
    return {
      messageId: target?.id ?? null,
      from: name !== "" ? name : carried.from.address,
      excerpt: excerpt(carried.excerpt),
      attachment: target?.attachments[0]?.filename ?? null,
      clickable: target !== null && options.inChat.has(target.id),
    };
  }

  const parentId = answeredId(message);
  const parent = parentId === null ? null : (lookup(parentId) ?? null);
  if (parent === null || !options.inChat.has(parent.id)) return null;
  const fragment = quotedFragmentOf(message, parent);
  let text = fragment;
  if (text === null && isOwn(message, options.self)) {
    const quoted = splitQuoted(message).quoted;
    const start = quoted === "" ? "" : excerpt(unquote(quoted));
    text = start === "" ? null : start;
  }
  if (text === null) return null;
  return { messageId: parent.id, from: senderOf(parent), excerpt: text, attachment: parent.attachments[0]?.filename ?? null, clickable: true };
}

function isOwn(message: EsMessage, self: string | readonly string[]): boolean {
  if (message.from === null) return false;
  const owner = new Set((typeof self === "string" ? [self] : self).map(canonicalAddress));
  return owner.has(canonicalAddress(message.from.address));
}
