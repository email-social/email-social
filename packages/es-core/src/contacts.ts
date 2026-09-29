/**
 * Contacts derived from the addresses seen in messages: who appears in
 * From, To and Cc, under which names, how often and how recently.
 */

import { canonicalAddress } from "./headers/canonical.js";
import type { Contact, EsAddress, EsMessage } from "./types.js";

/** Options of `deriveContacts`. */
export interface DeriveContactsOptions {
  /** Addresses to leave out (e.g. the user's own); compared in canonical form. */
  exclude?: readonly string[];
}

interface Entry {
  address: string;
  fromName: string;
  otherName: string;
  names: string[];
  lastSeen: string | null;
  lastTime: number | null;
  count: number;
}

/**
 * One contact per canonical address found in From, To or Cc.
 *
 * Identity is `canonicalAddress`: the domain is lowercased, the local part is
 * kept as written. RFC 5321 §2.4 makes the local part case-sensitive and
 * leaves its interpretation to the receiving host, so "Alice@example.com" and
 * "alice@example.com" may be different mailboxes; folding them could merge
 * two people, while not folding them at worst lists one person twice.
 *
 * Messages are deduplicated by id and read from oldest to newest (undated
 * messages count as the oldest), so "most recent" is well defined and the
 * result does not depend on the order of the input.
 */
export function deriveContacts(messages: readonly EsMessage[], options: DeriveContactsOptions = {}): Contact[] {
  const exclude = new Set((options.exclude ?? []).map(canonicalAddress));
  const entries = new Map<string, Entry>();

  for (const message of oldestFirst(messages)) {
    const time = timeOf(message.date);
    const inMessage = new Map<string, string[]>();
    const visit = (mailbox: EsAddress, isFrom: boolean): void => {
      const address = canonicalAddress(mailbox.address);
      if (address === "" || exclude.has(address)) return;
      let entry = entries.get(address);
      if (entry === undefined) {
        entry = { address, fromName: "", otherName: "", names: [], lastSeen: null, lastTime: null, count: 0 };
        entries.set(address, entry);
      }
      let names = inMessage.get(address);
      if (names === undefined) {
        names = [];
        inMessage.set(address, names);
        entry.count++;
        if (time !== null && (entry.lastTime === null || time > entry.lastTime)) {
          entry.lastTime = time;
          entry.lastSeen = message.date;
        }
      }
      const name = displayName(mailbox.name, address);
      if (name === "") return;
      if (isFrom) entry.fromName = name;
      else entry.otherName = name;
      if (!names.includes(name)) names.push(name);
    };
    if (message.from !== null) visit(message.from, true);
    for (const mailbox of message.to) visit(mailbox, false);
    for (const mailbox of message.cc) visit(mailbox, false);

    // This message's names (From first) become the most recent ones.
    for (const [address, names] of inMessage) {
      if (names.length === 0) continue;
      const entry = entries.get(address)!;
      entry.names = [...names, ...entry.names.filter((name) => !names.includes(name))];
    }
  }

  return [...entries.values()]
    .sort((a, b) => compareTimesNewestFirst(a.lastTime, b.lastTime) || compareCodeUnits(a.address, b.address))
    .map((entry) => ({
      address: entry.address,
      name: entry.fromName !== "" ? entry.fromName : entry.otherName,
      names: entry.names,
      lastSeen: entry.lastSeen,
      count: entry.count,
    }));
}

/**
 * A display name worth showing, or "" for none. Outlook writes recipients
 * taken from its address cache with single quotes inside the display name
 * ("'Anna Becker'" <anna@example.net>); those quotes are removed. A name that
 * only repeats the address carries no information and is dropped.
 */
function displayName(name: string, address: string): string {
  let text = name.replace(/\s+/g, " ").trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1).trim();
  if (text.toLowerCase() === address.toLowerCase()) return "";
  return text;
}

/** Deduplicated by id, undated first, then by date, id and content (so duplicates resolve the same way every time). */
function oldestFirst(messages: readonly EsMessage[]): EsMessage[] {
  const keyed = messages.map((message) => ({ message, time: timeOf(message.date), json: "" }));
  const json = (item: (typeof keyed)[number]): string => (item.json ||= JSON.stringify(item.message));
  keyed.sort((a, b) => {
    const byTime = a.time === b.time ? 0 : a.time === null ? -1 : b.time === null ? 1 : a.time - b.time;
    return byTime || compareCodeUnits(a.message.id, b.message.id) || compareCodeUnits(json(a), json(b));
  });
  const seen = new Set<string>();
  const out: EsMessage[] = [];
  for (const { message } of keyed) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    out.push(message);
  }
  return out;
}

/** Milliseconds of an ISO date, or null when absent or unparseable. */
function timeOf(date: string | null): number | null {
  if (date === null) return null;
  const time = Date.parse(date);
  return Number.isNaN(time) ? null : time;
}

function compareTimesNewestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Plain UTF-16 code-unit order (locale-independent). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
