/**
 * Stories: newsletters and promotions, shown apart from chats, each for a
 * week (spec section "Stories").
 *
 * A message is a story when it carries an accepted es.social.story record,
 * or when its header fields say it is a newsletter: List-Unsubscribe is
 * present (RFC 2369 §3.2), List-Post is absent (a discussion list is not a
 * story), Auto-Submitted is absent or "no" (RFC 3834 §5: order
 * confirmations, password resets and other automated mail are not stories,
 * whatever unsubscribe field they carry), and the Return-Path is not the
 * null path (a bounce, RFC 5321 §4.5.5). Precedence: bulk alone is not
 * enough. The account owner's own messages are never stories.
 *
 * Everything comes from the parsed message: reading a story makes no
 * request to anyone, and storyOf reads no clock.
 */

import { canonicalAddress } from "./headers/canonical.js";
import { normalizeSubject } from "./threading/subject.js";
import type { EsDelivery, EsListUnsubscribe, EsMessage, EsStory, EsStoryPart, EsUnsubscribe } from "./types.js";
import { collapse, excerpt } from "./util/text.js";

/** How long a story is shown after its Date, in days of 24 hours. */
export const STORY_LIFETIME_DAYS = 7;

const LIFETIME_MS = STORY_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

/** The subject of the message a mailto unsubscribe sends when the URI gives none. */
const DEFAULT_UNSUBSCRIBE_SUBJECT = "unsubscribe";

/** Options of `storyOf`. */
export interface StoryOptions {
  /** The account owner's address, or all of its addresses (aliases); compared in canonical form. */
  self?: string | readonly string[];
}

/** Whether the header fields say "newsletter": List-Unsubscribe, no List-Post, not automated, not a bounce. */
function isNewsletter(delivery: EsDelivery): boolean {
  return (
    delivery.listUnsubscribe !== null &&
    !delivery.listHeaders.includes("list-post") &&
    (delivery.autoSubmitted === null || delivery.autoSubmitted === "no") &&
    delivery.returnPath !== ""
  );
}

/** Percent-decoding (RFC 3986 §2.1) that keeps malformed sequences as written. */
function percentDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** An addr-spec a client can send to: no white space or brackets, something before and after one last "@". */
function usableAddress(text: string): string | null {
  const address = canonicalAddress(text);
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1 || /[\s<>(),;:"\\[\]]/.test(address.slice(at)) || /[\s<>(),;]/.test(address)) return null;
  return address;
}

/** A mailto URI (RFC 6068): the first address and the subject; the body and other fields are ignored. */
function mailtoOf(uri: string): { mailto: string; subject: string } | null {
  const rest = uri.slice("mailto:".length);
  const question = rest.indexOf("?");
  const to = percentDecode(question < 0 ? rest : rest.slice(0, question)).split(",")[0] ?? "";
  const address = usableAddress(to);
  if (address === null) return null;
  let subject = "";
  if (question >= 0) {
    for (const field of rest.slice(question + 1).split("&")) {
      const eq = field.indexOf("=");
      if (eq > 0 && field.slice(0, eq).toLowerCase() === "subject") {
        // A line break or other control character in a header value could start another field: never let one through.
        subject = collapse(percentDecode(field.slice(eq + 1)).replace(/[\u0000-\u001f\u007f]/g, " "));
        break;
      }
    }
  }
  return { mailto: address, subject: subject === "" ? DEFAULT_UNSUBSCRIBE_SUBJECT : subject };
}

/**
 * From List-Unsubscribe and List-Unsubscribe-Post: one-click when RFC 8058
 * asks for it and an https URI is given (§3.1 requires https); else the
 * first usable mailto (sent by the client, no page to open); else the first
 * http or https URI as a page for the reader to open.
 */
function fromHeaders(header: EsListUnsubscribe | null): EsUnsubscribe | null {
  if (header === null) return null;
  const https = header.uris.find((uri) => /^https:\/\//i.test(uri));
  if (header.oneClick && https !== undefined) return { oneClick: https };
  for (const uri of header.uris) {
    if (!/^mailto:/i.test(uri)) continue;
    const mailto = mailtoOf("mailto:" + uri.slice("mailto:".length));
    if (mailto !== null) return mailto;
  }
  const page = header.uris.find((uri) => /^https?:\/\//i.test(uri));
  return page === undefined ? null : { link: page };
}

/** A record's `unsubscribe`: its address as a message, its url as a page (never a one-click request it did not declare). */
function fromRecord(record: EsStoryPart): EsUnsubscribe | null {
  const value = record.unsubscribe;
  if (value === null) return null;
  return "mailto" in value ? { mailto: value.mailto, subject: DEFAULT_UNSUBSCRIBE_SUBJECT } : { link: value.url };
}

/** The base subject (section 7.2), else the first non-blank line of the text, cut to 140 characters. */
function titleOf(message: Pick<EsMessage, "subject" | "text">): string {
  const base = normalizeSubject(message.subject).base;
  if (base !== "") return base;
  const line = message.text.split("\n").find((l) => l.trim() !== "") ?? "";
  return excerpt(line);
}

function instant(value: string): number {
  return Date.parse(value.toUpperCase());
}

/**
 * The story a message is, or null. Deterministic: built only from the
 * parsed message (and the owner's addresses), so the same message always
 * gives the same story. A message without From or Date is not a story: it
 * has no sender to show or no time to expire.
 */
export function storyOf(message: Pick<EsMessage, "from" | "date" | "subject" | "text" | "es" | "delivery">, options: StoryOptions = {}): EsStory | null {
  if (message.from === null || message.date === null) return null;
  const received = instant(message.date);
  if (Number.isNaN(received)) return null;
  const sender = canonicalAddress(message.from.address);
  const self = typeof options.self === "string" ? [options.self] : (options.self ?? []);
  if (self.some((address) => canonicalAddress(address) === sender)) return null;

  const record = message.es?.$type === "es.social.story" ? message.es : null;
  if (record === null && !isNewsletter(message.delivery)) return null;

  let expires = received + LIFETIME_MS;
  if (record?.expiresAt != null) {
    const until = instant(record.expiresAt);
    if (!Number.isNaN(until) && until < expires) expires = until;
  }
  return {
    sender: { name: collapse(message.from.name), address: sender },
    title: record !== null ? collapse(record.title) : titleOf(message),
    receivedAt: new Date(received).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    unsubscribe: fromHeaders(message.delivery.listUnsubscribe) ?? (record === null ? null : fromRecord(record)),
    explicit: record !== null,
  };
}
