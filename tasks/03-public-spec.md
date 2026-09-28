# Task 3 — the public spec, in English, matching what Tasks 1–2 actually do

## Goal
`spec/es-protocol.md`: an English specification of the parts of the Email Social Protocol that this repository implements, written from `spec/es-protocol-v2-excerpt.md` (Czech prose, English examples) and from the code's vectors. A reader who has never seen this repository can implement a compatible client from the spec alone.

## Deliverables
1. Sections: Introduction and goals (plain e-mail always works; no server), Identifiers (`did:es:` mapping), Message format (the `text/plain` first rule, the ES structured part, the JSON lexicon for direct messages and receipts, `multipart/mixed` layout, headers used), Threading (the algorithm of `es-core`, deterministic), Receipts (when they may be sent), Compatibility (what real clients do; every deviation from the draft listed in `spec/DEVIATIONS.md` with evidence), Test vectors (pointing to `packages/es-core/vectors`).
2. Every normative statement uses RFC 2119 words and is covered by at least one vector or test; a table at the end maps statements to tests.
3. `spec/DEVIATIONS.md` reconciled: anything the Czech draft says that the implementation does differently is either fixed in the spec or listed with the reason.
4. `README.md` at the repository root: what Email Social is in five sentences, how to try it, how to contribute, licences (spec CC BY 4.0, code Apache-2.0).

## Acceptance test ("done when")
- A second, independent session (or a reviewer) implements the parsing side of the spec in a scratch file using only `spec/es-protocol.md` and the vectors, and passes the vectors. Record the result in the PR.
- No forbidden words from CLAUDE.md rule 4 anywhere in `spec/` or `README.md` (a `docs:check` script greps for them and is part of `npm test`).
- The Czech excerpt stays in the repository as `spec/es-protocol-v2-excerpt.md` for provenance.
