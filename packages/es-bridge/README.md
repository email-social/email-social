# @email-social/es-bridge

The local part of Email Social: a Node 22 service that reads and sends your
own mail over IMAP and SMTP and serves the chat-like web client
(`packages/es-web`) to your browser on `127.0.0.1`. Every conversation,
thread and contact it shows is computed with `@email-social/es-core`.

```sh
npm ci && npm run build          # at the repository root
npx email-social                 # sign in to an IMAP/SMTP account in the page
npx email-social --demo          # a demo mailbox, no account, no network
npx email-social --maildir DIR --address you@example.com   # a folder of .eml files
```

Options: `--demo`, `--maildir <dir>`, `--address`, `--name`, `--cache-dir <dir>`,
`--port <n>` (default: a random free port), `--no-open`, `--max-messages <n>`
(newest messages per IMAP folder, default 500). Manual steps with Gmail,
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
- **Receipts.** A Delivered receipt when an Email Social message that asks
  for one arrives, and a Read receipt when you open its conversation. Each is
  sent once per message (recorded as `$EsDelivered` / `$EsRead` keywords in
  the mailbox) and never to someone writing plain e-mail.
- **Replies.** Sent to everyone else in the conversation. The Email Social
  part (`email-social.json`) is attached only when one of them has sent an
  Email Social message before; otherwise the reply is plain `text/plain`
  e-mail.

## Structure

| File | Role |
| --- | --- |
| `src/adapters/types.ts` | `MailboxAdapter`: list since a cursor, fetch raw, add flags, append to Sent, send, watch |
| `src/adapters/imap-smtp.ts` | imapflow + nodemailer; SPECIAL-USE Sent folder, UIDVALIDITY-qualified uids, IDLE |
| `src/adapters/maildir.ts` | `INBOX/`, `Sent/` of `.eml` files, flags in a JSON file, `Outbox/` for sending |
| `src/session.ts` | the mailbox in memory: conversations, threads, contacts, replies, receipts |
| `src/bridge.ts` | HTTP/WebSocket server, token and host checks, sign-in |
| `src/api-types.ts` | JSON shapes of the API (shared with es-web) |
| `src/demo.ts` | the demo mailbox (40 messages, 9 conversations, Task 1 client formats) |

Tests: `npm test` (adapters, session, receipt rule, server, nothing-leaves,
CLI arguments) and `npm run test:e2e` (after `npm run build`: the web client
in Chromium on the seeded maildir, and the `email-social` command).

Licence: Apache-2.0.
