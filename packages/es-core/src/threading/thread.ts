/**
 * Groups messages into conversations.
 *
 * 1. Reference trees from References and In-Reply-To (RFC 5322 §3.6.4), as in
 *    the JWZ algorithm and RFC 5256 §2.2 REFERENCES. Referenced messages that
 *    are not present stay in the tree as placeholders, so a conversation keeps
 *    the same root (and id) whether or not its first message is in the mailbox.
 * 2. Trees are merged by base subject (see `normalizeSubject`) when their
 *    participants overlap by containment, for replies sent without thread
 *    headers.
 * 3. Messages without a subject are grouped by identical participant sets.
 *
 * The result does not depend on the order of the input: messages are first
 * put in a canonical order, and every later step follows that order.
 */

import { deriveContacts } from "../contacts.js";
import { canonicalAddress } from "../headers/canonical.js";
import type { Conversation, EsMessage } from "../types.js";
import { sha256Hex } from "../util/sha256.js";
import { normalizeSubject, subjectKey } from "./subject.js";

/** A message with its parsed date. */
interface Item {
  message: EsMessage;
  time: number | null;
  json: string;
}

/** The messages of one reference tree. */
interface Group {
  rootId: string;
  items: Item[];
  /** Time of the earliest dated message, or null. */
  time: number | null;
  participants: Set<string>;
  key: string;
  prefixed: boolean;
}

interface Draft {
  rootId: string;
  key: string;
  hasUnprefixed: boolean;
  participants: Set<string>;
  items: Item[];
}

/** Groups messages into conversations, newest conversation first. */
export function threadMessages(messages: readonly EsMessage[]): Conversation[] {
  const items = canonicalOrder(messages);
  const parents = buildReferenceTrees(items);
  const groups = collectGroups(items, parents);

  const drafts: Draft[] = [];
  // Conversations by subject key, in creation order ("the first existing conversation" wins).
  const byKey = new Map<string, Draft[]>();
  for (const group of groups) {
    const candidates = byKey.get(group.key) ?? [];
    const target = candidates.find((draft) => fits(draft, group));
    if (target === undefined) {
      const draft: Draft = {
        rootId: group.rootId,
        key: group.key,
        hasUnprefixed: !group.prefixed,
        participants: new Set(group.participants),
        items: [...group.items],
      };
      drafts.push(draft);
      byKey.set(group.key, [...candidates, draft]);
      continue;
    }
    target.items.push(...group.items);
    for (const address of group.participants) target.participants.add(address);
    if (!group.prefixed) target.hasUnprefixed = true;
  }

  return drafts
    .map(toConversation)
    .sort((a, b) => compareNewestFirst(timeOf(a.lastDate), timeOf(b.lastDate)) || compareCodeUnits(a.id, b.id));
}

/**
 * Whether a group joins an existing conversation by subject (or, without a
 * subject, by participants). Participants alone never join conversations
 * that have a subject.
 */
function fits(draft: Draft, group: Group): boolean {
  if (draft.key !== group.key) return false;
  if (group.key === "") return sameSet(draft.participants, group.participants);
  if (!isSubset(draft.participants, group.participants) && !isSubset(group.participants, draft.participants)) return false;
  // Two separate originals with the same subject (e.g. a weekly report) stay apart.
  return group.prefixed || !draft.hasUnprefixed;
}

/**
 * Sorted by date (undated last), then id, then content; the first copy of each
 * id is kept.
 */
function canonicalOrder(messages: readonly EsMessage[]): Item[] {
  const items: Item[] = messages.map((message) => ({ message, time: timeOf(message.date), json: "" }));
  items.sort(compareItems);
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.message.id)) return false;
    seen.add(item.message.id);
    return true;
  });
}

function compareItems(a: Item, b: Item): number {
  return (
    compareOldestFirst(a.time, b.time) ||
    compareCodeUnits(a.message.id, b.message.id) ||
    compareCodeUnits((a.json ||= JSON.stringify(a.message)), (b.json ||= JSON.stringify(b.message)))
  );
}

/**
 * Parent links between message ids (JWZ algorithm, RFC 5256 §2.2). The chain
 * of a message is its References plus, when References does not end with it,
 * the first In-Reply-To id, which names the direct parent (RFC 5322 §3.6.4):
 * Outlook writes the thread root in References and the parent only in
 * In-Reply-To, and some clients truncate long References. The message's own
 * id is dropped from its chain (self-references). Consecutive chain ids are
 * linked unless the child already has a parent or the link would close a
 * loop; the message itself then hangs under the last chain id, replacing a
 * parent guessed from other messages. A message without a chain keeps a
 * guessed parent, as it would if it had been read before those messages.
 */
function buildReferenceTrees(items: readonly Item[]): Map<string, string> {
  const parents = new Map<string, string>();
  const isAncestorOrSelf = (candidate: string, id: string): boolean => {
    for (let current: string | undefined = id; current !== undefined; current = parents.get(current)) {
      if (current === candidate) return true;
    }
    return false;
  };

  for (const { message } of items) {
    const chain = message.refs.references.filter((id) => id !== "" && id !== message.id);
    const inReplyTo = message.refs.inReplyTo[0];
    if (inReplyTo !== undefined && inReplyTo !== "" && inReplyTo !== message.id && chain[chain.length - 1] !== inReplyTo) {
      chain.push(inReplyTo);
    }
    for (let i = 1; i < chain.length; i++) {
      const parent = chain[i - 1]!;
      const child = chain[i]!;
      if (!parents.has(child) && !isAncestorOrSelf(child, parent)) parents.set(child, parent);
    }
    const last = chain[chain.length - 1];
    if (last !== undefined && !isAncestorOrSelf(message.id, last)) parents.set(message.id, last);
  }
  return parents;
}

/** One group per reference tree that holds at least one message, in canonical group order. */
function collectGroups(items: readonly Item[], parents: ReadonlyMap<string, string>): Group[] {
  const byRoot = new Map<string, Item[]>();
  for (const item of items) {
    let root = item.message.id;
    for (let parent = parents.get(root); parent !== undefined; parent = parents.get(root)) root = parent;
    const list = byRoot.get(root);
    if (list === undefined) byRoot.set(root, [item]);
    else list.push(item);
  }

  const groups: Group[] = [];
  for (const [rootId, groupItems] of byRoot) {
    const first = groupItems[0]!;
    const subject = normalizeSubject(first.message.subject);
    groups.push({
      rootId,
      items: groupItems,
      time: first.time,
      participants: participantSet(groupItems),
      key: subjectKey(subject.base),
      prefixed: subject.isReply || subject.isForward,
    });
  }
  return groups.sort((a, b) => compareOldestFirst(a.time, b.time) || compareCodeUnits(a.rootId, b.rootId));
}

function participantSet(items: readonly Item[]): Set<string> {
  const set = new Set<string>();
  for (const { message } of items) {
    for (const mailbox of [...(message.from === null ? [] : [message.from]), ...message.to, ...message.cc]) {
      const address = canonicalAddress(mailbox.address);
      if (address !== "") set.add(address);
    }
  }
  return set;
}

function toConversation(draft: Draft): Conversation {
  const items = [...draft.items].sort(compareItems);
  const messages = items.map((item) => item.message);
  const dated = items.filter((item) => item.time !== null);
  let subject = "";
  for (const message of messages) {
    const base = normalizeSubject(message.subject).base;
    if (base !== "") {
      subject = base;
      break;
    }
  }
  return {
    id: "conv-" + sha256Hex(draft.rootId).slice(0, 32),
    rootMessageId: draft.rootId,
    subject,
    participants: deriveContacts(messages)
      .map((contact) => ({ name: contact.name, address: contact.address }))
      .sort((a, b) => compareCodeUnits(a.address, b.address)),
    messageIds: messages.map((message) => message.id),
    firstDate: dated.length > 0 ? dated[0]!.message.date : null,
    lastDate: dated.length > 0 ? dated[dated.length - 1]!.message.date : null,
  };
}

/** Milliseconds of an ISO date, or null when absent or unparseable. */
function timeOf(date: string | null): number | null {
  if (date === null) return null;
  const time = Date.parse(date);
  return Number.isNaN(time) ? null : time;
}

/** Earlier first; null (undated) after every date. */
function compareOldestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Later first; null (undated) after every date. */
function compareNewestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function isSubset(small: ReadonlySet<string>, large: ReadonlySet<string>): boolean {
  if (small.size > large.size) return false;
  for (const value of small) if (!large.has(value)) return false;
  return true;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && isSubset(a, b);
}

/** Plain UTF-16 code-unit order (locale-independent). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
