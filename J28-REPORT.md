# J28 — robustness of the es-core parser and the es-bridge against malformed mail

## Answer in short

No input made `parseMessage` throw, and no input made the parser disagree with
itself: no attachment it lists is missing from `extractPart`, the ES reader matches
spec §5.4, LF and CRLF give the same message, and threading doesn't depend on input order.
That held across about 4 600 fuzzed messages per default run and about 25 000 in a 40-round
run. What a hostile sender **could** do was make one step quadratic. Eleven
such cost blow-ups were found in es-core; ten are fixed in `src/`, one is an
`it.fails`. In es-bridge, one malformed WebSocket frame crashed the process (fixed), and
two IMAP issues are recorded as `it.fails`.

A note on names: the task says `safeParseMessage` / `parseMessage`. This
repository has `parseMessage` (documented never to throw, the "safe" one) and
the internal `parseMessageUnguarded` (the same parser without its last-resort
`catch`). es-core defines no parse error type, so the harness requires
**both** never to throw, and their results to be equal.

## Harness design (packages/es-core/test/fuzz/, see its README.md)

1. Deterministic: `mulberry32` with a seed per case = FNV-1a(`ES_FUZZ_SEED`, fixture, mutator, round), so cases don't depend on run order. A failure message names fixture, mutator, round and seed.
2. Corpus: all 51 fixtures (`fixtures/*.eml`, `fixtures/replies/*.eml`), as latin1 strings so every byte survives.
3. 13 mutators (`mutate.ts`): byte flips, random truncation, duplicated/dropped header fields, 1 MB header lines (8 kinds), boundary strings in bodies, charset chaos and invalid UTF-8, CRLF/LF/CR mixes, quoted-printable and base64 corruption, RFC 2231 fragments out of order/duplicated/gapped, Content-Type swaps, header/body splicing.
4. Exhaustive passes: truncation before, inside and after every MIME delimiter line (874 cuts); each header field dropped and duplicated (1 206 variants); LF and CRLF forms of every fixture.
5. Synthetic inputs (`synthetic.test.ts`): runs of 25 characters in 19 header fields (ReDoS sweep, 64 KB; 1 MB long), 10 000 nested multiparts in 5 variants plus 10 000 siblings, References/In-Reply-To loops of 10 000 ids, ES JSON with wrong types (every field × 30 values, 3 000 random records, 100 000-element arrays), `>` floods (4 MB; 100 MB long).
6. Properties (`properties.ts`), per message: neither parser throws; equal results; well-formed `EsMessage`; under 0.5 s + 1 µs/byte for parsing plus split, unquote, reply quote and reply card; `splitQuoted` keeps every non-blank line exactly once; each listed attachment extracts with equal size and type; ES part shaped as spec §5.4 says and stable through `formatEsJson` → `parseEsJson`.
7. Per batch: `threadMessages` places each distinct id once, gives the same result for a shuffled input, and runs in under 0.5 s + 50 µs per id.
8. ES oracle (`es-oracle.ts`): §5.4 re-implemented from the spec text; `parseEsJson` must agree on every record.
9. Scale (`threading-scale.test.ts`): threading in 5 mailbox shapes, plus `topicsOf`, `groupByParticipants`, `deriveContacts`, at N = 2 000 and 20 000. The 20 000 run must take < 50× the 2 000 run (O(N log N) ≈ 13×, O(N²) = 100×).
10. Default run is about 35 s of the es-core suite; `ES_FUZZ_ROUNDS`, `ES_FUZZ_SEED` and `ES_FUZZ_LONG=1` (30 rounds, 100 MB flood, 1 MB runs) give longer runs. Findings are kept as plain unit tests in `test/hostile-input.test.ts`.

To check that the harness can actually fail, it was also run against a copy of es-core with my `src/` fixes undone (results below).

## Findings

| # | Input class | Symptom (before) | Fix or `it.fails` | File |
| --- | --- | --- | --- | --- |
| 1 | Reply text of repeated "attribution + `>` line" blocks with nothing fresh between them | `splitQuoted` quadratic: each block rescanned every earlier line. 16 000 blocks 3.0 s, 40 000 blocks 10.6 s | Fixed: prefix counts of fresh lines (O(1) per test) | `packages/es-core/src/quotes.ts` (`assignRoles`) |
| 2 | `Content-Type`/`Content-Disposition` with tens of thousands of RFC 2231 fragments | Duplicate-section test scanned all earlier fragments. 60 000 fragments 6.9 s | Fixed: a `Set` of taken section numbers | `packages/es-core/src/headers/params.ts` (`collect`) |
| 3 | HTML body with deeply nested `<blockquote>` | Each line got one `> ` per enclosing quote, n²/2 characters of output. **1 MB of HTML exhausted a 4 GB heap (process abort)** | Fixed: rendered quote depth capped at 32 | `packages/es-core/src/mime/html-to-text.ts` |
| 4 | Header value with a long inner run of spaces or tabs (any field) | ReDoS in `/^[ \t\r\n]+\|[ \t\r\n]+$/g`: 32 000 spaces 1.5 s, 64 000 15 s; a 1 MB line extrapolates to about half an hour | Fixed: trim by index scan | `packages/es-core/src/headers/header-block.ts` |
| 5 | A long reply chain (In-Reply-To), in date order or reversed | Threading walked the chain for every message (loop check, then root): 20 000 messages 15.3 s (reversed 6.3 s) | Fixed: loop walk skipped for ids that are no one's parent, and roots memoised | `packages/es-core/src/threading/thread.ts` |
| 6 | One message whose `References` lists 10 000–20 000 ids, also with loops | Loop check per link: 10 000 ids 1.75 s, 20 000 ids 6.5 s | Fixed by the same change | `packages/es-core/src/threading/thread.ts` |
| 7 | Many subject-less messages with distinct participants | Every group compared with every earlier subject-less conversation, plus an array copy per conversation: 20 000 messages 12.3 s | Fixed: lookup by sorted participant set; no copies | `packages/es-core/src/threading/thread.ts` |
| 8 | Many unrelated messages sharing one subject (bulk mail, spam) | Same-subject groups matched by a linear scan of every conversation with that subject: 20 000 messages 19.5 s (11.5 s after the copy fix of #7) | **`it.fails`**: needs an index for "subset either way", not a local fix | `packages/es-core/src/threading/thread.ts` (`candidates.find(fits)`); test in `test/hostile-input.test.ts` |
| 9 | ES part whose `email.references` holds 100 000 ids | Duplicate test by `Array.includes`: **238 s** | Fixed: a `Set` | `packages/es-core/src/es/schema.ts` (`readEmailMeta`) |
| 10 | Many distinct invented `charset` labels across messages | Module-level decoder cache kept every label ever seen: unbounded growth in a long-running bridge (5 000 labels → 5 000 entries) | Fixed: only labels the platform knows are cached | `packages/es-core/src/codec/charset.ts` |
| 11 | One chat with thousands of distinct subjects (a newsletter sender) | `topicsOf` rule 3 scanned every earlier topic, recomputing its subject key: 40 000 messages 1.3 s, 80 000 5.9 s | Fixed: a map from subject key to newest topic | `packages/es-core/src/topics.ts` |
| 12 | es-bridge: malformed WebSocket frame (unmasked, or announcing 1 MB) from a client holding the token | `ws` emits `"error"` on the socket and the bridge had no listener, so an **uncaught exception ended the process** | Fixed: `error` listener, and `maxPayload: 4096` (the page never sends) | `packages/es-bridge/src/bridge.ts:464,481`; test in `test/server.test.ts` |
| 13 | es-bridge: hostile IMAP server sends a huge message literal | imapflow buffers literals up to 1 GB by default; `imapOptions` sets no lower `maxLiteralSize` | **`it.fails`** ("caps the size of one fetched message") | `packages/es-bridge/src/adapters/imap-smtp.ts:94`; test in `test/imap-smtp.test.ts` |
| 14 | es-bridge: IMAP server stops answering during a command outside a sync | Nothing gives up before imapflow's 5-minute socket timeout, which a trickling server never triggers | **`it.fails`** ("gives up on a command by itself …") | `packages/es-bridge/src/adapters/imap-smtp.ts:186`; test in `test/imap-smtp.test.ts` |

Each es-core row is a test in `packages/es-core/test/hostile-input.test.ts`
with its smallest input embedded (no file under `fixtures/malformed/` was
needed). Time bounds sit about 10× above what the fixed code needs.

Not counted as a defect: bare-CR line endings (old Mac) are not line breaks
to es-core. The whole message then reads as one header field: no crash, just
empty fields. RFC 5322 §2.3 allows CR only as part of CRLF, and
`header-block.ts` documents CRLF/LF only.

### The harness against the original code

With my `src/` fixes undone in a scratch copy of es-core:
- `test/hostile-input.test.ts`: 8 of 8 asserting findings tests fail. The blockquote test was skipped there because it would abort the worker (out of memory); the loop-correctness test passes on both versions, as it should.
- The scale test fails 4 of 5 threading shapes: reply chain 27.8 s, reversed 10.6 s, subject-less 19.4 s, phantom References 54.2 s.
- `synthetic.test.ts` fails the ReDoS sweep (#4: 398 s), the 100 000-element ES arrays (#9: 225 s) and the 4 MB "attribution + quote" flood (#1: 128 s). The nested-`<blockquote>` flood (#3) was left out of that run because it aborts the worker.
- The fuzz harness alone (as opposed to the hand-written unit tests) does **not** catch #2 (RFC 2231 fragments: its mutator makes at most 40 fragments), #10 (decoder cache: the harness doesn't measure memory) or #11 (`topicsOf`: the scale case for it was added after this check). The tests in `test/hostile-input.test.ts` cover those three.

## Measured timings (this machine, fixed code)

Single runs on a shared machine, so treat them as orders of magnitude.

**Threading at scale** (`threading-scale.test.ts`; best of 3 at N = 2 000, best of 2 at N = 20 000; two runs shown)

| Mailbox shape | N = 2 000 | N = 20 000 | ratio | before the fix, N = 20 000 |
| --- | --- | --- | --- | --- |
| threads of 10 (In-Reply-To + References) | 16–19 ms | 153–233 ms | 8–14 | 207 ms |
| one reply chain, In-Reply-To only | 9–11 ms | 108 ms | 10–12 | 15 314 ms |
| one reply chain, dates reversed | 8–14 ms | 106–112 ms | 7–14 | 6 350 ms |
| no subject, distinct participants | 32–45 ms | 371–395 ms | 8–12 | 12 270 ms |
| References to 20 phantom ids each, overlapping | 19–23 ms | 207–342 ms | 9–18 | 54 188 ms (under load) |
| same subject, distinct senders (#8, not fixed) | 164 ms | 11 467 ms | 70 | 19 466 ms |

Per chat: `topicsOf` (one chat, distinct subjects) 5–8 ms / 60–64 ms (5.9 s at 80 000 before the fix, 121 ms after); `groupByParticipants` (20 cc each) 67–73 ms / 564–622 ms; `deriveContacts` (20 cc each) 30–31 ms / 330–331 ms.

**Before → after, for each fixed finding**

| # | Input | Before | After |
| --- | --- | --- | --- |
| 1 | 16 000 / 40 000 attribution + quote blocks | 2 979 ms / 10 573 ms | 52 ms / 191 ms |
| 2 | 16 000 / 60 000 RFC 2231 fragments | 455 ms / 6 909 ms | 60 ms / 242 ms |
| 3 | 1 MB of `<blockquote>x` | out of memory at 4 GB | 121 ms (100 MB in the long run: see below) |
| 4 | 32 000 / 64 000 spaces inside a header value | 1 524 ms / 15 109 ms | 1 ms / 25 ms |
| 5 | reply chain of 20 000 | 14 257 ms | 182 ms |
| 6 | one message, 20 000 References | 6 531 ms | 33 ms |
| 7 | 20 000 subject-less, distinct participants | 7 598 ms | 600 ms |
| 9 | ES part, 100 000 references | 238 281 ms | 161 ms |
| 10 | 5 000 invented charset labels | cache 1 → 5 001 entries | stays at 1 |
| 11 | `topicsOf`, 80 000 distinct subjects | 5 899 ms | 121 ms |

**Fuzz run times (fixed code)**: default `test/fuzz` about 9 s (mutated fixtures) + 22 s (synthetic) + 7 s (scale), running in parallel.

**Long run (`ES_FUZZ_LONG=1`, fixed code, once, 505 s)**: 44 of 45 passed. The failure was the random-ES-record test hitting vitest's 5 s default timeout (100 000 records take about 8 s). I gave it an explicit timeout and the rerun passed in 8 s. Results:
- 1 MB runs in 19 header fields × 25 characters: 57 s for 475 messages of 1 MB.
- `long-header`, 30 rounds (1 530 messages with a 1 MB header line): 197 s.
- 100 MB `>` floods through `splitQuoted` (two splits, the line-conservation check and `unquotedLines`): 10 s for one line; 19–146 s for line-based floods of 1.6–50 M lines; 66 s for the 100 MB flood as a message body plus 100 MB of nested `<blockquote>`.

All of these are within the linear time bound (4 × (0.5 s + 1 µs/byte)), with no out-of-memory abort at Node's default heap.

## es-bridge: places where a malformed message or a hostile IMAP server can hurt

Read by hand (no fuzzing of the real bridge). Line numbers are after this
change.

**Fixed, with a test**
- `packages/es-bridge/src/bridge.ts:481`: the events WebSocket had no `"error"` listener, so a frame that breaks RFC 6455 crashed the process (#12). `bridge.ts:464`: `maxPayload` was `ws`'s default of 100 MB on a socket the page never writes to; it's now 4096 bytes. Test: `test/server.test.ts`, "a malformed WebSocket frame".

**Recorded as `it.fails`** (testable in isolation through the injectable `ImapClient` and the pure `imapOptions`)
- `packages/es-bridge/src/adapters/imap-smtp.ts:94` (`imapOptions`): no `maxLiteralSize`, so imapflow accepts literals up to 1 GB (#13). Then `imap-smtp.ts:405-407` (`fetchMany`) fetches `source` with no RFC822.SIZE check first, and `new Uint8Array(m.source)` copies each Buffer, doubling memory, with up to 25 messages per batch. A cap needs a decision on what to show for a refused message: as things stand, an oversized literal fails the whole IMAP stream, which would make every sync reconnect in a loop. Not a local fix.
- `imap-smtp.ts:186` (`exclusive`/`withMailbox`): no deadline per IMAP command (#14). The session's stall watchdog (`session.ts:299, 407, 466`) covers start-up, background loading and sync only. `fetchRaw` for "original" and attachment downloads (`session.ts:1070`), `addFlags` for read receipts and `appendToSent` (`imap-smtp.ts:424`) can hold the single operation queue until imapflow's 5-minute socket inactivity timeout, and indefinitely against a server that trickles a byte every few minutes. Every later operation waits behind them.

**Listed only** (not testable in isolation, or by design)
- `imap-smtp.ts:346-347`: a full listing runs `UID SEARCH ALL` and sorts every uid of the folder in memory before keeping the newest 500. Memory is proportional to what the server claims.
- `imap-smtp.ts:357-363`: an incremental listing (`n:*`) keeps every FETCH response the server sends. `maxMessages` applies only to the first listing.
- `imap-smtp.ts:335, 404, 417`: `box.uidValidity.toString()` throws a TypeError if a server omits UIDVALIDITY. Callers catch it (logged "sync failed", or a sign-in error), so this isn't a crash, but the account can never sync.
- `session.ts:391`: for every downloaded message, the whole store is scanned for `local:` copies: O(N²) over one download. That's bounded by `maxMessages` (500 per folder) for IMAP, but unbounded for a Maildir.
- `session.ts:268, 614`: the `splits` cache (message id + text length → `splitQuoted` result) is never pruned. It grows for the life of the process with every message shown, including deleted ones, and again whenever an id arrives with a different text.
- `session.ts:249, 386`: the store keeps every parsed message with its full text, and no single message is size-capped. Memory is about the total text of up to 2 × 500 messages, each of any size.
- `session.ts:253`: `receiptsSent` grows by one id per receipt and is never pruned (small).
- `packages/es-bridge/src/adapters/maildir.ts:113`: `readFile` of a whole message file with no size limit, then a copy. `maildir.ts:88`: no limit on the number of files listed.
- `packages/es-bridge/src/cache.ts:46`: the metadata cache is trusted as written. A malformed entry throws inside the `try`, so the whole cache is dropped and rebuilt (no crash). Entries with very large header fields are loaded as they are.
- Uncaught promise rejections: every fire-and-forget call was checked and has a handler (`imap-smtp.ts:269` `void this.tryReconnect()`, whose body is all inside `try`; `session.ts:334`; `bridge.ts:385, 507`; `maildir.ts:172`). imapflow rejects `connect()` instead of emitting `"error"` before a listener exists (`imap-flow.js:331-340`), so the late `on("error")` in `setUp` is safe. HTTP request bodies are capped at 1 MB (`bridge.ts:171`).

## Test results

Root `npm test` (docs:check, then every workspace) is green:

| Package | Before | After |
| --- | --- | --- |
| es-core | 37 files, 1 454 passed | 41 files, 1 518 passed + 1 expected fail (#8), 22.8 s |
| es-web | 4 files, 69 passed | 69 passed (unchanged) |
| es-bridge | 10 files, 154 passed | 155 passed + 2 expected fail (#13, #14), 29.8 s |

`npm run license:check` passes (no dependency added). `npm run typecheck` is clean in es-core (src and tests) and es-bridge. The only failures in the suite are the 3 `it.fails` above. Each was also checked to fail for the stated reason: the deadline test with `it` instead of `it.fails` fails with "expected false to be true".

## Skipped, and why

- **git was not available.** Every git command (`status`, `diff`, `add -N`, `stash`) needed an approval this session could not get. So `J28.patch` was **not** produced by `git diff`. It was built by `difflib` from originals rebuilt by reverse-applying each of my edits (each had to match exactly once, and the rebuilt line counts were checked against `wc -l` taken before any change). `J28.status` was written in `git status --short` format by the same script, not by git. Please run `git add -N . && git diff` to get the authoritative patch; nothing was committed.
- `safeParseMessage` does not exist here; see "Answer in short" for how the properties were mapped.
- `fixtures/malformed/` was not created: every reproducing input is small enough to be generated inside its test.
- #8 (same-subject merge), #13 (IMAP literal cap) and #14 (IMAP command deadline) are not fixed: each needs a design decision, not a local change.
- The es-bridge "listed only" items were not changed. The bridge was not fuzzed, as asked.
- The harness bounds time, not heap. Memory is checked only where an output size or cache size can be asserted (#3, #10).
- Bare-CR line endings are left as they are (see above).
- Not run: `test:browser` and `test:e2e` (they need a browser), and `vectors:check` beyond what `npm test` includes.
