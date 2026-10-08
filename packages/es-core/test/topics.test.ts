/**
 * Topics: the threads inside one chat (topicsOf), and the carrier subject
 * Email Social writes when a topic has no name (carrierSubject).
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { normalizeSubject, subjectKey } from "../src/threading/subject.js";
import { carrierSubject, subjectNoteOf, topicsOf } from "../src/topics.js";
import type { EsMessage } from "../src/types.js";
import { readFixture } from "./helpers/fixtures.js";
import { mid, msg, t } from "./helpers/messages.js";

const ALICE = "Alice Dvořáková <alice@example.com>";
const BOB = "Bob Svoboda <bob@example.org>";

/** `message` as an Email Social post carrying the given topic fields in its ES part. */
function es(message: EsMessage, email: { topicRoot?: string | null; topicLabel?: string | null } = {}): EsMessage {
  const meta = { messageId: message.refs.messageId, subject: message.subject, inReplyTo: message.refs.inReplyTo[0] ?? null, references: message.refs.references, textSha256: null, topicRoot: null, topicLabel: null, replyTo: null, ...email };
  return { ...message, es: { $type: "es.social.post", author: null, text: message.text, via: message.from!.address, createdAt: message.date!, email: meta, requestReceipts: [] } };
}

/** Root id of each message, by EsMessage.id. */
const roots = (messages: EsMessage[]): Record<string, string> => Object.fromEntries(Object.entries(topicsOf(messages).of).map(([id, placed]) => [id, placed.rootId]));

describe("carrierSubject", () => {
  it("names the sender in a chat with one other person", () => {
    expect(carrierSubject({ name: "Alice Dvořáková", address: "alice@example.com" }, [{ name: "Bob Svoboda", address: "bob@example.org" }])).toBe("Message from Alice Dvořáková");
  });

  it("uses the address when the account has no display name, and collapses white space in names", () => {
    expect(carrierSubject({ name: "", address: "alice@example.com" }, [{ name: "Bob", address: "bob@example.org" }])).toBe("Message from alice@example.com");
    expect(carrierSubject({ name: "  Alice   D. ", address: "alice@example.com" }, [])).toBe("Message from Alice D.");
  });

  it("names the others of a group, sorted by address, at most three and then +N, so a 1:1 chat and a group never share a subject", () => {
    const me = { name: "Alice", address: "alice@example.com" };
    const others = [
      { name: "Zoe", address: "zoe@example.net" },
      { name: "", address: "carol@example.org" },
      { name: "Bob", address: "bob@example.org" },
      { name: "Dan", address: "dan@Example.ORG" },
      { name: "Eve", address: "eve@example.com" },
    ];
    expect(carrierSubject(me, others.slice(0, 2))).toBe("Message from Alice to carol@example.org, Zoe");
    expect(carrierSubject(me, others.slice(0, 3))).toBe("Message from Alice to Bob, carol@example.org, Zoe");
    expect(carrierSubject(me, others)).toBe("Message from Alice to Bob, carol@example.org, Dan +2");
    expect(carrierSubject(me, [others[2]!])).not.toBe(carrierSubject(me, others.slice(1, 3)));
  });
});

describe("topicsOf: placing each message", () => {
  it("rule 1: the ES part's topicRoot, when that message is in the chat, wins over everything else", () => {
    const root = es(msg({ id: mid("r"), from: ALICE, to: BOB, date: t(0), subject: "Trip" }), { topicRoot: mid("r"), topicLabel: "Trip" });
    const other = msg({ id: mid("o"), from: BOB, to: ALICE, date: t(5), subject: "Invoice 114" });
    const next = es(msg({ id: mid("n"), from: ALICE, to: BOB, date: t(10), subject: "Re: Invoice 114", inReplyTo: mid("o") }), { topicRoot: mid("r"), topicLabel: "Trip" });
    expect(roots([root, other, next])).toEqual({ [mid("r")]: mid("r"), [mid("o")]: mid("o"), [mid("n")]: mid("r") });
  });

  it("rule 1 falls through when the topicRoot is not in the chat (outside the loaded window)", () => {
    const first = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const reply = es(msg({ id: mid("b"), from: ALICE, to: BOB, date: t(5), subject: "Re: Plan", inReplyTo: mid("a") }), { topicRoot: mid("gone") });
    expect(roots([first, reply])).toEqual({ [mid("a")]: mid("a"), [mid("b")]: mid("a") });
  });

  it("rule 2: the topic of the message answered, through a chain of In-Reply-To", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Invoice" });
    const c = msg({ id: mid("c"), from: ALICE, to: BOB, date: t(2), subject: "Re: Plan", inReplyTo: mid("a") });
    const d = msg({ id: mid("d"), from: BOB, to: ALICE, date: t(3), subject: "Re: Plan", inReplyTo: mid("c"), references: [mid("a"), mid("c")] });
    expect(roots([a, b, c, d])).toEqual({ [mid("a")]: mid("a"), [mid("b")]: mid("b"), [mid("c")]: mid("a"), [mid("d")]: mid("a") });
  });

  it("rule 2: References only, the newest id held in the chat (In-Reply-To pointing outside it is skipped)", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Invoice" });
    const refsOnly = msg({ id: mid("c"), from: ALICE, to: BOB, date: t(2), subject: "Re: Plan", references: [mid("a"), mid("elsewhere")] });
    const outside = msg({ id: mid("d"), from: ALICE, to: BOB, date: t(3), subject: "Re: Plan", inReplyTo: mid("elsewhere"), references: [mid("b"), mid("a"), mid("elsewhere")] });
    expect(roots([a, b, refsOnly, outside])).toMatchObject({ [mid("c")]: mid("a"), [mid("d")]: mid("a") });
  });

  it("rule 3: an Outlook reply without threading headers joins the topic with its base subject (DEVIATIONS D8)", () => {
    const original = parseMessage(readFixture("apple-mail-fr-original.eml"));
    const other = { ...msg({ id: mid("x"), from: "camille@example.org", date: t(-1), subject: "Autre chose" }), date: "2026-03-04T17:00:00.000Z" };
    const reply = parseMessage(readFixture("outlook-fr-reply-no-thread-headers.eml"));
    expect(reply.refs.inReplyTo).toEqual([]);
    expect(reply.refs.references).toEqual([]);
    const result = topicsOf([original, other, reply]);
    expect(result.of[reply.id]).toEqual({ rootId: original.id, topicStart: true });
    expect(result.topics.map((topic) => topic.base)).toEqual(["Réunion de lundi", "Autre chose"]);
  });

  it("rule 4: a tagged reply with no headers joins the previous message's topic", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Invoice 114" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Lunch" });
    const tagged = msg({ id: mid("c"), from: BOB, to: ALICE, date: t(2), subject: "RE: Invoice 114 [EXTERNAL]" });
    expect(roots([a, b, tagged])[mid("c")]).toBe(mid("b"));
  });

  it("rule 4: a '(no subject)' mail joins the previous message's topic; as the first message it is its own root", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const empty = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "" });
    expect(roots([a, empty])[mid("b")]).toBe(mid("a"));
    expect(topicsOf([empty, a]).topics.map((topic) => [topic.rootId, topic.base])).toEqual([
      [mid("b"), ""],
      [mid("a"), "Plan"],
    ]);
  });

  it("rule 4: a reply to something not held joins the previous message's topic", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const reply = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "Something else", inReplyTo: mid("gone") });
    expect(roots([a, reply])[mid("b")]).toBe(mid("a"));
  });

  it("rule 5: a fresh plain mail with a new subject starts a plain topic, whatever client wrote it", () => {
    const thunderbird = parseMessage(readFixture("thunderbird-flowed.eml"));
    const later = msg({ id: mid("n"), from: ALICE, to: BOB, date: "2026-03-05T09:00:00.000Z", subject: "Kolo na prodej" });
    const result = topicsOf([thunderbird, later]);
    expect(result.topics).toEqual([
      { rootId: thunderbird.id, label: null, base: "Oběd v pátek", kind: "plain", count: 1 },
      { rootId: mid("n"), label: null, base: "Kolo na prodej", kind: "plain", count: 1 },
    ]);
  });

  it("a plain sender's renamed reply that keeps its References stays in its topic", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const b = msg({ id: mid("b"), from: ALICE, to: BOB, date: t(1), subject: "Re: Plan", inReplyTo: mid("a") });
    const renamed = msg({ id: mid("c"), from: BOB, to: ALICE, date: t(2), subject: "New venue (was: Plan)", inReplyTo: mid("b"), references: [mid("a"), mid("b")] });
    const result = topicsOf([a, b, renamed]);
    expect(result.topics).toHaveLength(1);
    expect(result.of[mid("c")]).toEqual({ rootId: mid("a"), topicStart: false });
  });

  it("two named roots in one chat, each with its label, and continuations that follow them", () => {
    const trip = es(msg({ id: mid("t"), from: ALICE, to: BOB, date: t(0), subject: "Trip" }), { topicRoot: mid("t"), topicLabel: "Trip" });
    const party = es(msg({ id: mid("p"), from: ALICE, to: BOB, date: t(1), subject: "Party" }), { topicRoot: mid("p"), topicLabel: "Party" });
    const answer = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(2), subject: "Re: Trip", inReplyTo: mid("t") });
    const result = topicsOf([trip, party, answer]);
    expect(result.topics).toEqual([
      { rootId: mid("t"), label: "Trip", base: "Trip", kind: "named", count: 2 },
      { rootId: mid("p"), label: "Party", base: "Party", kind: "named", count: 1 },
    ]);
  });

  it("reads the label from the oldest message that carries one when the root carries none", () => {
    const root = es(msg({ id: mid("r"), from: ALICE, to: BOB, date: t(0), subject: "Message from Alice" }), { topicRoot: mid("r") });
    const one = es(msg({ id: mid("1"), from: ALICE, to: BOB, date: t(1), subject: "Re: Message from Alice", inReplyTo: mid("r") }), { topicRoot: mid("r"), topicLabel: "Garden" });
    const two = es(msg({ id: mid("2"), from: ALICE, to: BOB, date: t(2), subject: "Re: Message from Alice", inReplyTo: mid("1") }), { topicRoot: mid("r"), topicLabel: "Later name" });
    expect(topicsOf([root, one, two]).topics).toEqual([{ rootId: mid("r"), label: "Garden", base: "Message from Alice", kind: "named", count: 3 }]);
  });

  it("marks where a run of one topic starts", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const b = msg({ id: mid("b"), from: ALICE, to: BOB, date: t(1), subject: "Re: Plan", inReplyTo: mid("a") });
    const c = msg({ id: mid("c"), from: BOB, to: ALICE, date: t(2), subject: "Invoice" });
    const d = msg({ id: mid("d"), from: ALICE, to: BOB, date: t(3), subject: "Re: Plan", inReplyTo: mid("b") });
    const e = msg({ id: mid("e"), from: BOB, to: ALICE, date: t(4), subject: "Re: Plan", inReplyTo: mid("d") });
    const { of } = topicsOf([a, b, c, d, e]);
    expect([a, b, c, d, e].map((m) => of[m.id]!.topicStart)).toEqual([true, false, true, true, false]);
  });
});

describe("topicsOf: kinds, counts and what it ignores", () => {
  it("kind: named with a label, carrier for an ES root or a 'Message from …' base, plain otherwise", () => {
    const esRoot = es(msg({ id: mid("e"), from: BOB, to: ALICE, date: t(0), subject: "Hello there" }), { topicRoot: mid("e") });
    const carrierFromPlainClient = msg({ id: mid("c"), from: BOB, to: ALICE, date: t(1), subject: "Message from Bob Svoboda" });
    const plain = msg({ id: mid("p"), from: BOB, to: ALICE, date: t(2), subject: "Invoice 114" });
    const named = es(msg({ id: mid("n"), from: ALICE, to: BOB, date: t(3), subject: "Trip" }), { topicRoot: mid("n"), topicLabel: "Trip" });
    expect(topicsOf([esRoot, carrierFromPlainClient, plain, named]).topics.map((topic) => topic.kind)).toEqual(["carrier", "carrier", "plain", "named"]);
  });

  it("leaves out Auto-Submitted messages (other than 'no'), which neither start nor join a topic", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Invoice 114" });
    const auto = { ...msg({ id: mid("v"), from: BOB, to: ALICE, date: t(1), subject: "Out of office" }), delivery: { listHeaders: [], listId: null, autoSubmitted: "auto-replied", precedence: null, returnPath: null } };
    const no = { ...msg({ id: mid("n"), from: BOB, to: ALICE, date: t(2), subject: "Re: Invoice 114", inReplyTo: mid("a") }), delivery: { listHeaders: [], listId: null, autoSubmitted: "no", precedence: null, returnPath: null } };
    const result = topicsOf([a, auto, no]);
    expect(Object.keys(result.of).sort()).toEqual([mid("a"), mid("n")].sort());
    expect(result.topics).toEqual([{ rootId: mid("a"), label: null, base: "Invoice 114", kind: "plain", count: 2 }]);
    expect(result.of[mid("n")]!.topicStart).toBe(false);
  });

  it("keeps the root's base subject, so every reply goes out as 'Re: <root base>' however later subjects stack prefixes", () => {
    const root = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(0), subject: "Invoice 114" });
    const stacked = msg({ id: mid("s"), from: BOB, to: ALICE, date: t(1), subject: "Re: Odp: Re: AW: Invoice 114", inReplyTo: mid("r") });
    const [topic] = topicsOf([root, stacked]).topics;
    expect("Re: " + topic!.base).toBe("Re: Invoice 114");
    expect(normalizeSubject("Re: " + topic!.base).base).toBe(topic!.base);
  });

  it("a chat started by a '(no subject)' mail has a root with an empty base: the next message must be a carrier root", () => {
    const [topic] = topicsOf([msg({ id: mid("r"), from: BOB, to: ALICE, date: t(0), subject: "" })]).topics;
    expect(topic).toEqual({ rootId: mid("r"), label: null, base: "", kind: "plain", count: 1 });
  });

  it("in a chat another Email Social user opened, the carrier names them, and replies inherit it byte for byte", () => {
    const theirs = es(msg({ id: mid("b"), from: BOB, to: ALICE, date: t(0), subject: carrierSubject({ name: "Bob Svoboda", address: "bob@example.org" }, [{ name: "Alice", address: "alice@example.com" }]) }), { topicRoot: mid("b") });
    const [topic] = topicsOf([theirs]).topics;
    expect(topic).toMatchObject({ kind: "carrier", base: "Message from Bob Svoboda" });
    expect("Re: " + topic!.base).toBe("Re: Message from Bob Svoboda");
  });

  it("compares base subjects with subjectKey (case and Unicode form)", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Café" });
    const b = msg({ id: mid("b"), from: BOB, to: ALICE, date: t(1), subject: "CAFÉ" });
    expect(subjectKey("CAFÉ")).toBe(subjectKey("Café"));
    expect(roots([a, b])[mid("b")]).toBe(mid("a"));
  });

  it("depends only on the messages: same input, same result; each id is placed once", () => {
    const a = msg({ id: mid("a"), from: BOB, to: ALICE, date: t(0), subject: "Plan" });
    const b = msg({ id: mid("b"), from: ALICE, to: BOB, date: t(1), subject: "Re: Plan", inReplyTo: mid("a") });
    expect(topicsOf([a, b])).toEqual(topicsOf([a, b]));
    expect(topicsOf([a, b, a]).topics[0]!.count).toBe(2);
    expect(topicsOf([])).toEqual({ topics: [], of: {} });
  });
});

describe("subjectNoteOf", () => {
  const root = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(0), subject: "Invoice 114" });
  const topic = { rootId: mid("r"), base: "Invoice 114" };

  it("a plain sender's tagged reply → its base subject, for one small line on that bubble", () => {
    const tagged = msg({ id: mid("t"), from: BOB, to: ALICE, date: t(1), subject: "Re: Invoice 114 [EXTERNAL]", inReplyTo: mid("r") });
    expect(subjectNoteOf(tagged, topic)).toBe("Invoice 114 [EXTERNAL]");
    expect(topicsOf([root, tagged]).of[mid("t")]!.rootId).toBe(mid("r"));
  });

  it("the same subject from an Email Social sender → null (its subject is only a carrier)", () => {
    const tagged = es(msg({ id: mid("t"), from: BOB, to: ALICE, date: t(1), subject: "Re: Invoice 114 [EXTERNAL]", inReplyTo: mid("r") }));
    expect(subjectNoteOf(tagged, topic)).toBeNull();
  });

  it("a topic root → null; an empty subject → null; the same base with other prefixes or case → null", () => {
    expect(subjectNoteOf(root, topic)).toBeNull();
    expect(subjectNoteOf(msg({ id: mid("e"), from: BOB, date: t(1), subject: "", inReplyTo: mid("r") }), topic)).toBeNull();
    expect(subjectNoteOf(msg({ id: mid("s"), from: BOB, date: t(1), subject: "AW: Odp: invoice 114", inReplyTo: mid("r") }), topic)).toBeNull();
  });

  it("an Auto-Submitted message → null", () => {
    const auto = { ...msg({ id: mid("a"), from: BOB, date: t(1), subject: "Automatic reply: Invoice 114" }), delivery: { listHeaders: [], listId: null, autoSubmitted: "auto-replied", precedence: null, returnPath: null } };
    expect(subjectNoteOf(auto, topic)).toBeNull();
  });
});
