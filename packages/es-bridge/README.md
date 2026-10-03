# @email-social/es-bridge

The local part of Email Social: a Node 22 service that reads and sends your
own mail over IMAP and SMTP and serves the chat-like web client
(`packages/es-web`) to your browser on `127.0.0.1`. The chats, quoted text,
"Other mail" and contacts it shows are computed with `@email-social/es-core`.

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
- **Chats.** Messages are grouped by the people in them
  (`groupByParticipants`), not by subject. Mail from lists and programs
  (`classifyMessage`: `List-*`, `Auto-Submitted`, `Precedence`, `Return-Path: <>`,
  no-reply senders) goes to "Other mail", read-only. Each message is split
  into what the sender wrote, the quoted text and the signature (`splitQuoted`),
  and carries its quote card (`replyContextOf`): the message it answers,
  looked up among everything the session holds, or its subject where a new
  one starts or the answered message is not held. The web client shows the
  card and the fresh text, never the quoted text.
- **Live.** New mail in INBOX arrives by IDLE; every folder (also the sent
  folder, for messages sent from other clients) is checked every 30 seconds.
  A lost connection is re-established with growing pauses (1 s to 60 s),
  and a server that gives no answer for 45 seconds is reported to the page
  with "Try again".
- **Receipts.** A Delivered receipt when an Email Social message that asks
  for one arrives, and a Read receipt when you open its chat. Each is
  sent once per message (recorded as `$EsDelivered` / `$EsRead` keywords in
  the mailbox) and never to someone writing plain e-mail.
- **Sending.** `POST /api/messages` replies in a chat (to everyone else in
  it) or starts a new chat (recipients, optional subject; without one the
  first line of the text, cut at 60 characters at a word boundary). The
  Email Social part (`email-social.json`) is attached only when a recipient
  has sent an Email Social message before; otherwise the message is plain
  `text/plain` e-mail, and a reply then quotes the message it answers below
  the text (`quoteForReply`), since the recipient's client shows no chat.

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
