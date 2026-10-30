# Task 4b — spec clarifications from the independent review, and the QT-6 decision

Small task on `main` after PR #6 (stories) and the pull request that brought the vectors in `packages/es-core/vectors/multi/`, the `splitQuoted` fixes, the robustness fixes and the CRA files. One PR, one session. This session has about 30 dollars of budget: stop at 80 % of it and open the PR with what is complete and a list of what is missing; do not leave failing tests in.

This is item L of `tasks/04-stories.md`, which PR #6 could not do because `tasks/J1-spec-findings.md` was not in the repository yet.

## Deliverables
1. **Section (b) of `tasks/J1-spec-findings.md`.** Apply the two confirmed items ([QT-2] step 3, [RD-14] step 5). For every ambiguous item apply the proposed wording where it matches what es-core does; where it does not, leave the text and list the identifier in the PR description with the reason. No change to `src/`.
2. **QT-6 (maintainer's decision, 30 October): the spec follows the code.** The fourth bullet of QT-6 says the owner's card shows the section 9.3 excerpt (139 characters cut back to a word boundary, then `…`), not "the first 140 characters". Section 12.2 (a story's title from the first line of the text, PR #6) points at 9.3 the same way. Turn the `it.fails` case in `test/vectors-multi.test.ts` and the vector `reply-cards-own-long-quote.json` into an ordinary passing case.
3. **Missing coverage (section "Missing coverage" of the findings).** The `multi/` vectors already cover threading, chats, topics, reply cards, quotes, contacts and subject notes. Check that every statement in the mapping table at the end of `spec/es-protocol.md` names at least one test or vector; add a vector only where none exists, in the form of its neighbours (a vector written by es-core carries `delivery.listUnsubscribe` like every other one since PR #6).
4. The mapping table, `spec/DEVIATIONS.md` where the Czech draft differs, and `packages/es-core/vectors/README.md` updated with whatever changed.

## Acceptance test ("done when")
- Every `[XX-n]` identifier named in section (b) of `tasks/J1-spec-findings.md` is either changed in `spec/es-protocol.md` or listed in the PR description with the reason it was left.
- No `it.fails` remains for QT-6; `npm test` at the root is green including `docs:check` and `license:check`; CI green.
- `git diff --stat` touches only `spec/`, `packages/es-core/vectors/`, `packages/es-core/test/`, `docs/` and `tasks/`; nothing under any `src/`.
- No forbidden words (CLAUDE.md rule 4); addresses from `example.com`, `example.org`, `example.net` only.

## Out of scope
The three `it.fails` cases left by the robustness fixes (groups with the same subject, the IMAP literal size limit, a timeout for IMAP commands outside sync) are Task 5. No change to stories, the bridge or the web client.
