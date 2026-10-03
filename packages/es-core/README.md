# @email-social/es-core

Turns raw e-mail (RFC 5322) into Email Social conversations and back: it
parses messages, writes new ones and receipts, groups messages into chats and
derives contacts. Pure TypeScript with no I/O and no network access; it runs
unchanged in Node 22 and in browsers.

Every message it writes is an ordinary e-mail: the text comes first as
`text/plain`, and the structured ES part (`application/vnd.email-social.message+json`)
is attached after it in `multipart/mixed`, so any mail client shows the text.

## API

```ts
parseMessage(raw: string | Uint8Array): EsMessage                     // never throws; strings are read as UTF-8
extractPart(raw, partId): EsPartContent | null                        // decoded bytes of one attachment (EsAttachment.partId)
serializeMessage(out: EsOutgoing, { date, messageId, includeEsPart? }): string  // CRLF, 7-bit; text/plain first, then the ES part
serializeReceipt(receipt: EsOutgoingReceipt, { date, messageId }): string  // a "delivered" or "read" receipt
replyTargetOf(parent): ReplyTarget · replyContextOf(message, lookup, { previous? })  // headers for a reply · its quote card
threadMessages(messages: EsMessage[]): Conversation[]                 // threads by references and subject, any input order
groupByParticipants(messages, { self }): Chat[]                        // one chat per set of other people, any subjects
classifyMessage(message): "person" | "list" | "automated"              // from List-*, Auto-Submitted, Precedence, Return-Path, no-reply
splitQuoted(message): { fresh, quoted, signature }                     // what the sender wrote now; every line kept in one part
quoteForReply(parent, { maxLines?, timeZone? }): string                // "On … wrote:" + the parent's fresh text as "> " lines
normalizeSubject(subject): { base, isReply, isForward } · canonicalAddress(address)  // strips Re:/AW:/Odp:/[list] · lowercases the domain
deriveContacts(messages, { exclude? }): Contact[] · deriveDid(address) · formatDid · parseDid · isValidDid  // contacts; did:es as metadata
ES_MEDIA_TYPE · ES_DRAFT_MEDIA_TYPE · ES_TEXT_MAX_BYTES               // ES part media types, text limit (10000 B)
// Types (src/types.ts): EsMessage, EsAddress, EsAttachment, EsRefs, EsDelivery, EsPart (EsPostPart | EsReceiptPart), Conversation,
// Chat, ChatEntry, MessageKind, QuotedSplit, ReplyContext, Contact, EsOutgoing, EsOutgoingReceipt, ReplyTarget, SerializeOptions, ReceiptKind, EsPartContent
```

## Example

```ts
import { parseMessage, replyTargetOf, serializeMessage, threadMessages } from "@email-social/es-core";

const messages = rawMessages.map((raw) => parseMessage(raw)); // Uint8Array[] read from the mailbox
const [latest] = threadMessages(messages);                     // conversations, most recent first
const last = messages.find((m) => m.id === latest.messageIds.at(-1))!;

const raw = serializeMessage(
  { from: me, to: [last.from!], text: "See you on Friday!", inReplyTo: replyTargetOf(last),
    es: { requestReceipts: ["read"] } },
  { date: new Date(), messageId: `<${crypto.randomUUID()}@example.com>` }, // the caller supplies time and id
);
```

## Notes

- **Plain e-mail always works.** A message without an ES part is a complete
  `EsMessage` (`es: null`). The ES part of an incoming message is used only
  when its `via` is the From address and its `email.messageId` is the
  Message-ID, so a part carried along by an ordinary forward is listed as an
  attachment instead.
- **Contacts and participants are keyed by the canonical address**: the
  domain is lowercased, the local part is kept as written. RFC 5321 §2.4
  lets the receiving host treat the local part as case-sensitive, so folding
  it could merge two different mailboxes; not folding it at worst shows one
  person twice.
- **Deterministic.** es-core never reads the clock or generates random
  values: the Date and Message-ID of new messages are passed in, and the same
  input always gives the same bytes. Conversation ids are derived from the
  root Message-ID (`conv-` + 32 hex digits of its SHA-256), not from time.
- **Chats and quotes.** `groupByParticipants` groups by the people in a
  message, not by subject, so one person is one chat. `splitQuoted` keeps
  every line (the three parts together contain the whole text) and treats
  an Email Social post as entirely fresh; `quoteForReply` is for replies to
  people who do not use Email Social, whose clients show no history.
  `replyContextOf` gives the quote card a client shows above a message
  instead of quoted text: the answered message's sender and first lines, or
  the subject where a new one starts.
- **Browsers.** The library uses only `Uint8Array`, `TextEncoder` and
  `TextDecoder`; a Node `Buffer` is accepted because it is a `Uint8Array`.
- **Test vectors** in [`vectors/`](vectors/README.md) (raw message →
  expected `EsMessage`) are the conformance suite for other implementations;
  the client formats they come from are described in
  [`fixtures/README.md`](fixtures/README.md). Deviations from the draft spec
  are listed in [`spec/DEVIATIONS.md`](../../spec/DEVIATIONS.md).

Scripts: `npm test`, `npm run typecheck`, `npm run build` (Vite bundle
`dist/es-core.js` + type declarations), `npm run test:browser` (Chromium
smoke test of the bundle), `npm run vectors:check`, `npm run vectors:update`.

Licence: Apache-2.0.
