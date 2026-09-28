# Task 2 — `es-bridge` + `es-web`: a mailbox as a chat, running locally

## Goal
`npx email-social` on a laptop opens `http://127.0.0.1:<port>` where the user logs into their own mailbox (IMAP + SMTP) and sees conversations as chats: list on the left, bubbles on the right, a box to type, send. Nothing leaves the machine except the user's own IMAP/SMTP traffic.

## Deliverables
### `packages/es-bridge` (Node 22)
1. **Mailbox adapters** behind one interface `MailboxAdapter` (list messages since a cursor, fetch raw by uid, append to Sent, send via SMTP, watch for new mail via IDLE or polling): an **IMAP/SMTP adapter** (`imapflow` + `nodemailer`) and a **Maildir adapter** (a directory of `.eml` files) used by tests and by people who want to try it offline.
2. **Credentials** are entered in the UI and kept **only in memory** for the session unless the user ticks "remember on this device", in which case they are stored with the OS keychain via a small permissive library, never in a plain file. Support app passwords (Gmail, Seznam.cz) and plain IMAP/SMTP with STARTTLS/TLS. No OAuth in this task.
3. **Local API** (HTTP + WebSocket on 127.0.0.1 only, random port, a per-session token in the URL): conversations, messages of a conversation, send, mark read, contacts. Everything computed with `es-core`; the bridge stores no message content on disk (an in-memory cache only; a `--cache-dir` option may store **parsed metadata**, never bodies, opt-in).
4. **Receipts:** when the user opens a conversation, send a `Read` receipt **only if the sender's message carried an ES part asking for one**; never for plain e-mail senders. Delivered receipts are sent when a message with an ES part arrives, same rule.
### `packages/es-web` (Vite + React or Preact, small)
5. Conversation list (participant names, last line, unread badge), thread view as bubbles (mine right, theirs left), composer, "many recipients" conversations rendered as a group; attachments listed as names with a download link through the bridge; HTML-only mails shown as text (from `es-core`), with a plain "open original" action that saves the `.eml`.
6. A visible **`VerificationBadgeSlot`** component that renders nothing today (extension point; no text, no icon).
7. Accessibility basics: keyboard navigation, focus order, contrast per WCAG AA, no colour-only state.

## Acceptance test ("done when")
- **End-to-end with the Maildir adapter** (Playwright): a seeded maildir with 40 messages in 9 conversations (fixtures from Task 1 formats) → the UI shows 9 conversations in the right order with the right unread counts; opening one shows bubbles with correct sides and text; sending a reply appends an `.eml` to the maildir Sent folder that (a) starts with `text/plain`, (b) threads under the conversation when re-read, (c) is readable by `mailparser`.
- **Receipt rule test:** a plain e-mail sender never gets a receipt; an ES sender asking for one gets exactly one `Read` receipt per message.
- **Nothing leaves:** a test asserts the bridge makes no outbound connection other than the configured IMAP/SMTP hosts (mock DNS/sockets), and that no message body is written under the cache dir.
- **IMAP smoke against a real mailbox is manual** and documented in `docs/TRY-IT.md`: Gmail (app password), Seznam.cz, generic IMAP — with the exact steps and what the user should see. The maintainer runs it; the PR records the result.
- `npm test` green in all packages; `npm run build` produces the bridge with the web UI bundled; `npx email-social` works from a clean clone on Node 22.

## Out of scope
Mobile, push notifications, contact discovery ("does this address support ES"), encryption, signatures, group administration, federation, HTTP API for third parties.
