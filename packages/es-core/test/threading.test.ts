import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { threadMessages } from "../src/threading/thread.js";
import type { Conversation, EsMessage } from "../src/types.js";
import { mid, msg, t } from "./helpers/messages.js";
import { mulberry32, shuffle } from "./helpers/prng.js";

const ALICE = "Alice Example <alice@example.com>";
const BOB = "Bob Svoboda <bob@example.org>";
const JANA = "Jana Nováková <jana@example.net>";
const CAROL = "Carol <carol@example.com>";
const DAVE = "Dave <dave@example.org>";

/** Expected conversation id, computed independently with node:crypto. */
const convId = (root: string): string => "conv-" + createHash("sha256").update(root, "utf8").digest("hex").slice(0, 32);

/** Message ids per conversation, in output order. */
const idsOf = (conversations: Conversation[]): string[][] => conversations.map((c) => c.messageIds);

/** Runs threadMessages on the input and on 5 seeded shuffles, checks they agree, returns the result. */
function thread(messages: EsMessage[]): Conversation[] {
  const result = threadMessages(messages);
  const random = mulberry32(0x5eed);
  for (let i = 0; i < 5; i++) expect(threadMessages(shuffle(messages, random))).toEqual(result);
  return result;
}

describe("threading by References and In-Reply-To (RFC 5322 §3.6.4, RFC 5256 REFERENCES)", () => {
  it("groups a reply chain with full References", () => {
    const a = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "Lunch" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(10), subject: "Re: Lunch", references: [mid("a")], inReplyTo: mid("a") });
    const c = msg({ id: mid("c"), from: ALICE, to: BOB, cc: JANA, date: t(20), subject: "Re: Re: Lunch", references: [mid("a"), mid("b")], inReplyTo: mid("b") });
    const [conv, ...rest] = thread([c, a, b]);
    expect(rest).toEqual([]);
    expect(conv).toEqual({
      id: convId(mid("a")),
      rootMessageId: mid("a"),
      subject: "Lunch",
      participants: [
        { name: "Alice Example", address: "alice@example.com" },
        { name: "Bob Svoboda", address: "bob@example.org" },
        { name: "Jana Nováková", address: "jana@example.net" },
      ],
      messageIds: [mid("a"), mid("b"), mid("c")],
      firstDate: t(0),
      lastDate: t(20),
    });
  });

  it("threads a reply that has only In-Reply-To (Outlook), whatever its subject and participants", () => {
    const a = msg({ id: mid("a"), from: "Anna Becker <anna@example.net>", to: "Lukas Weber <lukas@example.net>", date: t(0), subject: "Projektübersicht Q2" });
    const b = msg({ id: mid("b"), from: "Lukas Weber <lukas@example.net>", to: CAROL, date: t(5), subject: "Something else", inReplyTo: mid("a") });
    expect(idsOf(thread([a, b]))).toEqual([[mid("a"), mid("b")]]);
  });

  it("appends In-Reply-To to References that do not end with it (Outlook writes the root in References, the parent in In-Reply-To)", () => {
    // The original is not in the mailbox; p is present and has no headers of its own.
    const p = msg({ id: mid("p"), from: ALICE, to: BOB, date: t(0), subject: "Faktura za únor" });
    const x = msg({ id: mid("x"), from: BOB, to: CAROL, date: t(5), subject: "Odp: Jiné téma", references: [mid("root")], inReplyTo: mid("p") });
    const [conv, ...rest] = thread([p, x]);
    expect(rest).toEqual([]);
    expect(conv!.messageIds).toEqual([mid("p"), mid("x")]);
    expect(conv!.rootMessageId).toBe(mid("root"));
  });

  it("uses References when In-Reply-To is its last element (no duplicate link)", () => {
    const a = msg({ id: mid("a"), date: t(0), subject: "A", from: ALICE, to: BOB });
    const b = msg({ id: mid("b"), date: t(1), subject: "B", from: CAROL, to: DAVE, references: [mid("a")], inReplyTo: mid("a") });
    expect(idsOf(thread([a, b]))).toEqual([[mid("a"), mid("b")]]);
  });

  it("keeps phantom roots: the root id is the same with and without the original message", () => {
    const original = msg({ id: mid("root"), from: ALICE, to: BOB, date: t(0), subject: "Release plan" });
    const r1 = msg({ id: mid("r1"), from: BOB, to: ALICE, date: t(10), subject: "Re: Release plan", references: [mid("root")] });
    const r2 = msg({ id: mid("r2"), from: ALICE, to: BOB, date: t(20), subject: "Re: Release plan", references: [mid("root"), mid("r1")] });
    const without = thread([r2, r1]);
    const withOriginal = thread([r2, original, r1]);
    expect(without).toHaveLength(1);
    expect(withOriginal).toHaveLength(1);
    expect(without[0]!.rootMessageId).toBe(mid("root"));
    expect(withOriginal[0]!.rootMessageId).toBe(mid("root"));
    expect(without[0]!.id).toBe(withOriginal[0]!.id);
    expect(without[0]!.id).toBe(convId(mid("root")));
  });

  it("keeps the root when only a middle message's References are known", () => {
    // r2 lists the whole chain; r1 is missing, root is missing.
    const r2 = msg({ id: mid("r2"), date: t(20), subject: "Re: X", references: [mid("root"), mid("r1")] });
    const r3 = msg({ id: mid("r3"), date: t(30), subject: "Re: X", references: [mid("r1")], inReplyTo: mid("r1") });
    const [conv, ...rest] = thread([r3, r2]);
    expect(rest).toEqual([]);
    expect(conv!.rootMessageId).toBe(mid("root"));
  });

  it("joins two trees when a later message's References connect them", () => {
    const x = msg({ id: mid("x"), date: t(0), subject: "One", from: ALICE, to: BOB, references: [mid("a")] });
    const y = msg({ id: mid("y"), date: t(1), subject: "Two", from: CAROL, to: DAVE, references: [mid("b")] });
    expect(thread([x, y])).toHaveLength(2);
    const z = msg({ id: mid("z"), date: t(2), subject: "Three", from: JANA, to: ALICE, references: [mid("a"), mid("b")] });
    const joined = thread([x, y, z]);
    expect(idsOf(joined)).toEqual([[mid("x"), mid("y"), mid("z")]]);
    expect(joined[0]!.rootMessageId).toBe(mid("a"));
  });

  it("lets a message's own References override a parent guessed from another message", () => {
    // g arrives first (clock skew) and claims p is m's parent; m itself says q.
    const g = msg({ id: mid("g"), date: t(0), subject: "Re: Plan", references: [mid("p"), mid("m")] });
    const m = msg({ id: mid("m"), date: t(5), subject: "Re: Plan", references: [mid("q")] });
    expect(thread([g, m])[0]!.rootMessageId).toBe(mid("q"));
    // Same result when m is the earlier one.
    const m2 = { ...m, date: t(-5) };
    expect(thread([g, m2])[0]!.rootMessageId).toBe(mid("q"));
  });

  it("keeps a guessed parent when the message itself has no References (same result in either date order)", () => {
    const g = msg({ id: mid("g"), date: t(0), subject: "Alpha", references: [mid("p"), mid("m")] });
    const m = msg({ id: mid("m"), date: t(5), subject: "Beta" });
    expect(thread([g, m]).map((c) => c.rootMessageId)).toEqual([mid("p")]);
    expect(thread([g, { ...m, date: t(-5) }]).map((c) => c.rootMessageId)).toEqual([mid("p")]);
  });
});

describe("threading: broken headers", () => {
  it("survives a two-message reference loop", () => {
    const a = msg({ id: mid("a"), date: t(0), subject: "Loop", references: [mid("b")] });
    const b = msg({ id: mid("b"), date: t(1), subject: "Loop", references: [mid("a")] });
    const result = thread([a, b]);
    expect(idsOf(result)).toEqual([[mid("a"), mid("b")]]);
  });

  it("survives a three-message loop and a loop inside one References header", () => {
    const a = msg({ id: mid("a"), date: t(0), subject: "One", references: [mid("c")] });
    const b = msg({ id: mid("b"), date: t(1), subject: "Two", references: [mid("a")] });
    const c = msg({ id: mid("c"), date: t(2), subject: "Three", references: [mid("b")] });
    const d = msg({ id: mid("d"), date: t(3), subject: "Four", references: [mid("e"), mid("f"), mid("e")] });
    expect(idsOf(thread([a, b, c, d]))).toEqual([[mid("d")], [mid("a"), mid("b"), mid("c")]]);
  });

  it("ignores self-references", () => {
    const a = msg({ id: mid("a"), date: t(0), subject: "Me", references: [mid("a")], inReplyTo: mid("a") });
    const b = msg({ id: mid("b"), date: t(1), subject: "Other", references: [mid("b"), mid("a")] });
    const [conv, ...rest] = thread([a, b]);
    expect(rest).toEqual([]);
    expect(conv!.rootMessageId).toBe(mid("a"));
    expect(conv!.messageIds).toEqual([mid("a"), mid("b")]);
  });

  it("keeps one copy of a message that appears twice (e.g. Inbox and Sent)", () => {
    const a = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "Hello" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Re: Hello", references: [mid("a")] });
    const [conv, ...rest] = thread([a, b, { ...a }, { ...b }]);
    expect(rest).toEqual([]);
    expect(conv!.messageIds).toEqual([mid("a"), mid("b")]);
  });

  it("chooses the same copy of a duplicate id whatever the input order", () => {
    const a1 = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "First copy" });
    const a2 = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "Second copy" });
    const one = thread([a1, a2]);
    expect(one).toEqual(thread([a2, a1]));
    expect(one[0]!.messageIds).toEqual([mid("a")]);
    // The earlier copy wins when the dates differ.
    const late = { ...a2, date: t(30) };
    expect(thread([late, a1])[0]!.subject).toBe("First copy");
  });

  it("threads messages without a Message-ID by their sha256 ids", () => {
    const h1 = "sha256:" + "1".repeat(64);
    const h2 = "sha256:" + "2".repeat(64);
    const m1 = msg({ id: h1, from: ALICE, to: BOB, date: t(0), subject: "Minutes" });
    const m2 = msg({ id: h2, from: CAROL, to: DAVE, date: t(1), subject: "Agenda" });
    const result = thread([m1, m2]);
    expect(result.map((c) => [c.id, c.rootMessageId, c.messageIds])).toEqual([
      [convId(h2), h2, [h2]],
      [convId(h1), h1, [h1]],
    ]);
  });

  it("returns no conversations for no messages", () => {
    expect(threadMessages([])).toEqual([]);
  });
});

describe("threading: subject fallback", () => {
  it("merges a reply without thread headers into the original (Outlook fr \"RE :\")", () => {
    const original = msg({ id: mid("o"), from: "Camille <camille@example.org>", to: "Julien <julien@example.org>", cc: "Amélie <amelie@example.org>", date: t(0), subject: "Réunion de lundi" });
    const reply = msg({ id: mid("r"), from: "Julien <julien@example.org>", to: "Camille <camille@example.org>", cc: "Amélie <amelie@example.org>", date: t(30), subject: "RE : Réunion de lundi" });
    const [conv, ...rest] = thread([reply, original]);
    expect(rest).toEqual([]);
    expect(conv!.messageIds).toEqual([mid("o"), mid("r")]);
    expect(conv!.rootMessageId).toBe(mid("o"));
    expect(conv!.subject).toBe("Réunion de lundi");
  });

  it("merges localized prefixes, list tags and case differences of the same subject", () => {
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(0), subject: "Projektübersicht Q2" });
    const r1 = msg({ id: mid("r1"), from: BOB, to: ALICE, date: t(1), subject: "AW: PROJEKTÜBERSICHT Q2" });
    const r2 = msg({ id: mid("r2"), from: ALICE, to: BOB, date: t(2), subject: "Odp: AW: Projektübersicht Q2" });
    const f = msg({ id: mid("f"), from: BOB, to: ALICE, date: t(3), subject: "[team] WG: Projektübersicht Q2" });
    expect(idsOf(thread([f, r2, original, r1]))).toEqual([[mid("o"), mid("r1"), mid("r2"), mid("f")]]);
  });

  it("merges when participants grow (reply-all with a new Cc) or shrink (reply to one)", () => {
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(0), subject: "Budget" });
    const grow = msg({ id: mid("g"), from: BOB, to: ALICE, cc: JANA, date: t(1), subject: "Re: Budget" });
    const shrink = msg({ id: mid("s"), from: JANA, to: ALICE, date: t(2), subject: "Re: Budget" });
    expect(idsOf(thread([original, grow, shrink]))).toEqual([[mid("o"), mid("g"), mid("s")]]);
  });

  it("does not merge the same subject between unrelated people (participant containment guard)", () => {
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(0), subject: "Lunch" });
    const stranger = msg({ id: mid("s"), from: CAROL, to: DAVE, date: t(1), subject: "Re: Lunch" });
    const overlap = msg({ id: mid("v"), from: ALICE, to: CAROL, date: t(2), subject: "Re: Lunch" });
    expect(idsOf(thread([original, stranger, overlap]))).toEqual([[mid("v")], [mid("s")], [mid("o")]]);
  });

  it("keeps two unprefixed originals with the same subject apart", () => {
    const week1 = msg({ id: mid("w1"), from: ALICE, to: BOB, date: t(0), subject: "Weekly report" });
    const week2 = msg({ id: mid("w2"), from: ALICE, to: BOB, date: t(7 * 24 * 60), subject: "Weekly report" });
    expect(idsOf(thread([week1, week2]))).toEqual([[mid("w2")], [mid("w1")]]);
  });

  it("merges a later header-less reply into the earliest matching conversation", () => {
    const week1 = msg({ id: mid("w1"), from: ALICE, to: BOB, date: t(0), subject: "Weekly report" });
    const week2 = msg({ id: mid("w2"), from: ALICE, to: BOB, date: t(100), subject: "Weekly report" });
    const reply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(200), subject: "Re: Weekly report" });
    expect(idsOf(thread([week1, week2, reply]))).toEqual([[mid("w1"), mid("r")], [mid("w2")]]);
  });

  it("merges an original into a conversation that only holds replies (clock-skewed reply before the original)", () => {
    const reply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(0), subject: "Re: Lunch" });
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(3), subject: "Lunch" });
    const [conv, ...rest] = thread([original, reply]);
    expect(rest).toEqual([]);
    expect(conv!.messageIds).toEqual([mid("r"), mid("o")]);
    // The id comes from the earliest group, which is the reply's.
    expect(conv!.rootMessageId).toBe(mid("r"));
    expect(conv!.subject).toBe("Lunch");
  });

  it("keeps the References root when a reply is clock-skewed before its original", () => {
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(10), subject: "Lunch" });
    const reply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(0), subject: "Re: Lunch", references: [mid("o")] });
    const [conv, ...rest] = thread([original, reply]);
    expect(rest).toEqual([]);
    expect(conv!.rootMessageId).toBe(mid("o"));
    expect(conv!.messageIds).toEqual([mid("r"), mid("o")]);
  });

  it("merges a reply group with a phantom root into the original found by subject", () => {
    const original = msg({ id: mid("o"), from: ALICE, to: BOB, date: t(0), subject: "Trip" });
    // Reply whose References point to a message id the original does not have (e.g. rewritten by a list).
    const reply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Trip", references: [mid("other")] });
    const [conv, ...rest] = thread([reply, original]);
    expect(rest).toEqual([]);
    expect(conv!.rootMessageId).toBe(mid("o"));
  });

  it("does not merge two reference trees that both start with an unprefixed original", () => {
    const a = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "Status" });
    const ar = msg({ id: mid("ar"), from: BOB, to: ALICE, date: t(1), subject: "Re: Status", references: [mid("a")] });
    const b = msg({ id: mid("b"), from: ALICE, to: BOB, date: t(2), subject: "Status" });
    const br = msg({ id: mid("br"), from: BOB, to: ALICE, date: t(3), subject: "Re: Status", references: [mid("b")] });
    expect(idsOf(thread([a, ar, b, br]))).toEqual([[mid("b"), mid("br")], [mid("a"), mid("ar")]]);
  });

  it("takes the group's subject from its earliest message", () => {
    // The group starts with "Lunch" and a later reply in it changed the subject; "Re: New topic" elsewhere must not join it.
    const a = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "Lunch" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "New topic", references: [mid("a")] });
    const c = msg({ id: mid("c"), from: ALICE, to: BOB, date: t(2), subject: "Re: New topic" });
    expect(idsOf(thread([a, b, c]))).toEqual([[mid("c")], [mid("a"), mid("b")]]);
  });
});

describe("threading: empty subjects and participants", () => {
  it("groups empty-subject messages between exactly the same people (chat-like)", () => {
    const m1 = msg({ id: mid("m1"), from: ALICE, to: BOB, date: t(0), subject: "" });
    const m2 = msg({ id: mid("m2"), from: BOB, to: ALICE, date: t(1), subject: "" });
    const m3 = msg({ id: mid("m3"), from: ALICE, to: "BOB <bob@EXAMPLE.org>", date: t(2), subject: "Re:" });
    expect(idsOf(thread([m3, m1, m2]))).toEqual([[mid("m1"), mid("m2"), mid("m3")]]);
  });

  it("keeps empty-subject messages apart when the participant sets differ, even as a superset", () => {
    const m1 = msg({ id: mid("m1"), from: ALICE, to: BOB, date: t(0) });
    const m2 = msg({ id: mid("m2"), from: ALICE, to: [BOB, JANA], date: t(1) });
    const m3 = msg({ id: mid("m3"), from: CAROL, to: BOB, date: t(2) });
    expect(idsOf(thread([m1, m2, m3]))).toEqual([[mid("m3")], [mid("m2")], [mid("m1")]]);
  });

  it("never merges conversations that have different subjects because of the participants", () => {
    const lunch = msg({ id: mid("l"), from: ALICE, to: BOB, date: t(0), subject: "Lunch" });
    const budget = msg({ id: mid("b"), from: ALICE, to: BOB, date: t(1), subject: "Budget" });
    const empty = msg({ id: mid("e"), from: ALICE, to: BOB, date: t(2), subject: "" });
    expect(idsOf(thread([lunch, budget, empty]))).toEqual([[mid("e")], [mid("b")], [mid("l")]]);
  });

  it("canonicalises participant domains but not local parts", () => {
    const m1 = msg({ id: mid("m1"), from: "Alice <Alice@EXAMPLE.com>", to: "bob@example.org", date: t(0), subject: "Hi" });
    const m2 = msg({ id: mid("m2"), from: "bob@example.org", to: "Alice <Alice@example.com>", cc: "alice@example.com", date: t(1), subject: "Re: Hi", references: [mid("m1")] });
    expect(thread([m1, m2])[0]!.participants).toEqual([
      { name: "Alice", address: "Alice@example.com" },
      { name: "", address: "alice@example.com" },
      { name: "", address: "bob@example.org" },
    ]);
  });

  it("names participants with their most recent From name, else a To/Cc name", () => {
    const m1 = msg({ id: mid("m1"), from: "Bob <bob@example.org>", to: "Ali <alice@example.com>", date: t(0), subject: "Hi" });
    const m2 = msg({ id: mid("m2"), from: "Bob S. <bob@example.org>", to: "Alice E. <alice@example.com>", cc: "Jana <jana@example.net>", date: t(1), subject: "Re: Hi", references: [mid("m1")] });
    const m3 = msg({ id: mid("m3"), from: "alice@example.com", to: "Robert <bob@example.org>", date: t(2), subject: "Re: Hi", references: [mid("m1"), mid("m2")] });
    expect(thread([m1, m2, m3])[0]!.participants).toEqual([
      { name: "Alice E.", address: "alice@example.com" },
      { name: "Bob S.", address: "bob@example.org" },
      { name: "Jana", address: "jana@example.net" },
    ]);
  });

  it("takes the subject from the earliest message with a non-empty base subject", () => {
    const a = msg({ id: mid("a"), from: ALICE, to: BOB, date: t(0), subject: "" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Re: Now with a SUBJECT", references: [mid("a")] });
    const c = msg({ id: mid("c"), from: ALICE, to: BOB, date: t(2), subject: "Changed", references: [mid("a"), mid("b")] });
    expect(thread([a, b, c])[0]!.subject).toBe("Now with a SUBJECT");
    expect(thread([a])[0]!.subject).toBe("");
  });
});

describe("threading: order and dates", () => {
  it("orders conversations by last date, newest first, undated last, then by id", () => {
    const old = msg({ id: mid("old"), from: ALICE, to: BOB, date: t(0), subject: "Old" });
    const oldReply = msg({ id: mid("old-r"), from: BOB, to: ALICE, date: t(500), subject: "Re: Old", references: [mid("old")] });
    const mid1 = msg({ id: mid("mid"), from: ALICE, to: BOB, date: t(100), subject: "Middle" });
    const undated1 = msg({ id: mid("u1"), from: ALICE, to: BOB, subject: "Undated one" });
    const undated2 = msg({ id: mid("u2"), from: ALICE, to: BOB, subject: "Undated two" });
    const result = thread([undated2, mid1, old, undated1, oldReply]);
    expect(result.map((c) => c.subject)).toEqual([
      "Old",
      "Middle",
      ...[
        { id: convId(mid("u1")), subject: "Undated one" },
        { id: convId(mid("u2")), subject: "Undated two" },
      ]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((x) => x.subject),
    ]);
    expect(result[0]!.messageIds).toEqual([mid("old"), mid("old-r")]);
  });

  it("orders messages chronologically, undated messages last, ties by id", () => {
    const a = msg({ id: mid("a"), date: t(5), subject: "S", references: [mid("root")] });
    const b = msg({ id: mid("b"), date: t(1), subject: "S", references: [mid("root")] });
    const c = msg({ id: mid("c"), date: null, subject: "S", references: [mid("root")] });
    const d = msg({ id: mid("d"), date: t(1), subject: "S", references: [mid("root")] });
    const [conv] = thread([a, c, d, b]);
    expect(conv!.messageIds).toEqual([mid("b"), mid("d"), mid("a"), mid("c")]);
    expect(conv!.firstDate).toBe(t(1));
    expect(conv!.lastDate).toBe(t(5));
  });

  it("compares dates as instants and treats an unparseable date as missing", () => {
    const a = msg({ id: mid("a"), date: "2026-03-02T10:00:00+01:00", subject: "S", references: [mid("root")] });
    const b = msg({ id: mid("b"), date: "2026-03-02T09:30:00.000Z", subject: "S", references: [mid("root")] });
    const c = msg({ id: mid("c"), date: "not a date", subject: "S", references: [mid("root")] });
    const [conv] = thread([c, b, a]);
    expect(conv!.messageIds).toEqual([mid("a"), mid("b"), mid("c")]);
    expect(conv!.firstDate).toBe("2026-03-02T10:00:00+01:00");
    expect(conv!.lastDate).toBe("2026-03-02T09:30:00.000Z");
  });

  it("gives null dates to a conversation of undated messages", () => {
    const [conv] = thread([msg({ id: mid("u"), from: ALICE, to: BOB, subject: "Draft" })]);
    expect(conv!.firstDate).toBeNull();
    expect(conv!.lastDate).toBeNull();
  });
});

describe("threading: determinism and identifiers", () => {
  it("derives the conversation id from the root Message-ID (checked against node:crypto)", () => {
    const [conv] = threadMessages([msg({ id: "<3f2a9c1e-6b4d-4e8a-9f1c-2d7e5b8a0c34@example.com>", date: t(0), subject: "Oběd v pátek" })]);
    expect(conv!.id).toBe(convId("<3f2a9c1e-6b4d-4e8a-9f1c-2d7e5b8a0c34@example.com>"));
    expect(conv!.id).toMatch(/^conv-[0-9a-f]{32}$/);
    expect(convId("<a@example.com>")).toBe("conv-" + createHash("sha256").update("<a@example.com>").digest("hex").slice(0, 32));
  });

  /** A small mailbox with every tricky case at once. */
  function mailbox(): EsMessage[] {
    const people = [ALICE, BOB, JANA, CAROL, DAVE];
    const out: EsMessage[] = [];
    // A long References chain with the root missing.
    for (let i = 1; i <= 6; i++) {
      const refs = [mid("chain-0"), ...Array.from({ length: i - 1 }, (_, k) => mid(`chain-${k + 1}`))];
      out.push(msg({ id: mid(`chain-${i}`), from: people[i % 2]!, to: people[(i + 1) % 2]!, date: t(i * 10), subject: "Re: Chain", references: refs }));
    }
    // Header-less replies merged by subject; two originals kept apart.
    out.push(msg({ id: mid("lunch-1"), from: ALICE, to: JANA, date: t(3), subject: "Lunch" }));
    out.push(msg({ id: mid("lunch-2"), from: ALICE, to: JANA, date: t(4), subject: "Lunch" }));
    out.push(msg({ id: mid("lunch-r"), from: JANA, to: ALICE, date: t(5), subject: "Odp: Lunch" }));
    // A loop and a self-reference.
    out.push(msg({ id: mid("loop-a"), date: t(7), subject: "Loop", references: [mid("loop-b")] }));
    out.push(msg({ id: mid("loop-b"), date: t(8), subject: "Loop", references: [mid("loop-a")] }));
    out.push(msg({ id: mid("self"), date: t(9), subject: "Self", references: [mid("self")] }));
    // Duplicates, identical dates, undated and id-less messages.
    out.push(msg({ id: mid("dup"), from: CAROL, to: DAVE, date: t(2), subject: "Dup" }));
    out.push(msg({ id: mid("dup"), from: CAROL, to: DAVE, date: t(2), subject: "Dup (copy)" }));
    out.push(msg({ id: mid("same-1"), from: CAROL, to: DAVE, date: t(2), subject: "" }));
    out.push(msg({ id: mid("same-2"), from: DAVE, to: CAROL, date: t(2), subject: "" }));
    out.push(msg({ id: mid("undated"), from: BOB, to: CAROL, subject: "No date" }));
    out.push(msg({ id: "sha256:" + "ab".repeat(32), from: BOB, to: CAROL, date: t(1), subject: "No id" }));
    return out;
  }

  it("gives the same output for 20 seeded shuffles of the input", () => {
    const messages = mailbox();
    const expected = threadMessages(messages);
    const random = mulberry32(20260928);
    for (let i = 0; i < 20; i++) expect(threadMessages(shuffle(messages, random))).toEqual(expected);
    // Two conversations end at t(2); they are ordered by conversation id.
    const tied: [string, string[]][] = [
      [convId(mid("dup")), [mid("dup")]],
      [convId(mid("same-1")), [mid("same-1"), mid("same-2")]],
    ];
    tied.sort((x, y) => (x[0] < y[0] ? -1 : 1));
    expect(expected.map((c) => c.messageIds)).toEqual([
      [1, 2, 3, 4, 5, 6].map((i) => mid(`chain-${i}`)),
      [mid("self")],
      [mid("loop-a"), mid("loop-b")],
      [mid("lunch-1"), mid("lunch-r")],
      [mid("lunch-2")],
      ...tied.map((x) => x[1]),
      ["sha256:" + "ab".repeat(32)],
      [mid("undated")],
    ]);
    expect(expected[0]!.rootMessageId).toBe(mid("chain-0"));
  });

  it("gives the same output on repeated calls and does not modify the input", () => {
    const messages = mailbox();
    const before = JSON.stringify(messages);
    const first = threadMessages(messages);
    expect(threadMessages(messages)).toEqual(first);
    expect(JSON.stringify(messages)).toBe(before);
  });
});
