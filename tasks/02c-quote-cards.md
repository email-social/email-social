# Task 2c — reply context as a quote card, never as quoted text

Continues Task 2b on the same pull request. The maintainer's note after the first real-mailbox run: show reply context the way messengers do — a small card above the message with who is being answered and an excerpt — and never repeat quoted text under the message. The subject is the thread identifier inside a chat; it is shown only inside such cards, not as separators.

## Deliverables
### es-core
A. **`replyContextOf(message, lookup)`** → `{ kind: "parent", messageId, from, excerpt, attachment } | { kind: "subject", subject } | null`.
   - `parent` when `refs.inReplyTo[0]` (or, failing that, the last `References` id) names a message the lookup returns: `from` = the parent's sender (display name or address), `excerpt` = the first two lines of the parent's **fresh** text (`splitQuoted`), at most 140 characters, cut at a word boundary with "…"; `attachment` = the name of the parent's first attachment, or null.
   - `subject` when the message answers nothing we hold **or** starts a new base subject in its chat (`normalizeSubject`) and the subject is not empty: the base subject without `Re:`/`Fwd:` prefixes.
   - `null` otherwise (same subject as the previous message of the chat, nothing answered). Deterministic; tests with the Task 1 fixtures (Gmail, Outlook with References only, Outlook without thread headers, Apple Mail, Thunderbird, Seznam).
### es-bridge
B. The conversation API returns `replyContext` for every message, computed against the messages the session holds (parent in another folder counts; parent not loaded → `subject` kind).
### es-web
C. **Quote card** above the bubble text: sender name in bold, excerpt in muted text, attachment name with a paper-clip glyph when present; a thin accent bar on the left like messengers use; tapping the card scrolls to the parent bubble and highlights it for a second; for `subject` kind the card shows the subject alone. The card is the only place a subject appears: **remove the subject separators** from Task 2b.
D. **No quoted text under any bubble.** The bubble shows only the fresh text. Remove the inline "Show quoted text" control; the message menu (⋯) offers "Open original", which downloads the raw `.eml` through the bridge (already exists for attachments; reuse). Signatures stay collapsed.
E. Outgoing replies keep Task 2b behaviour: people without Email Social receive the attribution line and the quoted parent below the text; ES users receive no quote. In our own chat the sent reply shows the quote card, not the quoted text.

## Acceptance test ("done when")
- es-core: ≥ 20 deterministic tests for `replyContextOf` incl. missing parent, References-only threading, subject change, empty subject, attachment name, excerpt cut at a word boundary, HTML-only parent (excerpt from HTML-to-text).
- e2e (Playwright, Maildir): (1) a reply whose parent is in the mailbox shows the card with the parent's name and excerpt, and no quoted text anywhere in the bubble; (2) tapping the card scrolls to and highlights the parent; (3) a reply to a message not in the mailbox shows the subject card; (4) a chat where one person used four subjects shows subject cards at each change and **no separators**; (5) a reply fixture with 40 quoted lines renders only the fresh text, and "Open original" downloads the raw message; (6) a sent reply to a plain sender shows the card in our chat while the written `.eml` contains the quoted parent.
- Task 2 and 2b tests stay green; `docs/TRY-IT.md` updated ("what you should see" rows for cards); manual rerun recorded by the maintainer.

## Out of scope
Reactions, stories, feed, editing or deleting messages, forwarding.
