# Email Social — working rules for this repository

Email Social turns an ordinary e-mail mailbox into a chat-like client. Everything here is public, open source and built from scratch in this repository. Read this file before any task.

## What this repository is
- `spec/` — the Email Social Protocol (ES) public specification. CC BY 4.0.
- `packages/es-core` — pure TypeScript library: message model, threading, contacts, identifiers. No I/O, no network. Apache-2.0.
- `packages/es-bridge` — local Node service that talks IMAP/SMTP on the user's behalf and exposes a local API for the UI. Apache-2.0.
- `packages/es-web` — the chat-like web client served locally by the bridge. Apache-2.0.
- `tasks/` — the work items. Do them in order; each one has an acceptance test that defines "done".

## Non-negotiable rules
1. **Plain e-mail always works.** Every message Email Social sends must be readable as a normal e-mail by a recipient with any client: a `text/plain` part with the full content comes first; the structured ES part is additional, never required.
2. **No server of ours.** The user's mailbox is the only storage. Nothing is sent to any third-party service. No telemetry, no analytics, no crash reporting.
3. **No secrets in the repository.** No credentials, tokens, keys, real e-mail addresses or real mailbox content in code, tests, fixtures or commits. Fixtures use `example.com`, `example.org`, `example.net` only.
4. **No claims.** Documentation and UI text describe what the code does. Never use: "secure", "unhackable", "military-grade", "zero-knowledge", "quantum", "end-to-end encrypted" (there is no encryption in this repository yet), "verified", "private by design". Say what happens instead ("stored only in your mailbox").
5. **Encryption and signatures are out of scope.** Do not add, sketch or promise them. Leave a clearly named extension point (`VerificationBadgeSlot`) and nothing else.
6. **Tests define done.** A task is complete when its acceptance test in `tasks/` passes and `npm test` is green in every package. Write the failing test first, then the code. Deterministic tests only: no real network, no clocks without injection, no random without a seed.
7. **Small commits with plain-language messages** describing the behaviour, not the file names. One task = one pull request. Never force-push.
8. **Dependencies:** Node 22 LTS, TypeScript, Vitest. Keep the dependency list short and permissively licensed (MIT/Apache-2.0/BSD/ISC); no GPL/AGPL; no packages abandoned for more than 3 years. Lockfile committed.
9. **Compatibility first:** follow RFC 5322 (message format), RFC 2045–2049 (MIME), RFC 3501/9051 (IMAP), RFC 5321 (SMTP), RFC 8098 (MDN) where they apply. Cite the section in a comment when the code relies on one.
10. **Language:** code, comments, docs and UI in English. The spec excerpt in `spec/` is partly Czech; Task 3 translates it.

## How to work
- Start each task by reading its file in `tasks/`, then the relevant spec section, then existing code. Write a short plan as the PR description.
- When the spec and reality disagree (e.g. what real mail clients emit), reality wins: document the deviation in `spec/DEVIATIONS.md` with the evidence.
- When something is unclear and the task file does not settle it, choose the option that keeps rule 1 and write the choice into the PR description under "Decisions".
- Never widen scope: no feeds, reactions, hashtags, groups beyond "many recipients", no federation, no HTTP API, no encryption.
