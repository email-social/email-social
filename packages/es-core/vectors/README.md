# Test vectors

These files are the test suite of the Email Social message format for any
implementation, in any language. Each `*.json` file is one raw e-mail message
and the `EsMessage` that a conforming parser produces from it.

`npm run vectors:check` (in `packages/es-core`) runs them against es-core.
`npm run vectors:update` rewrites them from the current code; the diff must
then be reviewed like any code change.

## Format

```json
{
  "description": "what the message is and what it exercises",
  "source": "fixtures/<file>.eml" | "generated",
  "raw": "the message, when its bytes are valid UTF-8",
  "rawBase64": "the message bytes in base64, otherwise (exactly one of raw / rawBase64)",
  "input": { "kind": "message" | "receipt" | "story", "...": "only for generated vectors, see below" },
  "expected": { "...": "EsMessage" },
  "split": { "fresh": "…", "quoted": "…", "signature": "…" },
  "story": { "…": "only in stories-*.json: storyOf(expected), or null" }
}
```

- **Input bytes.** Parse the UTF-8 bytes of `raw`, or the decoded bytes of
  `rawBase64`. Line endings are as on the wire (CRLF), except in
  `mbox-lf-obsolete-date.json`, which has LF on purpose. Do not normalise
  them before parsing.
- **`expected`** is an `EsMessage` as defined in
  [`src/types.ts`](../src/types.ts). Compare with deep equality; key order
  does not matter, array order does. In short:
  - `id`: the Message-ID in angle brackets, or `"sha256:"` + the lowercase
    hex SHA-256 of the raw bytes when there is none;
  - `from` (first mailbox or `null`), `to`, `cc`, `replyTo`: `{ name, address }`
    with the name decoded and the address's domain lowercased (the local part
    is kept as written);
  - `date`: ISO 8601 in UTC with milliseconds, or `null`;
  - `subject`: decoded, whitespace runs collapsed to one space, trimmed;
  - `text`: the text/plain body (HTML reduced to text only when there is no
    text/plain), `"\n"` line endings, format=flowed unwrapped, not trimmed;
    `textSource` says `"plain"`, `"html"` or `"none"`;
  - `es`: the ES part record, or `null` when there is none or it does not
    belong to the message (its `via` is not the From address, or its
    `email.messageId` is not the Message-ID); a post's `text` is `null` when
    the sender left a text over 10000 UTF-8 bytes out of the record, and
    `email.textSha256` then holds the hex SHA-256 of the body text;
    `email.topicRoot` (the Message-ID of the root of the message's topic),
    `email.topicLabel` (the topic's name) and `email.replyTo` (on a
    deliberate reply: `{ messageId, from: { name, address }, excerpt }`, with
    `messageId` read like any msg-id and `from.address` in canonical form) are
    `null` when absent or malformed, as in records written before they existed;
  - `attachments`: metadata of every other leaf part (`filename`,
    `contentType`, `disposition`, decoded `size`, `contentId`, IMAP `partId`);
  - `refs`: `messageId`, and every msg-id of `In-Reply-To` and `References`;
  - `delivery`: the list and automation header fields: the lowercased names
    of the RFC 2369 / RFC 2919 `List-*` fields present (sorted), the
    `List-Id` identifier, the `Auto-Submitted` keyword (RFC 3834) and the
    `Precedence` value (lowercased, without comments or parameters), and the
    `Return-Path` address (`""` for `<>`), each `null` when absent; and
    `listUnsubscribe`: the URIs in angle brackets of the first
    `List-Unsubscribe` field (RFC 2369 §3.2, white space removed, in order,
    each once) with `oneClick`, true when `List-Unsubscribe-Post` is
    `List-Unsubscribe=One-Click` (RFC 8058 §3.1), or `null` when there is no
    `List-Unsubscribe` field.
- **`split`** is `splitQuoted(expected)`: the text the sender wrote in
  this message (`fresh`), the earlier messages their client quoted
  (`quoted`: `>` lines with their attribution, an Outlook header block or a
  forward/original-message separator and everything after it) and the
  signature (from the `-- ` delimiter, or a mobile one-liner such as "Sent
  from my iPhone"). Each part has the blank lines at its edges removed; runs
  of one part separated by another part are joined with a blank line. Every
  non-blank line of `text` is in exactly one part. The
  `replies-*.json` vectors (from `fixtures/replies/`) exist for this field:
  one reply per client format.
- **`story`** is in the `stories-*.json` vectors only (from
  `fixtures/stories/`, and the generated `stories-explicit-record.json`):
  `storyOf(expected)` without an owner address, the story a client shows
  for the message, or `null` for the discussion list, the automated mail and
  the bounce that must never be one (`es-protocol.md`, section "Stories").
- **Generated vectors** (`source: "generated"`) were written by es-core's
  serializer from `input` with a fixed date and Message-ID.
  `generated-topic-root.json` and `generated-topic-reply.json` are the root
  of a named topic and a deliberate reply inside it, with the `email` keys in
  the order `messageId, subject, inReplyTo, references, textSha256,
  topicRoot, topicLabel, replyTo`. `stories-explicit-record.json` was
  written by `writeStory`: an es.social.story record with its keys in the
  order `via, createdAt, email, title, expiresAt, unsubscribe, text`. A conforming
  writer need not produce the same bytes, but a conforming parser must read
  `raw` as `expected`. es-core additionally checks that serialising `input`
  again gives `raw` byte for byte.

The fixture vectors come from `../fixtures/`; see `../fixtures/README.md`
for what each reconstructed client format contains. All addresses and
domains are `example.com`, `example.org` or `example.net`.

## Multi-message vectors (`multi/*.json`)

Threading, contacts, chats, topics, unquoting, fragments, reply quotes,
reply cards and subject notes (sections 7–9 of
[`spec/es-protocol.md`](../../../spec/es-protocol.md)) need more than one
message. Each file in `multi/` is one mailbox:

```json
{
  "description": "what the messages are and what they exercise",
  "covers": ["TP-1"],
  "owner": { "name": "Alice Example", "addresses": ["alice@example.com"] },
  "messages": [{ "raw": "…" }, { "rawBase64": "…" }],
  "expected": { "conversations": [], "chats": [], "topics": {}, "…": "some of the views below" },
  "divergences": [{ "key": "replyCards", "statement": "QT-6", "note": "…" }]
}
```

- **`covers`** names the statements of the spec the file exists for.
- **`owner`** is the account owner: every address of the account (the
  first is the one it writes from) and the display name it writes with.
- **`messages`** are read like the `raw` / `rawBase64` of a single vector.
  Their order does not matter: every view is the same for any order of the
  messages, and `test/vectors-multi.test.ts` checks this with the reversed
  and a rotated order.
- **`expected`** holds only the views the file is about. Compare each with
  deep equality (key order does not matter, array order does). Message ids
  below are `EsMessage.id`; with several messages of one id, the first one
  is used for lookups (the copies in these files read to the same model).
  - `conversations`: `threadMessages(messages)` (section 7.1);
  - `contacts`: `deriveContacts(messages)`, nothing excluded (section 7.3);
  - `kinds`: id → `"person"`, `"list"` or `"automated"`: `"person"` for a
    message from one of the owner's addresses, else `classifyMessage`
    (section 8.3);
  - `chats`: `groupByParticipants` of the messages whose kind is
    `"person"`, with `self` = the owner's addresses (sections 8.1 and 8.3:
    list and automated mail is not shown as chats);
  - `topics`: chat id → `topicsOf(the chat's messages in chat order)`
    (section 8.2);
  - `carrierSubjects`: chat id → `carrierSubject({ name: owner.name,
    address: owner.addresses[0] }, chat.participants)` (section 8.2);
  - `subjectNotes`: id → `subjectNoteOf(message, its topic)` for every
    message placed in a topic (section 9.6);
  - `quotes`: id → `{ quoted, lines, text }` for every message whose
    `splitQuoted(message).quoted` is not empty: that part,
    `unquotedLines(quoted)` and `unquote(quoted)` (section 9.2);
  - `fragments`: id → `quotedFragmentOf(message, parent)` for every message
    whose parent is held; the parent is the first In-Reply-To id, else the
    last References id, never the message's own id (section 9.3);
  - `replyQuotes`: id → `quoteForReply(message, { maxLines: 5, timeZone:
    "UTC" })`, the quote below a reply to that message (section 9.4);
  - `replyCards`: id → `replyCardOf(message, lookup, { inChat, self })`
    for every message of every chat, with `lookup` over all the messages,
    `inChat` the ids of the message's chat and `self` the owner's addresses
    (section 9.5).
- **`divergences`** (optional) lists the views where es-core does not do
  what the spec says. The file holds what the spec says; the note says
  where es-core differs, and `test/vectors-multi.test.ts` expects that
  check to fail until es-core or the spec changes.

The messages are written in `test/helpers/multi-vectors.ts`: plain
messages as an ordinary client writes them, Email Social posts by es-core's
serializer. `npm run vectors:update` rewrites these files too.
