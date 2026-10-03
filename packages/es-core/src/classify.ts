/**
 * Tells mail a person wrote from mail sent to a list or by a program, using
 * header fields only (never the text). Lists and automated mail are not
 * chats: a client shows them apart ("Other mail").
 */

import { canonicalAddress, splitAddress } from "./headers/canonical.js";
import type { EsMessage, MessageKind } from "./types.js";

/** Local parts of sending addresses that no person reads replies to (compared case-insensitively). */
const AUTOMATED_LOCAL = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster)(?:[-+_.].*)?$/i;

/**
 * "list" when the message carries any RFC 2369 / RFC 2919 List-* field or
 * Precedence: list; otherwise "automated" when Auto-Submitted is anything
 * but "no" (RFC 3834 §5), Precedence is bulk or junk, the Return-Path is the
 * null path "<>" (bounces, RFC 5321 §4.5.5), or the From local part is
 * no-reply, noreply, do-not-reply, mailer-daemon or postmaster (also with a
 * suffix such as "noreply+billing"); otherwise "person".
 */
export function classifyMessage(message: Pick<EsMessage, "from" | "delivery">): MessageKind {
  const { listHeaders, autoSubmitted, precedence, returnPath } = message.delivery;
  if (listHeaders.length > 0 || precedence === "list") return "list";
  if (autoSubmitted !== null && autoSubmitted !== "no") return "automated";
  if (precedence === "bulk" || precedence === "junk") return "automated";
  if (returnPath === "") return "automated";
  const from = message.from === null ? null : splitAddress(canonicalAddress(message.from.address));
  if (from !== null && AUTOMATED_LOCAL.test(from.local)) return "automated";
  return "person";
}
