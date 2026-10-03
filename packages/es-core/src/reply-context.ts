/**
 * The context a messenger shows above a message, as a small quote card:
 * the message it answers (who wrote it, how it began, its attachment) when
 * that message is held, otherwise the subject, when the message starts a new
 * one in its chat or answers something that is not held. Inside a chat the
 * subject is only a thread identifier, so it appears nowhere else.
 */

import { splitQuoted } from "./quotes.js";
import { normalizeSubject, subjectKey } from "./threading/subject.js";
import type { EsMessage, ReplyContext } from "./types.js";

/** Options of `replyContextOf`. */
export interface ReplyContextOptions {
  /** The message before this one in its chat (oldest first); omitted or null for the first. */
  previous?: Pick<EsMessage, "subject"> | null;
}

/** The longest excerpt, in characters (UTF-16 code units), "…" included. */
const EXCERPT_MAX = 140;

/**
 * The first two non-blank lines of a text, white space collapsed, cut at a
 * word boundary with "…" so the result is at most 140 characters.
 */
function excerptOf(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, 2);
  const joined = lines.join(" ");
  if (joined.length <= EXCERPT_MAX) return joined;
  const room = joined.slice(0, EXCERPT_MAX - 1);
  const space = room.lastIndexOf(" ");
  return (space > 0 ? room.slice(0, space) : room).trimEnd() + "…";
}

/** The Message-ID this message answers: the first In-Reply-To id, else the last References id. */
function answeredId(message: EsMessage): string | null {
  const id = message.refs.inReplyTo[0] ?? message.refs.references[message.refs.references.length - 1] ?? null;
  return id === null || id === message.id ? null : id;
}

/**
 * The quote card of a message.
 *
 * - `parent` when the message answers (In-Reply-To, else the last
 *   References id; RFC 5322 §3.6.4) a message `lookup` returns: the parent's
 *   sender (display name, else address), the first two lines of what the
 *   parent's sender wrote (`splitQuoted`, so never what the parent quoted),
 *   and the name of its first attachment.
 * - `subject` when the message answers a message that is not held, or
 *   starts a new base subject in its chat (`options.previous`; the first
 *   message of a chat starts one): the base subject, without Re:/Fwd: and
 *   list tags. Never for an empty subject.
 * - null otherwise: the same subject as the previous message, nothing answered.
 */
export function replyContextOf(message: EsMessage, lookup: (messageId: string) => EsMessage | null | undefined, options: ReplyContextOptions = {}): ReplyContext | null {
  const answered = answeredId(message);
  const parent = answered === null ? null : (lookup(answered) ?? null);
  if (parent !== null) {
    const name = parent.from?.name.trim() ?? "";
    return {
      kind: "parent",
      messageId: parent.id,
      from: name !== "" ? name : (parent.from?.address ?? ""),
      excerpt: excerptOf(splitQuoted(parent).fresh),
      attachment: parent.attachments[0]?.filename ?? null,
    };
  }
  const subject = normalizeSubject(message.subject).base;
  if (subject === "") return null;
  const previous = options.previous ?? null;
  const changed = previous === null || subjectKey(normalizeSubject(previous.subject).base) !== subjectKey(subject);
  return answered !== null || changed ? { kind: "subject", subject } : null;
}
