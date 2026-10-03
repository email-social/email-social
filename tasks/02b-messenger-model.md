# Task 2b — make it a messenger: one conversation per contact, clean bubbles, new chats, live updates

The manual smoke test of Task 2 with a real mailbox showed that the client still feels like an e-mail program. This task changes the model from "threads by subject" to "chats with people" and fixes what failed against a real mailbox. It continues on the Task 2 pull request; Task 2's guarantees stay (nothing leaves the machine except IMAP/SMTP, no message text on disk, receipts only to ES senders, plain e-mail always works).

## What the maintainer saw (each must be fixed and covered by a test)
1. Sign-in stays on "Signing in…" and looks frozen.
2. A new incoming message does not appear, not even after reloading the page; only signing out and in shows it.
3. There is no way to start a new message, only to reply.
4. A reply sent from Email Social arrives without any context (no quoted original), so the recipient cannot tell what is being answered.
5. A reply from an ordinary client contains the quoted previous text, so the conversation shows everything twice.
6. Messages from one person are split into several conversations by subject; the list looks like a mail client.

## Deliverables
### es-core (separate commits with their own tests)
A. **`groupByParticipants(messages, { self })`** — a conversation is the set of participants other than the account owner (canonical addresses, sorted). Every message exchanged with exactly that set belongs to one conversation, ordered by date. `threadMessages` stays as it is. The result carries, for each message, its base subject so the client can show a small separator when the subject changes. Deterministic ids: `chat-` + first 32 hex digits of SHA-256 over the sorted participant list.
B. **`classifyMessage(message)` → `"person" | "list" | "automated"`** using only headers (RFC 2369 `List-*`, `Auto-Submitted` (RFC 3834), `Precedence: bulk/list/junk`, `Return-Path: <>`, and sender local parts `no-reply`, `noreply`, `do-not-reply`, `mailer-daemon`, `postmaster`). Lists and automated mail never become chats.
C. **`splitQuoted(message)` → `{ fresh, quoted, signature }`** — separates what the sender wrote now from quoted earlier messages and from the signature. Handle: `>`-quoted lines; attribution lines in English, Czech, German and French ("On … wrote:", "Dne … napsal(a):", "Am … schrieb …:", "Le … a écrit :") including wrapped ones; Outlook header blocks (`From:/Sent:/To:/Subject:` and their Czech, German and French forms) and `-----Original Message-----`; forwarded-message separators; the signature delimiter `-- ` (RFC 3676 §4.3); HTML replies (`blockquote`, Gmail's quote container, Outlook's divider) when the text came from HTML. When nothing is recognised, everything is `fresh`. Never drops text: `fresh + quoted + signature` contain every line of the input.
D. **`quoteForReply(parent, { maxLines })`** — the attribution line plus the parent's fresh text quoted with `> `, for replies to people who do not use Email Social.

### es-bridge
E. **Live updates:** new mail in INBOX and new items in the sent folder (sent from another client) reach the open page within 60 seconds without any action, by IDLE where the server supports it and by polling otherwise; after a page reload the page shows the current state. A lost connection is re-established with back-off and the page says "Reconnecting…".
F. **Sign-in that shows progress:** conversations appear as soon as the newest 50 messages are loaded; the rest loads in the background with a visible count; if nothing arrives for 60 seconds the page shows the error and a "Try again" button. No state in which the page only says "Signing in…" for longer than 5 seconds without a number changing.
G. **Sending:** `POST /api/messages` for a new chat (recipients, optional subject, text) and for replies. Subject of a new chat when none is given: the first line of the text, cut at 60 characters at a word boundary. Replies to a conversation where nobody has ever sent an ES part include `quoteForReply` of the message being answered below the text; replies to ES users do not quote.

### es-web
H. **Chat list** built from `groupByParticipants` for `"person"` messages: one row per person or group, newest first, unread count, last line (fresh text only). A collapsed section "Other mail" lists `"list"` and `"automated"` senders, read-only.
I. **Bubbles show only the fresh text**; a small "Show quoted text" control expands the rest; signatures are collapsed the same way. A subject separator appears where the base subject changes.
J. **New chat:** a button opens a composer with a recipient field (autocomplete from contacts, any valid address accepted, several recipients make a group), optional subject, text.
K. **Contact page:** clicking a name opens the person's page: names seen, address, first and last message dates, number of messages, the chat with them, the attachments exchanged (names, dates, download through the bridge), and the groups you share. No feed, no reactions.

## Acceptance test ("done when")
- **es-core:** ≥ 40 new deterministic tests; `splitQuoted` is covered by at least 25 fixtures of real reply formats (Gmail web and app, Outlook desktop in en/cs/de/fr, Outlook web, Apple Mail, iOS Mail, Thunderbird, Seznam.cz, mutt; plain and HTML), each with the expected `fresh` text; a property test that no input line is lost; vectors updated and `vectors:check` green.
- **End-to-end (Playwright, Maildir adapter):** (1) a seeded mailbox where one person wrote under four different subjects shows **one** chat with four separators; (2) a reply fixture with quoted text shows only the fresh text, and the control reveals the rest; (3) "New chat" to a new address writes a message whose first part is `text/plain`, with the derived subject, and the chat appears in the list; (4) a reply to a plain sender contains the attribution line and the quoted parent below the text, a reply to an ES sender does not; (5) the contact page shows the dates, count and attachments; (6) newsletters appear only under "Other mail".
- **Live update and sign-in (fake IMAP server in tests):** a message delivered while the page is open appears without reload within the polling interval; a reload shows it; with an artificial delay of 200 ms per message the page shows conversations after the first 50 and a changing count; with a server that stops answering the page shows the error within 60 seconds.
- Task 2 tests stay green (nothing leaves, cache without text, receipt rule).
- `docs/TRY-IT.md` updated with these flows; the manual smoke is rerun by the maintainer and recorded.
- Also in this pull request: `engines.node` becomes `>=22.12.0` (no upper bound); a `license:check` script in CI (no GPL/AGPL/unlicensed in runtime dependencies; MPL-2.0 allowed for build tools and listed in README).

## Out of scope
Feed, reactions, stickers, read-state sync across devices beyond IMAP flags, push notifications, contact discovery, encryption, signatures, mobile packaging.
