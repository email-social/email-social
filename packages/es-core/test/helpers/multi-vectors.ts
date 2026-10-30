/**
 * The inputs of the multi-message vectors (vectors/multi/*.json, format in
 * vectors/README.md): for each vector, the raw messages, the account owner
 * and which views it checks. test/vectors-multi.test.ts computes the
 * expected views from them with es-core (ES_UPDATE_VECTORS=1) and checks the
 * files against them.
 *
 * Plain messages are written here as a mail client would send them; Email
 * Social posts are written by es-core's serializer.
 */
import { serializeMessage } from "../../src/serialize.js";
import type { EsAddress, EsOutgoing } from "../../src/types.js";

/** The views a vector can check; vectors/README.md says how each one is computed. */
export type ViewKey =
  | "conversations"
  | "contacts"
  | "kinds"
  | "chats"
  | "topics"
  | "carrierSubjects"
  | "subjectNotes"
  | "quotes"
  | "fragments"
  | "replyCards"
  | "replyQuotes";

export interface Owner {
  /** The owner's display name, used for carrier subjects. */
  name: string;
  /** Every address of the account (aliases); the first is the one it writes from. */
  addresses: string[];
}

/** A place where es-core does not do what the spec says: the vector holds what the spec says. */
export interface Divergence {
  key: ViewKey;
  statement: string;
  note: string;
  /** The spec's value of the view, from the one es-core computes. */
  spec: (computed: unknown) => unknown;
}

export interface MultiSource {
  description: string;
  /** The statements of spec/es-protocol.md the vector exists for. */
  covers: string[];
  owner: Owner;
  messages: string[];
  keys: ViewKey[];
  divergences?: Divergence[];
}

// ---------------------------------------------------------------- builders

const ALICE = "Alice Example <alice@example.com>";
const BOB = "Bob Svoboda <bob@example.org>";
const CAROL = "Carol Novak <carol@example.net>";
const DAN = "Dan <dan@example.net>";

const ALICE_ADDR: EsAddress = { name: "Alice Example", address: "alice@example.com" };
const BOB_ADDR: EsAddress = { name: "Bob Svoboda", address: "bob@example.org" };

const OWNER: Owner = { name: "Alice Example", addresses: ["alice@example.com"] };

/** 2026-03-<day> <hh>:<mm> UTC as ISO 8601. */
const at = (day: number, hh: number, mm = 0): string =>
  `2026-03-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;

/** An RFC 2047 B encoded-word in UTF-8. */
const ew = (text: string): string => `=?utf-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;

interface Mail {
  /** Message-ID; left out when absent. */
  id?: string;
  from?: string;
  to?: string;
  cc?: string;
  /** ISO 8601; the Date field is left out when absent. */
  date?: string;
  /** The Subject field as written; left out when absent. */
  subject?: string;
  inReplyTo?: string;
  references?: string;
  /** More header fields, written before the MIME fields. */
  headers?: string[];
  /** The text, "\n" line ends. */
  body?: string;
  /** Send the body as text/html instead of text/plain. */
  html?: boolean;
  /** Add an attachment with this file name (multipart/mixed). */
  attachment?: string;
}

/** A raw message as an ordinary client writes it: CRLF line ends, UTF-8 8bit text. */
function mail(m: Mail): string {
  const head: string[] = [];
  if (m.from !== undefined) head.push(`From: ${m.from}`);
  if (m.to !== undefined) head.push(`To: ${m.to}`);
  if (m.cc !== undefined) head.push(`Cc: ${m.cc}`);
  if (m.subject !== undefined) head.push(`Subject: ${m.subject}`);
  if (m.date !== undefined) head.push(`Date: ${new Date(m.date).toUTCString()}`);
  if (m.id !== undefined) head.push(`Message-ID: ${m.id}`);
  if (m.inReplyTo !== undefined) head.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references !== undefined) head.push(`References: ${m.references}`);
  head.push(...(m.headers ?? []), "MIME-Version: 1.0");
  const body = (m.body ?? "").replace(/\n/g, "\r\n");
  const textType = `Content-Type: text/${m.html === true ? "html" : "plain"}; charset=utf-8\r\nContent-Transfer-Encoding: 8bit`;
  if (m.attachment === undefined) return `${head.join("\r\n")}\r\n${textType}\r\n\r\n${body}`;
  const boundary = "part-boundary-1";
  return (
    `${head.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n${textType}\r\n\r\n${body}\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf; name="${m.attachment}"\r\nContent-Disposition: attachment; filename="${m.attachment}"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n` +
    `--${boundary}--\r\n`
  );
}

/** An Email Social post written by es-core. */
function post(outgoing: EsOutgoing, date: string, messageId: string): string {
  return serializeMessage(outgoing, { date, messageId });
}

/** "On Mon, 2 Mar 2026 at 09:00, <who> wrote:" */
const wrote = (who: string, when = "Mon, 2 Mar 2026 at 09:00"): string => `On ${when}, ${who} wrote:`;

/** Each line prefixed with "> " (an empty one with ">"). */
const quote = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");

// ---------------------------------------------------------------- vectors

const LONG_LINE_1 = "Let us meet at the station at half past seven, take the slow train to the lake, walk around it in the morning";
const LONG_LINE_2 = "and have lunch in the small restaurant by the pier before we go back.";
/** unquote() of the whole quote of lq1: its two lines joined with a space. */
const LONG_QUOTE = `${LONG_LINE_1} ${LONG_LINE_2}`;

export const MULTI_SOURCES: Record<string, MultiSource> = {
  "threading-canonical-order.json": {
    description:
      "Section 7.1 step 1: the messages are given out of order; one Message-ID is held twice (an INBOX and a Sent copy that differ only in a Received field); two messages share a date and are ordered by id; one has no date and comes last.",
    covers: ["TH-1"],
    owner: OWNER,
    keys: ["conversations"],
    messages: [
      mail({ id: "<o4@example.org>", from: BOB, to: ALICE, subject: "Re: Picnic", inReplyTo: "<o2@example.com>", references: "<o1@example.org> <o2@example.com>", body: "Undated, so it sorts last.\n" }),
      mail({ id: "<o3@example.org>", from: BOB, to: ALICE, date: at(2, 10), subject: "Re: Picnic", inReplyTo: "<o1@example.org>", references: "<o1@example.org>", body: "Same time as Alice's answer.\n" }),
      mail({ id: "<o5@example.net>", from: CAROL, to: ALICE, date: at(2, 8), subject: "Concert", headers: ["Received: from mx1.example.net by mx.example.com; Mon, 2 Mar 2026 08:00:01 +0000"], body: "Tickets for Friday?\n" }),
      mail({ id: "<o2@example.com>", from: ALICE, to: BOB, date: at(2, 10), subject: "Re: Picnic", inReplyTo: "<o1@example.org>", references: "<o1@example.org>", body: "Saturday works.\n" }),
      mail({ id: "<o1@example.org>", from: BOB, to: ALICE, date: at(2, 9), subject: "Picnic", body: "Picnic on Saturday?\n" }),
      mail({ id: "<o5@example.net>", from: CAROL, to: ALICE, date: at(2, 8), subject: "Concert", headers: ["Received: from mx2.example.net by mx.example.com; Mon, 2 Mar 2026 08:00:02 +0000"], body: "Tickets for Friday?\n" }),
    ],
  },

  "threading-references.json": {
    description:
      "Section 7.1 steps 2, 3 and 5: a thread whose root is not in the mailbox (a placeholder root names the conversation), a reply with only In-Reply-To, an Outlook reply whose References names the root and whose In-Reply-To names the parent, a two-message reference loop, a message that references itself, and a message without a Message-ID (its sha256: id is the root id).",
    covers: ["TH-2", "TH-4"],
    owner: OWNER,
    keys: ["conversations"],
    messages: [
      mail({ id: "<r2@example.org>", from: BOB, to: ALICE, date: at(3, 9), subject: "Re: Plan", inReplyTo: "<r1@example.com>", references: "<r1@example.com>", body: "The root <r1@example.com> is not in this mailbox.\n" }),
      mail({ id: "<r3@example.com>", from: ALICE, to: BOB, date: at(3, 10), subject: "Re: Plan", inReplyTo: "<r2@example.org>", body: "Only In-Reply-To here.\n" }),
      mail({ id: "<r4@example.org>", from: BOB, to: ALICE, date: at(3, 11), subject: "RE: Plan", inReplyTo: "<r3@example.com>", references: "<r1@example.com>", body: "Outlook: References names the root, In-Reply-To the parent.\n" }),
      mail({ id: "<l1@example.net>", from: CAROL, to: BOB, date: at(3, 9, 30), subject: "Loop", references: "<l2@example.net>", body: "References the next message.\n" }),
      mail({ id: "<l2@example.net>", from: BOB, to: CAROL, date: at(3, 9, 45), subject: "Re: Loop", references: "<l1@example.net>", body: "References the previous one.\n" }),
      mail({ id: "<s1@example.net>", from: DAN, to: ALICE, date: at(3, 12), subject: "Notes", inReplyTo: "<s1@example.net>", references: "<s1@example.net>", body: "References itself.\n" }),
      mail({ from: DAN, to: ALICE, date: at(3, 13), subject: "No Message-ID", body: "This message has no Message-ID field.\n" }),
    ],
  },

  "threading-subject-fallback.json": {
    description:
      "Section 7.1 step 4: an Outlook reply without threading headers joins its original by subject; the same subject between other people, and a second unprefixed original, stay apart; a prefixed reply with one more person joins by containment; messages without a subject join only when the participant sets are equal.",
    covers: ["TH-3"],
    owner: OWNER,
    keys: ["conversations"],
    messages: [
      mail({ id: "<f1@example.org>", from: BOB, to: ALICE, date: at(4, 9), subject: "Budget 2026", body: "Here is the budget.\n" }),
      mail({ id: "<f2@example.com>", from: ALICE, to: BOB, date: at(4, 10), subject: "RE: Budget 2026", body: "Outlook reply without In-Reply-To or References.\n" }),
      mail({ id: "<f3@example.net>", from: CAROL, to: DAN, date: at(4, 11), subject: "Re: Budget 2026", body: "Other people, same subject.\n" }),
      mail({ id: "<f4@example.org>", from: BOB, to: ALICE, date: at(4, 12), subject: "Budget 2026", body: "A second original with the same subject.\n" }),
      mail({ id: "<f5@example.org>", from: BOB, to: ALICE, cc: CAROL, date: at(4, 13), subject: "Re: Budget 2026", body: "Copying Carol.\n" }),
      mail({ id: "<e1@example.org>", from: BOB, to: ALICE, date: at(4, 9, 30), body: "No subject at all.\n" }),
      mail({ id: "<e2@example.com>", from: ALICE, to: BOB, date: at(4, 9, 40), subject: "", body: "An empty subject.\n" }),
      mail({ id: "<e3@example.net>", from: CAROL, to: ALICE, date: at(4, 9, 50), subject: "Re:", body: "Only a prefix.\n" }),
    ],
  },

  "threading-base-subject.json": {
    description:
      "Section 7.2: reply and forward prefixes in several languages, counters, list tags, (fwd) trailers, [fwd: …] wrappers, the full-width colon, a combining caron, NBSP and narrow NBSP; single-letter tokens and tags with nothing after them are kept. The chats view lists every message's base subject.",
    covers: ["TH-5"],
    owner: OWNER,
    keys: ["chats", "conversations"],
    messages: [
      mail({ id: "<b01@example.org>", from: BOB, to: ALICE, date: at(5, 9), subject: "Plan", body: "1\n" }),
      mail({ id: "<b02@example.org>", from: BOB, to: ALICE, date: at(5, 9, 1), subject: "Re: [team] AW: Fwd: Plan (fwd)", body: "2\n" }),
      mail({ id: "<b03@example.org>", from: BOB, to: ALICE, date: at(5, 9, 2), subject: "[fwd: Re: Plan]", body: "3\n" }),
      mail({ id: "<b04@example.org>", from: BOB, to: ALICE, date: at(5, 9, 3), subject: "RE : Plan", body: "4\n" }),
      mail({ id: "<b05@example.org>", from: BOB, to: ALICE, date: at(5, 9, 4), subject: "Re[2]: plan", body: "5\n" }),
      mail({ id: "<b06@example.org>", from: BOB, to: ALICE, date: at(5, 9, 5), subject: ew("PŘ: Plan"), body: "6\n" }),
      mail({ id: "<b07@example.org>", from: BOB, to: ALICE, date: at(5, 9, 6), subject: ew("回复：Plan"), body: "7\n" }),
      mail({ id: "<b08@example.org>", from: BOB, to: ALICE, date: at(5, 9, 7), subject: "R: Ciao", body: "8\n" }),
      mail({ id: "<b09@example.org>", from: BOB, to: ALICE, date: at(5, 9, 8), subject: "Re: [list]", body: "9\n" }),
      mail({ id: "<b10@example.org>", from: BOB, to: ALICE, date: at(5, 9, 9), subject: "Rescue plan", body: "10\n" }),
      mail({ id: "<b11@example.org>", from: BOB, to: ALICE, date: at(5, 9, 10), subject: ew("Re:  Plan trip"), body: "11\n" }),
      mail({ id: "<b12@example.org>", from: BOB, to: ALICE, date: at(5, 9, 11), subject: "Réf. : Plan", body: "12\n" }),
    ],
  },

  "contacts.json": {
    description:
      "Section 7.3: Outlook's single quotes around a name, a name that only repeats the address, white space in names, the From name preferred over To and Cc names, names most recent first, the domain folded and the local part kept, an undated message read first, and a contact never seen in a dated message sorted last.",
    covers: ["TH-6"],
    owner: OWNER,
    keys: ["contacts"],
    messages: [
      mail({ id: "<c1@example.net>", from: "'Anna Becker' <anna@Example.NET>", to: `${ALICE}, Zed <zed@example.net>`, subject: "Hello", body: "Undated.\n" }),
      mail({ id: "<c2@example.net>", from: '"anna@example.net" <anna@example.net>', to: ALICE, cc: "Ann B. <anna@example.net>", date: at(6, 9), subject: "Again", body: "The From name is the address.\n" }),
      mail({ id: "<c3@example.org>", from: BOB, to: '"Anna   Becker-Novak" <anna@example.net>', cc: "alice <alice@example.com>", date: at(6, 10), subject: "Names", body: "White space in a To name.\n" }),
      mail({ id: "<c4@example.com>", from: "Alice E. <alice@example.com>", to: "Bob@example.org", date: at(6, 11), subject: "Case", body: "The local part's case is kept.\n" }),
    ],
  },

  "chats.json": {
    description:
      "Section 8.1: everything exchanged with one person is one chat whatever the subject; the owner's alias and the case of its domain are removed wherever they appear; a group is a chat of its own; a message to oneself is the chat without participants; an undated chat is sorted last.",
    covers: ["CH-1"],
    owner: { name: "Alice Example", addresses: ["alice@example.com", "alice.example@example.net"] },
    keys: ["chats"],
    messages: [
      mail({ id: "<h1@example.org>", from: BOB, to: ALICE, date: at(7, 9), subject: "Lunch", body: "Lunch?\n" }),
      mail({ id: "<h2@example.com>", from: ALICE, to: BOB, date: at(7, 10), subject: "Re: Lunch", inReplyTo: "<h1@example.org>", body: "Yes.\n" }),
      mail({ id: "<h3@example.org>", from: BOB, to: "Alice <alice.example@EXAMPLE.NET>", date: at(7, 11), subject: "Books", body: "To the alias.\n" }),
      mail({ id: "<h4@example.com>", from: ALICE, to: `${BOB}, ${CAROL}`, date: at(7, 12), subject: "Party", body: "Party on Friday.\n" }),
      mail({ id: "<h5@example.net>", from: CAROL, to: "alice.example@example.net", cc: `${BOB}, ${ALICE}`, date: at(7, 13), subject: "Re: Party", body: "I'll bring a cake.\n" }),
      mail({ id: "<h6@example.com>", from: ALICE, to: "Alice <alice@EXAMPLE.com>", date: at(7, 14), subject: "Note to self", body: "Buy milk.\n" }),
      mail({ id: "<h7@example.net>", from: CAROL, to: ALICE, subject: "Hi", body: "Undated.\n" }),
    ],
  },

  "chats-other-mail.json": {
    description:
      "Section 8.3 and the rule that list and automated mail is not shown as chats: list fields, Precedence, Auto-Submitted, the null Return-Path and no-reply senders are classified; a local part that only starts like noreply is a person; the owner's own message is a person whatever its fields. The chats view groups only the person messages.",
    covers: ["CH-2", "CH-3"],
    owner: OWNER,
    keys: ["kinds", "chats"],
    messages: [
      mail({ id: "<k1@example.org>", from: BOB, to: "Team <team@lists.example.org>", date: at(8, 9), subject: "[team] Agenda", headers: ["List-Id: Team <team.lists.example.org>", "List-Post: <mailto:team@lists.example.org>"], body: "Mailing list post.\n" }),
      mail({ id: "<k2@example.org>", from: "Club <club@example.org>", to: ALICE, date: at(8, 9, 1), subject: "Club news", headers: ["Precedence: list"], body: "Precedence: list.\n" }),
      mail({ id: "<k3@example.net>", from: "Shop <news@example.net>", to: ALICE, date: at(8, 9, 2), subject: "Offers", headers: ["Precedence: bulk"], body: "Newsletter.\n" }),
      mail({ id: "<k4@example.org>", from: BOB, to: ALICE, date: at(8, 9, 3), subject: "Out of office", headers: ["Auto-Submitted: auto-replied"], body: "I am away.\n" }),
      mail({ id: "<k5@example.net>", from: "Mail Delivery System <MAILER-DAEMON@example.net>", to: ALICE, date: at(8, 9, 4), subject: "Undelivered Mail", headers: ["Return-Path: <>"], body: "Bounce.\n" }),
      mail({ id: "<k6@example.com>", from: "Billing <noreply+billing@example.com>", to: ALICE, date: at(8, 9, 5), subject: "Invoice", body: "No-reply sender.\n" }),
      mail({ id: "<k7@example.com>", from: "Do-Not-Reply@example.com", to: ALICE, date: at(8, 9, 6), subject: "Notice", body: "Upper case no-reply sender.\n" }),
      mail({ id: "<k8@example.net>", from: "Noreplyer <noreplyer@example.net>", to: ALICE, date: at(8, 9, 7), subject: "Hello", body: "Only starts like noreply.\n" }),
      mail({ id: "<k9@example.net>", from: CAROL, to: ALICE, date: at(8, 9, 8), subject: "Holiday", headers: ["Auto-Submitted: no"], body: "Auto-Submitted: no is a person.\n" }),
      mail({ id: "<k10@example.com>", from: ALICE, to: BOB, date: at(8, 9, 9), subject: "Minutes", headers: ["Precedence: bulk", "Auto-Submitted: auto-generated"], body: "The owner's own message.\n" }),
      mail({ id: "<k11@example.org>", from: BOB, to: ALICE, date: at(8, 9, 10), subject: "Coffee?", body: "A person.\n" }),
    ],
  },

  "topics-rules.json": {
    description:
      "Section 8.2, the five placement rules in one chat: a fresh first message, a reply by In-Reply-To, a new fresh subject, an Outlook reply without headers found by subject, a prefixed reply with a new subject, named topics from ES parts, a reply whose In-Reply-To is outside the chat but whose References reaches the chat, an ES part's topicRoot winning over In-Reply-To, an empty subject, a fresh mail with an existing subject, and a topicRoot that is not in the chat.",
    covers: ["TP-1"],
    owner: OWNER,
    keys: ["chats", "topics"],
    messages: [
      mail({ id: "<t01@example.org>", from: BOB, to: ALICE, date: at(9, 9), subject: "Trip", body: "Rule 5 (and the first message): a root.\n" }),
      mail({ id: "<t02@example.com>", from: ALICE, to: BOB, date: at(9, 9, 1), subject: "Re: Trip", inReplyTo: "<t01@example.org>", references: "<t01@example.org>", body: "Rule 2.\n" }),
      mail({ id: "<t03@example.org>", from: BOB, to: ALICE, date: at(9, 9, 2), subject: "Budget", body: "Rule 5: a new topic.\n" }),
      mail({ id: "<t04@example.com>", from: ALICE, to: BOB, date: at(9, 9, 3), subject: "RE: Trip", body: "Rule 3: no headers, the subject of an existing topic.\n" }),
      mail({ id: "<t05@example.org>", from: BOB, to: ALICE, date: at(9, 9, 4), subject: "Re: Something else", body: "Rule 4: a reply prefix, the previous message's topic.\n" }),
      post({ from: ALICE_ADDR, to: [BOB_ADDR], subject: "Concert", text: "Rule 1: a named topic.\n", es: { topicRoot: "self", topicLabel: "Concert" } }, at(9, 9, 5), "<t06@example.com>"),
      mail({ id: "<t07@example.org>", from: BOB, to: ALICE, date: at(9, 9, 6), subject: "Re: Budget", inReplyTo: "<elsewhere@example.net>", references: "<t03@example.org> <elsewhere@example.net>", body: "Rule 2 by References.\n" }),
      post(
        { from: BOB_ADDR, to: [ALICE_ADDR], subject: "Re: Concert", text: "Rule 1 before rule 2.\n", inReplyTo: { messageId: "<t07@example.org>", references: ["<t03@example.org>"] }, es: { topicRoot: "<t06@example.com>", topicLabel: "Concert" } },
        at(9, 9, 7),
        "<t08@example.org>",
      ),
      mail({ id: "<t09@example.org>", from: BOB, to: ALICE, date: at(9, 9, 8), body: "Rule 4: no subject.\n" }),
      mail({ id: "<t10@example.com>", from: ALICE, to: BOB, date: at(9, 9, 9), subject: "Budget", body: "Rule 3: unprefixed, an existing subject.\n" }),
      mail({ id: "<t11@example.org>", from: BOB, to: ALICE, date: at(9, 9, 10), subject: "Holiday photos", body: "Rule 5.\n" }),
      post({ from: BOB_ADDR, to: [ALICE_ADDR], subject: "Re: Trip", text: "topicRoot not in the chat: rule 3.\n", es: { topicRoot: "<unknown@example.org>" } }, at(9, 9, 11), "<t12@example.org>"),
    ],
  },

  "topics-auto-submitted.json": {
    description:
      "Section 8.2, Auto-Submitted: the owner's own automatic reply is in the chat (the owner's mail is always a person's) but is left out of topics, gets no reply card although it quotes, and no subject note although its subject differs; a reply to it is placed by its References; Auto-Submitted: no is placed as usual.",
    covers: ["TP-2"],
    owner: OWNER,
    keys: ["chats", "topics", "replyCards", "subjectNotes"],
    messages: [
      mail({ id: "<a1@example.org>", from: BOB, to: ALICE, date: at(10, 9), subject: "Report", body: "Here is the report.\nPlease have a look.\nThanks.\nBob\n" }),
      mail({
        id: "<a2@example.com>",
        from: ALICE,
        to: BOB,
        date: at(10, 9, 1),
        subject: "Automatic reply: Report",
        inReplyTo: "<a1@example.org>",
        references: "<a1@example.org>",
        headers: ["Auto-Submitted: auto-replied"],
        body: `I am away until Monday.\n\n${wrote(BOB, "Tue, 10 Mar 2026 at 09:00")}\n${quote("Please have a look.")}\n`,
      }),
      mail({ id: "<a3@example.org>", from: BOB, to: ALICE, date: at(10, 9, 2), subject: "Re: Automatic reply: Report", inReplyTo: "<a2@example.com>", references: "<a1@example.org> <a2@example.com>", headers: ["Auto-Submitted: no"], body: "Enjoy the holiday.\n" }),
    ],
  },

  "topics-labels.json": {
    description:
      "Section 8.2, the topic fields: a plain topic, a carrier topic rooted by a post without a name, a label taken from the oldest message that carries one (not the root) with white space collapsed, a later different label ignored, a carrier subject written by a plain client, a subject that is only \"Message from\", a post without a name under an ordinary subject (carrier), counts, and topicStart where the topics alternate.",
    covers: ["TP-3"],
    owner: OWNER,
    keys: ["chats", "topics"],
    messages: [
      mail({ id: "<g1@example.org>", from: BOB, to: ALICE, date: at(11, 9), subject: "Garden", body: "Plain topic.\n" }),
      post({ from: ALICE_ADDR, to: [BOB_ADDR], subject: "Message from Alice Example", text: "A post without a name.\n", es: { topicRoot: "self" } }, at(11, 9, 1), "<g2@example.com>"),
      post(
        { from: BOB_ADDR, to: [ALICE_ADDR], subject: "Re: Message from Alice Example", text: "Names the topic.\n", inReplyTo: { messageId: "<g2@example.com>" }, es: { topicRoot: "<g2@example.com>", topicLabel: "Weekend   plans" } },
        at(11, 9, 2),
        "<g3@example.org>",
      ),
      post(
        { from: ALICE_ADDR, to: [BOB_ADDR], subject: "Re: Message from Alice Example", text: "Another name, too late.\n", inReplyTo: { messageId: "<g3@example.org>", references: ["<g2@example.com>"] }, es: { topicRoot: "<g2@example.com>", topicLabel: "Other name" } },
        at(11, 9, 3),
        "<g4@example.com>",
      ),
      mail({ id: "<g5@example.org>", from: BOB, to: ALICE, date: at(11, 9, 4), subject: "Message from Bob", body: "A carrier subject from a plain client.\n" }),
      mail({ id: "<g6@example.org>", from: BOB, to: ALICE, date: at(11, 9, 5), subject: "Re: Garden", inReplyTo: "<g1@example.org>", body: "Back to the garden.\n" }),
      mail({ id: "<g7@example.com>", from: ALICE, to: BOB, date: at(11, 9, 6), subject: "Re: Garden", inReplyTo: "<g6@example.org>", body: "Still the garden.\n" }),
      mail({ id: "<g8@example.org>", from: BOB, to: ALICE, date: at(11, 9, 7), subject: "Message from", body: "Nothing after the prefix.\n" }),
      post({ from: BOB_ADDR, to: [ALICE_ADDR], subject: "Photos", text: "A post without a name and with an ordinary subject.\n", es: { topicRoot: "self" } }, at(11, 9, 8), "<g9@example.org>"),
    ],
  },

  "topics-carrier-subject.json": {
    description:
      "Section 8.2, the carrier subject the owner writes into each chat: one other person (only the sender is named), a person without a name, a group of five (sorted by address, three names, then +2, an address for a person without a name) and a group of two.",
    covers: ["TP-4"],
    owner: { name: "Alice   Example", addresses: ["alice@example.com"] },
    keys: ["chats", "carrierSubjects"],
    messages: [
      mail({ id: "<cs1@example.org>", from: '"Bob   Svoboda" <bob@example.org>', to: ALICE, date: at(12, 9), subject: "Hi", body: "One other person.\n" }),
      mail({ id: "<cs2@example.net>", from: "dan@example.net", to: ALICE, date: at(12, 9, 1), subject: "Hi", body: "No name.\n" }),
      mail({
        id: "<cs3@example.com>",
        from: ALICE,
        to: `Frank <frank@example.com>, ${CAROL}, dan@example.net, Erin <erin@example.com>, ${BOB}`,
        date: at(12, 9, 2),
        subject: "Group",
        body: "Five others.\n",
      }),
      mail({ id: "<cs4@example.com>", from: ALICE, to: `Erin <erin@example.com>, ${CAROL}`, date: at(12, 9, 3), subject: "Pair", body: "Two others.\n" }),
    ],
  },

  "quotes-unquote.json": {
    description:
      "Section 9.2: quotes as the quoted message had them: nested quote marks with and without spaces and a tab, attributions at every depth (Gmail, mutt), an Outlook header block in Czech under a divider, an English header block inside a quote with a line right under it, an original-message separator, and the U+FEFF of iOS Mail.",
    covers: ["QT-3"],
    owner: OWNER,
    keys: ["quotes"],
    messages: [
      mail({
        id: "<u1@example.com>",
        from: ALICE,
        to: BOB,
        date: at(13, 9),
        subject: "Re: Lunch",
        body: `Thanks!\n\n${wrote(BOB)}\n> Sounds good.\n>\n> ${wrote(ALICE, "Sun, 1 Mar 2026 at 18:00")}\n> > Lunch on Friday?\n> >> At noon.\n`,
      }),
      mail({
        id: "<u2@example.com>",
        from: ALICE,
        to: BOB,
        date: at(13, 9, 1),
        subject: "RE: Oběd",
        body: "Díky.\n\n________________________________\nOd: Bob Svoboda <bob@example.org>\nOdesláno: pondělí 2. března 2026 10:00\nKomu: Alice Example <alice@example.com>\nPředmět: Oběd\n\nV pátek ve 12?\n",
      }),
      mail({
        id: "<u3@example.com>",
        from: ALICE,
        to: BOB,
        date: at(13, 9, 2),
        subject: "Re: Venue",
        body: `Noted.\n\n${wrote(BOB, "Mon, 2 Mar 2026 at 11:00")}\n> Forwarding Carol's note.\n>\n> -----Original Message-----\n> From: Carol Novak <carol@example.net>\n> Sent: Monday, March 2, 2026 9:00 AM\n> To: Bob Svoboda <bob@example.org>\n> Subject: Venue\n> The hall is booked.\n`,
      }),
      mail({
        id: "<u4@example.com>",
        from: ALICE,
        to: BOB,
        date: at(13, 9, 3),
        subject: "Re: Noon",
        body: "OK\n\nSent from my iPhone\n\nOn 2 Mar 2026, at 10:00, Bob Svoboda <bob@example.org> wrote:\n\n> ﻿See you at noon.\n",
      }),
      mail({
        id: "<u5@example.com>",
        from: ALICE,
        to: BOB,
        date: at(13, 9, 4),
        subject: "Re: Patch",
        body: "* Bob Svoboda <bob@example.org> [2026-03-02 10:15]:\n> Does it build?\n>\t> It did yesterday.\n\nIt builds now.\n",
      }),
    ],
  },

  "quotes-fragment.json": {
    description:
      "Section 9.3: replies to a seven-line message quoting one interior sentence, part of a line, its start, its end, all of it, four lines, and point by point; a reply to an HTML-only message; a reply quoting the start of a two-line message; and a fragment longer than 140 characters.",
    covers: ["QT-4"],
    owner: OWNER,
    keys: ["fragments"],
    messages: [
      mail({
        id: "<p1@example.com>",
        from: ALICE,
        to: BOB,
        date: at(14, 9),
        subject: "Saturday",
        body: "Hi Bob,\n\nthe train leaves at 7:40 from platform 3.\nJana said she would come too.\nWe could have lunch at the lake.\nBring a jacket, it gets cold there.\nTickets are on me.\n\nAlice\n",
      }),
      mail({ id: "<fr1@example.org>", from: BOB, to: ALICE, date: at(14, 10), subject: "Re: Saturday", inReplyTo: "<p1@example.com>", body: `Great!\n\n${wrote(ALICE)}\n${quote("Jana said she would come too.")}\n` }),
      mail({ id: "<fr2@example.org>", from: BOB, to: ALICE, date: at(14, 10, 1), subject: "Re: Saturday", inReplyTo: "<p1@example.com>", body: `Which one?\n\n${wrote(ALICE)}\n${quote("leaves at 7:40")}\n` }),
      mail({ id: "<fr3@example.org>", from: BOB, to: ALICE, date: at(14, 10, 2), subject: "Re: Saturday", inReplyTo: "<p1@example.com>", body: `Hi!\n\n${wrote(ALICE)}\n${quote("Hi Bob,")}\n` }),
      mail({ id: "<fr4@example.org>", from: BOB, to: ALICE, date: at(14, 10, 3), subject: "Re: Saturday", inReplyTo: "<p1@example.com>", body: `Thank you!\n\n${wrote(ALICE)}\n${quote("Tickets are on me.\n\nAlice")}\n` }),
      mail({
        id: "<fr5@example.org>",
        from: BOB,
        to: ALICE,
        date: at(14, 10, 4),
        subject: "Re: Saturday",
        inReplyTo: "<p1@example.com>",
        body: `Sounds good.\n\n${wrote(ALICE)}\n${quote("Hi Bob,\n\nthe train leaves at 7:40 from platform 3.\nJana said she would come too.\nWe could have lunch at the lake.\nBring a jacket, it gets cold there.\nTickets are on me.\n\nAlice")}\n`,
      }),
      mail({
        id: "<fr6@example.org>",
        from: BOB,
        to: ALICE,
        date: at(14, 10, 5),
        subject: "Re: Saturday",
        inReplyTo: "<p1@example.com>",
        body: `Fine.\n\n${wrote(ALICE)}\n${quote("the train leaves at 7:40 from platform 3.\nJana said she would come too.\nWe could have lunch at the lake.\nBring a jacket, it gets cold there.")}\n`,
      }),
      mail({
        id: "<fr7@example.org>",
        from: BOB,
        to: ALICE,
        date: at(14, 10, 6),
        subject: "Re: Saturday",
        inReplyTo: "<p1@example.com>",
        body: "Hi Alice,\n\n> the train leaves at 7:40 from platform 3.\nPerfect.\n\n> Tickets are on me.\nThank you!\n",
      }),
      mail({
        id: "<p2@example.com>",
        from: ALICE,
        to: BOB,
        date: at(14, 11),
        subject: "Sunday",
        html: true,
        body: "<p>Hi Bob,</p><p>the bus leaves at 9:10.</p><p>Jana is coming.</p><p>We eat at the hut.</p><p>Alice</p>\n",
      }),
      mail({ id: "<fr8@example.org>", from: BOB, to: ALICE, date: at(14, 11, 1), subject: "Re: Sunday", inReplyTo: "<p2@example.com>", body: `Good.\n\n${wrote(ALICE, "Sat, 14 Mar 2026 at 11:00")}\n${quote("Jana is coming.")}\n` }),
      mail({ id: "<p3@example.com>", from: ALICE, to: BOB, date: at(14, 12), subject: "Coffee", body: "Coffee at 10?\nOr at 11?\n" }),
      mail({ id: "<fr9@example.org>", from: BOB, to: ALICE, date: at(14, 12, 1), subject: "Re: Coffee", inReplyTo: "<p3@example.com>", body: `Yes.\n\n${wrote(ALICE, "Sat, 14 Mar 2026 at 12:00")}\n${quote("Coffee at 10?")}\n` }),
      mail({
        id: "<p4@example.com>",
        from: ALICE,
        to: BOB,
        date: at(14, 13),
        subject: "Route",
        body: "Hello,\n\nwe start at the station, walk along the river to the old mill, cross the bridge, climb the hill behind the church and come back through the forest before it gets dark.\n\nSee you,\nAlice\n",
      }),
      mail({
        id: "<fr10@example.org>",
        from: BOB,
        to: ALICE,
        date: at(14, 13, 1),
        subject: "Re: Route",
        inReplyTo: "<p4@example.com>",
        body: `Too long for me.\n\n${wrote(ALICE, "Sat, 14 Mar 2026 at 13:00")}\n${quote("we start at the station, walk along the river to the old mill, cross the bridge, climb the hill behind the church and come back through the forest before it gets dark.")}\n`,
      }),
    ],
  },

  "quotes-reply-quote.json": {
    description:
      "Section 9.4: the quote below a reply to each message, with at most 5 lines and the date in UTC: a named sender with a signature left out, an undated sender whose name is its address, a message without From, seven lines cut to five, a message that only quotes (its whole text is quoted again), and a message without text.",
    covers: ["QT-5"],
    owner: OWNER,
    keys: ["replyQuotes"],
    messages: [
      mail({ id: "<q1@example.org>", from: BOB, to: ALICE, date: "2026-03-03T10:15:00Z", subject: "Time", body: "See you at 10:15.\n\nBob\n-- \nBob Svoboda, example.org\n" }),
      mail({ id: "<q2@example.net>", from: '"carol@example.net" <carol@example.net>', to: ALICE, subject: "Undated", body: "No date here.\n" }),
      mail({ id: "<q3@example.net>", to: ALICE, date: at(3, 11), subject: "Anonymous", body: "Nobody signed this.\n" }),
      mail({ id: "<q4@example.org>", from: BOB, to: ALICE, date: at(3, 12), subject: "List", body: "one\ntwo\n\nfour\nfive\nsix\nseven\n" }),
      mail({ id: "<q5@example.org>", from: BOB, to: ALICE, date: at(3, 13), subject: "Fwd", body: `${wrote(CAROL, "Tue, 3 Mar 2026 at 08:00")}\n${quote("Is the hall free?")}\n` }),
      mail({ id: "<q6@example.org>", from: BOB, to: ALICE, date: at(3, 14), subject: "Empty", body: "" }),
    ],
  },

  "reply-cards.json": {
    description:
      "Section 9.5: cards in a chat with Bob: a post whose replyTo is held (with the target's attachment), a post whose target is not held, a post without replyTo, a whole-message quote, a fragment quote, the owner's own quote of a whole message, a message answering itself, a parent in another chat, a parent not held, and a parent found through References.",
    covers: ["QT-6"],
    owner: OWNER,
    keys: ["chats", "replyCards"],
    messages: [
      mail({
        id: "<rc1@example.com>",
        from: ALICE,
        to: BOB,
        date: at(15, 9),
        subject: "Trip",
        attachment: "map.pdf",
        body: "Shall we take the 7:40 train on Saturday?\nI can buy the tickets.\nBring a jacket.\nTell me by Friday.\n",
      }),
      post(
        {
          from: BOB_ADDR,
          to: [ALICE_ADDR],
          text: "I'm in. 7:40 works.\n",
          inReplyTo: { messageId: "<rc1@example.com>", subject: "Trip" },
          es: { replyTo: { messageId: "<rc1@example.com>", from: ALICE_ADDR, excerpt: "Shall we take the 7:40 train on Saturday?" } },
        },
        at(15, 9, 1),
        "<rc2@example.org>",
      ),
      post(
        {
          from: BOB_ADDR,
          to: [ALICE_ADDR],
          subject: "Re: Trip",
          text: "About your older message: yes.\n",
          es: {
            replyTo: {
              messageId: "<gone@example.com>",
              from: { name: "", address: "alice@example.com" },
              excerpt:
                "This older message is no longer in the mailbox, and its excerpt is longer than one hundred and forty characters, so the card cuts it at a word boundary.",
            },
          },
        },
        at(15, 9, 2),
        "<rc3@example.org>",
      ),
      post({ from: BOB_ADDR, to: [ALICE_ADDR], text: "Also, I'll bring sandwiches.\n", inReplyTo: { messageId: "<rc1@example.com>", subject: "Trip" } }, at(15, 9, 3), "<rc4@example.org>"),
      mail({
        id: "<rc5@example.org>",
        from: BOB,
        to: ALICE,
        date: at(15, 9, 4),
        subject: "Re: Trip",
        inReplyTo: "<rc1@example.com>",
        body: `Sounds good.\n\n${wrote(ALICE, "Sun, 15 Mar 2026 at 09:00")}\n${quote("Shall we take the 7:40 train on Saturday?\nI can buy the tickets.\nBring a jacket.\nTell me by Friday.")}\n`,
      }),
      mail({ id: "<rc6@example.org>", from: BOB, to: ALICE, date: at(15, 9, 5), subject: "Re: Trip", inReplyTo: "<rc1@example.com>", body: `I have one.\n\n${wrote(ALICE, "Sun, 15 Mar 2026 at 09:00")}\n${quote("Bring a jacket.")}\n` }),
      mail({ id: "<rc7@example.com>", from: ALICE, to: BOB, date: at(15, 9, 6), subject: "Re: Trip", inReplyTo: "<rc2@example.org>", body: `Great.\n\n${wrote(BOB, "Sun, 15 Mar 2026 at 09:01")}\n${quote("I'm in. 7:40 works.")}\n` }),
      mail({ id: "<rc8@example.org>", from: BOB, to: ALICE, date: at(15, 9, 7), subject: "Re: Trip", inReplyTo: "<rc8@example.org>", body: `Answers itself.\n\n${wrote(ALICE, "Sun, 15 Mar 2026 at 09:00")}\n${quote("Bring a jacket.")}\n` }),
      mail({ id: "<cc1@example.net>", from: CAROL, to: ALICE, date: at(15, 8), subject: "Hello", body: "Hello Alice,\nthe hall is booked.\nThe band is confirmed.\nThe food is ordered.\nCarol\n" }),
      mail({ id: "<rc9@example.org>", from: BOB, to: ALICE, date: at(15, 9, 8), subject: "Re: Hello", inReplyTo: "<cc1@example.net>", body: `Nice.\n\n${wrote(CAROL, "Sun, 15 Mar 2026 at 08:00")}\n${quote("The band is confirmed.")}\n` }),
      mail({ id: "<rc10@example.org>", from: BOB, to: ALICE, date: at(15, 9, 9), subject: "Re: Trip", inReplyTo: "<missing@example.org>", body: `Hm.\n\n${wrote(ALICE, "Sun, 15 Mar 2026 at 09:00")}\n${quote("Bring a jacket.")}\n` }),
      mail({ id: "<rc11@example.org>", from: BOB, to: ALICE, date: at(15, 9, 10), subject: "Re: Trip", references: "<x@example.net> <rc1@example.com>", body: `Thanks!\n\n${wrote(ALICE, "Sun, 15 Mar 2026 at 09:00")}\n${quote("I can buy the tickets.")}\n` }),
    ],
  },

  "reply-cards-own-long-quote.json": {
    description:
      "Section 9.5: the owner's own reply quoting the whole of a long message gets a card whose excerpt is the first 140 characters of unquote(quoted).",
    covers: ["QT-6"],
    owner: OWNER,
    keys: ["replyCards"],
    divergences: [
      {
        key: "replyCards",
        statement: "QT-6",
        note: "The fourth bullet of section 9.5 says \"the first 140 characters of unquote(quoted)\"; es-core cuts that text as in section 9.3 instead (139 characters, back to a word boundary, then \"…\"). The vector holds the first 140 characters.",
        spec: (computed) => {
          const cards = structuredClone(computed) as Record<string, { excerpt: string } | null>;
          const card = cards["<lq2@example.com>"];
          if (card) card.excerpt = LONG_QUOTE.slice(0, 140);
          return cards;
        },
      },
    ],
    messages: [
      mail({ id: "<lq1@example.org>", from: BOB, to: ALICE, date: at(16, 9), subject: "Plan", body: `${LONG_LINE_1}\n${LONG_LINE_2}\n` }),
      mail({
        id: "<lq2@example.com>",
        from: ALICE,
        to: BOB,
        date: at(16, 10),
        subject: "Re: Plan",
        inReplyTo: "<lq1@example.org>",
        body: `Agreed.\n\n${wrote(BOB, "Mon, 16 Mar 2026 at 09:00")}\n${quote(`${LONG_LINE_1}\n${LONG_LINE_2}`)}\n`,
      }),
    ],
  },

  "subject-notes.json": {
    description:
      "Section 9.6: in one topic, the root, a same-subject reply, a reply differing only in case, a gateway tag after the subject (a note), a list tag before it (no note), an Email Social post with another subject, an empty subject, and a renamed reply (a note); none of them moves.",
    covers: ["QT-7"],
    owner: OWNER,
    keys: ["topics", "subjectNotes"],
    messages: [
      mail({ id: "<n1@example.org>", from: BOB, to: ALICE, date: at(17, 9), subject: "Trip", body: "Root.\n" }),
      mail({ id: "<n2@example.com>", from: ALICE, to: BOB, date: at(17, 9, 1), subject: "Re: Trip", inReplyTo: "<n1@example.org>", body: "Same subject.\n" }),
      mail({ id: "<n3@example.org>", from: BOB, to: ALICE, date: at(17, 9, 2), subject: "RE: trip", inReplyTo: "<n2@example.com>", body: "Only the case differs.\n" }),
      mail({ id: "<n4@example.org>", from: BOB, to: ALICE, date: at(17, 9, 3), subject: "Re: Trip [EXTERNAL]", inReplyTo: "<n3@example.org>", body: "A gateway tag.\n" }),
      mail({ id: "<n5@example.org>", from: BOB, to: ALICE, date: at(17, 9, 4), subject: "[EXTERNAL] Re: Trip", inReplyTo: "<n4@example.org>", body: "A tag the base subject removes.\n" }),
      post({ from: ALICE_ADDR, to: [BOB_ADDR], subject: "Re: Trip plans", text: "A post.\n", inReplyTo: { messageId: "<n5@example.org>", references: ["<n1@example.org>"] } }, at(17, 9, 5), "<n6@example.com>"),
      mail({ id: "<n7@example.org>", from: BOB, to: ALICE, date: at(17, 9, 6), subject: "", inReplyTo: "<n6@example.com>", body: "Empty subject.\n" }),
      mail({ id: "<n8@example.org>", from: BOB, to: ALICE, date: at(17, 9, 7), subject: "Re: Lunch", inReplyTo: "<n7@example.org>", body: "Renamed.\n" }),
    ],
  },
};
