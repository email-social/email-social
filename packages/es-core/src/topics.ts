/**
 * Topics: the threads inside one chat.
 *
 * Every chat has one implicit topic, and an Email Social user may name more.
 * A topic is identified by the Message-ID of its root message, never by the
 * subject text, and a message never moves between topics once placed: a
 * subject changed by an ordinary mail client moves nothing.
 *
 * Mail clients group differently (see spec/DEVIATIONS.md): Gmail and
 * Exchange by the normalized subject, Thunderbird by References only. The
 * one layout that keeps a single conversation everywhere is a stable
 * References chain and a byte-stable subject, "Re: " + the root's base
 * subject from the second message on; the carrier subject below is that
 * subject for a topic without a name.
 */

import { canonicalAddress } from "./headers/canonical.js";
import { normalizeSubject, subjectKey } from "./threading/subject.js";
import type { ChatTopics, EsAddress, EsMessage, Topic } from "./types.js";
import { collapse } from "./util/text.js";

/** What every carrier subject starts with (see `carrierSubject`). */
const CARRIER_PREFIX = "Message from ";

/** How many of the other people a group's carrier subject names before "+N". */
const CARRIER_NAMES = 3;

const nameOf = (person: Pick<EsAddress, "name" | "address">): string => {
  const name = collapse(person.name);
  return name !== "" ? name : person.address;
};

/**
 * The Subject of the first message Email Social sends into a chat whose
 * topic has no name: "Message from " + the sender's display name (the
 * address when the account has none). With more than one other person it
 * goes on with " to " + their display names (addresses when they have
 * none), sorted by canonical address, at most three and then " +N".
 * Exchange groups a conversation by the normalized subject alone, so a
 * subject naming only the sender would merge a 1:1 chat and a group chat
 * with the same people. It is written once and then inherited byte for
 * byte ("Re: " + it); it is never derived from the message text.
 */
export function carrierSubject(sender: Pick<EsAddress, "name" | "address">, others: readonly Pick<EsAddress, "name" | "address">[]): string {
  const from = CARRIER_PREFIX + nameOf(sender);
  const byAddress = new Map<string, Pick<EsAddress, "name" | "address">>();
  for (const person of others) {
    const address = canonicalAddress(person.address);
    if (!byAddress.has(address)) byAddress.set(address, { name: person.name, address });
  }
  if (byAddress.size <= 1) return from;
  const sorted = [...byAddress.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((address) => byAddress.get(address)!);
  const named = sorted.slice(0, CARRIER_NAMES).map(nameOf).join(", ");
  const rest = sorted.length - CARRIER_NAMES;
  return `${from} to ${named}${rest > 0 ? ` +${rest}` : ""}`;
}

/** Whether a base subject has the carrier form ("Message from …"). */
export function isCarrierBase(base: string): boolean {
  return base.startsWith(CARRIER_PREFIX) && base.length > CARRIER_PREFIX.length;
}

/** Whether `topicsOf`, `subjectNoteOf` and `replyCardOf` leave a message out: Auto-Submitted other than "no" (RFC 3834 §5). */
export function isAutomatic(message: Pick<EsMessage, "delivery">): boolean {
  const value = message.delivery.autoSubmitted;
  return value !== null && value !== "no";
}

/** The topic fields an Email Social post carries in `email` (spec: `topicRoot`, `topicLabel`), or nulls. */
function carried(message: EsMessage): { root: string | null; label: string | null } {
  if (message.es?.$type !== "es.social.post") return { root: null, label: null };
  const email = message.es.email as { topicRoot?: unknown; topicLabel?: unknown };
  const label = typeof email.topicLabel === "string" ? collapse(email.topicLabel) : "";
  return { root: typeof email.topicRoot === "string" ? email.topicRoot : null, label: label === "" ? null : label };
}

/**
 * Places every message of one chat in a topic. `messages` are the chat's
 * messages oldest first, as `groupByParticipants` orders them. Each message
 * goes, by the first rule that applies:
 *
 * 1. to the topic of the message its ES part names as `email.topicRoot`,
 *    when that message is earlier in the chat (a message naming itself is a
 *    root);
 * 2. to the topic of the message it answers: In-Reply-To, else the newest
 *    References id, that is earlier in the chat;
 * 3. with no parent in the chat, to the topic whose base subject equals its
 *    non-empty base subject (by `subjectKey`; Outlook replies without
 *    threading headers, DEVIATIONS D8), the newest such topic;
 * 4. with no parent in the chat, when it carries In-Reply-To or References,
 *    has a reply prefix, or has an empty base subject, to the topic of the
 *    previous message of the chat (a reply to something not held, a tagged
 *    or renamed reply, a "(no subject)" mail); the chat's first message is
 *    its own root;
 * 5. otherwise (a fresh mail: no threading headers, no reply prefix, a new
 *    base subject), it is the root of a new topic, whatever client wrote it.
 *
 * Messages with Auto-Submitted other than "no" are left out. Each id is
 * placed once. The result depends on nothing but `messages`.
 */
export function topicsOf(messages: readonly EsMessage[]): ChatTopics {
  const of: ChatTopics["of"] = {};
  const topics: Topic[] = [];
  const byRoot = new Map<string, { topic: Topic; root: EsMessage }>();
  let previous: string | null = null;

  const start = (message: EsMessage): string => {
    const topic: Topic = { rootId: message.id, label: null, base: normalizeSubject(message.subject).base, kind: "plain", count: 0 };
    topics.push(topic);
    byRoot.set(message.id, { topic, root: message });
    return message.id;
  };
  const placed = (id: string | undefined): id is string => id !== undefined && Object.hasOwn(of, id);

  const place = (message: EsMessage): string => {
    const { root } = carried(message);
    if (root === message.id) return start(message);
    if (root !== null && placed(root)) return of[root]!.rootId;

    const answered = message.refs.inReplyTo[0];
    if (answered !== message.id && placed(answered)) return of[answered]!.rootId;
    for (let i = message.refs.references.length - 1; i >= 0; i--) {
      const id = message.refs.references[i]!;
      if (id !== message.id && placed(id)) return of[id]!.rootId;
    }

    const subject = normalizeSubject(message.subject);
    if (subject.base !== "") {
      const key = subjectKey(subject.base);
      for (let i = topics.length - 1; i >= 0; i--) if (topics[i]!.base !== "" && subjectKey(topics[i]!.base) === key) return topics[i]!.rootId;
    }

    const threaded = [...message.refs.inReplyTo, ...message.refs.references].some((id) => id !== message.id);
    if (threaded || subject.isReply || subject.base === "") return previous ?? start(message);
    return start(message);
  };

  for (const message of messages) {
    if (isAutomatic(message) || Object.hasOwn(of, message.id)) continue;
    const rootId = place(message);
    of[message.id] = { rootId, topicStart: rootId !== previous };
    previous = rootId;
    const entry = byRoot.get(rootId)!;
    entry.topic.count++;
    const { label } = carried(message);
    if (entry.topic.label === null && label !== null) entry.topic.label = label;
  }

  for (const { topic, root } of byRoot.values()) {
    topic.kind = topic.label !== null ? "named" : root.es?.$type === "es.social.post" || isCarrierBase(topic.base) ? "carrier" : "plain";
  }
  return { topics, of };
}
