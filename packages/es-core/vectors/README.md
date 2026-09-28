# Test vectors

These files are the test suite of the Email Social message format for any
implementation, in any language. Each `*.json` file is one raw e-mail message
and the `EsMessage` that a conforming parser produces from it.

`npm run vectors:check` (in `packages/es-core`) runs them against es-core.
`npm run vectors:update` rewrites them from the current code; the diff must
then be reviewed like any code change.

## Format

```json
{
  "description": "what the message is and what it exercises",
  "source": "fixtures/<file>.eml" | "generated",
  "raw": "the message, when its bytes are valid UTF-8",
  "rawBase64": "the message bytes in base64, otherwise (exactly one of raw / rawBase64)",
  "input": { "kind": "message" | "receipt", "...": "only for generated vectors, see below" },
  "expected": { "...": "EsMessage" }
}
```

- **Input bytes.** Parse the UTF-8 bytes of `raw`, or the decoded bytes of
  `rawBase64`. Line endings are as on the wire (CRLF), except in
  `mbox-lf-obsolete-date.json`, which has LF on purpose. Do not normalise
  them before parsing.
- **`expected`** is an `EsMessage` as defined in
  [`src/types.ts`](../src/types.ts). Compare with deep equality; key order
  does not matter, array order does. In short:
  - `id`: the Message-ID in angle brackets, or `"sha256:"` + the lowercase
    hex SHA-256 of the raw bytes when there is none;
  - `from` (first mailbox or `null`), `to`, `cc`, `replyTo`: `{ name, address }`
    with the name decoded and the address's domain lowercased (the local part
    is kept as written);
  - `date`: ISO 8601 in UTC with milliseconds, or `null`;
  - `subject`: decoded, whitespace runs collapsed to one space, trimmed;
  - `text`: the text/plain body (HTML reduced to text only when there is no
    text/plain), `"\n"` line endings, format=flowed unwrapped, not trimmed;
    `textSource` says `"plain"`, `"html"` or `"none"`;
  - `es`: the ES part record, or `null` when there is none or it does not
    belong to the message (its `via` is not the From address, or its
    `email.messageId` is not the Message-ID); a post's `text` is `null` when
    the sender left a text over 10000 UTF-8 bytes out of the record, and
    `email.textSha256` then holds the hex SHA-256 of the body text;
  - `attachments`: metadata of every other leaf part (`filename`,
    `contentType`, `disposition`, decoded `size`, `contentId`, IMAP `partId`);
  - `refs`: `messageId`, and every msg-id of `In-Reply-To` and `References`.
- **Generated vectors** (`source: "generated"`) were written by es-core's
  serializer from `input` with a fixed date and Message-ID. A conforming
  writer need not produce the same bytes, but a conforming parser must read
  `raw` as `expected`. es-core additionally checks that serialising `input`
  again gives `raw` byte for byte.

The fixture vectors come from `../fixtures/`; see `../fixtures/README.md`
for what each reconstructed client format contains. All addresses and
domains are `example.com`, `example.org` or `example.net`.
