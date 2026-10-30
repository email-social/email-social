# Email Social Protocol: direct messages over e-mail

**Status:** the specification of what this repository implements (Tasks 1–4). It is written from the Czech working draft [`es-protocol-v2-excerpt.md`](es-protocol-v2-excerpt.md), which stays in this directory for provenance, and from what the code in `packages/es-core` and `packages/es-bridge` does. Where the draft and this document differ, this document describes the implementation and [`DEVIATIONS.md`](DEVIATIONS.md) gives the reason and the evidence.

**Licence:** CC BY 4.0 (see [`LICENSE`](LICENSE)).

**Test vectors:** [`packages/es-core/vectors/`](../packages/es-core/vectors/README.md). Every normative statement below carries an identifier such as `[ID-1]`; the [table at the end](#16-requirements-and-the-tests-that-cover-them) names the tests and vectors that cover each one.

## Contents

1. [Introduction and goals](#1-introduction-and-goals)
2. [Conventions and terminology](#2-conventions-and-terminology)
3. [Identifiers](#3-identifiers)
4. [Message format: writing](#4-message-format-writing)
5. [The ES part](#5-the-es-part)
6. [Reading a message](#6-reading-a-message)
7. [Threading](#7-threading)
8. [Chats and topics](#8-chats-and-topics)
9. [Quoted text and reply cards](#9-quoted-text-and-reply-cards)
10. [Sending into a chat](#10-sending-into-a-chat)
11. [Receipts](#11-receipts)
12. [Stories](#12-stories)
13. [Compatibility with real mail clients](#13-compatibility-with-real-mail-clients)
14. [Test vectors](#14-test-vectors)
15. [Considerations](#15-considerations)
16. [Requirements and the tests that cover them](#16-requirements-and-the-tests-that-cover-them)

Appendix A: [patterns for quoted text](#appendix-a-patterns-for-quoted-text) · Appendix B: [reply and forward prefixes](#appendix-b-reply-and-forward-prefixes) · Appendix C: [named character references](#appendix-c-named-character-references)

## 1. Introduction and goals

Email Social turns an ordinary mailbox into a chat-like client. This document specifies the wire format of its messages and the algorithms a client uses to read and group them, so that an independent implementation can exchange messages with this one and show a mailbox the same way.

The design follows two goals, which take precedence over everything else in this document:

- **Plain e-mail always works.** Every message is an ordinary RFC 5322 message whose first body part is `text/plain` and holds the whole text. A recipient with any mail client reads it without knowing about Email Social. The structured data an Email Social client adds (the *ES part*) is optional for everyone else.
- **No server.** The user's mailbox, reached over IMAP and SMTP, is the only storage. Nothing in this protocol needs a server of its own, a lookup on the network, or a third-party service.

This document covers direct messages between people (one to one and small groups), delivery and read receipts, threading, the chat view built on them, and newsletters shown apart from it as stories. It does not cover the draft's federation (chapter 3), HTTP API (chapter 5), repositories, content identifiers, feeds, reactions, follows, profiles, encryption or signatures. A client MUST NOT need any of these to read or write the messages this document describes. [INT-1]

## 2. Conventions and terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals, as shown here.

Regular expressions are written in JavaScript syntax. The flag `i` means case-insensitive matching (with `u`, by Unicode simple case folding), `u` means Unicode-aware matching; `\b` is the ASCII word boundary and `\d` is `[0-9]`. **White space** without qualification, and `\s` in a regular expression, mean JavaScript's white space: TAB, LF, VT, FF, CR, SPACE, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. To **trim** is to remove white space at both ends; to **collapse** white space is to replace every run of it with one SPACE. Where a rule uses fewer characters, it names them. A **`<…>` group** is a `<`, any characters other than `<` and `>`, and a `>` (`/<([^<>]*)>/`); its *content* is what lies between the brackets. To **remove comments** from a value is to replace, in one pass, every `(` … `)` that contains no parenthesis with one SPACE (`value.replace(/\([^()]*\)/g, " ")`); where a rule removes *nested* comments, a comment runs from `(` to the matching `)`, with `\` quoting the next character.

- **Writer:** software that composes Email Social messages, receipts and story records (sections 4, 5, 10, 11, 12.4).
- **Reader:** software that turns a raw message into the message model of section 6 and checks its ES part (sections 5 and 6). A conforming reader passes the test vectors (section 14).
- **Client:** a reader and writer that also groups messages (sections 7 to 9) and sends receipts (section 11).
- **Account owner:** the person whose mailbox the client shows; *own messages* are those sent from the owner's address (or found in the owner's Sent folder).
- **ES part:** the MIME part with media type `application/vnd.email-social.message+json` (section 5).
- **Post:** an ES part with `$type` `es.social.post`; **receipt:** one with `$type` `es.social.receipt`; **story record:** one with `$type` `es.social.story`.
- **Story:** a newsletter or promotion that a client shows apart from chats for a limited time (section 12).
- **Base subject:** a subject without reply and forward prefixes and list tags (section 7.2).
- **Conversation:** messages linked by threading headers and subjects (section 7). **Chat:** every message exchanged with one set of people (section 8.1). **Topic:** a thread inside a chat (section 8.2).

Section 6 describes the message model by the names of its fields (`id`, `from`, `text`, …); the vectors use the same names. Implementations MAY use other names internally; the vectors compare the values. [INT-2]

## 3. Identifiers

### 3.1 Addresses

The canonical form of an e-mail address is the address with surrounding white space removed, one pair of enclosing angle brackets and the white space inside them removed, and the part after the last `@` lowercased (ASCII and Unicode lowercase); the local part is kept exactly as written. An address without an `@`, or with nothing before or after the last `@`, has no domain to lowercase and is not a usable address: a reader MUST NOT take it as a sender or recipient (section 6.2). [ID-1]

A reader MUST compare addresses (the owner's, a sender's, an ES part's `via`) in canonical form. It MUST NOT fold the case of the local part: RFC 5321 §2.4 leaves its interpretation to the receiving host, so `Alice@example.com` and `alice@example.com` are two addresses. [ID-2]

### 3.2 Message identifiers

A reader MUST normalise a message identifier (msg-id, RFC 5322 §3.6.4) by removing all white space inside it, removing one leading `<` and one trailing `>`, and wrapping the rest in angle brackets. A value that is empty after this, or still contains `<` or `>`, is not an identifier. [ID-3]

A reader MUST read header fields that hold a list of identifiers (`In-Reply-To`, `References`) liberally: when the value contains `<`, the content of every `<…>` group is a candidate; otherwise, after removing comments, every token between runs of white space and commas that contains `@` is a candidate. Candidates are normalised as above, invalid ones dropped, and duplicates removed keeping the first occurrence. `Message-ID` is the first identifier read this way. [ID-4]

A reader MUST give every message an `id`: its normalised Message-ID, or, when it has none, the string `sha256:` followed by the lowercase hexadecimal SHA-256 of its raw bytes. [ID-5]

### 3.3 `did:es` identifiers

A `did:es` identifier names a person in the ES part's `author` field. It is metadata only: no reader resolves it, fetches a DID document or relies on it for anything (draft §1.2–§1.4 are not implemented; DEVIATIONS D20).

```
did:es:<domain>:<local-identifier>
```

- `<domain>` is a DNS name in canonical form: one or more labels separated by `.`, each label matching `/^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/`, at most 253 characters in total. Internationalised labels appear in their `xn--` (Punycode, RFC 3492) form.
- `<local-identifier>` is one or more characters matching `/^(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+$/` (W3C DID Core `idchar`); it contains no `:`.

A reader MUST take a string as a valid `did:es` identifier exactly when it starts with `did:es:`, the next `:` separates a valid domain from a valid local identifier, and nothing else follows. Only this canonical form is valid, so identifiers compare as plain strings: an upper-case domain makes an identifier invalid. [ID-6]

The default identifier of an address is derived as follows: take the canonical address, split it at the last `@`, convert the domain to ASCII (NFC normalisation, lowercase, each label that is not ASCII replaced by `xn--` followed by its RFC 3492 Punycode encoding), and use the first 32 lowercase hexadecimal digits of SHA-256 over the UTF-8 bytes of `<local part>@<ASCII domain>` as the local identifier. For example `alice@example.com` gives `did:es:example.com:ff8d9819fc0e12bf0d24892e45987e24`. A writer MAY put any other valid `did:es` identifier in `author` instead. [ID-7]

## 4. Message format: writing

This section describes the messages a writer produces. Other software writes messages differently; section 6 reads them all.

### 4.1 Layout

A message to a recipient who has sent an ES part before (section 10) has this structure:

```
multipart/mixed; boundary="=_es_<24 hex digits>"
├── text/plain; charset=utf-8                   the whole text; 7bit or quoted-printable
└── application/vnd.email-social.message+json   the ES part; base64;
                                                Content-Disposition: attachment; filename="email-social.json"
```

- The top-level type MUST be `multipart/mixed`, and its first part MUST be the `text/plain; charset=utf-8` part holding the whole text of the message. A writer MUST NOT use `multipart/alternative` and MUST NOT add an HTML part. [WR-1]
- The ES part MUST be the second part, with media type `application/vnd.email-social.message+json`, `Content-Transfer-Encoding: base64` and `Content-Disposition: attachment; filename="email-social.json"`. [WR-2]
- The text in the `text/plain` part and the `text` of the post record MUST be identical, except that a text over 10000 UTF-8 bytes is left out of the record (section 5.2). [WR-3]
- To a recipient who has never sent an ES part, a writer SHOULD send a single-part message: `Content-Type: text/plain; charset=utf-8` and nothing else, with no ES part. Receipts always carry their ES part. [WR-4]

es-core writes the boundary as `=_es_` followed by the first 24 hexadecimal digits of SHA-256 over the Message-ID (with its angle brackets), the preamble line `This is a multi-part message in MIME format.`, and no epilogue. `=_` cannot occur in quoted-printable or base64 output, so the boundary never occurs in the parts (RFC 2045 §6.7). A writer MAY choose another boundary that cannot occur in the parts. [WR-5]

### 4.2 Header fields

A writer MUST write `Date`, `From`, `Subject`, `Message-ID`, `MIME-Version: 1.0` and `Content-Type`, and at least one of `To` and `Cc`. A reply MUST carry `In-Reply-To` with the Message-ID of the message it answers and `References` (section 4.4). [WR-6]

es-core writes the fields in this order: `Date`, `From`, `To` (when there are To recipients), `Cc` (when there are Cc recipients), `Subject` (also when empty: `Subject:`), `Message-ID`, `In-Reply-To` and `References` (replies and receipts), `Auto-Submitted: auto-replied` (receipts), `MIME-Version`, `Content-Type`.

- **Line format.** The whole message MUST use CRLF line endings and 7-bit ASCII only, so it passes any SMTP server without 8BITMIME or SMTPUTF8 (RFC 5321 §2.4). Header lines SHOULD stay within 78 characters and MUST stay within 998 (RFC 5322 §2.1.1). [WR-7]
- **Date.** `Date` MUST be an RFC 5322 date-time. es-core writes it in UTC with the day without a leading zero: `Mon, 2 Mar 2026 09:00:00 +0000`. The instant has whole seconds, and the post's `createdAt` names the same instant (section 5.2). [WR-8]
- **Addresses.** Addresses MUST be written in canonical form (section 3.1) and MUST be ASCII addr-specs (RFC 5322 §3.4.1); a writer MUST refuse an address it cannot write so that it reads back unchanged. A display name is written as atoms when it is printable ASCII without specials, as a quoted-string when it contains specials, and otherwise as UTF-8 RFC 2047 encoded-words. Long lists are folded after the comma between mailboxes. [WR-9]
- **Subject.** The subject MUST have runs of white space (including NBSP) collapsed to one space and be trimmed before it is written, in the header and in the ES part alike. A non-ASCII subject is written as UTF-8 RFC 2047 encoded-words of at most 75 characters each, holding whole characters, separated by folding white space; es-core writes the shorter of the Q and B encodings for each word, Q on a tie. Printable ASCII that contains no `=?` or `?=` is written as it is. A reply without an explicit subject gets `Re: ` followed by the parent's subject, unless that subject already starts with `re:` in any case (RFC 5322 §3.6.5). Section 10.2 gives the subjects of chat messages. [WR-10]
- **Message-ID.** The writer's Message-ID MUST have the form `<left@right>` with printable ASCII only, no white space and exactly one `@`. [WR-11]

### 4.3 The text part

The text MUST have its line endings normalised: CRLF and lone CR become LF in the model, CRLF on the wire. A lone UTF-16 surrogate becomes U+FFFD before the text is written, so the text part and the ES record hold the same characters. [WR-12]

The text part is written as `7bit` when every line is printable ASCII or TAB, at most 76 characters long, does not end with a space or tab (RFC 2045 §6.7 rule 3), does not start with `From ` (mbox) or `.` (SMTP), and the boundary does not occur in it. Otherwise it MUST be written as `quoted-printable` (RFC 2045 §6.7): lines of at most 76 characters, soft line breaks between them, and a space or tab at the end of a line encoded. In the single-part form of section 4.1 the text is written as `7bit` only when, in addition, it is empty or ends with a line break; otherwise its quoted-printable form ends with a soft line break, so the body ends with CRLF and still decodes to exactly the text (RFC 2045 §6.7 rule 5). [WR-13]

Messages to people without Email Social end with a signature block whose `-- ` line ends with a space (section 10.4), so they are always quoted-printable (`--=20`).

### 4.4 Replies

The `References` of a reply MUST be the parent's `References` (or, when the parent has none, its `In-Reply-To` if that holds exactly one identifier), followed by the parent's Message-ID, with duplicates removed and the parent last (RFC 5322 §3.6.4). Identifiers that cannot be written in printable ASCII are left out. A chain longer than 20 identifiers keeps the first one (the root) and the 19 most recent. A message whose parent has no usable Message-ID MUST NOT carry `In-Reply-To` or `References` for it. [WR-14]

## 5. The ES part

### 5.1 Media type and encoding

A writer MUST write the media type `application/vnd.email-social.message+json` (DEVIATIONS D16). A reader MUST also accept the draft's media type `application/vnd.es.social+json`, in any letter case and with any parameters, which it ignores. [ES-1]

The body of the ES part is one JSON object (RFC 8259) in UTF-8. es-core writes it pretty-printed with two spaces of indentation and a final line feed, base64-encoded in lines of 76 characters. A reader MUST remove a leading U+FEFF before parsing the JSON. [ES-2]

### 5.2 The post record

```json
{
  "$type": "es.social.post",
  "author": "did:es:example.com:ff8d9819fc0e12bf0d24892e45987e24",
  "value": {
    "text": "Hi Bob,\n\nlunch on Friday at noon?\n\nAlice\n",
    "via": "alice@example.com",
    "createdAt": "2026-03-02T09:00:00.000Z",
    "email": {
      "messageId": "<es-vector-1@mail.example.com>",
      "subject": "Lunch on Friday?",
      "inReplyTo": "<parent@example.org>",
      "references": ["<root@example.org>", "<parent@example.org>"],
      "textSha256": "…",
      "topicRoot": "<root@example.org>",
      "topicLabel": "Trip to the hills",
      "replyTo": {
        "messageId": "<parent@example.org>",
        "from": { "name": "Bob", "address": "bob@example.org" },
        "excerpt": "Shall we take the 7:40 train?"
      }
    },
    "requestReceipts": ["delivered", "read"]
  }
}
```

The fields are written in exactly this order, and optional fields without a value are left out (es-core never writes `null` except for `replyTo.messageId`). A writer MUST NOT write the draft's `uri`, `cid`, `signature`, `updatedAt` or the lexicon fields `facets`, `embed`, `visibility`, `geo`, `reply` and `langs` (DEVIATIONS D10, D18). [ES-3]

| Field | Written | Meaning |
| --- | --- | --- |
| `$type` | always | `es.social.post` |
| `author` | optional | a valid `did:es` identifier (section 3.3) |
| `value.text` | unless too long | exactly the text of the `text/plain` part; left out when its UTF-8 form is over 10000 bytes |
| `value.via` | always | the canonical From address |
| `value.createdAt` | always | the `Date` instant as an RFC 3339 UTC timestamp with milliseconds (`.000Z`) |
| `value.email.messageId` | always | the message's own Message-ID |
| `value.email.subject` | when ≤ 500 UTF-8 bytes | the subject as written in the header (section 4.2) |
| `value.email.inReplyTo` | replies | the `In-Reply-To` identifier |
| `value.email.references` | replies | the `References` identifiers, in order |
| `value.email.textSha256` | when `text` is left out | lowercase hexadecimal SHA-256 of the UTF-8 text (with LF line endings) |
| `value.email.topicRoot` | in a topic (section 8.2) | the Message-ID of the topic's root; the root writes its own |
| `value.email.topicLabel` | in a named topic | the topic's name, white space collapsed |
| `value.email.replyTo` | deliberate replies | the message answered (section 9.5) |
| `value.requestReceipts` | optional | a subset of `["delivered", "read"]`, in that order, without duplicates |

- A text whose UTF-8 form is over 10000 bytes MUST be left out of the record and MUST then be represented by `email.textSha256`; the full text is always in the `text/plain` part (DEVIATIONS D14). [ES-4]
- A subject over 500 UTF-8 bytes MUST be left out of the record and is still written in the header. [ES-5]
- `createdAt` MUST name the same instant as the `Date` header. [ES-6]
- `email.topicRoot` MUST be a writable Message-ID: a topic whose root has a synthetic `sha256:` id has none, and the field is left out. `email.topicLabel` is written on every message of a named topic, not only on its root. `email.replyTo` is written only on a deliberate reply: `messageId` is the target's Message-ID or `null` when it has none, `from` its sender (display name and canonical address) and `excerpt` the start of what the sender wrote, at most 140 characters (section 9.5). It has nothing to do with the RFC 5322 `Reply-To` field (DEVIATIONS D25). [ES-7]

### 5.3 The receipt record

```json
{
  "$type": "es.social.receipt",
  "author": "did:es:…",
  "value": {
    "kind": "read",
    "messageId": "<es-vector-1@mail.example.com>",
    "via": "bob@example.org",
    "createdAt": "2026-03-02T09:12:00.000Z"
  }
}
```

`kind` is `delivered` or `read`; `messageId` names the message the receipt is about; `via` is the canonical address of the account sending the receipt; `createdAt` the `Date` instant. The fields are written in this order and `author` is optional. A receipt MUST NOT contain `requestReceipts`. [ES-8]

### 5.4 Reading a record

A reader MUST parse the JSON of an ES part as follows, liberal with optional fields and strict with required ones. [ES-9]

1. Invalid JSON, a root that is not an object, or a missing or non-object `value` → no record.
2. `author`: kept when it is a valid `did:es` identifier (section 3.3), else `null`.
3. `value.via`: a string whose canonical form (section 3.1) contains `@`; otherwise no record.
4. `value.createdAt`: a string matching RFC 3339 §5.6 `date-time` (`YYYY-MM-DDTHH:MM:SS`, optional fraction, `Z` or `±HH:MM`; `T` and `Z` in either case) with month 1–12, day 1–31, hour ≤ 23, minute ≤ 59, second ≤ 60 and offset hour ≤ 23, offset minute ≤ 59; otherwise no record. The string is kept as written.
5. `$type` `es.social.post`:
   - `email` (when an object): `messageId` and `inReplyTo` are normalised (section 3.2) when they are strings, else `null`; `subject` is kept when it is a string, else `null`; `references` keeps the string elements that normalise, in order, without duplicates; `textSha256` is kept, lowercased, when it is 64 hexadecimal digits, else `null`; `topicRoot` is normalised when it is a string, else `null`; `topicLabel` is kept when it is a string, else `null`; `replyTo` is kept when it is an object whose `from` is an object with an `address` string that is a usable address in canonical form: `messageId` normalised when it is a string else `null`, `from.name` when a string else `""`, `excerpt` when a string else `""`; any other `replyTo` is `null`. A missing or non-object `email` gives all of these their empty values (`null`, and `[]` for `references`).
   - `text`: required as a string, unless `text` is absent or `null` and `email.textSha256` is set; then `text` is `null`. Anything else → no record.
   - `requestReceipts`: the values `delivered` and `read` that occur in the array, in that order; `[]` when absent or not an array.
6. `$type` `es.social.receipt`: `kind` MUST be `delivered` or `read` and `messageId` a string that normalises, otherwise no record.
7. `$type` `es.social.story`: section 12.4.
8. Any other `$type` → no record. Unknown fields are ignored; the draft's envelope fields `uri`, `cid` and `signature` are ignored (DEVIATIONS D18).

### 5.5 Which ES part belongs to the message

A forward made by an ordinary client can carry another message's ES part along (DEVIATIONS D12). A reader MUST take the ES part of a message only as follows; otherwise the message has no ES part (`es` is `null`) and the part is listed as an ordinary attachment (section 6.8). [ES-10]

1. Consider only the first leaf of the MIME tree (in part order, section 6.4) whose media type is an ES media type (section 5.1). Later ES parts are attachments.
2. Decode its body (section 6.4) as UTF-8, replacing invalid sequences with U+FFFD, and parse it (section 5.4). No record → no ES part.
3. When the message has a From address, the record's `via` MUST equal it (both canonical).
4. For a post or a story record, when both the message's Message-ID and the record's `email.messageId` are present, they MUST be equal. A receipt is about another message; only its `via` is checked.

## 6. Reading a message

A reader turns the raw bytes of a message into the model below. The test vectors (section 14) give the expected model for 58 messages in real client formats and 9 messages written by es-core. A reader MUST produce, for each vector, a model equal to `expected` (field order does not matter, array order does). [RD-1]

The model, in TypeScript notation (`?:` is not used: every field is always present):

```ts
interface Message {
  id: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];                 // the RFC 5322 Reply-To field
  date: string | null;                // "2026-03-02T09:00:00.000Z"
  subject: string;
  text: string;
  textSource: "plain" | "html" | "none";
  es: Post | Receipt | StoryRecord | null;
  attachments: Attachment[];
  refs: { messageId: string | null; inReplyTo: string[]; references: string[] };
  delivery: { listHeaders: string[]; listId: string | null; autoSubmitted: string | null;
              precedence: string | null; returnPath: string | null;
              listUnsubscribe: { uris: string[]; oneClick: boolean } | null };
}
interface Address { name: string; address: string }   // name "" when there is none
interface Attachment { filename: string | null; contentType: string; disposition: "inline" | "attachment";
                       size: number; contentId: string | null; partId: string }
interface Post {
  $type: "es.social.post"; author: string | null; text: string | null; via: string; createdAt: string;
  email: { messageId: string | null; subject: string | null; inReplyTo: string | null; references: string[];
           textSha256: string | null; topicRoot: string | null; topicLabel: string | null;
           replyTo: { messageId: string | null; from: Address; excerpt: string } | null };
  requestReceipts: ("delivered" | "read")[];
}
interface Receipt { $type: "es.social.receipt"; author: string | null; kind: "delivered" | "read";
                    messageId: string; via: string; createdAt: string }
interface StoryRecord {
  $type: "es.social.story"; author: string | null; via: string; createdAt: string;
  email: { messageId: string; textSha256: string | null }; title: string; expiresAt: string | null;
  unsubscribe: { mailto: string } | { url: string } | null; text: string | null;
}
```

`Post`, `Receipt` and `StoryRecord` are the records of sections 5.4 and 12.4 with the fields of `value` beside `$type` and `author`.

| Field | Value |
| --- | --- |
| `id` | section 3.2 |
| `from` | the first mailbox of the first `From` field that has one (section 6.2), or `null`; `Sender` is never used instead |
| `to`, `cc`, `replyTo` | every mailbox of every `To`, `Cc`, `Reply-To` field, in order |
| `date` | the first `Date` field (section 6.2) as an ISO 8601 UTC string with milliseconds, or `null` |
| `subject` | the first `Subject` field, RFC 2047-decoded, every run of SPACE, TAB, LF, VT, FF and CR replaced with one SPACE, and a SPACE at the start and at the end removed; `""` when absent |
| `text`, `textSource` | section 6.6 |
| `es` | section 5.5 |
| `attachments` | section 6.8 |
| `refs` | `messageId`: the first identifier of the first `Message-ID` field, or `null`; `inReplyTo` and `references`: the identifiers of the first `In-Reply-To` and the first `References` field, `[]` when absent (section 3.2) |
| `delivery` | section 6.9 |

A reader MUST NOT fail on any input: malformed parts give empty values, never an error. When a raw message is supplied as text instead of bytes, es-core reads the UTF-8 bytes of that text. [RD-2]

### 6.1 Header section

1. When the input starts with the bytes `From ` followed by optional SPACE or TAB and then anything but `:`, that first line is an mbox envelope line and is skipped.
2. Lines end at LF; a CR directly before the LF belongs to the line break. The header section ends at the first empty line (one that is only CRLF or LF); the body starts after it. Without an empty line the whole input is header and the body is empty.
3. A line starting with SPACE or TAB continues the previous field; unfolding removes the line break only, keeping the white space (RFC 5322 §2.2.3).
4. A field starts with a name of printable ASCII characters other than `:` (`[\x21-\x39\x3b-\x7e]+`), optional SPACE or TAB, and `:` (RFC 5322 §4.5.3 allows the white space). Lines that neither start a field nor continue one are skipped, and so are their continuations.
5. The field value is everything after the colon, with leading and trailing SPACE, TAB, CR and LF removed. Its bytes are read as UTF-8 when they are valid UTF-8 (RFC 6532) and as windows-1252 otherwise, per field. Encoded-words are not decoded at this stage.
6. Field names are matched without regard to case. "The first X field" means the first field named X in the section.

A reader MUST read header sections this way. [RD-3]

### 6.2 Header values

**Encoded-words (RFC 2047).** In the subject, in display names and in MIME parameters (section 6.3), a reader MUST decode every encoded-word, a match of `/=\?([^?\s]+)\?([BbQq])\?([^?\r\n]*)\?=/` (charset and encoding in any case; the charset may carry an RFC 2231 `*language` suffix, which is removed with everything after the first `*`; the payload may contain spaces but not `?`, CR or LF): B as base64 (section 6.4), Q with `_` as space and `=XX` as a byte, an invalid `=` kept literally, raw non-ASCII characters kept as their UTF-8 bytes. SPACE, TAB, CR and LF between two encoded-words are removed (§6.2), and such adjacent encoded-words in the same charset are joined as bytes before the charset is decoded, so a character split across two words is restored. Malformed words are left as they are. Encoded-words that touch other text or sit inside quoted strings are decoded too. The bytes are decoded with the rules of section 6.5. [RD-4]

**Address lists.** A reader MUST read `From`, `To`, `Cc` and `Reply-To` as address lists (RFC 5322 §3.4, obsolete forms §4.4) by tokenising the value into quoted strings (with quoted-pairs), comments (nested, with quoted-pairs), angle-bracket groups `<…>`, the separators `,` `;` `:` and words (runs of characters other than SPACE, TAB, CR, LF and `"()<>,;:`; a word that starts with an encoded-word whose payload has no white space, `/=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=/`, takes all of it even when it contains `:` or `,`, and then continues as usual; a stray `>` or `)` is dropped, and ends the word before it). An angle-bracket group runs to the next `>` (or the end); a comment's text keeps its nested parentheses. Then: [RD-5]

1. Entries are separated by `,` and `;`. A `:` outside a group, in an entry without an angle-bracket group, starts a group: the tokens of the entry so far (the group's name) are dropped and the members are read as entries; `;` ends the group. Any other `:` is ignored (groups do not nest). A word, quoted string or angle-bracket group after an angle-bracket group starts the next entry even without a comma.
2. An entry with an angle-bracket group: its address is the group's content with an obsolete source route (`/^[ \t\r\n]*@[^:"<>]*:/`) removed, and then nested comments, SPACE, TAB, CR and LF removed outside quoted strings (quoted strings are kept with their quotes); its name is the display name: the entry's words and quoted strings before the group, joined with one space where SPACE, TAB, CR, LF or a comment separated them, encoded-words decoded, runs of SPACE, TAB, CR and LF replaced with one SPACE, and trimmed; or, when that is empty, the text of the entry's first comment, decoded, its runs of SPACE, TAB, CR and LF replaced with one SPACE, and trimmed.
3. An entry without an angle-bracket group: leaving comments out, tokens not separated by SPACE, TAB, CR or LF form chunks; when exactly one chunk contains a word with `@`, it is the address (its tokens joined as written, quoted strings with their quotes) and the name is the text of the entry's first comment (decoded, runs of SPACE, TAB, CR and LF replaced with one SPACE, trimmed) when that is not empty, else the other chunks read as a display name (as in rule 2). When several chunks contain `@`, each is a separate address without a name.
4. An entry whose address has no domain (section 3.1) is dropped. Addresses are given in canonical form.

**Dates.** A reader MUST read the first `Date` value as follows. [RD-6] Nested comments are replaced by one SPACE each, white space is collapsed and the value trimmed; an empty value has no date. The value is matched against the RFC 5322 form (obsolete forms §4.3 included)

```
/^(?:\p{L}+\.?\s*,?\s*)?(\d{1,2})\s*[- ]?\s*([a-z]+)\.?\s*[- ]?\s*(\d{2,4})\s+(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?(?:\s*([+-]\d{2}:?\d{2}(?=\s+[a-z]+$|$)|[a-z]+(?:\s*[+-]\d{2}:?\d{2})?))?(?:\s+[a-z]+)?$/iu
```

whose groups are day, month, year, hour, minute, second and zone; the day name is any word of letters and is not checked. The month is an English month name or its three-letter abbreviation, or `Sept`, in any case. Two-digit years below 50 are 20xx and from 50 19xx; three-digit years are added to 1900 (§4.3). The zone, with white space removed, is either `±hh[:]mm`, or a name optionally followed by such an offset; a name followed by an offset (`GMT+0100`) uses the offset, and a name alone has the offset of UT, UTC, GMT, Z (0), EST (−5), EDT (−4), CST (−6), CDT (−5), MST (−7), MDT (−6), PST (−8) or PDT (−7) hours, any other name meaning +0000 (§4.3); a missing zone is +0000, and a name after a numeric offset (`-0500 EST`) is ignored. When the value does not match, it is matched against ISO 8601 as some broken senders write it

```
/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i
```

with the fraction cut or padded to milliseconds and a missing zone meaning `Z`. There is no date when neither form matches, the year is before 1900 or after 9999, the day does not exist in the month, the hour is above 23, the minute above 59, the second above 60, or a numeric offset has hours above 23 or minutes above 59. Second 60 carries into the next minute. The result is the UTC instant as `YYYY-MM-DDTHH:MM:SS.sssZ`.

### 6.3 Content-Type and Content-Disposition

A reader MUST split a `Content-Type` or `Content-Disposition` value into a first segment (up to the first `;`) and parameters. A first segment containing `=` is a parameter: the type was left out, and the first segment is then empty. Each parameter starts after `;` and white space; its name runs to the next `=` or `;`, trimmed and lowercased; a parameter without `=` is ignored, and so is an empty name. After the `=` and any SPACE, TAB, CR and LF, the value is a quoted-string (quoted-pairs unescaped; unterminated, it runs to the end; anything after it up to the next `;` is ignored) or the text up to the next `;`, trimmed. [RD-7]

- **Type.** The first segment, with comments and white space removed and lowercased, MUST match `` /^[!#$%&'*+\-.^_`|~0-9a-z]+\/[!#$%&'*+\-.^_`|~0-9a-z]+$/ ``; otherwise, and when the field is absent, the type is `text/plain` (RFC 2045 §5.2), keeping the parameters that were read. [RD-8]
- **RFC 2231.** Parameters whose name matches `/^(.+?)\*(?:(\d+)(\*)?)?$/` (`name*`, `name*0`, `name*0*`, `name*1`, …) are pieces of the parameter `name`; `name*` is piece 0, extended. Pieces MUST be joined in numeric order of their index (the first occurrence of an index wins). A piece whose name ends with `*` is extended: when it is the piece with the lowest index and contains two `'`, the text before the first `'` is the charset and everything up to the second `'` is removed; in extended pieces, `%XX` sequences and ASCII characters are bytes, decoded in that charset (section 6.5) together with the bytes of directly following extended pieces, and a raw non-ASCII character is kept as it is. Other pieces are text. When no piece is extended, RFC 2047 encoded-words in the joined value are decoded (except in `boundary`). An RFC 2231 value takes precedence over a plain parameter of the same name. [RD-9]
- **Other values.** RFC 2047 encoded-words in a plain (not extended) value MUST be decoded, except in `boundary`. For a repeated plain parameter the first occurrence wins. [RD-10]
- **Disposition.** The disposition MUST be read as: `Content-Disposition` absent → no disposition; first segment, with comments and white space removed, `inline` (any case) → `inline`; anything else → `attachment` (RFC 2183 §2.8). [RD-11]

### 6.4 MIME structure

A reader MUST parse the message into a tree of entities, each with header fields, a type, parameters, a disposition, a transfer encoding, a Content-ID and a raw body, as follows: [RD-12]

- **Transfer encoding.** `Content-Transfer-Encoding` with comments, `"` and `'` removed, trimmed and lowercased, up to the first white space or `;`; `7bit` when absent or empty.
- **Content-ID.** The content of the first `<…>` group of `Content-ID` (else the value with comments removed), normalised like a message identifier (section 3.2); `null` when absent or not an identifier.
- **Multipart.** An entity whose type starts with `multipart/` is split at its `boundary` parameter (RFC 2046 §5.1.1). A delimiter line is `--` followed by the UTF-8 bytes of the boundary, optionally `--` (a close delimiter), then only SPACE, TAB, CR and LF (transport padding); boundaries match exactly and case-sensitively. The lines of the body are read in order: at a delimiter line, the part open so far (if any) ends before the line break that precedes the delimiter line; a close delimiter ends the multipart; any other delimiter opens a part on the next line. Without a close delimiter, the last open part runs to the end of the body. The preamble and epilogue are dropped. A multipart without a `boundary` parameter (or with an empty one), or whose body contains no delimiter line, is a leaf with type `text/plain`. A multipart whose first delimiter line is a close delimiter has no parts: it is a leaf and keeps its type.
- **Parts.** Each part is split into header and body at its first empty line, as in section 6.1, except that a part whose first line is neither empty nor the start of a header field (section 6.1 step 4) has no header at all. A part without `Content-Type` has the type `text/plain`, or `message/rfc822` inside a `multipart/digest` (RFC 2046 §5.1.5).
- **Part numbers.** The root has the part number `""`; the parts of a multipart are numbered `1`, `2`, … and nested parts `2.1`, `2.2`, …, as IMAP does (RFC 9051 §6.4.5). Part order is the order of these numbers (depth first).
- **Depth.** The root is at depth 0 and the parts of an entity at depth *d* are at depth *d* + 1. A multipart at depth 32 or more is not split: it is a leaf and keeps its type.
- **Encapsulated messages.** A `message/rfc822` or `message/global` part is a leaf: its content is an attached message, not part of this one.

**Decoding a body.** A reader MUST decode `base64` bodies ignoring every character outside the alphabet `A–Z a–z 0–9 + /`, stopping at the first `=`, with each 4 characters giving 3 bytes and a trailing 2 or 3 characters giving 1 or 2 bytes (a lone trailing character gives none). It MUST decode `quoted-printable` bodies line by line: trailing SPACE and TAB of each line are removed; a line then ending in `=` is a soft line break, removed together with its line break; `=XX` (hexadecimal in either case, both digits before the end of the line) is one byte; any other `=` is kept; hard line breaks (CRLF or LF) and 8-bit bytes pass through. Any other transfer encoding leaves the body as it is. [RD-13]

### 6.5 Charsets

A reader MUST decode text from bytes with the charset label of its part (or encoded-word, or RFC 2231 piece) as follows: [RD-14]

1. The label is trimmed, surrounding quotes removed, and lowercased.
2. No label, or a US-ASCII label (`us-ascii`, `ascii`, `ansi_x3.4-1968`, `iso646-us`, `us`, `iso-ir-6`, `csascii`): ASCII bytes are ASCII; when any byte is 0x80 or above, the bytes are read as UTF-8 when they are valid UTF-8, else as windows-1252. Real mail that omits the charset or claims US-ASCII often carries 8-bit text.
3. A label of the WHATWG Encoding Standard: decoded with that encoding, invalid sequences becoming U+FFFD. The Encoding Standard maps `iso-8859-1`, `latin1` and `us-ascii`'s neighbours to windows-1252, which is what such senders use.
4. `x-user-defined`, labels the Encoding Standard does not know (`utf-7`, `cp852`, …) and labels it maps to `replacement`: as in step 2 for 8-bit bytes (UTF-8 when valid, else windows-1252).
5. A UTF-8 byte order mark at the start is removed.

### 6.6 Body text

The `text` of a message is what a plain-text mail reader shows: `text/plain` wherever it exists, HTML reduced to text only when there is none. A reader MUST choose and join it as follows. [RD-15]

A **body-text leaf** is a leaf of type `text/plain` or `text/html` without the disposition `attachment` and without a file name (section 6.8). The chosen leaves of an entity are:

- a body-text leaf: itself; any other leaf: none;
- `multipart/alternative`: the chosen leaves of the first child whose chosen leaves include a `text/plain` part with non-blank text; else those of the last child whose chosen leaves include HTML (RFC 2046 §5.1.4: later is richer); else those of the first child with any chosen leaf;
- `multipart/related`: those of the child whose Content-ID equals the `start` parameter (normalised like a Content-ID), else of the first child (RFC 2387 §3.2);
- any other multipart (`mixed`, `signed`, `report`, …): those of every child, in order.

Of the chosen leaves of the root, the `text/plain` ones are used when at least one of them has non-blank text; otherwise the `text/html` ones, reduced to text (section 6.7), when there are any; otherwise the `text/plain` ones (all blank). Each used part's text is appended, skipping empty texts, with one `\n` inserted between two texts when the earlier one does not end with `\n`. The text is never trimmed. `textSource` is `plain` or `html` according to the parts used, and `none` when the text is empty.

**Text of a `text/plain` part.** The text of a `text/plain` part MUST be its decoded body (section 6.4) decoded in its charset (section 6.5), CRLF and lone CR turned into LF, and, when the `format` parameter is `flowed` (any case), unwrapped as below with `DelSp` taken from the `delsp` parameter (`yes`, any case). [RD-16]

**format=flowed (RFC 3676).** A reader MUST unwrap a flowed text as follows. The text is split into lines; a final empty line (the text ends with a line break) is remembered and removed. For each line: its quote depth is the number of leading `>` characters; after them, one leading space is removed (space-stuffing, §4.4); the content `-- ` is a signature separator; any other content ending in a space is *flowed*. A paragraph is open while flowed lines follow each other. Before a line is added, an open paragraph is closed when the line has a different quote depth or is a signature separator. The line's content is appended to the open paragraph (or starts one), without its trailing space when it is flowed and DelSp is `yes`; when the line is not flowed, the paragraph is closed. A closed paragraph is written as its text at depth 0, and otherwise as `>` repeated for the depth, followed by a space and the text when the text is not empty. Lines are joined with `\n`, and a final `\n` is added when the input ended with a line break. [RD-17]

### 6.7 HTML reduced to text

HTML is reduced to plain text without rendering or fetching anything. A reader MUST reduce it as follows to pass the vectors; nothing else in this document depends on it. [RD-18]

The input (after CRLF and CR become LF) is read from left to right:

1. **Text** between tags has its character references decoded (below) and is written. Outside `<pre>`, every run of SPACE, TAB, LF, FF and CR becomes one space; a leading space is dropped when nothing has been written yet, when the output ends with a line feed or a space, or when a line break is pending; a text that is then a single space is appended as it is, without applying pending line breaks. Inside `<pre>` the text is written as it is, without the line feed that directly follows the `<pre>` start tag.
2. `<!--` starts a comment that ends after `-->` (or at the end of input). `<!` and `<?` start a declaration or processing instruction that ends after the next `>`.
3. A tag is `<`, an optional `/`, a name matching `[A-Za-z][A-Za-z0-9:_-]*`, and everything up to the next `>` outside a quoted attribute value (a `"` or `'` whose previous character other than SPACE, TAB, LF and FF is `=` opens one, and the same quote character closes it). A `<` not followed by a name is text. An unterminated tag ends the input. Tag names are compared lowercased.
4. A `head` start tag hides text and `br` until `</head>` or a `body` tag (start or end). A `script`, `style`, `title` or `template` start tag hides everything up to the next `</` followed by its name (any case) and then white space, `/`, `>` or the end of the input, and from there up to the next `>`; without such a closing tag the rest of the input is hidden.
5. `br` writes a line feed, after applying pending line breaks and the line prefix as for text (below).
6. `p`, `h1`–`h6` and `table` (start or end) request a blank line before the next text.
7. `address`, `article`, `aside`, `blockquote`, `caption`, `center`, `dd`, `details`, `div`, `dl`, `dt`, `fieldset`, `figcaption`, `figure`, `footer`, `form`, `header`, `hr`, `li`, `main`, `nav`, `ol`, `pre`, `section`, `summary`, `tbody`, `tfoot`, `thead`, `tr` and `ul` (start or end) request a new line before the next text. In addition, `blockquote` changes the quote depth (start +1, end −1, never below 0), `li` starts a list item and `</li>` ends it, and `pre` changes the preformatted depth.
8. A `td` or `th` start tag writes text consisting of one space (subject to rule 1).
9. Every other tag is ignored.

Before writing text (other than the single space of rule 1) or the line feed of a `br`, a writer applies the pending line breaks: when something has been written, it appends as many line feeds as are missing to reach the request (one for a new line, two for a blank line), counting the line feeds the output already ends with; nothing is added before the first text; the request is then cleared. Then, when the output is empty or ends with a line feed, it writes `> ` once per quote level, and a pending list item writes `- ` (once). So nested blocks add no blank lines, and an empty line made by `<br>` inside a quote reads `>`. Inside `<pre>`, every line feed of the text is followed by `> ` once per quote level.

Finally, every U+00A0 becomes a space, every line has trailing white space removed, runs of three or more line feeds become two, and the result is trimmed.

**Character references.** `&#` followed by decimal digits, `&#x` or `&#X` followed by hexadecimal digits, and `&` followed by a name (a letter and then one or more letters or digits, as many as follow) are character references, each optionally followed by `;`. A numeric reference is decoded whether or not `;` follows it; one to 0, above U+10FFFF, to a surrogate, or with more than 8 digits gives U+FFFD; one in the range 0x80–0x9F gives the windows-1252 character with that byte (the five bytes windows-1252 leaves undefined give the C1 control of that number). A named reference is decoded when its name is in [appendix C](#appendix-c-named-character-references) (names are case-sensitive) and it is followed by `;`, or when it is `amp`, `lt`, `gt`, `quot`, `nbsp`, `copy` or `reg` without `;`. Any other reference is left as written: `&copy2026` stays, because its name is `copy2026`.

### 6.8 Attachments

Every leaf of the MIME tree that is not a body-text leaf (section 6.6) and is not the accepted ES part (section 5.5) is an attachment, in part order. For each, a reader MUST give: [RD-19]

| Field | Value |
| --- | --- |
| `filename` | the `filename` parameter of Content-Disposition, else the `name` parameter of Content-Type (RFC 2183 §2.3, RFC 2046 §4.5.1), when not blank; else `null` |
| `contentType` | the lowercased type (section 6.3) |
| `disposition` | the Content-Disposition (section 6.3); when absent, `inline` if the part has a Content-ID (it is referenced from the body), else `attachment` |
| `size` | the number of bytes of the decoded body (section 6.4) |
| `contentId` | the normalised Content-ID, or `null` |
| `partId` | the part number (section 6.4); `1` for the body of a message that is not multipart |

Body-text leaves are never attachments, also when another part was chosen as the text (an HTML alternative is not an attachment). A text part with a file name or the disposition `attachment` is never body text.

### 6.9 Delivery fields

A reader MUST record in `delivery` the header fields that tell list and program mail from mail a person wrote (section 8.3): [RD-20]

| Field | Value |
| --- | --- |
| `listHeaders` | the lowercased names among `list-id`, `list-help`, `list-unsubscribe`, `list-subscribe`, `list-post`, `list-owner`, `list-archive` (RFC 2369, RFC 2919) present in the header, sorted, each once |
| `listId` | the content of the first `<…>` of the first `List-Id`, else its whole value, trimmed and lowercased; `null` when absent or empty |
| `autoSubmitted` | the first `Auto-Submitted` value with comments removed, cut at the first `;`, trimmed and lowercased; `null` when absent |
| `precedence` | the same for `Precedence` |
| `returnPath` | the content of the first `<…>` of the first `Return-Path` (else its value), trimmed, in canonical form; `""` for the null path `<>`; `null` when absent |
| `listUnsubscribe` | `null` when there is no `List-Unsubscribe` field; else `uris`, the content of every `<…>` group of the first `List-Unsubscribe` (RFC 2369 §3.2) with white space removed (a URI may be folded), in order, empty ones and repeats left out; and `oneClick`, true when the first `List-Unsubscribe-Post` value with white space removed is `List-Unsubscribe=One-Click` in any letter case (RFC 8058 §3.1) |

## 7. Threading

A client groups messages into conversations with the algorithm below. The result MUST NOT depend on the order of the input: messages are first put in a canonical order, and every step follows that order. [TH-1]

### 7.1 Conversations

1. **Canonical order.** Sort the messages by date (instants, earliest first, messages without a date last), then by `id` in UTF-16 code-unit order. Of several messages with the same `id`, keep one (es-core keeps the one whose JSON serialisation sorts first).
2. **Reference links (RFC 5256 §2.2, JWZ).** For each message in canonical order, its *chain* is its `References` without its own id, followed by its first `In-Reply-To` id when that is present, not its own id, and not already the last element. Link each consecutive pair of the chain (parent, child) unless the child already has a parent or the parent is the child or a descendant of it (a loop). Then make the last chain element the message's parent, replacing a parent set earlier by another message's chain, unless that would close a loop. A message without a chain keeps a parent set by other messages.
3. **Groups.** Follow parents from each message to its root; every root with at least one present message forms a group of those messages (in canonical order). Identifiers that are not present stay as placeholders, so a conversation keeps its root, and its id, whether or not the root message is in the mailbox. Each group has the time of its first message, the participant set (canonical addresses of From, To and Cc of its messages), the subject key of its first message's base subject (section 7.2) and whether that subject had a reply or forward prefix. Sort the groups by time (undated last), then by root id.
4. **Subject fallback.** Take the groups in that order. A group joins the first earlier conversation with the same subject key when:
   - the key is empty and the participant sets are equal; or
   - the key is not empty, one participant set contains the other, and either the group's subject had a prefix or no group of the conversation so far had an unprefixed subject (two separate originals with the same subject, such as a weekly report, stay apart).

   Otherwise it starts a new conversation rooted at the group's root. A conversation's participant set is the union of those of its groups.
5. **Result.** For each conversation: its messages in canonical order; `id` = `conv-` + the first 32 hexadecimal digits of SHA-256 over the UTF-8 root id; `rootMessageId`; `subject` = the base subject of the earliest message whose base subject is not empty, else `""`; `participants` = the contacts (section 7.3) of its messages, as `{ name, address }` sorted by address; `messageIds`; `firstDate` and `lastDate` of its dated messages (or `null`). Conversations are sorted by last date, newest first, undated last, then by id.

A client MUST thread by `References` and `In-Reply-To` as in steps 2 and 3, and MUST keep placeholder roots. [TH-2] A client that also uses the subject fallback (step 4) MUST apply the participant containment guard and the unprefixed-original rule, so unrelated people with the same subject are never merged. [TH-3] Conversation ids MUST be derived from the root id as in step 5. [TH-4]

### 7.2 Base subject

A client MUST compute the base subject as in RFC 5256 §2.1, extended with the reply and forward prefixes real clients write in their users' languages (DEVIATIONS D9): starting from the subject (in NFC), repeat until nothing changes: [TH-5]

1. replace every run of white space, NBSP (U+00A0) and narrow NBSP (U+202F) with one space and trim;
2. remove a trailer `(fwd)` (any case) with the white space before it, as often as it occurs; this counts as a forward;
3. when the whole subject is `[fwd: …]` (any case), keep only its content; a forward; then start again;
4. when the subject starts with `[…]` (no brackets inside) followed by optional white space, and something follows it, remove it (a list tag); then start again;
5. when the subject starts with a prefix token from [appendix B](#appendix-b-reply-and-forward-prefixes), an optional counter `[n]`, `(n)` or `^n`, an optional `.`, optional white space and `:` or the full-width `：` (U+FF1A), remove it and the white space after it; it counts as a reply or a forward according to the token; then start again.

The result keeps its casing. Single-letter tokens (Italian `R:`, `I:`, Hungarian `V:`) are not prefixes. The **subject key** used for comparisons is the base subject in NFC, lowercased.

### 7.3 Contacts

Contacts give the names shown for addresses. A client SHOULD derive them as follows, so that a person keeps the name they use themselves. For a set of messages (deduplicated by `id`, read oldest first with undated messages first, then by id), every canonical address in From, To and Cc, except excluded ones, is a contact with: [TH-6]

- `count`: the number of distinct messages that mention it;
- `lastSeen`: the latest date of those messages, or `null`;
- `names`: the distinct display names seen, most recent message first, and within a message the From name first. A display name is the name with white space collapsed and trimmed, with one pair of single quotes around it removed (Outlook writes `'Anna Becker'`), and dropped when it equals the address (ignoring case);
- `name`: the most recent name used in From, else the most recent name used in To or Cc, else `""`.

Contacts are sorted by `lastSeen`, newest first (never dated last), then by address.

## 8. Chats and topics

### 8.1 Chats

A chat is every message exchanged with exactly one set of people, whatever the subjects (DEVIATIONS D22). The participants of a message are the canonical addresses in From, To and Cc, without the account owner's addresses. A client MUST group messages into chats as follows: [CH-1]

1. Put the messages in the canonical order of section 7.1, keeping one copy of each id.
2. Group them by their sorted participant list (UTF-16 code-unit order); messages to oneself only form the chat with no participants.
3. For each chat: `id` = `chat-` + the first 32 hexadecimal digits of SHA-256 over the UTF-8 participant addresses, sorted and joined with `\n`; `participants` = `{ name, address }` with the contact name (section 7.3, computed over the chat's messages without the owner); `messages` = `{ id, subject }` in canonical order, `subject` being the base subject; `firstDate`, `lastDate`.
4. Chats are sorted by last date, newest first, undated last, then by id.

A client MUST NOT show mail from lists and programs (section 8.3) as chats. [CH-2]

### 8.2 Topics

A topic is a thread inside a chat. Every chat has one implicit topic; an Email Social user may name more. A topic is identified by the `id` of its root message, never by the subject text, and a message never moves between topics once it is placed (DEVIATIONS D24). A client that shows topics MUST place the messages of one chat, in the order of section 8.1, by the first rule that applies: [TP-1]

1. the ES part names a `topicRoot` that is the message's own id → the message is the root of a new topic; a `topicRoot` that is the id of an earlier message of the chat → that message's topic;
2. the message answers an earlier message of the chat (its first `In-Reply-To` id, else the newest `References` id that is earlier in the chat; never its own id) → that message's topic;
3. its base subject is not empty and has the same subject key as the base subject of an existing topic → the newest such topic (Outlook replies without threading headers, DEVIATIONS D8);
4. it carries any `In-Reply-To` or `References` id other than its own, or its subject has a reply prefix, or its base subject is empty → the topic of the previous message of the chat; the chat's first message is a root;
5. otherwise (a fresh mail: no threading headers, no reply prefix, a new base subject) → the root of a new topic, whatever client wrote it.

Messages whose `Auto-Submitted` value is present and not `no` MUST be left out of topics, reply cards (section 9.5) and subject notes (section 9.6). [TP-2]

Each topic has `rootId`; `label`, the `topicLabel` of the oldest message of the topic that carries a non-empty one (white space collapsed), else `null`; `base`, the root's base subject; `kind`: `named` when it has a label, `carrier` when it has none and its root carries a post or its base subject starts with `Message from ` and continues, `plain` otherwise; and `count`. Each placed message has a `topicStart` flag, true when the previous placed message belongs to another topic (and for the first). The result MUST depend on nothing but the messages: not on the time of reading, the order of input or the messages of other chats. [TP-3]

**Carrier subject.** The subject of the first message an Email Social client sends into a topic without a name is `Message from ` followed by the sender's display name (white space collapsed; the address when the name is empty). When the chat has more than one other person, ` to ` follows with the others' display names (white space collapsed; addresses when they have none), deduplicated and sorted by canonical address, at most three, joined with `, `, then ` +N` for the rest (`Message from Alice to Bob, Carol, Dan +2`). Exchange groups conversations by the normalised subject alone, so a subject naming only the sender would merge a one-to-one and a group chat with the same people. The carrier subject MUST NOT be derived from the message text. [TP-4]

### 8.3 Lists and programs

A client MUST classify a message as `list` mail when `delivery.listHeaders` is not empty, `precedence` is `list` or its ES part is a story record (section 12.4); otherwise as `automated` when `autoSubmitted` is present and not `no` (RFC 3834 §5), `precedence` is `bulk` or `junk`, `returnPath` is `""` (bounces, RFC 5321 §4.5.5), or the local part of the From address matches `/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster)(?:[-+_.].*)?$/i`; otherwise as `person`. The account owner's own messages MUST always be `person`. es-web shows list and automated mail apart from chats, under "Other mail". [CH-3]

## 9. Quoted text and reply cards

Ordinary clients quote the whole message they answer below or above the reply (DEVIATIONS D21). A chat view shows what the sender wrote now, not the quote. The rules in this section are what es-core does; a client MAY show quoted text differently, but a reader that claims to produce the vectors' `split` field MUST follow section 9.1 exactly. [QT-1]

### 9.1 Splitting a text

A text is split into `fresh` (what the sender wrote now), `quoted` (earlier messages their client quoted) and `signature`. Every non-blank line MUST end up in exactly one part; nothing is dropped. The text of an Email Social post is entirely `fresh`. For any other message, with the patterns of [appendix A](#appendix-a-patterns-for-quoted-text): [QT-2]

1. **Tail.** Scan the lines (CRLF and CR read as LF) from the top, skipping quote lines (`QUOTE`) and blank lines. The *tail* starts at the first line that is an original-message, forwarded-message or Apple Mail forward separator; or at the first line that starts an Outlook header block (below), moved up to a `DIVIDER` line directly above it (skipping blank lines); or at the first line that ends a strict attribution (below) that is not followed (after blank lines) by a quote line, the tail then starting at the attribution's first line. Every line from the tail on is `quoted`.
2. **Quote blocks.** Before the tail, a quote block is a run of quote lines, blank lines between them included. When the nearest non-blank line above a block (after the previous block) ends an attribution (non-strict), the block starts at that attribution's first line.
3. **Signature.** Outside quote blocks and before the tail, the signature starts at the last `SIGNATURE_DELIMITER` line; without one, at the last `FOOTER_DIVIDER` line; without either, the last non-blank line is the signature when, trimmed, it is at most 80 characters long and matches `MOBILE_SIGNATURE`. A delimiter or footer signature runs to the tail; a mobile one is that line only. Lines of quote blocks inside it stay in their blocks.
4. **Interleaving.** The reply is *interleaved* when some quote block before the signature has a non-blank line that is not in any block and not in the signature both above it and below it.
5. **Roles.** A quote block is `quoted` when it starts at or after the signature, when no such fresh line follows it, or, in a reply that is not interleaved, when no such fresh line precedes it. Other blocks stay `fresh`, with the answers around them.
6. **Collecting.** Each part is the runs of its lines, blank lines at the edges of each run removed, empty runs dropped, runs joined with one blank line.

**Outlook header blocks.** A header block starts at a line whose label (`HEADER_LABEL`, trimmed and lowercased) is a From label (`from`, `od`, `von`, `de`, `van`, `da`, `från`, `fra`), when at least two different other labels (`sent`, `date`, `to`, `cc`, `bcc`, `subject`, `reply-to`, `odesláno`, `datum`, `komu`, `kopie`, `předmět`, `gesendet`, `an`, `betreff`, `envoyé`, `à`, `objet`) occur on the next seven lines before a blank line.

**Attributions.** An attribution is 1 to 3 consecutive non-blank, non-quote lines ending at a given line, at most 300 characters when trimmed and joined with spaces, containing a digit or `@`, and matching `ATTRIBUTION_END`, `GERMAN_ATTRIBUTION` or `MUTT_ATTRIBUTION`. It must also match `ATTRIBUTION_START` unless it is a single line and not strict. The longest such window (3, then 2, then 1 lines) is used.

### 9.2 Unquoting

A client that compares a quote with the message it quotes (sections 9.3, 9.5) MUST first unquote it. `unquotedLines(quoted)` gives the lines of a quote as the quoted message had them: each line's quote marks are removed (a leading `>` after at most three SPACE, TAB or U+FEFF characters, then further `>` each optionally preceded by one SPACE or TAB, then one SPACE or TAB, then one U+FEFF), remembering the depth; then original-message and forward separators are dropped; Outlook header blocks are dropped from their From line to their last label line (lines at one depth, so a text right under the block is kept) with a `DIVIDER` line above them; attributions (non-strict, windows at one depth) are dropped. Blank lines are kept. `collapse(text)` replaces every run of white space, NBSP and narrow NBSP with one space and trims. `unquote(quoted)` is `collapse` of the unquoted lines joined with spaces. [QT-3]

### 9.3 Fragments

A sender who wants to answer one point cuts the quote down to it. With `s` the unquoted lines of a message's `quoted` part, `q = collapse(s joined with spaces)` and `p` the collapsed lines of the parent's `fresh` part that are not quote lines, a client MUST take the message as quoting a **fragment** of its parent when, and only when, all of these hold: `q` is not empty; `q` occurs in `p` and is not all of it; `s` has at most 3 non-blank lines; `q` is neither the start nor the end of `p`, unless those lines of the parent number at most 3 non-blank ones; the parent's `textSource` is not `html`; the message is not interleaved. The fragment is `q` cut to 140 characters (below). [QT-4]

**Cutting to 140 characters.** A text with white space collapsed that is longer than 140 characters is cut to its first 139 characters, then before the last space in them when there is one after the first character (else, when the last character is a high surrogate, before it), trimmed at the end, and followed by `…`.

### 9.4 Quoting a deliberate reply

When a client quotes the message a deliberate reply answers (section 10.3), it SHOULD write, so that readers recognise the quote (section 9.1), an attribution line `On <date>, <who> wrote:` and the parent's fresh text (or, when that is empty, its whole text, trimmed) with each line prefixed by `> ` (an empty line by `>`). `<date>` is `Tue, 3 Mar 2026 at 10:15` in the writer's time zone and is left out (`<who> wrote:`) when the parent has no date; `<who>` is `Name <address>`, or the address when the name is empty or is itself an address, or `an unknown sender`. At most `maxLines` lines are quoted, followed by `> [...]` when lines were cut; Email Social uses 5 (section 10.3). The quote is empty when the parent has no text. [QT-5]

### 9.5 Reply cards

A chat view shows a quote card above a **deliberate reply**, a message that answers one specific message, and only there. The card names the message answered (`messageId` when held, else `null`), its sender (display name, else address, else `""`), an excerpt, the name of its first attachment when held, and whether it can be shown (held and in the chat being shown). A client MUST NOT draw a card for a message that quotes the whole message it answers, the default of every mail client. For a message in a chat: [QT-6]

- an Email Social post whose ES part carries `email.replyTo` → a card from the carried sender and excerpt (cut to 140 characters), whether or not the target is held;
- an Email Social post without `email.replyTo` → no card, whatever its `In-Reply-To` says: it continues its topic;
- otherwise, the parent is the first `In-Reply-To` id, or, when there is none, the last `References` id; when that is the message's own id, or the parent is not held or not in the chat → no card;
- the account owner's own message without an ES part → a card when it has a `quoted` part: its fragment (section 9.3) of the parent, else the first 140 characters of `unquote(quoted)`; Email Social quotes only on a deliberate reply, and in a chat without ES parts the quote is the only record of one;
- anyone else's message without an ES part → a card when it quotes a fragment of the parent; the excerpt is the fragment.

### 9.6 Subject notes

A client MAY show a one-line note with the base subject of a message without an ES part whose base subject is not empty and differs (by subject key) from its topic's base subject, and which is not the topic's root (for example a gateway's `[EXTERNAL]` tag). The note MUST NOT change anything else: the message stays in its topic. [QT-7]

## 10. Sending into a chat

This section describes how an Email Social client composes messages so that a chat stays one conversation in every recipient's client (DEVIATIONS D23–D24). The *ES-capable* recipients of a chat are those who have ever sent an accepted ES part.

### 10.1 Format by recipient

A message MUST carry the ES part (with `requestReceipts` when the sender wants receipts; es-bridge always asks for both) only when at least one recipient has sent an ES part before; otherwise it is a single `text/plain` part (section 4.1). [SN-1]

### 10.2 Topic binding and subjects

A client MUST bind every message it sends to a topic: the topic of the message it answers (a deliberate reply), a topic chosen by its root, a topic chosen by name (the newest named or plain topic whose base subject or label has the same subject key as the name's base subject, else a new one), or by default the topic of the owner's newest message in the chat, else the chat's newest topic. [SN-2]

- **A new root** (a new topic, or the first message to a set of people) MUST have no `In-Reply-To` and no `References`. Its subject is the topic's name, or the carrier subject (section 8.2) when it has none, and with an ES part it carries `topicRoot` (its own Message-ID) and `topicLabel` when named. [SN-3]
- **Every later message** of a topic MUST carry exactly `Re: ` followed by the base subject of the topic's root, whatever prefixes other clients stacked on their replies, so the subject stays byte-stable. A topic whose root has an empty base subject gets a new carrier root instead (a deliberate reply there keeps its target's threading headers and takes the carrier subject). [SN-4]
- **A continuation** (no message chosen) MUST answer the newest message of the bound topic that has a Message-ID (`In-Reply-To`, `References` per section 4.4), or carries the subject alone when none has one; with an ES part it carries `topicRoot` (when the root has a Message-ID) and `topicLabel` (in a named topic). [SN-5]

### 10.3 Deliberate replies and quotes

A deliberate reply answers its target (its `In-Reply-To`, `References`; when the target has no Message-ID, the continuation's headers). With an ES part it carries `email.replyTo` (section 5.2; when the target has a sender) and no quote. To a chat where no recipient has ever sent an ES part, it ends with the quote of section 9.4 with at most 5 lines. A continuation MUST NOT carry a quote, and a message with an ES part MUST NOT carry a quote. [SN-6]

Quoting the whole previous message under every chat message would make Outlook's Conversation Clean Up delete the recipient's earlier messages (it deletes messages wholly contained in later ones); the cap reduces this to deliberate replies, and a target of five lines or fewer is still quoted in full (DEVIATIONS D23).

### 10.4 Footer

Every message to a chat where no recipient has ever sent an ES part MUST end with a signature block whose last line is `Sent with Email Social. Reply as you normally would; this is an ordinary e-mail.`. The block starts with a `-- ` line (RFC 3676 §4.3) unless the typed text has one of its own (a line `-- ` or `--`; the last one counts), in which case the footer becomes the last line of the user's signature block, so a message never has two delimiter lines. The body is the typed text before its signature block (trailing white space removed), a blank line, the quote (deliberate replies only), a blank line and the signature block; empty pieces and their blank lines are left out. A message with an ES part has no footer. [SN-7]

## 11. Receipts

A receipt tells the sender of an Email Social post that it was delivered to the recipient's Email Social client (`delivered`) or opened there (`read`). It replaces the MDN request of RFC 8098, which clients honour unevenly (DEVIATIONS D15, D19).

### 11.1 The receipt message

A receipt MUST be an ordinary message with the layout of section 4.1, always with its ES part, and: [RC-1]

- `Subject`: `Delivered: ` or `Read: ` followed by the original's subject (white space collapsed), or `Delivery receipt` / `Read receipt` when the original has none;
- `In-Reply-To` with the original's Message-ID and `References` as for a reply (section 4.4), so every client threads it with the original;
- `Auto-Submitted: auto-replied` (RFC 3834 §5);
- a short English text saying what happened, for example `Read receipt: the message "Lunch" (<id>) was opened by bob@example.org on Mon, 2 Mar 2026 09:12:00 +0000.`;
- the receipt record of section 5.3.

A receipt MUST NOT request receipts, as RFC 8098 §2.1 forbids an MDN in answer to an MDN. [RC-2]

### 11.2 When receipts may be sent

- A client MUST NOT send a receipt of a kind the post did not ask for in `requestReceipts`, and MUST NOT send any receipt for a message without an accepted post (plain e-mail senders never get one). [RC-3]
- A client MUST send each kind at most once per message. es-bridge records a sent receipt as the IMAP keyword `$EsDelivered` or `$EsRead` on the message (RFC 9051 §2.3.2), so the rule holds across restarts and devices; where a mailbox cannot store keywords, a client MUST NOT send `delivered` for messages that were already in the mailbox when it started. [RC-4]
- A client MAY send `delivered` when it first fetches a message that asked for it, and SHOULD NOT send it for a message already marked `\Seen` (it arrived before; `read` covers it). [RC-5]
- A client MAY send `read` when the account owner opens the chat that holds the message. [RC-6]
- A client MUST send a receipt only for incoming messages in the inbox that are not the owner's own and that have a Message-ID, and MUST address it to the post's `via`. [RC-7]

## 12. Stories

Newsletters and promotions are not conversations. A client shows them apart from chats as **stories**: above the chat list, one circle per sender, each message for a week. A story is an ordinary message and stays one: it is also listed under "Other mail" (section 8.3), and nothing about it is sent anywhere. Reading a story makes no request to its sender or to anyone else (CN-2).

### 12.1 Which messages are stories

A client MUST take a message as a story when it has a `from` and a `date`, its From address is not one of the account owner's addresses (canonical form, section 3.1), and either: [ST-1]

- its ES part (section 5.5) is a story record (section 12.4), an **explicit** story; or
- its header fields say "newsletter" (section 6.9): `delivery.listUnsubscribe` is not `null` (a `List-Unsubscribe` field, RFC 2369 §3.2); `delivery.listHeaders` does not contain `list-post` (a discussion list, where people write to each other, is not a story); `delivery.autoSubmitted` is `null` or `no` (RFC 3834 §5: order confirmations, password resets and other automated mail are not stories, whatever unsubscribe field they carry); and `delivery.returnPath` is not `""` (a bounce, RFC 5321 §4.5.5).

`Precedence: bulk` alone does not make a story. A `List-Unsubscribe` field without a usable URI still does; the story then has no way to unsubscribe (section 12.3).

The story of a message MUST depend on nothing but the message and the account owner's addresses: finding it makes no request and does not read the clock, so the same message always gives the same story. Whether a story is still shown is decided by comparing its `expiresAt` with the current time. [ST-2]

### 12.2 What a story shows

A story has the fields below. A client MUST NOT show a story at or after its `expiresAt`; the message stays where it is, in the mailbox and under "Other mail". [ST-3]

| Field | Value |
| --- | --- |
| `sender` | the message's `from`: the display name with white space collapsed and the address in canonical form |
| `title` | for an explicit story, the record's `title` with white space collapsed; otherwise the base subject (section 7.2), or, when that is empty, the first non-blank line of `text` cut to 140 characters (section 9.3) |
| `receivedAt` | `date`, the instant of the `Date` field |
| `expiresAt` | `receivedAt` plus 7 days of 24 hours; for an explicit story, the record's `expiresAt` when that is an earlier instant (never a later one) |
| `unsubscribe` | section 12.3 |
| `explicit` | `true` for an explicit story, else `false` |

### 12.3 How to unsubscribe

A client MUST take a story's `unsubscribe` from the first of these that applies: [ST-4]

1. `{ oneClick: uri }` when `delivery.listUnsubscribe.oneClick` is true (RFC 8058 §3.1) and one of its URIs starts with `https://` (in any letter case): the first such URI. RFC 8058 §3.1 requires https, so an `http:` URI is never used for a one-click request.
2. `{ mailto: address, subject }` for the first `mailto:` URI (RFC 6068) whose first address, percent-decoded and in canonical form, is usable: something before and after its last `@`, no white space and none of `<>(),;` in it, none of `:"\[]` after the `@`. `subject` is the URI's `subject` field, percent-decoded, with every control character (U+0000–U+001F, U+007F) replaced by a SPACE and white space collapsed, or `unsubscribe` when there is none or it is empty. The `body` and other fields are ignored.
3. `{ link: uri }` for the first URI that starts with `http://` or `https://`: a page for the reader to open.
4. For an explicit story: the record's `unsubscribe`, `{ mailto }` as `{ mailto, subject: "unsubscribe" }` and `{ url }` as `{ link: url }`. A record never declares a one-click request.
5. Otherwise `null`.

A mailto URI comes before a page because the client can send the message itself and nothing opens in a browser. The URIs are those of the first `List-Unsubscribe` field (section 6.9).

### 12.4 The story record

A sender can mark a message as a story with an ES part whose `$type` is `es.social.story`. es-core writes one with `writeStory`.

```json
{
  "$type": "es.social.story",
  "author": "did:es:shop.example.org:…",
  "value": {
    "via": "news@shop.example.org",
    "createdAt": "2026-03-18T08:00:00.000Z",
    "email": { "messageId": "<es-vector-9@shop.example.org>" },
    "title": "Spring sale: shoes from 20 €",
    "expiresAt": "2026-03-22T23:00:00.000Z",
    "unsubscribe": { "mailto": "leave@shop.example.org" },
    "text": "Spring sale: walking shoes, trail runners and sandals from 20 €, until Sunday.\n"
  }
}
```

| Field | Written | Meaning |
| --- | --- | --- |
| `$type` | always | `es.social.story` |
| `author` | optional | a valid `did:es` identifier (section 3.3) |
| `value.via` | always | the canonical From address |
| `value.createdAt` | always | the `Date` instant as an RFC 3339 UTC timestamp with milliseconds |
| `value.email.messageId` | always | the message's own Message-ID |
| `value.email.textSha256` | when `text` is left out | lowercase hexadecimal SHA-256 of the UTF-8 text |
| `value.title` | always | the story's title, white space collapsed, 1 to 200 UTF-8 bytes; also the `Subject` |
| `value.expiresAt` | optional | when the story stops being shown, as an RFC 3339 UTC timestamp with milliseconds |
| `value.unsubscribe` | optional | `{ "mailto": address }` or `{ "url": http or https URL }`; also written as `List-Unsubscribe` |
| `value.text` | unless too long | exactly the text of the `text/plain` part; left out when its UTF-8 form is over 10000 bytes |

A writer MUST write a story as a message with the layout of section 4.1 and the header fields of section 4.2, with `Subject` equal to the title and the record's fields in the order of the example, optional fields without a value left out. When the story has an `unsubscribe`, the writer MUST also write a `List-Unsubscribe` field with the same URI (`<mailto:address>` or `<url>`), so that ordinary clients offer it too. The title, white space collapsed, MUST be 1 to 200 UTF-8 bytes, and a text over 10000 UTF-8 bytes MUST be left out and represented by `email.textSha256` (as ES-4 says for a post). [ST-5]

A reader MUST read a story record by section 5.4 items 1 to 4 and these rules: [ST-6]

- `email.messageId`: a string that normalises (section 3.2); otherwise no record. `email.textSha256` as for a post.
- `title`: a string that is not blank and is at most 200 UTF-8 bytes, kept as written; otherwise no record.
- `text`: as for a post (section 5.4 item 5).
- `expiresAt`: kept when it is an RFC 3339 date-time (section 5.4 item 4), else `null`.
- `unsubscribe`: when it is an object with a `mailto` string, `{ mailto }` with the address in canonical form if it is usable (something before and after its last `@`, no white space, `<` or `>`), else `null`; otherwise `{ url }` when `url` is a string of at most 2000 characters that matches `/^https?:\/\/[\x21-\x7e]+$/i` and contains none of `<>"\`, else `null`.

A story record MUST NOT contain `requestReceipts`, and a reader ignores one. A client MUST NOT send a receipt (section 11) for a message that is a story (section 12.1), explicit or not, whatever its ES part asks for: the sender of a newsletter learns nothing from the reader's client. [ST-7]

### 12.5 Reading a story and leaving its sender

A client MUST show a story without making any request because of it. It shows the message text, or the message's HTML reduced to an allow-list that runs nothing and loads nothing (es-core `storyContent`): no scripts, styles, forms, frames, objects or event handlers; links only to http, https and mailto targets, opening in a new window without a referrer; image sources held back in `data-src` and `data-srcset`. Remote images are loaded only when the reader asks for them, for that story only. Opening a story marks its message `\Seen` (RFC 9051 §2.3.2) and sends no receipt (ST-7). [ST-8]

A client MUST NOT make any other request for a story than the one the reader asks for by unsubscribing, after a confirmation that names where it goes, and then exactly one, by the kind of section 12.3: [ST-9]

- `oneClick`: one HTTPS POST to the URI with the body `List-Unsubscribe=One-Click` and the media type `application/x-www-form-urlencoded` (RFC 8058 §3.1), without cookies, a referrer or other header fields; at most one redirect is followed, to https only, with the same POST; 10 seconds in all; a 2xx answer is success.
- `mailto`: one message to the address through the account's own SMTP server, with the URI's subject and an empty body, without an ES part and without a copy in the sent folder.
- `link`: no request by the client; the page opens in the reader's browser.

After any of these succeeds, the client hides the sender's stories; the messages stay under "Other mail". The reader can also hide a sender without unsubscribing, and show them again. es-bridge keeps the hidden senders in the account's settings file (section 15, RC-8).

## 13. Compatibility with real mail clients

Real clients do not follow the draft, and often not the RFCs either. [`DEVIATIONS.md`](DEVIATIONS.md) records each difference with its evidence; this section summarises what a client has to be ready for.

- **Text and structure.** Clients send `multipart/alternative` with HTML, HTML only (`textSource` `html`), 8-bit text in legacy charsets (windows-1250, iso-8859-2), quoted-printable that splits a UTF-8 character across a soft line break, `format=flowed`, attachments named with RFC 2231 or RFC 2047, and list footers as separate parts (D1–D6, D11). Sections 6.4–6.8 read all of these.
- **Identifiers and threading.** Message-IDs are chosen by other software and sometimes replaced on the way (D7); `In-Reply-To` and `References` are partial or missing (Outlook writes `In-Reply-To` only or nothing, D8); reply prefixes are localised and lists add tags (D9); the draft's AT-URI `reply` links never come from ordinary clients (D10). Sections 7 and 8.2 thread with headers, keep placeholder roots and fall back to subjects with guards.
- **Grouping in other clients.** Gmail threads by References and subject together, Exchange by the normalised subject, Thunderbird by References only; Apple Mail and Seznam.cz do not document their rules (D24). Section 10.2 keeps a chat one conversation everywhere with a stable References chain and a byte-stable `Re: <base>` subject.
- **Quotes.** Every client quotes the whole message it answers, in its own layout (D21); section 9 reads them, and section 10.3 quotes only on a deliberate reply (D23).
- **Forwards** carry another message's ES part along (D12), which section 5.5 rejects.
- **People, lists and programs** share a mailbox; section 8 tells them apart (D22).
- **Receipts** by MDN are honoured unevenly (D15); section 11 uses ordinary messages.
- **Newsletters** say what they are only through `List-Unsubscribe`, often with an RFC 8058 one-click request, and order confirmations and password resets carry the same field (D27); section 12 tells them apart and shows newsletters as stories.

| Deviation | Draft | This document |
| --- | --- | --- |
| D1 | §4.1 the JSON is an alternative to the text | the ES part is a separate attachment, `multipart/mixed` (section 4.1) |
| D2 | §4.1 example without Date, Message-ID, MIME-Version | all required (section 4.2) |
| D3 | §4.1 8-bit text, overlong JSON lines | 7bit or quoted-printable text, base64 JSON (sections 4.3, 5.1) |
| D4 | §4.1 `Content-Disposition: inline` for the JSON | `attachment` with a file name (section 4.1) |
| D5 | §4.1 HTML part | no HTML written; HTML read only without `text/plain` (sections 4.1, 6.6) |
| D6 | (none) | legacy charsets and broken encodings read (sections 6.2–6.5) |
| D7 | (none) | Message-IDs normalised, synthetic `sha256:` ids (section 3.2) |
| D8 | §4.3 headers plus ES metadata | headers with placeholders and a subject fallback (sections 7.1, 8.2) |
| D9 | (none) | localised prefixes and list tags removed (section 7.2) |
| D10 | §2.3.1, §4.3 `reply.root/parent` as AT URIs | not written, ignored; `topicRoot` and `replyTo` instead (section 5.2) |
| D11 | (none) | list footers and rewritten senders read (section 6.6) |
| D12 | (none) | an ES part must belong to its message (section 5.5) |
| D13 | §1.3 handle resolution by DNS and HTTPS | not implemented: no network lookups (section 3.3) |
| D14 | §2.3.1 `text` maxLength 10000 | in UTF-8 bytes; longer texts left out with `textSha256` (section 5.2) |
| D15 | (none) | receipts as ES messages, not MDNs (section 11) |
| D16 | §4.1 `application/vnd.es.social+json` | `application/vnd.email-social.message+json` written, both read (section 5.1) |
| D17 | §4.1 `multipart/alternative` with HTML | `multipart/mixed`, text first, ES part base64 (section 4.1) |
| D18 | §2.2–§2.5 envelope with `uri`, `cid`, `signature`; full lexicon | `$type`, `author`, `value`; the direct-message subset (section 5.2) |
| D19 | (none) | `requestReceipts` and `es.social.receipt` (sections 5.3, 11) |
| D20 | §1.1–§1.4 DID per server, documents, migration | DID derived from the address, metadata only (section 3.3) |
| D21 | (none) | quotes split off, cards only for deliberate replies (section 9) |
| D22 | §4.3 threads | chats per set of people; lists and programs apart (section 8) |
| D23 | (none) | a quote only on a deliberate reply, at most 5 lines, and a footer (section 10) |
| D24 | (none) | topics and the carrier subject (sections 8.2, 10.2) |
| D25 | (none) | `topicRoot`, `topicLabel`, `replyTo` in `email` (section 5.2) |
| D26 | §1.2–§1.4, §2.1–§2.5, §4.2 repositories, other lexicons, CIDs, signatures, DKIM | not implemented (sections 1, 5.4) |
| D27 | (none) | stories from header fields, and the `es.social.story` record (section 12) |

The draft's §2.1–§2.2 (repositories and record URIs), §2.3.2–§2.3.4 (reactions, follows, profiles), §2.4 (content identifiers), §2.5 and §4.2 (signatures, DKIM checks) are out of scope of this repository: no reader or writer here produces or interprets them (DEVIATIONS D26).

## 14. Test vectors

`packages/es-core/vectors/*.json` are the conformance suite of this document. Each file holds one raw message and the model of section 6 that a conforming reader produces from it; [`vectors/README.md`](../packages/es-core/vectors/README.md) describes the format.

```json
{
  "description": "what the message is and what it exercises",
  "source": "fixtures/<file>.eml" | "generated",
  "raw": "the message, when its bytes are valid UTF-8",
  "rawBase64": "the message bytes in base64, otherwise",
  "input": { "only for generated vectors": "what es-core serialised" },
  "expected": { "…": "the model of section 6" },
  "split": { "fresh": "…", "quoted": "…", "signature": "…" },
  "story": { "only in stories-*.json": "the story of section 12, or null" }
}
```

- **Input bytes.** Exactly one of `raw` and `rawBase64` is present. A reader MUST parse the UTF-8 bytes of `raw`, or the decoded bytes of `rawBase64`, without normalising line endings first. [VE-1]
- **`expected`.** The reader's model MUST equal `expected` by deep equality (section 6). [VE-2]
- **`split`.** A reader that implements section 9.1 MUST give `split` for the text of `expected` (with its ES part). [VE-3]
- **Generated vectors** were written by es-core from `input` with a fixed date and Message-ID. A conforming writer need not produce the same bytes, but it MUST produce messages that a conforming reader reads to the same model fields (subject, addresses, threading headers, text, ES record). [VE-4]
- **`story`.** A client that implements section 12 MUST give `story` for `expected` (with an account owner who is none of the vector's senders). [VE-5]

The 58 fixture vectors come from `packages/es-core/fixtures/`: 22 messages reconstructed from the published output formats of Gmail, Outlook, Apple Mail, iOS Mail, Thunderbird, mutt, Seznam.cz, Mailman, a newsletter sender and the draft's own layout, 29 reply formats from `fixtures/replies/`, and 7 newsletters and automated messages from `fixtures/stories/`; the 9 generated vectors cover new messages, replies, a 20 kB text, a plain message, both receipts, a named topic with a deliberate reply in it, and a story record. Every domain in them is `example.com`, `example.org` or `example.net`.

## 15. Considerations

- **What a message reveals.** The ES part repeats what the message's header already says (sender, Message-ID, subject, threading) and adds the text, receipt requests, topic names and the excerpt of a message answered. A writer SHOULD NOT put anything in the ES part that it would not put in the `text/plain` part or the header. [CN-1]
- **No lookups.** A reader MUST NOT fetch anything because of a message: no DID resolution, no handle lookup, no remote content in HTML (section 6.7 reduces HTML to text without loading anything). [CN-2]
- **Robustness.** A reader MUST bound its work on hostile input: es-core never throws, limits MIME nesting to 32 levels, and treats a malformed part as data. [CN-3]
- **Receipts** tell the sender when a message was fetched and when it was opened. That is the account owner's information, so which kinds of receipts a client sends is the owner's choice. A client SHOULD let the account owner choose between sending every kind a post asks for, only `delivered`, and none; sending fewer kinds MUST NOT change anything else, and incoming receipts are still read and shown. es-bridge reads the choice from its `--receipts all|delivered|none` option, keeps it in the account's settings file (beside the metadata cache, else in the user's configuration folder; readable by the owner only) for the next start, uses `all` when neither says anything, and sets the keyword of section 11.2 only for a receipt it sent. [RC-8]

## 16. Requirements and the tests that cover them

Paths are relative to the repository root. `›` names a test (a distinctive part of its title) in that file; a vector path means every assertion run on that vector by `packages/es-core/test/vectors.test.ts`. `packages/es-core/test/spec.test.ts` checks that every requirement above appears here exactly once and that every named test and file exists.

| Requirement | Covered by |
| --- | --- |
| INT-1 | `packages/es-core/test/es-schema.test.ts` › "ignores uri, cid and signature"; `packages/es-bridge/test/nothing-leaves.test.ts` › "a maildir session makes no outbound connection" |
| INT-2 | `packages/es-core/test/vectors.test.ts` › "parseMessage(raw) equals expected" |
| ID-1 | `packages/es-core/test/es-schema.test.ts` › "lowercases only the domain of an address"; `packages/es-core/test/address.test.ts` › "lowercases only the domain", "entries without '@'" |
| ID-2 | `packages/es-core/test/contacts.test.ts` › "folds the case of the domain only"; `packages/es-core/test/parse.test.ts` › "compares via with the canonical From address" |
| ID-3 | `packages/es-core/test/es-schema.test.ts` › "extracts message ids liberally" |
| ID-4 | `packages/es-core/test/es-schema.test.ts` › "extracts message ids liberally"; `packages/es-core/test/parse.test.ts` › "reads Message-ID, In-Reply-To (also with prose around it) and References without duplicates" |
| ID-5 | `packages/es-core/test/parse.test.ts` › "plus the hex SHA-256 of the raw bytes as id", "with the SHA-256 of no bytes as id"; `packages/es-core/vectors/mbox-lf-obsolete-date.json` |
| ID-6 | `packages/es-core/test/did.test.ts` › "parses the examples from the spec", "rejects malformed identifiers" |
| ID-7 | `packages/es-core/test/did.test.ts` › "derives a stable DID from an address", "uses the ASCII form of internationalised domains" |
| WR-1 | `packages/es-core/test/serialize.test.ts` › "is multipart/mixed with the text/plain part first and the ES part second" |
| WR-2 | `packages/es-core/test/serialize.test.ts` › "marks the ES part with its media type, base64 and an attachment disposition" |
| WR-3 | `packages/es-core/test/serialize.test.ts` › "carries a post record whose base64 decodes to the expected JSON", "keeps a text of exactly 10000 UTF-8 bytes" |
| WR-4 | `packages/es-core/test/serialize.test.ts` › "keeps the other headers of a plain message identical"; `packages/es-bridge/test/session.test.ts` › "replies to everyone else in a group as plain e-mail"; `packages/es-core/vectors/generated-plain-message.json` |
| WR-5 | `packages/es-core/test/serialize.test.ts` › "plus the first 24 hex digits of SHA-256(messageId)", "when 7bit text would contain the boundary" |
| WR-6 | `packages/es-core/test/serialize.test.ts` › "writes the header fields in the fixed order for a reply with Cc", "leaves out Cc, In-Reply-To and References for a new message", "rejects a message without recipients" |
| WR-7 | `packages/es-core/test/serialize.test.ts` › "uses CRLF only, 7-bit ASCII only, lines <= 998 and header lines <= 78" |
| WR-8 | `packages/es-core/test/serialize.test.ts` › "uses the Date header instant as createdAt"; `packages/es-core/test/date.test.ts` › "writes RFC 5322 date-time in UTC" |
| WR-9 | `packages/es-core/test/serialize.test.ts` › "encodes non-ASCII display names and quotes names with specials", "writes canonical addresses", "folds a long recipient list", "rejects %s"; `packages/es-core/test/address.test.ts` › "round trips generated lists" |
| WR-10 | `packages/es-core/test/serialize.test.ts` › "writes a non-ASCII subject as RFC 2047 encoded-words", "collapses white space runs and trims, in the header and in the ES record", "to the parent subject once, case-insensitively"; `packages/es-core/test/encoded-word.test.ts` › "chooses Q for mostly-ASCII text", "round trips generated strings" |
| WR-11 | `packages/es-core/test/serialize.test.ts` › "rejects the Message-ID %j with a TypeError" |
| WR-12 | `packages/es-core/test/serialize.test.ts` › "normalises CRLF and lone CR to LF", "replaces lone surrogates with U+FFFD" |
| WR-13 | `packages/es-core/test/serialize.test.ts` › "writes short printable ASCII lines as 7bit", "switches to quoted-printable above 76 characters per line"; `packages/es-core/test/codec-transfer.test.ts` › "encodes a space or tab at the end of a line", "protects lines starting with 'From ' and '.'"; `packages/es-core/vectors/generated-plain-message.json` |
| WR-14 | `packages/es-core/test/serialize.test.ts` › "writes References with the parent alone", "removes duplicate ids and keeps the parent last", "keeps the first and the last 19 ids", "skips reference ids that cannot be written in 7-bit ASCII"; `packages/es-core/test/receipts.test.ts` › "uses a single In-Reply-To id when there are no References", "throws a TypeError when the message has no Message-ID" |
| ES-1 | `packages/es-core/test/es-schema.test.ts` › "recognises the ES media types, including the draft"; `packages/es-core/test/parse.test.ts` › "accepts the draft media type and a base64-encoded ES part"; `packages/es-core/vectors/es-draft-layout.json` |
| ES-2 | `packages/es-core/test/es-schema.test.ts` › "removes a byte order mark before reading the JSON"; `packages/es-core/test/serialize.test.ts` › "carries a post record whose base64 decodes to the expected JSON" |
| ES-3 | `packages/es-core/test/es-schema.test.ts` › "writes a fixed key order and omits empty optional fields", "writes topicRoot, topicLabel and replyTo after the other email fields" |
| ES-4 | `packages/es-core/test/serialize.test.ts` › "leaves it out of the ES record, with its SHA-256"; `packages/es-core/test/es-schema.test.ts` › "writes a post without text as a record with email.textSha256"; `packages/es-core/vectors/generated-long-message.json` |
| ES-5 | `packages/es-core/test/serialize.test.ts` › "keeps a subject over 500 UTF-8 bytes in the header but not in the ES record" |
| ES-6 | `packages/es-core/test/serialize.test.ts` › "uses the Date header instant as createdAt" |
| ES-7 | `packages/es-core/test/serialize.test.ts` › "copies topicRoot, topicLabel and replyTo into email", "rejects a topicRoot that is not a writable Message-ID", "rejects a replyTo without a usable sender address"; `packages/es-core/test/es-schema.test.ts` › "writes a replyTo without a Message-ID with messageId null"; `packages/es-bridge/test/session.test.ts` › "starts a named topic" |
| ES-8 | `packages/es-core/test/es-schema.test.ts` › "round-trips both receipt kinds"; `packages/es-core/test/receipts.test.ts` › "carries an es.social.receipt record for both kinds", "never requests receipts itself" |
| ES-9 | `packages/es-core/test/es-schema.test.ts` › "rejects records without required fields, unknown types and invalid JSON", "drops malformed optional fields instead of rejecting the record", "reads the topic and reply fields liberally", "reads a record written before these fields existed", "validates RFC 3339 timestamps", "rejects a post with neither text nor a valid textSha256" |
| ES-10 | `packages/es-core/test/parse.test.ts` › "considers only the first ES part", "rejects an ES part whose via is not the From address", "rejects a post whose email.messageId differs from the Message-ID", "accepts a receipt about another message, checking only via", "skips the via check when the message has no From"; `packages/es-core/vectors/gmail-forward-carrying-es-part.json` |
| RD-1 | `packages/es-core/test/vectors.test.ts` › "parseMessage(raw) equals expected"; `packages/es-core/test/fixtures.test.ts` › "addresses: from, to, cc, reply-to", "attachments and ES part" |
| RD-2 | `packages/es-core/test/parse.test.ts` › "never throws and always returns a complete EsMessage", "returns a complete EsMessage for random bytes", "gives the same result for a string and for its UTF-8 bytes" |
| RD-3 | `packages/es-core/test/headers.test.ts` › "skips an mbox", "unfolds continuation lines by removing only the line break", "accepts whitespace before the colon", "skips lines without a colon and continuations of skipped lines", "falls back to windows-1252 per field", "treats a message without an empty line as all header" |
| RD-4 | `packages/es-core/test/encoded-word.test.ts` › "decodes B and Q words in any letter case", "drops whitespace between adjacent encoded-words", "joins a UTF-8 character split across two words", "strips an RFC 2231 §5 language tag", "leaves malformed words untouched", "touch surrounding text or sit inside quotes"; `packages/es-core/vectors/undisclosed-recipients.json` |
| RD-5 | `packages/es-core/test/address.test.ts` › "parses name-addr, bare addr-spec and quoted display names", "uses a trailing comment as the name", "flattens groups and drops empty groups", "does not nest groups", "strips obsolete source routes", "decodes encoded-words in names"; `packages/es-core/vectors/undisclosed-recipients.json` |
| RD-6 | `packages/es-core/test/date.test.ts` › "interprets 2-digit and 3-digit years", "understands the obsolete zone names", "treats single-letter and unknown zone names", "falls back to ISO 8601", "returns null for invalid or out-of-range dates"; `packages/es-core/vectors/mbox-lf-obsolete-date.json` |
| RD-7 | `packages/es-core/test/params.test.ts` › "lowercases the media type and parameter names", "unescapes quoted-pairs in quoted values", "keeps the first occurrence of a repeated parameter" |
| RD-8 | `packages/es-core/test/params.test.ts` › "defaults to text/plain when the header is absent or unparseable" |
| RD-9 | `packages/es-core/test/params.test.ts` › "decodes an RFC 2231 extended value", "joins RFC 2231 continuations in numeric order", "prefers an RFC 2231 value over a plain fallback"; `packages/es-core/vectors/thunderbird-attachment-rfc2231.json` |
| RD-10 | `packages/es-core/test/params.test.ts` › "decodes RFC 2047 encoded-words in quoted values", "does not decode a boundary" |
| RD-11 | `packages/es-core/test/params.test.ts` › "returns null for an absent header", "recognises inline and attachment in any case", "treats unknown or missing disposition types as attachment" |
| RD-12 | `packages/es-core/test/mime-tree.test.ts` › "numbers the parts of a multipart like IMAP", "gives the line break before a delimiter to the delimiter", "accepts transport padding", "ends the multipart at the end of input when the close delimiter is missing", "treats a multipart without a boundary parameter as a text/plain leaf", "keeps a multipart whose first delimiter line is the close delimiter", "defaults parts of multipart/digest to message/rfc822", "stops descending at depth 32", "does not descend into message/rfc822" |
| RD-13 | `packages/es-core/test/codec-transfer.test.ts` › "ignores line breaks, whitespace and characters outside the alphabet", "stops at the first padding character", "removes soft line breaks, including a UTF-8 sequence split", "keeps an invalid '=' sequence literally", "passes 8-bit bytes through unchanged"; `packages/es-core/test/mime-tree.test.ts` › "returns 7bit, 8bit, binary, unknown and absent encodings unchanged" |
| RD-14 | `packages/es-core/test/charset.test.ts` › "decodes windows-1250", "reads iso-8859-1 as windows-1252", "decodes unlabelled or us-ascii-labelled 8-bit text as UTF-8", "falls back to windows-1252 for 8-bit text", "falls back for labels the Encoding standard does not know", "removes a UTF-8 byte order mark"; `packages/es-core/vectors/outlook-cs-1250.json`; `packages/es-core/vectors/mutt-iso-8859-2.json` |
| RD-15 | `packages/es-core/test/parse.test.ts` › "in multipart/alternative takes the first text/plain", "converts the LAST HTML alternative", "uses the HTML alternative when the text/plain alternative is blank", "uses the part named by the start parameter", "joins every text part in order", "never uses a text part with a filename"; `packages/es-core/vectors/apple-mail-inline-image.json`; `packages/es-core/vectors/mailing-list-footer.json` |
| RD-16 | `packages/es-core/test/parse.test.ts` › "unwraps format=flowed after removing quoted-printable"; `packages/es-core/vectors/thunderbird-flowed.json` |
| RD-17 | `packages/es-core/test/flowed.test.ts` › "keeping the space when DelSp is no", "removes the trailing space of flowed lines when DelSp is yes", "removes one space of space-stuffing", "counts the quote depth", "does not join a flowed line with a line of a different quote depth", "recognises a quoted signature separator" |
| RD-18 | `packages/es-core/test/html-to-text.test.ts` › "drops comments, <head>, <title>, <style> and <script>", "starts block elements on a new line without adding blank lines", "quotes the lines inside <blockquote>", "decodes named, decimal and hexadecimal character references", "maps numeric references in the C1 range", "keeps white space and line breaks inside <pre>"; `packages/es-core/vectors/html-only-newsletter.json` |
| RD-19 | `packages/es-core/test/parse.test.ts` › "describes every non-text leaf", "gives part number '1' to a single-part message", "does not list them as attachments"; `packages/es-core/vectors/gmail-web-attachment.json` |
| RD-20 | `packages/es-core/test/classify.test.ts` › "records the list header fields, the List-Id, Auto-Submitted, Precedence, Return-Path and List-Unsubscribe"; `packages/es-core/vectors/mailing-list-footer.json` |
| TH-1 | `packages/es-core/test/threading.test.ts` › "gives the same output for 20 seeded shuffles", "chooses the same copy of a duplicate id"; `packages/es-core/test/fixtures-threading.test.ts` › "gives the same conversations for any order of the input" |
| TH-2 | `packages/es-core/test/threading.test.ts` › "threads a reply that has only In-Reply-To", "appends In-Reply-To to References", "keeps phantom roots", "survives a two-message reference loop"; `packages/es-core/test/fixtures-threading.test.ts` › "roots a reply whose original is not in the mailbox", "keeps the conversation id when the root message is missing" |
| TH-3 | `packages/es-core/test/threading.test.ts` › "does not merge the same subject between unrelated people", "keeps two unprefixed originals with the same subject apart", "keeps empty-subject messages apart when the participant sets differ"; `packages/es-core/test/fixtures-threading.test.ts` › "does not merge a subject-fallback reply with same-subject forwards" |
| TH-4 | `packages/es-core/test/threading.test.ts` › "derives the conversation id from the root Message-ID"; `packages/es-core/test/fixtures-threading.test.ts` › "gives every conversation an id of the form conv-<32 hex>" |
| TH-5 | `packages/es-core/test/subject.test.ts` › "normalizeSubject: counters", "normalizeSubject: mailing-list tags", "does not strip single-letter tokens", "recognises PŘ written with a combining caron", "lowercases and composes to NFC" |
| TH-6 | `packages/es-core/test/contacts.test.ts` › "prefers the name a person uses in From", "removes the single quotes Outlook puts around names", "lists distinct names, most recent first", "sorts by lastSeen (newest first, never-dated last), then by address" |
| CH-1 | `packages/es-core/test/chats.test.ts` › "puts everything exchanged with one person into one chat", "derives the id from the sorted canonical addresses of the others", "keeps a group apart from the chats with each of its members", "removes the account owner wherever it appears", "collects messages to oneself in a chat without participants" |
| CH-2 | `packages/es-bridge/test/session.test.ts` › "lists and newsletters under Other mail"; `packages/es-bridge/test-e2e/maildir.test.ts` › "lists newsletters and mailing lists only under a collapsed Other mail" |
| TP-1 | `packages/es-core/test/topics.test.ts` › "rule 1: the ES part's topicRoot", "rule 2: the topic of the message answered", "rule 3: an Outlook reply without threading headers", "rule 4: a tagged reply with no headers", "rule 5: a fresh plain mail with a new subject" |
| TP-2 | `packages/es-core/test/topics.test.ts` › "leaves out Auto-Submitted messages"; `packages/es-core/test/reply-card.test.ts` › "an Auto-Submitted message gets no card" |
| TP-3 | `packages/es-core/test/topics.test.ts` › "kind: named with a label", "reads the label from the oldest message that carries one", "marks where a run of one topic starts", "depends only on the messages" |
| TP-4 | `packages/es-core/test/topics.test.ts` › "names the sender in a chat with one other person", "names the others of a group, sorted by address, at most three and then +N" |
| CH-3 | `packages/es-core/test/classify.test.ts` › "any RFC 2369 / RFC 2919 List-* field", "Precedence: bulk or junk and the null Return-Path", "sender local parts no-reply", "Email Social receipts are automated" |
| QT-1 | `packages/es-core/test/vectors.test.ts` › "splitQuoted(expected) equals split" |
| QT-2 | `packages/es-core/test/split-quoted.test.ts` › "every file in fixtures/replies has an expectation", "treats an Email Social post as fresh text", "puts every non-blank input line into exactly one part" |
| QT-3 | `packages/es-core/test/unquote.test.ts` › "covers every reply fixture that quotes Alice", "drops attributions at every depth of a nested quote", "drops Outlook header blocks in en, cs, de and fr" |
| QT-4 | `packages/es-core/test/quoted-fragment.test.ts` › "the corpus replies quoting their parents in full", "one interior sentence", "four quoted lines", "an HTML-only parent", "an interleaved reply", "cuts a long fragment to 140 characters" |
| QT-5 | `packages/es-core/test/reply-quote.test.ts` › "writes an English attribution line and the parent", "keeps at most maxLines lines and marks the cut", "is recognised by splitQuoted" |
| QT-6 | `packages/es-core/test/reply-card.test.ts` › "Gmail reply quoting the whole Thunderbird original", "an interleaved (point by point) reply", "with replyTo whose target is not in the mailbox", "without replyTo but with In-Reply-To (a continuation)", "with a 5-line quote", "someone else's fragment quote"; `packages/es-bridge/test-e2e/maildir.test.ts` › "draws cards only above deliberate replies" |
| QT-7 | `packages/es-core/test/topics.test.ts` › "a plain sender's tagged reply", "a topic root → null" |
| SN-1 | `packages/es-bridge/test/session.test.ts` › "replies to everyone else in a group as plain e-mail", "with an Email Social recipient, a deliberate reply carries email.replyTo" |
| SN-2 | `packages/es-bridge/test/session.test.ts` › "continues the bound topic", "keeps the composer on the topic the account last wrote in" |
| SN-3 | `packages/es-bridge/test/session.test.ts` › "starts a named topic: a new root", "starts a new chat: text/plain first, the carrier subject" |
| SN-4 | `packages/es-bridge/test/session.test.ts` › "Subject 'Re: <root base>'", "starts a carrier root in a chat whose topic has no subject"; `packages/es-core/test/topics.test.ts` › "keeps the root's base subject" |
| SN-5 | `packages/es-bridge/test/session.test.ts` › "continues the bound topic: answers its newest message" |
| SN-6 | `packages/es-bridge/test/session.test.ts` › "quotes at most 5 lines with the attribution", "neither a quote nor the footer" |
| SN-7 | `packages/es-bridge/test/session.test.ts` › "the footer after '-- '", "puts the footer as the last line of a signature the user typed", "the footer last, as text/plain only" |
| RC-1 | `packages/es-core/test/receipts.test.ts` › "writes the header section of a read receipt exactly", "uses a Delivered: subject", "falls back to a fixed subject", "says in plain English what happened", "threads to the original"; `packages/es-core/vectors/generated-receipt-read.json` |
| RC-2 | `packages/es-core/test/receipts.test.ts` › "never requests receipts itself" |
| RC-3 | `packages/es-bridge/test/receipt-rule.test.ts` › "only to an ES sender who asked for it", "never to plain senders" |
| RC-4 | `packages/es-bridge/test/receipt-rule.test.ts` › "sends a Delivered receipt once", "does not send a receipt twice after a restart" |
| RC-5 | `packages/es-bridge/test/receipt-rule.test.ts` › "sends no Delivered receipt for a message that is already read", "sends a Delivered receipt for an ES message that arrives while running" |
| RC-6 | `packages/es-bridge/test/receipt-rule.test.ts` › "sends exactly one Read receipt per message when the conversation is opened" |
| RC-7 | `packages/es-bridge/test/receipt-rule.test.ts` › "never answers the account's own messages", "writes receipts as ordinary messages" |
| ST-1 | `packages/es-core/test/story.test.ts` › "a newsletter with List-Unsubscribe is a story", "is not a story without List-Unsubscribe, even with Precedence: bulk", "a discussion list (List-Post) is not a story", "Auto-Submitted other than no is an automated message", "a bounce (Return-Path: <>) is never a story", "the account owner's own message is never a story", "needs a sender and a date", "is a story with explicit: true"; `packages/es-core/vectors/stories-discussion-list.json`; `packages/es-core/vectors/stories-order-confirmation.json`; `packages/es-core/vectors/stories-password-reset.json`; `packages/es-core/vectors/stories-bounce.json` |
| ST-2 | `packages/es-core/test/story.test.ts` › "is deterministic: the same message gives the same story" |
| ST-3 | `packages/es-core/test/story.test.ts` › "takes the title from the subject without reply and forward prefixes", "takes the first non-blank line of the text when the subject is empty", "expires exactly seven days after the Date", "counts seven days of 24 hours across a daylight saving change", "uses the record's expiresAt when it is earlier than seven days, never later"; `packages/es-core/vectors/stories-expired-newsletter.json` |
| ST-4 | `packages/es-core/test/story.test.ts` › "one-click: List-Unsubscribe-Post", "with both mailto and https and no List-Unsubscribe-Post", "RFC 8058 needs https", "reads the mailto subject percent-decoded", "skips a mailto without a usable address", "offers a record's url as a page to open"; `packages/es-core/vectors/stories-newsletter-one-click.json`; `packages/es-core/vectors/stories-newsletter-mailto-bulk.json` |
| ST-5 | `packages/es-core/test/story-record.test.ts` › "writes an ordinary message: text/plain first", "writes the record's fields in a fixed order", "writes List-Unsubscribe from the record", "collapses the title, and refuses an empty one", "leaves a text over 10000 UTF-8 bytes out of the record"; `packages/es-core/vectors/stories-explicit-record.json` |
| ST-6 | `packages/es-core/test/story-record.test.ts` › "reads back what writeStory wrote", "rejects a story without a title", "drops malformed optional fields instead of rejecting the story", "accepts a story whose text is left out", "is not taken from a message whose Message-ID differs" |
| ST-7 | `packages/es-core/test/story-record.test.ts` › "never asks for receipts", "drops malformed optional fields instead of rejecting the story"; `packages/es-bridge/test/stories.test.ts` › "and sends no receipt, even when its ES part asks for one" |
| ST-8 | `packages/es-bridge/test/stories.test.ts` › "listing and opening stories makes no request to anyone", "gives the text and the reduced HTML, images held back", "and sends no receipt, even when its ES part asks for one"; `packages/es-core/test/story-content.test.ts` › "leaves out scripts, styles, the head", "leaves out forms and their controls", "leaves out every event handler", "keeps style declarations that load nothing", "moves image sources to data-src and data-srcset", "keeps http, https and mailto links", "drops javascript:, data: and obfuscated link targets", "the one-click newsletter: reduced text" |
| ST-9 | `packages/es-bridge/test/stories.test.ts` › "one-click: exactly one POST", "one-click: follows one redirect to https", "one-click: gives up after the time limit", "mailto: one plain message", "link: no request at all", "hides a sender's stories in a per-account file" |
| VE-1 | `packages/es-core/test/vectors.test.ts` › "stores each fixture byte for byte", "parseMessage(raw) equals expected" |
| VE-2 | `packages/es-core/test/vectors.test.ts` › "parseMessage(raw) equals expected" |
| VE-3 | `packages/es-core/test/vectors.test.ts` › "splitQuoted(expected) equals split" |
| VE-4 | `packages/es-core/test/roundtrip.test.ts` › "round trip: serialise → parse"; `packages/es-core/test/serialize.test.ts` › "gives the same text, subject, addresses and threading headers" |
| VE-5 | `packages/es-core/test/vectors.test.ts` › "storyOf(expected) equals story", "gives every story vector a story field and no other vector one" |
| CN-1 | `packages/es-core/test/es-schema.test.ts` › "writes a fixed key order and omits empty optional fields" |
| CN-2 | `packages/es-bridge/test/nothing-leaves.test.ts` › "a maildir session makes no outbound connection", "an IMAP sign-in connects only to the configured IMAP and SMTP hosts"; `packages/es-core/test/hygiene.test.ts` › "library code runs in browsers and is deterministic" |
| CN-3 | `packages/es-core/test/parse.test.ts` › "never throws and always returns a complete EsMessage", "returns a message with only its SHA-256 id if an internal error escapes"; `packages/es-core/test/mime-tree.test.ts` › "stops descending at depth 32", "never throws on truncated or malformed multipart input" |
| RC-8 | `packages/es-bridge/test/receipt-rule.test.ts` › "all (the default): both receipts are sent and both keywords set", "delivered: only the Delivered receipt is sent and only its keyword set", "none: no receipt is sent and no keyword set"; `packages/es-bridge/test/server.test.ts` › "sends receipts as the account's setting says"; `packages/es-bridge/test/cli-args.test.ts` › "reads every option"; `packages/es-bridge/test/stories.test.ts` › "keeps the receipt setting in the same file" |

## Appendix A: patterns for quoted text

The patterns of section 9, as es-core uses them (`packages/es-core/src/quotes.ts`). They are matched against one line without its line break; `ATTRIBUTION_*` patterns are matched against the lines of an attribution window trimmed and joined with one space.

```
QUOTE                /^[ \t﻿]{0,3}>/
ATTRIBUTION_END      /(?:\bwrote|\bnapsal(?:a|\(a\)|\/a)?|\bschrieb|\ba écrit|\bescribió|\bha scritto|\bschreef|\bescreveu|\bskrev|\bnapisał(?:a|\(a\))?)\s?:$/iu
GERMAN_ATTRIBUTION   /^Am\s.*\bschrieb\b.*:$/u
MUTT_ATTRIBUTION     /^\* .+ \[\d{4}-\d{2}-\d{2}[^\]]*\]:$/u
ATTRIBUTION_START    /^(?:On|Am|Le|Dne|El|Il|Op|Em|Den|Dnia|po|út|st|čt|pá|so|ne|\d)[\s.,]/iu
ORIGINAL_SEPARATOR   /^\s*-{2,}\s*(?:original message|původní zpráva|původní e-mail|ursprüngliche nachricht|message d'origine|mensaje original|messaggio originale|oorspronkelijk bericht)\s*-{2,}\s*$/iu
FORWARD_SEPARATOR    /^\s*-{2,}\s*(?:forwarded message|přeposlaná zpráva|weitergeleitete nachricht|message transféré|mensaje reenviado|messaggio inoltrato|doorgestuurd bericht)\s*-{2,}\s*$/iu
APPLE_FORWARD        /^\s*(?:begin forwarded message|začátek přeposlané zprávy|anfang der weitergeleiteten nachricht|début du message réexpédié)\s?:\s*$/iu
HEADER_LABEL         /^\s*\*?([^\s:*][^:*]{0,24}?)\s?\*?\s?:\*?(?:\s|$)/u
DIVIDER              /^\s*(?:_{8,}|-{8,})\s*$/
FOOTER_DIVIDER       /^\s*_{20,}\s*$/
SIGNATURE_DELIMITER  /^--[ \t]?$/
MOBILE_SIGNATURE     /^(?:sent from my \S.*|sent from (?:outlook|mail|yahoo mail|samsung).*|get outlook for (?:ios|android).*|odesláno z (?:iphonu|ipadu|mobilu|mého .*)|odesláno ze .*|von meinem \S+ gesendet.*|gesendet von meinem .*|envoyé de mon .*|envoyé depuis .*)$/iu
```

`HEADER_LABEL` captures the label in group 1; the From and other labels of an Outlook header block are listed in section 9.1. The patterns cover the default layouts of English, Czech, German, French, Spanish, Italian, Dutch, Portuguese, Scandinavian and Polish clients that the reply fixtures reconstruct; layouts in other languages are not recognised and stay `fresh`.

## Appendix B: reply and forward prefixes

The prefix tokens of section 7.2 (`packages/es-core/src/threading/subject.ts`), compared case-insensitively in NFC:

| Kind | Tokens |
| --- | --- |
| Reply | `re`, `aw`, `antw`, `odp`, `odpověď`, `sv`, `rif`, `res`, `réf`, `rép`, `ynt`, `atb`, `回复`, `答复`, `回覆` |
| Forward | `fw`, `fwd`, `wg`, `tr`, `př`, `přep`, `přeposláno`, `rv`, `vs`, `vb`, `enc`, `doorst`, `fs`, `转发`, `轉寄` |

With `TOKENS` the tokens joined by `|`, longest first, the patterns of section 7.2 are:

```
PREFIX       new RegExp(`^(${TOKENS})(?:\[\d+\]|\(\d+\)|\^\d+)?\.?\s*[:：]\s*`, "iu")
FWD_TRAILER  /\s*\(fwd\)$/iu
FWD_WRAPPER  /^\[fwd:(.*)\]$/iu
BLOB         /^\[[^[\]]*\]\s*/u
```

For example, the base subject of `Re: Plan`, `RE : Plan`, `Re[2]: Plan`, `Re(3): Plan`, `Re^4: Plan`, `Réf. : Plan`, `AW: Plan`, `Odp: Plan`, `PŘ: Plan` (a forward; also when written with a combining caron, which NFC composes), `回复：Plan` and `[list] Re: [list] Plan` is `Plan`; `Rescue plan`, `Re-run` and `R: Ciao` are base subjects already, and `Re: [list]` gives `[list]`, because a tag with nothing after it stays.

## Appendix C: named character references

The names that section 6.7 decodes, with the code point each one stands for (`packages/es-core/src/mime/html-to-text.ts`). They are a subset of the HTML list; any other name is left as written.

`amp` U+0026, `lt` U+003C, `gt` U+003E, `quot` U+0022, `apos` U+0027, `nbsp` U+00A0, `ensp` U+2002, `emsp` U+2003, `thinsp` U+2009, `zwnj` U+200C, `zwj` U+200D, `lrm` U+200E, `rlm` U+200F, `shy` U+00AD, `ndash` U+2013, `mdash` U+2014, `hellip` U+2026, `lsquo` U+2018, `rsquo` U+2019, `sbquo` U+201A, `ldquo` U+201C, `rdquo` U+201D, `bdquo` U+201E, `laquo` U+00AB, `raquo` U+00BB, `lsaquo` U+2039, `rsaquo` U+203A, `bull` U+2022, `middot` U+00B7, `copy` U+00A9, `reg` U+00AE, `trade` U+2122, `euro` U+20AC, `pound` U+00A3, `yen` U+00A5, `cent` U+00A2, `sect` U+00A7, `para` U+00B6, `deg` U+00B0, `plusmn` U+00B1, `times` U+00D7, `divide` U+00F7, `frac12` U+00BD, `frac14` U+00BC, `frac34` U+00BE, `iexcl` U+00A1, `iquest` U+00BF, `dagger` U+2020, `Dagger` U+2021, `permil` U+2030, `prime` U+2032, `larr` U+2190, `rarr` U+2192, `uarr` U+2191, `darr` U+2193, `harr` U+2194, `aacute` U+00E1, `Aacute` U+00C1, `eacute` U+00E9, `Eacute` U+00C9, `iacute` U+00ED, `Iacute` U+00CD, `oacute` U+00F3, `Oacute` U+00D3, `uacute` U+00FA, `Uacute` U+00DA, `yacute` U+00FD, `Yacute` U+00DD, `agrave` U+00E0, `Agrave` U+00C0, `egrave` U+00E8, `Egrave` U+00C8, `igrave` U+00EC, `Igrave` U+00CC, `ograve` U+00F2, `Ograve` U+00D2, `ugrave` U+00F9, `Ugrave` U+00D9, `acirc` U+00E2, `Acirc` U+00C2, `ecirc` U+00EA, `Ecirc` U+00CA, `icirc` U+00EE, `Icirc` U+00CE, `ocirc` U+00F4, `Ocirc` U+00D4, `ucirc` U+00FB, `Ucirc` U+00DB, `auml` U+00E4, `Auml` U+00C4, `euml` U+00EB, `Euml` U+00CB, `iuml` U+00EF, `Iuml` U+00CF, `ouml` U+00F6, `Ouml` U+00D6, `uuml` U+00FC, `Uuml` U+00DC, `yuml` U+00FF, `Yuml` U+0178, `atilde` U+00E3, `Atilde` U+00C3, `ntilde` U+00F1, `Ntilde` U+00D1, `otilde` U+00F5, `Otilde` U+00D5, `aring` U+00E5, `Aring` U+00C5, `aelig` U+00E6, `AElig` U+00C6, `oelig` U+0153, `OElig` U+0152, `oslash` U+00F8, `Oslash` U+00D8, `ccedil` U+00E7, `Ccedil` U+00C7, `szlig` U+00DF, `eth` U+00F0, `ETH` U+00D0, `thorn` U+00FE, `THORN` U+00DE, `scaron` U+0161, `Scaron` U+0160, `ccaron` U+010D, `Ccaron` U+010C, `rcaron` U+0159, `Rcaron` U+0158, `zcaron` U+017E, `Zcaron` U+017D, `ecaron` U+011B, `Ecaron` U+011A, `dcaron` U+010F, `Dcaron` U+010E, `tcaron` U+0165, `Tcaron` U+0164, `ncaron` U+0148, `Ncaron` U+0147, `lcaron` U+013E, `Lcaron` U+013D, `uring` U+016F, `Uring` U+016E
