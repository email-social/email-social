# Fuzz harness for es-core

Deterministic: every input comes from a seeded generator (`mulberry32`, seed
per case from `seedFor(fixture, mutator, round)`), so a failure message names
everything needed to rebuild the input. The default run takes about 30 s
inside `npm test`.

| File | What it does |
| --- | --- |
| `config.ts` | Seed, rounds, sizes and the time limit per message (0.5 s + 1 µs per byte). |
| `mutate.ts` | Mutators that work on the raw bytes of a message: byte flips, random truncation, duplicated and dropped header fields, 1 MB header lines, boundary strings in bodies, charset chaos and invalid UTF-8, CRLF/LF/CR mixes, quoted-printable and base64 corruption, RFC 2231 fragments out of order, Content-Type swaps, splicing two fixtures. |
| `properties.ts` | The properties checked for every input (below). |
| `es-oracle.ts` | An independent reading of spec section 5.4, to compare with `parseEsJson`. |
| `fixtures-mutated.test.ts` | Every fixture in `fixtures/` and `fixtures/replies/` through every mutator; truncation before, inside and after every MIME delimiter line; every header field dropped and duplicated; LF and CRLF forms parse the same. |
| `synthetic.test.ts` | Inputs built from scratch: runs of 25 characters in 19 header fields (ReDoS sweep), 10 000 nested and 10 000 sibling multiparts, References loops of 10 000 ids, ES parts that are valid JSON with wrong types, a flood of `>` quote prefixes (4 MB; 100 MB in the long run). |
| `threading-scale.test.ts` | Threads 2 000 and 20 000 synthetic messages of five mailbox shapes and prints the times. |

## Properties

- `parseMessage` never throws and returns a well-formed `EsMessage`.
- `parseMessageUnguarded` (the same parser without its last-resort `catch`)
  never throws either: es-core defines no parse error type, so any exception
  is a defect. Its result equals `parseMessage`'s.
- Parsing and reading one message (split, unquote, reply quote, reply card)
  stays under the time limit.
- `splitQuoted` keeps every non-blank line in exactly one of its parts.
- Every listed attachment can be extracted with `extractPart`, with the same
  size and type.
- An ES part has the types spec 5.4 promises and survives
  `formatEsJson` → `parseEsJson`; `parseEsJson` agrees with the oracle.
- `threadMessages` places each distinct id once and does not depend on input
  order.

## Running

```sh
npx vitest run test/fuzz                   # default run
ES_FUZZ_ROUNDS=40 npx vitest run test/fuzz # more mutations per fixture
ES_FUZZ_SEED=7 npx vitest run test/fuzz    # other inputs
ES_FUZZ_LONG=1 npx vitest run test/fuzz    # 30 rounds, 100 MB flood, 1 MB header runs (minutes)
```

Defects the harness found are kept as plain unit tests in
`test/hostile-input.test.ts`.
