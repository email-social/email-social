# @email-social/es-bridge

The local part of Email Social: a Node 22 service that reads and sends your
own mail over IMAP and SMTP and serves the chat-like web client
(`packages/es-web`) to your browser on `127.0.0.1`. The chats, topics, quote
cards, "Other mail" and contacts it shows are computed with `@email-social/es-core`.

```sh
npm ci && npm run build          # at the repository root
npx email-social                 # sign in to an IMAP/SMTP account in the page
npx email-social --demo          # a demo mailbox, no account, no network
npx email-social --maildir DIR --address you@example.com   # a folder of .eml files
```

Options: `--demo`, `--maildir <dir>`, `--address`, `--name`, `--cache-dir <dir>`,
`--port <n>` (default: a random free port), `--no-open`, `--max-messages <n>`
(newest messages per IMAP folder, default 500; the newest 50 are loaded
first and the chats appear, the rest follows in the background). Manual steps with Gmail,
Seznam.cz and other providers: [`docs/TRY-IT.md`](../../docs/TRY-IT.md).

## What goes where

- **Network.** The only outbound connections are to the IMAP and SMTP
  servers the user entered (`test/nothing-leaves.test.ts` checks this with
  every socket and DNS query of the process recorded). Passwords are sent
  only over TLS or a required STARTTLS.
- **Local API.** HTTP and WebSocket on `127.0.0.1` only, at a random port.
  Every API call needs the per-session token from the printed URL
  (`#token=…`); requests naming another host are refused (DNS rebinding),
  and the WebSocket also checks the origin. Attachments and originals are
  served as downloads and never rendered as pages.
- **Mail.** Messages stay in the mailbox. The bridge keeps parsed messages in
  memory only. With `--cache-dir` it also writes headers and flags (never
  text or attachments) to speed up the next start.
- **Password.** In memory until the bridge stops, unless "Remember on this
  device" is ticked. Then settings and password go to the OS keychain
  (`@napi-rs/keyring`), never to a plain file.
- **Chats and topics.** Messages are grouped by the people in them
  (`groupByParticipants`), not by subject. Mail from lists and programs
  (`classifyMessage`: `List-*`, `Auto-Submitted`, `Precedence`, `Return-Path: <>`,
  no-reply senders) goes to "Other mail", read-only. Inside a chat every
  message is placed in a topic identified by its root message (`topicsOf`).
  Each message is split into what the sender wrote, the quoted text and the
  signature (`splitQuoted`); it carries a quote card only when it is a
  deliberate reply (`replyCardOf`), and a one-line subject note when an
  ordinary client changed the subject (`subjectNoteOf`). The web client
  shows the card and the fresh text, never the quoted text.
- **Live.** New mail in INBOX arrives by IDLE; every folder (also the sent
  folder, for messages sent from other clients) is checked every 30 seconds.
  A lost connection is re-established with growing pauses (1 s to 60 s),
  and a server that gives no answer for 45 seconds is reported to the page
  with "Try again".
- **Receipts.** A Delivered receipt when an Email Social message that asks
  for one arrives, and a Read receipt when you open its chat. Each is
  sent once per message (recorded as `$EsDelivered` / `$EsRead` keywords in
  the mailbox) and never to someone writing plain e-mail.
- **Sending.** `POST /api/messages` writes into a chat (`chatId`) or to a
  set of people (`to`: their chat, or a new one). It continues a topic
  (`topic: { root }`, or the composer's default), names one (`topic:
  { label }`: re-enters the topic with that subject or name, else starts it),
  or answers one message deliberately (`replyTo`). The Email Social part
  (`email-social.json`) is attached only when a recipient has sent an Email
  Social message before; otherwise the message is plain `text/plain` e-mail.

## What goes on the wire

- **Subject.** A new topic's first message (its root) has no In-Reply-To or
  References and the topic's name as its Subject, or, for a topic without a
  name, the carrier subject: "Message from" and the account's name, plus
  " to " and up to three other people (then "+N") in a group. Every later
  message carries exactly `Re: ` + the root's base subject, whatever
  prefixes other clients stacked on their replies, so Gmail and Outlook
  keep the conversation together. A topic whose root has no subject gets a
  new carrier root instead. The first line of the text is never used as a
  subject.
- **Threading.** A message typed without choosing a target answers the
  newest message of its topic that has a Message-ID; a deliberate reply
  answers its target. With an Email Social recipient the ES part carries
  `email.topicRoot`, `email.topicLabel` (in a named topic) and, on a
  deliberate reply, `email.replyTo` (the target's id, sender and the start of
  its text).
- **Quote.** Only a deliberate reply to people without Email Social quotes:
  an attribution line and at most 5 lines of the message answered as `> `
  lines (`quoteForReply`), so Outlook's Conversation Clean Up does not take
  every earlier message for a duplicate. A continuation quotes nothing; a
  message with the ES part never quotes.
- **Footer.** Every message to people without Email Social ends with the
  signature block line "Sent with Email Social. Reply as you normally would;
  this is an ordinary e-mail.", after a `-- ` line, or as the last line of a
  signature the user typed. The `-- ` line makes the body quoted-printable
  (RFC 2045 §6.7); it still decodes to exactly the text.

See `spec/DEVIATIONS.md` D23–D25 for the reasons and the client behaviour
behind these rules.

## Local API

`GET /api/session` · `POST /api/login` · `POST /api/logout` · `POST /api/retry` ·
`GET /api/chats` · `GET /api/chats/:id` · `POST /api/chats/:id/read` ·
`GET /api/other` · `GET /api/other/:id` · `POST /api/other/:id/read` ·
`POST /api/messages` · `GET /api/contacts` · `GET /api/contacts/:address` ·
`POST /api/sync` · `GET /api/messages/:key/attachments/:partId` ·
`GET /api/messages/:key/original` · WebSocket `/api/events` (`session`,
`changed`). JSON shapes: `src/api-types.ts`.

## Structure

| File | Role |
| --- | --- |
| `src/adapters/types.ts` | `MailboxAdapter`: list since a cursor, fetch one or many, add flags, append to Sent, send, watch, reconnect |
| `src/adapters/imap-smtp.ts` | imapflow + nodemailer; SPECIAL-USE Sent folder, UIDVALIDITY-qualified uids, IDLE and polling, reconnection |
| `src/adapters/maildir.ts` | `INBOX/`, `Sent/` of `.eml` files, flags in a JSON file, `Outbox/` for sending |
| `src/session.ts` | the mailbox in memory: chats, Other mail, contacts, sending, receipts, progressive loading |
| `src/bridge.ts` | HTTP/WebSocket server, token and host checks, sign-in |
| `src/api-types.ts` | JSON shapes of the API (shared with es-web) |
| `src/demo.ts` | the demo mailbox (45 messages: 7 chats, a list and a newsletter; es-core's client formats, quoting as each client does) |

Tests: `npm test` (adapters, session, receipt rule, server, nothing-leaves,
live updates and sign-in against an IMAP test server on 127.0.0.1
(`test/helpers/fake-imap.ts`, with the real imapflow client), CLI arguments)
and `npm run test:e2e` (after `npm run build`: the web client in Chromium on
the seeded maildir and against the IMAP test server, and the `email-social`
command).

Licence: Apache-2.0.
