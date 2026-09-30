# Deviations from the ES v2 draft excerpt

This file lists the places where `spec/es-protocol-v2-excerpt.md` (chapters 1, 2 and 4) disagrees with what real mail software sends, accepts or changes. It also lists the places where `packages/es-core` does something other than the draft on purpose. CLAUDE.md says that when the spec and reality disagree, reality wins and the deviation is written down here with its evidence. Task 3, which writes the English public spec, should start from these entries.

- **Section A** covers real-world mail against the draft. Each entry gives what the draft says, what really happens, what es-core does, and which tests cover it.
- **Section B** covers deliberate implementation choices. Each entry gives what the draft says, what es-core does, why, and which tests cover it.

Quotations from the draft are translated from Czech where the draft is in Czech. Test files are in `packages/es-core/test/`. Fixtures are in `packages/es-core/fixtures/`. The fixtures were reconstructed from the public output formats of real clients; none of them was captured from a real mailbox (see `fixtures/README.md`).

**How the evidence was gathered.** RFC citations give section numbers. Client behaviour comes from public knowledge of the clients' output formats, and was checked where possible against web search results (see [Sources](#sources)). The RFC Editor, vendor documentation and mailing-list sites could not be opened from the environment this file was written in. Quoted RFC wording is therefore reproduced from the RFC text as known and from search excerpts, not copied from a fetched page.

## A. Where real-world mail contradicts the draft

### D1. The ES part is not an alternative rendering of the text

- **Draft says:** §4.1 puts `text/plain`, `text/html` and the `application/vnd.es.social+json` record in one `multipart/alternative`.
- **Reality:**
  - RFC 2046 §5.1.4 defines the parts of `multipart/alternative` as alternative versions of the *same* information. They are ordered by increasing faithfulness, and "the best choice is the LAST part of a type supported by the recipient system's local environment". The ES record is not a version of the text. So a reader that can handle JSON, or that treats `+json` as text, is entitled to show the record instead of the message.
  - Clients do apply this rule. Calendar invitations (for example from Outlook/Exchange and Gmail) put `text/calendar` as the last alternative, and a client that understands it shows the invitation instead of the text.
  - List software also treats alternatives as interchangeable. When Mailman's content filtering is on, `collapse_alternatives` replaces each `multipart/alternative` with its first non-empty part, which throws away the ES part.
  - The draft layout displays as intended only because most clients skip a type they do not know.
- **es-core does:**
  - It writes `multipart/mixed` (RFC 2046 §5.1.3): the `text/plain` part comes first and the ES part follows as a separate part (D17).
  - When reading, it finds an ES part anywhere outside `message/rfc822`, including inside `multipart/alternative`. It takes the body from the first `text/plain` alternative, so messages in the draft layout are still understood.
- **Covered by:** `test/fixtures.test.ts` (`es-draft-layout.eml`, "accepts the ES part of the spec 4.1 example and does not list it as an attachment"), `test/serialize.test.ts`, `test/compat-mailparser.test.ts`.

### D2. The example message has no Date, Message-ID or MIME-Version

- **Draft says:** the §4.1 example header has only `From`, `To`, `Subject` and `Content-Type`.
- **Reality:**
  - RFC 5322 §3.6: "The only required header fields are the origination date field and the originator address field(s)". So `Date` is mandatory.
  - RFC 5322 §3.6.4: every message SHOULD have a `Message-ID`.
  - RFC 2045 §4: a MIME message MUST include `MIME-Version: 1.0`. A reader that follows RFC 2045 strictly may treat a message without it as plain RFC 5322 text and show the raw MIME source.
  - MTAs add missing `Date` and `Message-ID` fields (for example Postfix with `always_add_missing_headers`). The added id is not the one written in the ES part (see D7).
  - Messages without any `Message-ID` do exist, for example in old mbox archives and from some automated senders.
- **es-core does:**
  - When writing, it always emits `Date`, `From`, `To`, `Cc` (when there is one), `Subject`, `Message-ID`, `In-Reply-To` and `References` (on replies), `MIME-Version: 1.0` and `Content-Type`. The caller supplies the Date and Message-ID (`SerializeOptions`); an invalid value throws `TypeError`.
  - When reading, it does not require `MIME-Version`. A message without a Message-ID gets the id `sha256:<hex of the raw bytes>`. A missing or unparseable Date gives `date: null`; the ES part's `createdAt` is not used as a substitute.
  - The `es-draft-layout.eml` fixture adds Date, Message-ID and MIME-Version to the draft example.
- **Covered by:** `test/serialize.test.ts` (header set and order), `test/fixtures.test.ts` ("derives the id of a message without Message-ID from SHA-256 of its raw bytes", `mbox-lf-obsolete-date.eml`), `test/threading.test.ts` ("threads messages without a Message-ID by their sha256 ids").

### D3. No transfer encoding: 8-bit text and overlong JSON lines

- **Draft says:** in §4.1, no part has a `Content-Transfer-Encoding`, and the JSON record is written in the body as it is.
- **Reality:**
  - Without the header, `Content-Transfer-Encoding: 7BIT` is assumed (RFC 2045 §6.1). 7bit data contains no octet above 127 and no line longer than 998 octets (RFC 2045 §2.7).
  - Czech text or emoji is 8-bit data. Sending it unencoded needs an `8bit` label and an SMTP path that offers 8BITMIME (RFC 6152).
  - Clients handle this differently. Gmail and Apple Mail encode non-ASCII text as quoted-printable (Gmail sometimes as base64). Thunderbird sends `Content-Transfer-Encoding: 8bit` by default (its hidden preference `mail.strictly_mime` is false) and relies on 8BITMIME.
  - Line length is the bigger problem for the ES part:
    - `JSON.stringify` puts the whole `text` value on one line. A 10000-byte text therefore makes a line far beyond the 998-octet limit of RFC 5322 §2.1.1 and the 1000-octet SMTP text line of RFC 5321 §4.5.3.1.6.
    - Postfix's `smtp_line_length_limit` breaks longer lines by inserting CR LF SPACE. Inside a JSON string that inserts an unescaped control character, which makes the JSON invalid (RFC 8259 §7).
- **es-core does:**
  - Every message it writes is 7-bit ASCII.
  - The `text/plain` part is sent as `7bit` only when it is ASCII, no line is longer than 76 characters, no line has trailing whitespace, and no line starts with `From ` or `.`. Otherwise it is quoted-printable (RFC 2045 §6.7).
  - The ES part is always base64 (RFC 2045 §6.8), in 76-character lines.
  - When reading, it accepts 7bit, 8bit, binary, quoted-printable and base64, and passes unknown encodings through unchanged.
- **Covered by:** `test/codec-transfer.test.ts`, `test/serialize.test.ts`, `test/compat-mailparser.test.ts`, `test/fixtures.test.ts` (`thunderbird-flowed.eml` and `mutt-iso-8859-2.eml` are 8bit).

### D4. `Content-Disposition: inline` on the machine-readable part

- **Draft says:** §4.1 marks the ES part `Content-Disposition: inline; filename="es-data.json"`.
- **Reality:**
  - RFC 2183 §2.1 marks a part `inline` when it is "intended to be displayed automatically upon display of the message".
  - RFC 2183 §2.2 says `attachment` parts are "separate from the main body of the mail message" and their display is "contingent upon some further action of the user".
  - Marking the JSON `inline` asks clients to show it in the message body. Whether a client does so depends on whether it can render the type, but the header asks for exactly what rule 1 of CLAUDE.md tries to avoid.
- **es-core does:**
  - It writes `Content-Disposition: attachment; filename="email-social.json"`, so ordinary clients show one small attachment with a name.
  - When reading, it recognises the ES part by its media type, whatever its disposition.
- **Covered by:** `test/serialize.test.ts`, `test/fixtures.test.ts` (`es-draft-layout.eml` with the inline disposition is still accepted).

### D5. HTML adds no compatibility, and is sometimes the only body

- **Draft says:** §4.1: "plain text and HTML for compatibility".
- **Reality:**
  - Every MIME reader can show `text/plain`; it is the default type (RFC 2045 §5.2). An HTML part adds nothing for compatibility.
  - In the other direction, much incoming mail is HTML first:
    - Newsletters and bulk senders often send `text/html` only.
    - The `text/plain` alternative that clients generate is a lossy conversion of their HTML. For example, Outlook writes list items as `  *   item`.
  - A reader that only takes `text/plain` shows nothing for HTML-only mail.
- **es-core does:**
  - It writes no HTML part (HTML bodies are out of scope in Task 1).
  - When reading, it prefers `text/plain`. Only when a message has no `text/plain` body does it reduce the HTML to text: tags are removed, line breaks kept, and the HTML is never rendered. `textSource` records which source was used.
- **Covered by:** `test/fixtures.test.ts` (`html-only-newsletter.eml`, "uses HTML only when a message has no text/plain part"; the list layout in `outlook-de-original.eml`).

### D6. Replies from ordinary clients are not UTF-8 and not always RFC-conformant

- **Draft says:** §4.1 shows only `charset=utf-8` and says nothing about messages written by other clients, which is where most replies come from.
- **Reality:**
  - **Charsets.** Czech Outlook writes `windows-1250`, and mutt and other Unix mailers write `iso-8859-2`. Text labelled `iso-8859-1` or `us-ascii` often contains windows-1252 bytes, which is why the WHATWG Encoding Standard maps those labels to windows-1252. Some messages carry 8-bit text with no charset label at all.
  - **Encoded-words where RFC 2047 forbids them.** RFC 2047 §5 forbids encoded-words inside quoted strings and in MIME parameters. Even so:
    - Gmail and Outlook write non-ASCII attachment names as `filename="=?UTF-8?B?…?="`, while Thunderbird uses RFC 2231 continuations (`filename*0*=UTF-8''…`).
    - Encoded-words inside quoted display names are common, for example from Outlook.
  - **Split characters.** RFC 2047 §5 also requires each encoded-word to hold whole characters, but real messages contain words split inside a UTF-8 sequence. mailparser's decoder (libmime `decodeWords`) joins adjacent words of the same charset before decoding, for this reason.
  - **format=flowed.** Thunderbird sends plain text as `format=flowed` (RFC 3676) by default. The lines in the part are not the author's lines until soft breaks and space-stuffing are undone.
  - **Raw UTF-8 headers.** Header fields in raw UTF-8 (RFC 6532) appear alongside RFC 2047 encoded-words.
- **es-core does:**
  - It decodes charsets by their WHATWG label. Unknown labels, and unlabelled 8-bit text, are read as UTF-8 when they are valid UTF-8 and as windows-1252 otherwise.
  - It decodes both RFC 2231 parameters and RFC 2047 words inside quotes.
  - It joins adjacent encoded-words of the same charset at the byte level before decoding them.
  - It undoes `format=flowed` (RFC 3676 §4.1–§4.4, including `delsp`).
  - It reads raw UTF-8 headers, with a windows-1252 fallback.
  - What it writes stays strict: every encoded-word holds whole characters, and it never writes flowed text.
- **Covered by:** `test/charset.test.ts`, `test/encoded-word.test.ts`, `test/params.test.ts`, `test/address.test.ts`, `test/headers.test.ts`, `test/fixtures.test.ts` (`outlook-cs-1250.eml`, `mutt-iso-8859-2.eml`, `gmail-web-attachment.eml`, `thunderbird-attachment-rfc2231.eml`, `thunderbird-flowed.eml`, `undisclosed-recipients.eml`).

### D7. Message-IDs are chosen by other software

- **Draft says:** §4.3 shows `Message-ID: <post-3k2a4b5c6d@mail.example.com>` and references `<post-root@…>` and `<post-parent@…>`. In other words, it expects ids derived from ES record keys.
- **Reality:**
  - Each Message-ID in a conversation is written by the software that sent that message. The fixtures reproduce the real shapes:
    - Gmail: `<CA…@…>`.
    - Exchange: ids that contain the server name.
    - Outlook without Exchange: `<000601dc…$…$…$@…>`.
    - Apple Mail and Thunderbird: `<UUID@domain>`.
    - mutt: `<YYYYMMDDhhmmss.GA12345@host>`.
  - RFC 5322 §3.6.4 requires only that the id be unique; it gives it no inner structure.
  - Some sending services replace the Message-ID they are given. Amazon SES documents that it overrides a supplied `Message-ID` with its own value.
  - So a record key cannot be recovered from a Message-ID, and the id inside the ES part can differ from the id in the header.
- **es-core does:**
  - It treats Message-IDs as opaque strings. It extracts them liberally and normalises them to `<…>` with whitespace removed.
  - It never derives a record key from a Message-ID or parses one out of it. The serializer uses whatever Message-ID the caller supplies.
  - A post's ES part is accepted only if its `email.messageId` equals the header Message-ID (when both exist). If a service rewrote the header, es-core reads the message as plain e-mail (`es: null`). Text, participants and threading do not change.
- **Covered by:** `test/es-schema.test.ts` ("extracts message ids liberally"), `test/fixtures.test.ts` ("id and threading references", `gmail-forward-carrying-es-part.eml`), `test/parse.test.ts`.

### D8. Threading headers are often partial or missing

- **Draft says:** §4.3: "ES uses e-mail threading headers plus its own thread metadata". There is no fallback.
- **Reality:**
  - RFC 5322 §3.6.4 makes `In-Reply-To` and `References` only SHOULD.
  - Outlook groups conversations by the proprietary `Thread-Index` and `Thread-Topic` headers (the Exchange conversation index, `PidTagConversationIndex` in Microsoft's protocol documentation). Clients that write only the standard headers do not thread correctly in Outlook, and Outlook's own replies can lack the standard ones:
    - With IMAP/SMTP accounts, Outlook sends `In-Reply-To` without `References`.
    - Older Outlook versions with POP/SMTP accounts send neither header.
  - Sometimes `References` does not end with the `In-Reply-To` id.
  - A "new message" written to continue a conversation carries no threading headers at all.
- **es-core does:**
  - It uses the REFERENCES algorithm of RFC 5256 (JWZ threading). The chain is `References`, plus `In-Reply-To` when that is not its last id.
  - It keeps phantom roots, so a conversation's id does not depend on whether the root message is in the mailbox.
  - It then merges reference trees by normalised subject (D9) when one tree's participant set contains the other's. Messages with an empty subject merge only when their participant sets are identical.
  - It does not read `Thread-Index` or `Thread-Topic`.
- **Covered by:** `test/threading.test.ts`, `test/fixtures-threading.test.ts` (`outlook-de-reply-in-reply-to-only.eml`, `outlook-fr-reply-no-thread-headers.eml`).

### D9. Reply prefixes are localised and wrapped in list tags

- **Draft says:** nothing. The draft does not use the subject for threading.
- **Reality:**
  - RFC 5322 §3.6.5 suggests a single `Re: `.
  - RFC 5256 §2.1 extracts a base subject by removing `re`, `fw` and `fwd` prefixes, `[…]` blobs, the `(fwd)` trailer and `[fwd: …]` wrappers.
  - Real clients localise these prefixes:
    - Outlook writes `AW:`/`WG:` in German, `Odp:`/`PŘ:` in Czech, `RE :`/`TR :` in French (with a space before the colon), `SV:`/`VB:` in Swedish, and so on.
    - Webmails stack their own `Re:` on top (`Re: Odp: …`).
    - Mailing lists add `[list]` before or after the prefix.
    - Some older clients write counters such as `Re[2]:` and `Re^2:`.
  - Because of D8, some replies can be matched to their conversation only by subject.
- **es-core does:**
  - `normalizeSubject` repeatedly strips reply and forward tokens in about 30 localisations. Matching ignores case and allows a counter, a space before the colon, and an ASCII or full-width colon.
  - It also strips leading `[tag]`s, `(fwd)` trailers and `[Fwd: …]` wrappers.
  - It does not strip single-letter tokens (Italian `R:`/`I:`, Hungarian `V:`), because they collide with ordinary subjects. Such replies are threaded only through their headers.
- **Covered by:** `test/subject.test.ts`, `test/threading.test.ts` ("threading: subject fallback"), `test/fixtures-threading.test.ts` ("strips localized prefixes and list tags from conversation subjects").

### D10. `reply.root` and `reply.parent` never come from ordinary clients

- **Draft says:** §2.3.1 defines `reply: { parent, root }` as `at-uri`s, and §4.3 carries them as ES thread metadata.
- **Reality:**
  - A reply written in Gmail, Outlook or Apple Mail has no ES part: Outlook documents that Reply and Reply All leave out the original's attachments. So every such reply lacks this metadata.
  - An AT URI names a record in a repository hosted by an ES server (§2.1–§2.2). This repository has no server and stores nothing outside the user's mailbox (CLAUDE.md rule 2), so an `at://` URI has nothing to point to.
- **es-core does:**
  - It does not write `reply` and ignores it when reading.
  - Threading uses only e-mail headers and subjects.
  - The ES part's `email.inReplyTo` and `email.references` copy the header values.
- **Covered by:** `test/es-schema.test.ts` (unknown fields are ignored), `test/threading.test.ts`.

### D11. Mailing lists and gateways change the message on the way

- **Draft says:** §4.2: "ES uses existing DKIM for additional validation", in the order DKIM, ES signature, DID resolution, timestamp. §4.1 assumes the message arrives as it was sent.
- **Reality:**
  - **Changes break DKIM.** List software changes both headers and body. RFC 6377 §3.3 lists subject tags, footers and the removal of MIME parts, and each of them breaks a DKIM signature that covers the changed part. RFC 7960 describes the same changes as the cause of DMARC failures on list traffic.
  - **Parts are removed.** When Mailman's content filtering is on, by default it passes only `multipart/mixed`, `multipart/alternative` and `text/plain`. An `application/*` ES part is removed.
  - **From is rewritten.** To avoid DMARC rejections (RFC 7960 §4.1.3.1), Mailman's "Munge From" and Google Groups rewrite `From` to the list address. For example, `From: "Alice via dev-list" <dev-list@lists.example.org>`, with the author moved to `Reply-To` (or `Cc`). Mailman's "Wrap Message" instead puts the original inside a `message/rfc822` part.
  - **Text is added.** Mailman appends its footer either to a single text part or as a separate `text/plain` part. Corporate gateways add banners and disclaimers. The text a reader sees is then no longer the text inside the ES part.
- **es-core does:**
  - It never needs the ES part: text, participants and threading all come from the MIME message.
  - The ES part is accepted only when its `via` equals the canonical `From`. After From rewriting it does not, so the message is read as plain e-mail from the list address, and the ES part is listed as an attachment.
  - It does not descend into wrapped originals (`message/rfc822`).
  - `EsMessage.text` is the MIME text, including any footer. `es.text` is the sender's text. es-core does not reconcile the two.
  - It performs no DKIM check and no timestamp check. DKIM needs DNS lookups (RFC 6376 §3.6.2), and signatures are out of scope (CLAUDE.md rule 5).
- **Covered by:** `test/fixtures.test.ts` (`mailing-list-footer.eml`: the footer part is joined to the text; "rejects an ES part that a forward carried along: its via is not the From address", which is the same rule that applies after From rewriting). No fixture has a rewritten From yet.

### D12. Forwards carry another message's ES part

- **Draft says:** nothing about forwarding.
- **Reality:**
  - Gmail and Outlook include the original's attachments when forwarding. Microsoft's documentation: "Any attachments included in the original message are automatically included when you forward".
  - A forwarded Email Social message therefore carries its ES part inside a new message with a different Message-ID, usually from a different sender. This also happens when authors forward their own message.
- **es-core does:**
  - It accepts a post's ES part only when `via` equals the canonical From address and `email.messageId` equals the header Message-ID (when both exist).
  - Otherwise `es` is `null`, and the carried part appears in `attachments` under its filename.
- **Covered by:** `test/fixtures.test.ts` (`gmail-forward-carrying-es-part.eml`), `test/parse.test.ts`.

### D13. Handle resolution needs the network and cannot represent every address

- **Draft says:** §1.3: "a handle (e-mail address) is resolved to a DID through a DNS TXT record or HTTP well-known". The DNS name for `user@example.com` is `_es.user.example.com.`; the HTTP form is `https://example.com/.well-known/es-did?handle=…`. The reverse check goes through `alsoKnownAs`.
- **Reality:**
  - The DNS form turns `@` into a label separator, and a `.` in the local part also becomes a separator. So `a.b@example.com` and `a@b.example.com` map to the same name.
  - DNS compares ASCII letters case-insensitively (RFC 4343), but local parts are case-sensitive (RFC 5321 §2.4).
  - A local part may be 64 octets long (RFC 5321 §4.5.3.1.1), but a DNS label holds at most 63 (RFC 1035 §2.3.4).
  - Quoted local parts (RFC 5321 §4.1.2) can contain spaces and `@`.
  - Both the DNS and the HTTP method need the owner of the mail domain to publish something. Users of a mailbox provider cannot do that themselves.
  - Both methods need network lookups.
- **es-core does:** no resolution, no DID documents and no network access (Task 1: identifiers are metadata only). DIDs are derived locally (D20).
- **Covered by:** nothing to cover, because es-core has no resolution code. `test/did.test.ts` covers format, parse, validate and derive.

### D14. Lexicon limits: undefined units, and real mail exceeds them

- **Draft says:** §2.3.1 sets `text` maxLength 10000, `email.subject` maxLength 500 and `langs` maxLength 3 (an array). `via` has `format: "email"`.
- **Reality:**
  - The draft uses AT Protocol Lexicon syntax. In Lexicon, a string's `maxLength` counts UTF-8 bytes (`maxGraphemes` counts characters), and an array's `maxLength` counts elements. The draft does not say which it means.
  - Lexicon defines no `email` string format.
  - E-mail itself sets no limit on the length of the subject or the body. RFC 5322 §2.1.1 limits line length, and folding allows long fields (§2.2.3).
    - Long chains such as `Re: AW: Fwd:` exceed 500 bytes.
    - Replies that quote earlier messages exceed 10000 bytes. In UTF-8, Czech letters take 1–2 bytes each and emoji take 4.
- **es-core does:**
  - It counts string limits in UTF-8 bytes (`ES_TEXT_MAX_BYTES` = 10000, `ES_SUBJECT_MAX_BYTES` = 500).
  - The limit applies to the ES record only, never to the e-mail. A text over 10000 bytes goes whole into the `text/plain` part; the record then leaves `text` out and carries `email.textSha256`, the lowercase hex SHA-256 of the UTF-8 text, so a reader can tie the record to the body. This makes `text` optional in that one case, although §2.3.1 lists it as required (D18).
  - When a subject exceeds 500 bytes, it writes `email.subject: null`. The `Subject` header still carries the whole subject.
  - The parser does not enforce these limits.
  - It reads `via` as an address containing `@`, with the domain lowercased.
- **Covered by:** `test/serialize.test.ts`, `test/es-schema.test.ts`, `test/roundtrip.test.ts` and `test/compat-mailparser.test.ts` (a 20 kB message), `vectors/generated-long-message.json`.

### D15. Receipts are missing from the draft, and uneven in real mail

- **Draft says:** chapters 1, 2 and 4 define no receipts. Task 1 asks for Delivered and Read receipts "per chapter 4 semantics", which do not exist there.
- **Reality:**
  - **Read receipts (MDN).** In Internet mail these are Message Disposition Notifications (RFC 8098):
    - They are requested with `Disposition-Notification-To`. The request is "merely a request", and user agents "are always free to silently ignore" it (§2.1).
    - An MDN must not be sent automatically when the requested address differs from `Return-Path`, and in that case the user must be asked (§2.1).
    - The dispositions are `displayed`, `deleted`, `dispatched` and `processed` (§3.2.6.2).
    - The notification is sent as `multipart/report` (RFC 6522).
  - **Support is uneven.** Gmail offers read receipts only for Google Workspace accounts where an administrator turned them on. Apple Mail does not support them.
  - **"Delivered".** In Internet mail this is a DSN (RFC 3464). DSNs are produced by MTAs and requested per recipient with the SMTP `NOTIFY` parameter (RFC 3461 §4.1), not by the recipient's client.
  - **Automatic replies.** Automatic messages should carry `Auto-Submitted` so that responders do not answer them (RFC 3834 §2, §5).
- **es-core does:**
  - Its own receipt record in the ES part, sent inside an ordinary message that any client can read (D19).
  - It does not write `Disposition-Notification-To`, and it neither produces nor interprets MDNs or DSNs. An incoming MDN is parsed as an ordinary message: the human-readable part becomes the text, and the report parts become attachments.
  - `read` corresponds to the MDN disposition `displayed`. `delivered` means that the recipient's Email Social client has fetched the message, which is neither a DSN nor an MDN.
- **Covered by:** `test/serialize.test.ts`, `test/es-schema.test.ts` ("round-trips both receipt kinds").

### D21. Ordinary replies carry the whole earlier message, quoted

- **Draft says:** nothing. A post's `text` is shown as it is; the draft does not say what a client does with the quoted history that mail clients add.
- **Reality:**
  - Gmail, Outlook, Apple Mail, iOS Mail, Thunderbird, Seznam.cz and mutt quote the message they answer: `>` lines after an attribution line ("On … wrote:", "Dne … napsal(a):", "Am … schrieb …:", "Le … a écrit :", wrapped over two lines by Gmail), or, in Outlook, a `From:`/`Sent:`/`To:`/`Subject:` block in the user's language followed by the unprefixed original. Thunderbird and mutt put the answer below the quote; mutt users answer between quoted lines.
  - In a chat view each message then shows the whole conversation again below it. The maintainer's first manual test with a real mailbox (tasks/02b, item 5) showed exactly that.
  - Signatures (RFC 3676 §4.3 `-- `, often without the space) and one-line mobile signatures ("Sent from my iPhone", "Odesláno z iPhonu") follow the text.
- **es-core does:** `splitQuoted` separates what the sender wrote now from the quoted text and the signature, without dropping a line; HTML is reduced to text with `> ` in front of lines inside `<blockquote>` (Gmail's quote container, Apple Mail's and Thunderbird's `type="cite"`). A quote between two answers stays with the answers. An Email Social post is always entirely fresh text.
- **Covered by:** `test/split-quoted.test.ts` (26 reconstructed reply formats in `fixtures/replies/` and 11 corpus replies, a seeded property test that no line is lost), `test/html-to-text.test.ts`, the `split` field of every test vector.

### D22. People write to each other under many subjects; lists and programs are not people

- **Draft says:** §4.3 groups messages by threading headers and ES thread metadata.
- **Reality:**
  - The same two people start a new subject for every new topic, so a thread view splits one relationship into many conversations and "looks like a mail client" (tasks/02b, item 6).
  - A mailbox also holds mailing lists (RFC 2369 `List-*`, RFC 2919 `List-Id`, `Precedence: list`), newsletters (`List-Unsubscribe`, `Precedence: bulk`) and automated mail (RFC 3834 `Auto-Submitted`, the null `Return-Path: <>` of delivery reports, no-reply senders), none of which is a conversation with a person.
- **es-core does:** `groupByParticipants` puts every message exchanged with exactly the same set of people (From, To and Cc without the account owner) into one chat, oldest first, with each message's base subject so a client can mark subject changes; the id is derived from the sorted addresses. `classifyMessage` tells `person`, `list` and `automated` mail apart from headers only; the bridge shows lists and automated mail under "Other mail". `threadMessages` (D8) is unchanged and still threads by headers and subject.
- **Covered by:** `test/chats.test.ts`, `test/classify.test.ts`, the `delivery` field of every test vector.

## B. Where es-core deliberately differs from the draft

### D16. Media type `application/vnd.email-social.message+json`

- **Draft says:** §4.1 uses `application/vnd.es.social+json; version=2.0`.
- **es-core does:**
  - It writes `application/vnd.email-social.message+json`.
  - When reading, it accepts both names, in any letter case and with any parameters. It ignores `version`, since MIME implementations ignore parameters they do not recognise (RFC 2045 §5.1).
- **Why:**
  - Task 1 (deliverable 2) requires this name.
  - The name says what the part carries to anyone who finds it in a message source.
  - The `+json` suffix (RFC 6839 §3.1) tells generic tools that the body is JSON.
  - This repository has registered neither name in the IANA vendor tree (RFC 6838 §3.2).
- **Covered by:** `test/es-schema.test.ts` ("recognises the ES media types, including the draft's").

### D17. `multipart/mixed` layout: text first, ES part as a base64 attachment, no HTML

- **Draft says:** §4.1 uses `multipart/alternative` with plain text, HTML and an inline JSON part.
- **es-core does:**
  - The top level is `multipart/mixed` with a short preamble line. It has two parts:
    - `text/plain; charset=utf-8`, encoded as 7bit or quoted-printable (D3), with no `Content-Disposition`.
    - The ES part: base64, `Content-Disposition: attachment; filename="email-social.json"`.
  - The boundary is `=_es_` plus 24 hex digits of SHA-256 over the Message-ID, so it is deterministic. `=_` cannot occur in quoted-printable or base64 output (RFC 2045 §6.7).
  - The text in the two parts is identical. The only change is that `\r\n` and lone `\r` become `\n`. A text over 10000 bytes is only in the `text/plain` part (D14).
  - With `includeEsPart: false` the message is a single `text/plain` part without an ES part, for recipients who have never sent one; such a message never shows an `email-social.json` attachment. A text without a final line break is then written as quoted-printable ending in a soft line break (RFC 2045 §6.7 rule 5), so the body ends with CRLF and still decodes to the exact text. Receipts always carry their ES part.
  - Receipts use the same layout.
- **Why:**
  - Rule 1 of CLAUDE.md: the plain text must be what every client shows.
  - This layout avoids the problems in D1, D3, D4 and D5.
  - The cost is that ordinary clients show one attachment named `email-social.json`.
- **Covered by:** `test/serialize.test.ts`, `test/compat-mailparser.test.ts` (mailparser reads the same text and subject).

### D18. Record envelope without `uri`, `cid` or `signature`, and the direct-message subset

- **Draft says:**
  - §2.2: the envelope has `$type`, `uri`, `cid`, `value`, `author`, `createdAt` and `updatedAt`.
  - §2.4: a CID computed over DAG-CBOR.
  - §2.5 and §4.1: a `signature` object.
  - §2.3.1: `text`, `via`, `createdAt`, `email`, `facets`, `embed`, `visibility`, `geo`, `reply` and `langs`.
  - The draft is inconsistent with itself:
    - §2.2 puts `createdAt` on the envelope, while §2.3.1 and §4.1 put it in `value`.
    - §2.4 computes the CID of a flat record that has no `value`.
    - The same CID string appears for different records in §2.2, §2.4 and §4.1, so it is a placeholder rather than a computed value.
- **es-core does:**
  - It writes the envelope as `$type`, an optional `author` and `value`.
  - `value` holds `text`, `via` and `createdAt` (required, as in §2.3.1, except that a text over 10000 bytes is left out, D14), `email { messageId, subject, inReplyTo, references, textSha256 }`, and `requestReceipts` (D19).
  - When reading, it follows §4.1 (the lexicon record sits inside `value`). It ignores unknown fields, drops malformed optional fields, and rejects a record that lacks a required field. Flat records in the §2.4 form are not accepted.
- **Why:**
  - `uri` and `cid` need a repository and DAG-CBOR/multiformats libraries, and this repository has neither.
  - Signatures are out of scope (CLAUDE.md rule 5).
  - `updatedAt` has no meaning for a message that has already been sent.
  - `facets`, `embed`, `visibility`, `geo`, `reply` (D10) and `langs` belong to features this repository does not have (CLAUDE.md: no feeds, reactions or hashtags). Images travel as ordinary attachments.
- **Covered by:** `test/es-schema.test.ts` ("accepts the draft record envelope (spec 4.1) and ignores uri, cid and signature", "drops malformed optional fields instead of rejecting the record").

### D19. `requestReceipts` and the `es.social.receipt` record

- **Draft says:** nothing (see D15).
- **es-core does:**
  - **Requesting.** A post may carry `value.requestReceipts`, a subset of `["delivered", "read"]` kept in that order without duplicates.
  - **The record.** A receipt is `{ "$type": "es.social.receipt", "author"?, "value": { kind, messageId, via, createdAt } }`.
  - **The message.** A receipt message has:
    - the subject `Read: <subject>` or `Delivered: <subject>`;
    - `In-Reply-To` and `References` pointing to the original, so every client threads it;
    - `Auto-Submitted: auto-replied` (RFC 3834 §5);
    - a short English plain text that says what happened;
    - the ES part.
  - Receipts never request receipts, just as RFC 8098 §2.1 forbids an MDN in answer to an MDN.
  - es-core only builds and parses receipts. Whether and when to send one, including asking the user, is left to the client (Task 2).
- **Why:**
  - The task requires the receipt to be in the ES part.
  - An MDN request is honoured unevenly (D15), and an ordinary message with a text part is readable everywhere (rule 1).
- **Covered by:** `test/es-schema.test.ts`, `test/serialize.test.ts`, `test/parse.test.ts`.

### D20. DIDs derived from the mailbox address, in one canonical spelling

- **Draft says:**
  - §1.1: "Every user has a stable DID independent of a particular e-mail address". `<domain>` is "the DNS domain of the ES server", and `<local-identifier>` is "a unique identifier within the server (UUID / hash)".
  - §1.2–§1.4 describe DID documents, resolution and migration.
- **es-core does:**
  - **Derivation.** `deriveDid(address)` uses the mailbox domain and the first 32 hex digits (128 bits) of SHA-256 over `<local part>@<ASCII domain>`, which is the draft's "hash" option.
    - The domain is lowercased. Internationalised labels are converted to their `xn--` form with RFC 3492 Punycode after NFC normalisation; this is not full UTS #46 processing.
    - Callers may put any valid `did:es` identifier in `author` instead.
  - **Metadata only.** Nothing resolves a DID or checks it against a DID document. A received `author` is only checked for syntax, and becomes `null` if malformed.
  - **Canonical syntax.** The syntax follows W3C DID Core §3.1: a lowercase method name, and `idchar` characters in the local identifier. In addition, the domain must consist of lowercase LDH labels. An uppercase domain makes a DID invalid rather than a second spelling of it, so DIDs can be compared as plain strings.
  - **Case in the local part.** The local part of the address is not case-folded (RFC 5321 §2.4). `Alice@…` and `alice@…` therefore get different DIDs, as they are different contacts.
- **Why:**
  - There is no ES server (CLAUDE.md rule 2), so the mailbox domain is the only domain available. The draft's own second example already puts a mailbox provider's domain in a DID.
  - The trade-off is that a derived DID changes when the address changes, contrary to what §1.1 intends.
- **Covered by:** `test/did.test.ts`, including the fixed vector `deriveDid("alice@example.com")` = `did:es:example.com:ff8d9819fc0e12bf0d24892e45987e24`.

### D23. Replies to people without Email Social quote what they answer

- **Draft says:** nothing about quoting.
- **es-core and the bridge do:** a reply sent from Email Social to a chat in which nobody has ever sent an ES part ends with `quoteForReply` of the message it answers: an English attribution line ("On Tue, 3 Mar 2026 at 10:15, Name <address> wrote:") and that message's fresh text as `> ` lines (at most 40). Such a reply has no ES part (D17 applies only when a recipient has sent one). A reply to someone who uses Email Social quotes nothing, since their client shows the chat.
- **Why:** an ordinary mail client shows no chat history, so a bare answer arrives without context (tasks/02b, item 4). The quote is in the `text/plain` body, readable everywhere (rule 1), and `splitQuoted` recognises it when the reply is read back.
- **Covered by:** `test/reply-quote.test.ts` (es-core), `test/session.test.ts` and `test-e2e/maildir.test.ts` (es-bridge).

## Sources

The following were read as search-result excerpts; the pages themselves could not be opened from the build environment:

- RFC 2046, MIME Part Two (§5.1.4): https://www.rfc-editor.org/rfc/rfc2046.html
- RFC 2047, encoded-word restrictions (§5): https://www.rfc-editor.org/rfc/rfc2047.html
- RFC 6377, DKIM and mailing lists: https://www.rfc-editor.org/rfc/rfc6377.html
- RFC 7960, DMARC and indirect mail flows: https://www.rfc-editor.org/rfc/rfc7960.html
- RFC 8098, Message Disposition Notification: https://www.rfc-editor.org/rfc/rfc8098.html
- Postfix `smtp_line_length_limit` ("Longer lines are broken by inserting <CR><LF><SPACE>"): https://www.postfix.org/postconf.5.html#smtp_line_length_limit and https://github.com/bokysan/docker-postfix/issues/142
- Thunderbird `mail.strictly_mime` default: https://bugzilla.mozilla.org/show_bug.cgi?id=1379096
- Amazon SES header fields ("If you provide a Message-ID header, Amazon SES overrides the header with its own value"): https://docs.aws.amazon.com/ses/latest/dg/header-fields.html
- Mailman DMARC mitigations: https://wiki.list.org/DEV/DMARC and https://docs.mailman3.org/projects/mailman/en/latest/src/mailman/handlers/docs/dmarc-mitigations.html
- Mailman content filtering (default pass types, `collapse_alternatives`): https://docs.mailman3.org/projects/mailman/en/latest/src/mailman/handlers/docs/filtering.html
- Google Groups From rewriting: https://www.spamresource.com/2014/04/google-groups-rewriting-from-addresses_25.html
- AT Protocol Lexicon (`maxLength` in UTF-8 bytes; array `maxLength` in elements): https://atproto.com/specs/lexicon
- Outlook threading by Thread-Index: https://github.com/freescout-help-desk/freescout/issues/4922
- Localised subject prefixes: https://en.wikipedia.org/wiki/List_of_email_subject_abbreviations and https://office-watch.com/2014/outlook-reply-forward-prefixes/
- Outlook forwards include attachments, replies do not: https://support.microsoft.com/en-us/outlook/reply-to-or-forward-an-email-message
- Gmail read receipts (work or school accounts only): https://support.google.com/mail/answer/9413651
- Apple Mail and read receipts: https://discussions.apple.com/thread/254379303

The following was read locally:

- mailparser's header decoder, `libmime` `decodeWords` in `node_modules/libmime/lib/libmime.js`, which joins adjacent encoded-words of the same charset before decoding.

The remaining RFC citations come from the RFC text as known: RFC 1035, 2045, 2183, 2231, 3461, 3464, 3492, 3676, 3834, 4343, 5256, 5321, 5322, 6152, 6376, 6522, 6532, 6838, 6839 and 8259. So does the WHATWG Encoding Standard's label table (https://encoding.spec.whatwg.org/).

This file is part of `spec/` and is licensed CC BY 4.0.
