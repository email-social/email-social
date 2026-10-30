# J1: independent implementation of the parsing side, from `spec/es-protocol.md` alone

This is the independent review that `tasks/03-public-spec.md` asks for.

## Method

1. **Writing the code.** While writing the parser I read only `spec/es-protocol.md`, `packages/es-core/vectors/*.json` and `packages/es-core/vectors/README.md` (plus `tasks/03-public-spec.md` for the task itself). I did **not** open anything under `packages/*/src/`, `packages/*/test/` or `spec/es-protocol-v2-excerpt.md`. `spec/DEVIATIONS.md` was not opened either.
2. **The parser.** It is in plain Node.js ES modules with no dependencies beyond Node built-ins (Node v26.8.1):
   - `text.mjs`: charsets (6.5), base64 and quoted-printable (6.4), addresses and msg-ids (3.1, 3.2), RFC 2047 (6.2).
   - `header.mjs`: header sections (6.1), address lists, dates (6.2), Content-Type and Content-Disposition with RFC 2231 (6.3).
   - `html.mjs`: HTML reduced to text and the named references (6.7, appendix C).
   - `parse.mjs`: the MIME tree, body text, flowed text, attachments and delivery fields (6.4–6.9), the ES record and ES-part acceptance (5.4, 5.5), and the message model (6).
   - `split.mjs`: fresh, quoted and signature (9.1, appendix A).
   - `run-vectors.mjs`: the runner. Run it with `node independent/run-vectors.mjs [--verbose] [filter]`.
3. **Comparing with es-core.** Only after the first run (step 4 of the brief) did I open `packages/es-core/src/`, for `quotes.ts` and `codec/charset.ts`. I also ran es-core's own TypeScript directly through Node's type stripping, with a resolve hook in `tools/ts-resolve.mjs` and no build. That let me test the readings I had guessed at:
   - `tools/probe.mjs`: 43 hand-written edge cases, one or more for each place where I had to choose a reading.
   - `tools/fuzz.mjs`: seeded byte-level mutations of every vector, 400 per vector.
   - `tools/grammar-fuzz.mjs`: seeded random token soups for address lists, dates, parameters, msg-ids, subjects, HTML, format=flowed, MIME trees, ES records and quote splitting, 3000 each.

## (a) Pass counts

Each vector file holds two checks: `expected` (the section 6 model, deep equality) and `split` (section 9.1). Every file has both.

| Vector file | First run | Final run |
| --- | --- | --- |
| ios-mail-reply.json | 1/2 | 2/2 |
| replies-ios-mail-de.json | 1/2 | 2/2 |
| replies-ios-mail-en.json | 1/2 | 2/2 |
| the other 56 files (every file listed in `packages/es-core/vectors/`) | 2/2 each | 2/2 each |
| **Overall** | **115/118** (59/59 `expected`, 56/59 `split`) | **118/118** |

On the first run all 59 `expected` models matched. The three failures were all in `split`. Each had a mobile signature ("Sent from my iPhone", "Von meinem iPhone gesendet", "Odesláno z iPhonu") above a trailing quote block. I had read QT-2 step 3, "the last non-blank line", as the last non-blank line of the text before the tail, which here is a quote line. es-core (`quotes.ts`, in the signature loop) takes the last non-blank line **outside quote blocks**. This was a gap in the spec, not a slip in my code. I changed my reading and all three passed.

Differential results after the fix, independent parser compared with es-core:

| Probe set | Agree |
| --- | --- |
| hand-written edge cases (`tools/probe.mjs`) | 42/43 |
| byte mutations of the vectors (`tools/fuzz.mjs 400`) | 23599/23600 |
| grammar fuzz (`tools/grammar-fuzz.mjs 3000`): address, date, params, html, flowed, msgid, subject, mime, es, split | 3000/3000 each |

Both disagreements are the same issue: a UTF-8 byte order mark in a part or encoded-word labelled with a non-UTF charset (RD-14, below).

## (b) Spec statements that were ambiguous, missing or wrong

Two of these were **confirmed** to change results, through a vector failure or a differential. The rest are places where the text allowed more than one reading; my first reading happened to match es-core, which the probes confirmed. A different independent reader could still go wrong there.

### Confirmed (changed results)

- **[QT-2]** step 3, "the last non-blank line is the signature when …": it does not say whether lines inside quote blocks count. es-core skips them, and three vectors depend on it. Proposed: *"without either, the last non-blank line outside quote blocks and before the tail is the signature when …"*.
- **[RD-14]** step 5, "A UTF-8 byte order mark at the start is removed": it reads as applying to every charset. es-core removes it only when the bytes are decoded as UTF-8 (TextDecoder's default; steps 2 and 4 when they pick UTF-8, and a `utf-8` label). With `charset=windows-1250` or `iso-8859-2`, the bytes EF BB BF stay as `ď»ż`. Proposed: *"5. When the bytes are decoded as UTF-8 (by its label, or by steps 2 and 4), a byte order mark at the start is removed; in any other charset the bytes EF BB BF are ordinary characters."*

### Ambiguous (my reading matched es-core, but the text allows another)

- **[ID-1]** "one pair of enclosing angle brackets and the white space inside them removed": this could mean all white space inside, or only the white space next to the brackets. es-core trims: `< a b@example.com >` gives `a b@example.com`. Proposed: *"… one pair of enclosing angle brackets removed together with the white space directly inside them …"*.
- **[ES-9]** step 5, `replyTo.from.address` "is a usable address in canonical form": this could mean "must already be canonical" or "is put in canonical form and must then be usable". es-core does the second, so `B@EXAMPLE.ORG` and `<b@example.org>` are accepted and canonicalised. Proposed: *"… whose canonical form (section 3.1) is a usable address; `from.address` is that canonical form"*.
- **[RD-5]** rule 3, "leaving comments out, tokens not separated by SPACE, TAB, CR or LF form chunks": it does not say whether a comment between two tokens separates them. In es-core it does not (`alice(x)@example.com` is one chunk). Proposed: *"… form chunks; a comment does not separate chunks, only SPACE, TAB, CR or LF outside comments does"*.
- **[RD-5]** rule 2, "joined with one space where SPACE, TAB, CR, LF or a comment separated them": it does not say whether encoded-words are decoded before or after joining. This matters because white space between two adjacent encoded-words is then removed. es-core decodes after joining. Proposed: *"… joined as described, and the joined text then RFC 2047-decoded (section 6.2) …"*.
- **[RD-13]** quoted-printable, "`=XX` (… both digits before the end of the line)": it does not say whether this is before or after trailing SPACE and TAB are removed. es-core uses the line after removal. Proposed: *"… both digits before the end of the line, after its trailing SPACE and TAB were removed"*.
- **[RD-12]** "A multipart without a `boundary` parameter … is a leaf with type `text/plain`": it does not say whether its other parameters (`charset`, `format`) still apply. In es-core they do. Proposed: *"… is a leaf with type `text/plain` that keeps its parameters"*.
- **[RD-9]** RFC 2231, "when it is the piece with the lowest index and contains two `'`": it does not say what charset applies when the lowest piece is not extended, or has no charset. es-core then decodes the bytes as for no label (6.5 step 2). Proposed: *"… when the lowest-index piece is not extended or has no charset prefix, extended bytes are decoded as for no label (section 6.5 step 2)"*.
- **[RD-4]** "Malformed words are left as they are": "malformed" is not defined. The regular expression already decides what is decoded, and an unknown charset falls back (6.5 step 4). Proposed: *"Text that does not match the pattern is left as it is; every match is decoded."*
- **[RD-15]** "non-blank text" (also in the `multipart/alternative` rule) is not defined. Proposed: add to section 2: *"**Blank**: empty or consisting only of white space."*
- **[RD-17]** "the content `-- ` is a signature separator": it does not say whether this applies at quote depth > 0. es-core treats `> -- ` as a separator. Proposed: *"… is a signature separator at any quote depth"*.
- **[QT-2]** step 2, "When the nearest non-blank line above a block (after the previous block) ends an attribution": it does not say whether the attribution window may reach back into or above the previous block. In es-core it must start after the previous block. Proposed: *"… ends an attribution that lies entirely after the previous block …"*.
- **[RD-18]** rule 7 and the paragraph after it, "a pending list item writes `- ` (once)": it does not say whether this happens only at the start of a line. Every `li` also requests a new line, so in practice it always is. Proposed: *"… and then, if a list item is pending, `- ` is written and the item is no longer pending"*.

### Missing coverage

- **[TH-1]–[TH-6], [CH-1]–[CH-3], [TP-1]–[TP-4], [QT-3]–[QT-7]:** no vector exercises threading, chats, topics, unquoting, fragments or reply cards. The vectors check one message at a time (`expected`, `split`). The acceptance test in task 3 ("implements the parsing side … and passes the vectors") therefore says nothing about sections 7, 8 and 9.2–9.6. Section 15 covers them only with es-core's own unit tests, which an independent implementation cannot run. Proposed: add multi-message vectors, for example `vectors/threading/*.json` holding `{ messages: [raw…], owner, expected: { conversations, chats, topics } }`. Then [TH-1]–[TP-4] become testable from outside, and RD-1/VE-2 can say "and the threading vectors".
- **[RD-1]**: the counts (51 fixture, 8 generated) match the directory today: 59 files, of which 29 are `replies-*`. Nothing points out that a newly added vector makes this sentence stale. Proposed: *"… give the expected model for every message in `packages/es-core/vectors/` (59 at the time of writing)"*.

No statement turned out to be **wrong**, meaning it says one thing while es-core and the vectors do another, except RD-14 step 5 as read literally.

## (c) What I skipped

- **Sections 7, 8, 9.2–9.6** (threading, contacts, chats, topics, classification, unquoting, fragments, reply cards, subject notes). No vector exercises them; see "Missing coverage". The brief limits the work to what the vectors exercise, so I did not implement them.
- **The writer side** (sections 4, 10, 11, VE-4): out of scope ("the parsing side").
- **The `did:es` derivation ([ID-7])**: not needed to read; [ID-6] validation is implemented because 5.4 needs it.
- **Robustness limits ([CN-3])**: MIME depth 32 is implemented. I did no performance or adversarial-size testing; `safeParseMessage` catches exceptions but is not a proof of RD-2.
- **The budget**: it was not a constraint. The work stopped because everything passed, at roughly 20 % of the budget.

## Files

`independent/` holds everything; nothing outside it was changed and nothing was committed. `tools/` contains the step-4 comparison scripts. They import `packages/es-core/src` and are not part of the independent implementation.
