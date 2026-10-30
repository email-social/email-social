# Task 3b — receipts can be turned off; the spec keeps the SHOULD

Small task on `main` after PR #4. One PR, one session. Stop when the acceptance test passes.

## Why
PR #4 dropped the sentence "a client SHOULD let the owner turn receipts off" because es-bridge had no such setting. Receipts tell the other side when a message arrived and when it was read; that is the owner's information. The protocol keeps the SHOULD, and this repository implements it.

## Deliverables
1. `es-bridge`: a per-account setting `receipts` with values `all` (default, today's behaviour), `delivered` (never send read receipts) and `none`. Read it from the same place the account's other settings live (config file or environment, whichever exists), documented in `docs/TRY-IT.md` next to the other settings. `none` means: no receipt is ever sent, nothing else changes (incoming receipts are still read and shown).
2. `es-web`: the setting visible and changeable in the client's settings view, if a settings view exists; otherwise a line in `docs/TRY-IT.md` saying where to set it.
3. `spec/es-protocol.md`, Considerations: restore the normative sentence as a SHOULD with an identifier (`[RC-n]`), and say that the kinds of receipts a client sends are the owner's choice. Add the statement to the mapping table at the end, pointing at the new tests.
4. `spec/DEVIATIONS.md`: remove or amend the note that said the switch is not implemented.
5. Tests: es-bridge unit tests for the three values (a post asking for both receipts: `all` sends two, `delivered` sends one, `none` sends none; the IMAP keywords are set only for receipts actually sent). `npm test` green, `docs:check` and `license:check` included.

## Acceptance test ("done when")
- The three es-bridge tests above pass and are listed in the spec's mapping table under the new identifier.
- `npm test` at the root is green, CI green.
- No forbidden words (CLAUDE.md rule 4) anywhere; `git diff --stat` touches only es-bridge, es-web (or TRY-IT), `spec/es-protocol.md`, `spec/DEVIATIONS.md` and tests.
- The PR description lists the setting's name, its values and where it is read from.
