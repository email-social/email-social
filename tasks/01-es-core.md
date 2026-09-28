# Task 1 — `es-core`: the message model, threading and contacts (pure library)

## Goal
A TypeScript library, no I/O, that turns raw RFC 5322 messages into Email Social conversations and back. Everything the client needs to think in "chats" instead of "mails", computed from ordinary e-mail.

## Deliverables (`packages/es-core`)
1. **Parsing:** from a raw message (string/Buffer) produce an `EsMessage`: id, from, to/cc, date, subject, `text` (the `text/plain` part, decoded per charset and transfer encoding), `es` (the parsed ES structured part if present, else `null`), `attachments` (metadata only), `refs` (Message-ID, In-Reply-To, References). Handle 7bit/8bit/quoted-printable/base64, UTF-8 and single-byte charsets, RFC 2047 subjects.
2. **Serialising:** from an `EsOutgoing` (participants, text, optional `inReplyTo`, optional ES fields) produce a raw message that (a) is readable as plain e-mail (rule 1 of CLAUDE.md: `text/plain` first), (b) carries the ES structured part as `application/vnd.email-social.message+json`, a **sibling part in `multipart/mixed` after the text** (never `multipart/alternative`: the plain text must be what every client shows), (c) sets `In-Reply-To`/`References` so that the recipient's client threads it too. The JSON schema of the ES part is `spec/es-protocol-v2-excerpt.md` chapter 2 lexicon for messages; keep only the fields the excerpt defines for a direct message.
3. **Threading:** group `EsMessage[]` into `Conversation[]` using `References`/`In-Reply-To` first, then subject normalisation (`Re:`, `Fwd:`, localized prefixes, `[list]` tags) as fallback, then participant set. Deterministic and stable: same input, same conversation ids. Conversation id derived from the earliest root Message-ID, not from time.
4. **Contacts:** derive `Contact[]` from messages (addresses seen in From/To/Cc, display names, last seen, count); a contact is identified by the canonical address (lowercase local part is NOT folded — only the domain is lowercased; document why).
5. **Identifiers:** `did:es:<domain>:<local-identifier>` mapping per spec chapter 1.1, as metadata only (derive, format, parse, validate). No resolution, no network.
6. **Receipts:** a `Delivered` and a `Read` receipt message kind in the ES part (spec chapter 4 semantics); parsing and serialising only.

## Acceptance test ("done when")
- `npm test` in `packages/es-core` is green with **≥ 60 deterministic tests** covering: 12+ real-world raw message fixtures (Gmail web, Thunderbird, Apple Mail, Outlook desktop, iOS Mail, Seznam.cz, mutt — reconstruct from public knowledge of their formats, addresses `@example.com` only), charsets and encodings, RFC 2047 subjects, threading with and without `References`, subject-prefix fallback in en/cs/de/fr, receipts, DID mapping.
- **Round trip:** serialise → parse gives back the same text, participants and ES fields for 20 generated cases (seeded).
- **Compatibility fixture:** every serialised message is also parsed by an independent parser (`mailparser`) in a test and yields the same plain text and subject.
- Vectors: `packages/es-core/vectors/*.json` (input raw message → expected `EsMessage`), with a `vectors:check` script; the vectors are the spec's test suite for other implementations.
- No dependency on Node built-ins beyond `Buffer`/`TextDecoder` so the library also runs in a browser bundle (a Vite build of the package succeeds and a browser smoke test parses one fixture).
- `README.md` of the package: API in 15 lines, one example.

## Out of scope
IMAP/SMTP (Task 2), UI (Task 2), HTML bodies (parse to text only for display: strip tags, keep line breaks; do not render), encryption, signatures, federation.
