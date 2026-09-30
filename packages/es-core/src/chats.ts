/**
 * Chats: messages grouped by the people in them, the way a messenger shows
 * them. A chat is the set of participants other than the account owner;
 * every message exchanged with exactly that set belongs to it, whatever its
 * subject or thread headers. `threadMessages` (by subject and references) is
 * a separate view and unchanged.
 */

import { deriveContacts } from "./contacts.js";
import { canonicalAddress } from "./headers/canonical.js";
import { normalizeSubject } from "./threading/subject.js";
import type { Chat, EsMessage } from "./types.js";
import { sha256Hex } from "./util/sha256.js";

/** Options of `groupByParticipants`. */
export interface GroupOptions {
  /** The account owner's address, or all of its addresses (aliases); compared in canonical form. */
  self: string | readonly string[];
}

interface Item {
  message: EsMessage;
  time: number | null;
  json: string;
}

/**
 * Groups messages into chats, newest chat first. The participants of a
 * message are the canonical addresses in From, To and Cc minus the owner's;
 * a message sent only to oneself belongs to the chat without participants.
 * The result does not depend on the order of the input, and each message id
 * is used once.
 */
export function groupByParticipants(messages: readonly EsMessage[], options: GroupOptions): Chat[] {
  const self = new Set((typeof options.self === "string" ? [options.self] : options.self).map(canonicalAddress));
  const byKey = new Map<string, { addresses: string[]; items: Item[] }>();
  for (const item of canonicalOrder(messages)) {
    const addresses = participantsOf(item.message, self);
    const key = addresses.join("\n");
    const chat = byKey.get(key);
    if (chat === undefined) byKey.set(key, { addresses, items: [item] });
    else chat.items.push(item);
  }

  const chats: Chat[] = [];
  for (const [key, { addresses, items }] of byKey) {
    const names = new Map(
      deriveContacts(
        items.map((item) => item.message),
        { exclude: [...self] },
      ).map((contact) => [contact.address, contact.name]),
    );
    const dated = items.filter((item) => item.time !== null);
    chats.push({
      id: "chat-" + sha256Hex(key).slice(0, 32),
      participants: addresses.map((address) => ({ name: names.get(address) ?? "", address })),
      messages: items.map((item) => ({ id: item.message.id, subject: normalizeSubject(item.message.subject).base })),
      firstDate: dated.length > 0 ? dated[0]!.message.date : null,
      lastDate: dated.length > 0 ? dated[dated.length - 1]!.message.date : null,
    });
  }
  return chats.sort((a, b) => compareNewestFirst(timeOf(a.lastDate), timeOf(b.lastDate)) || compareCodeUnits(a.id, b.id));
}

/** Canonical addresses in From, To and Cc except the owner's, deduplicated and sorted by code units. */
function participantsOf(message: EsMessage, self: ReadonlySet<string>): string[] {
  const set = new Set<string>();
  for (const mailbox of [...(message.from === null ? [] : [message.from]), ...message.to, ...message.cc]) {
    const address = canonicalAddress(mailbox.address);
    if (address !== "" && !self.has(address)) set.add(address);
  }
  return [...set].sort(compareCodeUnits);
}

/** Oldest first (undated last), then id, then content; the first copy of each id is kept. */
function canonicalOrder(messages: readonly EsMessage[]): Item[] {
  const items: Item[] = messages.map((message) => ({ message, time: timeOf(message.date), json: "" }));
  const json = (item: Item): string => (item.json ||= JSON.stringify(item.message));
  items.sort(
    (a, b) => compareOldestFirst(a.time, b.time) || compareCodeUnits(a.message.id, b.message.id) || compareCodeUnits(json(a), json(b)),
  );
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.message.id)) return false;
    seen.add(item.message.id);
    return true;
  });
}

/** Milliseconds of an ISO date, or null when absent or unparseable. */
function timeOf(date: string | null): number | null {
  if (date === null) return null;
  const time = Date.parse(date);
  return Number.isNaN(time) ? null : time;
}

function compareOldestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNewestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Plain UTF-16 code-unit order (locale-independent). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
