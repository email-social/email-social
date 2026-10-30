/**
 * Multi-message test vectors: packages/es-core/vectors/multi/*.json, the
 * conformance suite for sections 7–9 of spec/es-protocol.md (threading,
 * contacts, chats, topics, unquoting, fragments, reply quotes, reply cards,
 * subject notes). Format in vectors/README.md.
 *
 *   npx vitest run test/vectors-multi.test.ts                         check
 *   ES_UPDATE_VECTORS=1 npx vitest run test/vectors-multi.test.ts     rewrite the
 *     files from test/helpers/multi-vectors.ts and the current code, then check
 *
 * Where es-core does not do what the spec says, the vector holds what the
 * spec says (`divergences`), and the check of that view is expected to fail.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByParticipants } from "../src/chats.js";
import { classifyMessage } from "../src/classify.js";
import { deriveContacts } from "../src/contacts.js";
import { canonicalAddress } from "../src/headers/canonical.js";
import { parseMessage } from "../src/parse.js";
import { splitQuoted, unquote, unquotedLines } from "../src/quotes.js";
import { quotedFragmentOf, replyCardOf } from "../src/reply-card.js";
import { quoteForReply } from "../src/reply-quote.js";
import { threadMessages } from "../src/threading/thread.js";
import { carrierSubject, subjectNoteOf, topicsOf } from "../src/topics.js";
import type { EsMessage } from "../src/types.js";
import { MULTI_SOURCES, type Owner, type ViewKey } from "./helpers/multi-vectors.js";

const MULTI_DIR = fileURLToPath(new URL("../vectors/multi/", import.meta.url));
const UPDATE = process.env.ES_UPDATE_VECTORS === "1";

/** The statements of sections 7–9 that no single-message vector exercises (independent/REPORT.md, "Missing coverage"). */
const STATEMENTS = ["TH-1", "TH-2", "TH-3", "TH-4", "TH-5", "TH-6", "CH-1", "CH-2", "CH-3", "TP-1", "TP-2", "TP-3", "TP-4", "QT-3", "QT-4", "QT-5", "QT-6", "QT-7"];

interface MultiVector {
  description: string;
  covers: string[];
  owner: Owner;
  messages: ({ raw: string } | { rawBase64: string })[];
  expected: Partial<Record<ViewKey, unknown>>;
  divergences?: { key: ViewKey; statement: string; note: string }[];
}

function bytesOf(message: MultiVector["messages"][number]): Uint8Array {
  if ("raw" in message) return new TextEncoder().encode(message.raw);
  return new Uint8Array(Buffer.from(message.rawBase64, "base64"));
}

/** The message a message answers: its first In-Reply-To id, else its last References id; never its own. */
function answeredId(message: EsMessage): string | null {
  const id = message.refs.inReplyTo[0] ?? message.refs.references[message.refs.references.length - 1] ?? null;
  return id === message.id ? null : id;
}

/** Every view of vectors/README.md, computed by es-core from the raw messages. */
function views(raws: readonly Uint8Array[], owner: Owner): Record<ViewKey, unknown> {
  const messages = raws.map((raw) => parseMessage(raw));
  const self = owner.addresses;
  const own = new Set(self.map(canonicalAddress));
  const held = new Map<string, EsMessage>();
  for (const message of messages) if (!held.has(message.id)) held.set(message.id, message);
  const unique = [...held.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lookup = (id: string): EsMessage | null => held.get(id) ?? null;

  const kinds: Record<string, string> = {};
  for (const message of unique) {
    kinds[message.id] = message.from !== null && own.has(canonicalAddress(message.from.address)) ? "person" : classifyMessage(message);
  }
  const chats = groupByParticipants(
    messages.filter((message) => kinds[message.id] === "person"),
    { self },
  );

  const topics: Record<string, unknown> = {};
  const carrierSubjects: Record<string, string> = {};
  const subjectNotes: Record<string, string | null> = {};
  const replyCards: Record<string, unknown> = {};
  for (const chat of chats) {
    const inChat = chat.messages.map((entry) => held.get(entry.id)!);
    const placed = topicsOf(inChat);
    topics[chat.id] = placed;
    carrierSubjects[chat.id] = carrierSubject({ name: owner.name, address: self[0]! }, chat.participants);
    const ids = new Set(inChat.map((message) => message.id));
    for (const message of inChat) {
      const where = placed.of[message.id];
      const topic = where === undefined ? undefined : placed.topics.find((t) => t.rootId === where.rootId);
      if (topic !== undefined) subjectNotes[message.id] = subjectNoteOf(message, topic);
      replyCards[message.id] = replyCardOf(message, lookup, { inChat: ids, self });
    }
  }

  const quotes: Record<string, unknown> = {};
  const fragments: Record<string, string | null> = {};
  const replyQuotes: Record<string, string> = {};
  for (const message of unique) {
    const { quoted } = splitQuoted(message);
    if (quoted !== "") quotes[message.id] = { quoted, lines: unquotedLines(quoted), text: unquote(quoted) };
    const parentId = answeredId(message);
    const parent = parentId === null ? null : lookup(parentId);
    if (parent !== null) fragments[message.id] = quotedFragmentOf(message, parent);
    replyQuotes[message.id] = quoteForReply(message, { maxLines: 5, timeZone: "UTC" });
  }

  return {
    conversations: threadMessages(messages),
    contacts: deriveContacts(messages),
    kinds,
    chats,
    topics,
    carrierSubjects,
    subjectNotes,
    quotes,
    fragments,
    replyCards,
    replyQuotes,
  };
}

if (UPDATE) {
  mkdirSync(MULTI_DIR, { recursive: true });
  for (const [name, source] of Object.entries(MULTI_SOURCES)) {
    const computed = views(
      source.messages.map((raw) => new TextEncoder().encode(raw)),
      source.owner,
    );
    const expected: Partial<Record<ViewKey, unknown>> = {};
    for (const key of source.keys) expected[key] = computed[key];
    for (const divergence of source.divergences ?? []) expected[divergence.key] = divergence.spec(computed[divergence.key]);
    const vector: MultiVector = {
      description: source.description,
      covers: source.covers,
      owner: source.owner,
      messages: source.messages.map((raw) => ({ raw })),
      expected,
      ...(source.divergences === undefined ? {} : { divergences: source.divergences.map(({ key, statement, note }) => ({ key, statement, note })) }),
    };
    writeFileSync(MULTI_DIR + name, JSON.stringify(vector, null, 2) + "\n");
  }
}

const files = readdirSync(MULTI_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const vectors = files.map((f) => [f, JSON.parse(readFileSync(MULTI_DIR + f, "utf8")) as MultiVector] as const);
const computedOf = new Map(vectors.map(([f, v]) => [f, views(v.messages.map(bytesOf), v.owner)]));

const diverging = (vector: MultiVector, key: string): boolean => (vector.divergences ?? []).some((d) => d.key === key);
const checks = vectors.flatMap(([f, v]) => Object.keys(v.expected).map((key) => [f, key as ViewKey, v] as const));

describe("multi-message vectors (vectors/multi/*.json)", () => {
  it("has one vector per source in test/helpers/multi-vectors.ts, with the same messages", () => {
    expect(files).toEqual(Object.keys(MULTI_SOURCES).sort());
    for (const [f, vector] of vectors) {
      const source = MULTI_SOURCES[f]!;
      expect(vector.messages, f).toEqual(source.messages.map((raw) => ({ raw })));
      expect(Object.keys(vector.expected).sort(), f).toEqual([...source.keys].sort());
      expect(vector.description.length, f).toBeGreaterThan(20);
    }
  });

  it("covers every statement of sections 7 to 9 that no single-message vector exercises", () => {
    const covered = new Set(vectors.flatMap(([, v]) => v.covers));
    expect(STATEMENTS.filter((id) => !covered.has(id))).toEqual([]);
  });

  it.each(checks.filter(([f, key, v]) => !diverging(v, key)))("%s: es-core gives the expected %s", (f, key, vector) => {
    expect(computedOf.get(f)![key]).toEqual(vector.expected[key]);
  });

  it.fails.each(checks.filter(([f, key, v]) => diverging(v, key)))("%s: es-core differs from the spec in %s (see divergences)", (f, key, vector) => {
    expect(computedOf.get(f)![key]).toEqual(vector.expected[key]);
  });

  it.each(vectors)("%s: does not depend on the order of the messages", (f, vector) => {
    const forward = computedOf.get(f)!;
    const raws = vector.messages.map(bytesOf);
    const rotated = [...raws.slice(1), ...raws.slice(0, 1)];
    for (const order of [[...raws].reverse(), rotated]) {
      const other = views(order, vector.owner);
      for (const key of Object.keys(vector.expected) as ViewKey[]) expect(other[key], `${f} ${key}`).toEqual(forward[key]);
    }
  });
});
