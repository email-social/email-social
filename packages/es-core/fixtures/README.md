# Real-world message fixtures

Raw RFC 5322 messages that imitate what common mail clients send. They are
the input of `test/fixtures.test.ts` (every field of `parseMessage` compared
with a hand-written expectation) and `test/fixtures-threading.test.ts` (the
whole corpus threaded into conversations).

## Rules for this directory

- **Reconstructed, not captured.** No message comes from a real mailbox. Each
  one reproduces the publicly known output format of a client: header set and
  order, MIME structure, boundary and Message-ID style, charset and
  transfer-encoding choices, reply/forward prefixes, quote headers and
  signatures. People are invented.
- **Example domains only.** Every domain is `example.com`, `example.org`,
  `example.net` or a subdomain of them, including Message-IDs, `Received`
  fields and URLs (a Gmail-style Message-ID keeps Gmail's shape but ends in
  `@mail.example.com`). IPv4 addresses come from the RFC 5737
  documentation ranges, IPv6 addresses from `2001:db8::/32` (RFC 3849). The
  "fixture corpus" tests in `test/fixtures.test.ts` check this, together with
  line endings and the 998-character line limit (RFC 5322 §2.1.1).
- **Byte-exact.** Line endings are CRLF, as on the wire, except in
  `mbox-lf-obsolete-date.eml`, which tests LF on purpose. 8-bit bodies contain
  real single bytes of their charset; quoted-printable and base64 bodies were
  produced by an encoder, not typed. `.gitattributes` marks `*.eml` as
  `-text`; do not open and re-save these files in an editor.
- **Every file has an expectation.** Adding a fixture without an entry in
  `test/fixtures.test.ts` makes the corpus test fail.

## Files

| File | Client / format reconstructed | What it exercises | Provenance note |
| --- | --- | --- | --- |
| `thunderbird-flowed.eml` | Thunderbird 128, original message | `text/plain; charset=UTF-8; format=flowed`, 8bit; soft-wrapped lines unwrapped; `-- ` signature separator kept; RFC 2047 Q subject and names; `Content-Language: cs` | Minimal `User-Agent: Mozilla Thunderbird`, UUID Message-ID, wrap at 72 columns, as in recent Thunderbird releases |
| `gmail-web-reply.eml` | Gmail web, reply to the message above | `multipart/alternative` (QP plain + HTML); whole subject as one `=?UTF-8?B?…?=` word; `On … wrote:` attribution with U+202F before "AM"; `> ` quotes; In-Reply-To and References | Gmail boundary `000000000000` + 16 hex digits; Message-ID `<CA…@mail.example.com>` in Gmail's style |
| `ios-mail-reply.eml` | iOS Mail (Czech UI), reply-all to the Gmail reply | QP UTF-8 where a soft line break splits the bytes of 👍; U+FEFF that iOS puts before quoted text; `Mime-Version: 1.0 (1.0)`; `X-Mailer: iPhone Mail (…)`; "Odesláno z iPhonu"; References to both earlier messages | Apple-style header order and tab-folded `Content-Type` |
| `outlook-de-original.eml` | Outlook with Exchange Online, German | `multipart/alternative`, `text/plain; charset="iso-8859-1"` QP, Word-generated HTML; `Thread-Topic`, `Thread-Index`, empty `X-MS-Has-Attach:`; `Content-Language: de-DE`; Outlook's plain-text list layout (`  *   item`) | Exchange Message-ID and `_000_…_` boundary shapes; Thread-Index is 22 bytes of the documented layout with invented content |
| `outlook-de-reply-in-reply-to-only.eml` | Outlook 2016 with an IMAP/SMTP account, German reply | `AW:` prefix; In-Reply-To and Thread-Index but no References; German quote header (`Von: … Gesendet: … An: … Betreff: …`) with Outlook's trailing space (`=20`); `"'Anna Becker'"` display name; mixed-case domain `Example.NET` | `----=_NextPart_…` boundary, `<…$…$…$@domain>` Message-ID and "This is a multipart message in MIME format." preamble of Outlook without Exchange |
| `outlook-cs-1250.eml` | Outlook with Exchange, Czech, plain-text format | `text/plain; charset="windows-1250"` QP with Czech letters and „“ (0x84/0x93); `=?windows-1250?Q?Odp:_…?=`; "-----Původní zpráva-----" header block (`Od:`, `Odesláno:`, `Komu:`, `Předmět:`); References whose first id is not in the corpus (phantom root) | Czech Outlook uses "Odp:" for replies |
| `apple-mail-fr-original.eml` | Apple Mail on macOS, French | `multipart/alternative` with QP UTF-8; `Mime-Version: 1.0 (Mac OS X Mail 16.0 \(3774.600.62\))`; `X-Mailer: Apple Mail (2.3774.600.62)`; `<UUID@example.org>` Message-ID; empty preamble line | `Apple-Mail=_UUID` boundary |
| `outlook-fr-reply-no-thread-headers.eml` | Outlook 2007 (French) | `RE : ` with the French space before the colon; neither In-Reply-To nor References (only Thread-Index), so it joins the conversation of the Apple Mail original by subject and participants; `charset="windows-1252"` QP; "-----Message d'origine-----" block | Older Outlook versions with POP/SMTP accounts threaded only through Thread-Index |
| `apple-mail-fr-forward.eml` | Apple Mail on macOS, forward | `Fwd:` forward of the French original to a new person, no threading headers; must stay a separate conversation | Apple Mail writes "Fwd:" in every UI language; the French forward prefix "TR :" is in `outlook-fr-forward.eml` |
| `outlook-fr-forward.eml` | Outlook with Exchange, French | `TR : ` forward to another new person, QP UTF-8, French forward header block (`De :`, `Envoyé :`, `À :`, `Cc :`, `Objet :`) | Uppercase Exchange Message-ID domain as Exchange Online writes it |
| `apple-mail-inline-image.eml` | Apple Mail on macOS, plain-text message with a photo | `multipart/mixed`: text/plain, inline `image/jpeg` (Content-Disposition inline, filename, Content-Id), text/plain; the two text parts are joined | Apple Mail splits plain text around inline attachments; the JPEG is a 159-byte 1×1 image |
| `gmail-web-attachment.eml` | Gmail web, new message with a PDF | `multipart/mixed { multipart/alternative { plain, html }, application/pdf }`; `filename="=?UTF-8?B?…?="` (RFC 2047 inside quotes, Gmail style); `Content-ID` + `X-Attachment-Id` | Gmail writes the inner close delimiter directly before the next outer delimiter |
| `thunderbird-attachment-rfc2231.eml` | Thunderbird 128, message with a spreadsheet | non-ASCII filename as RFC 2231 continuations (`filename*0*=UTF-8''…; filename*1*=…`) and as RFC 2047 words in `name`; flowed text with a space-stuffed `From ` line (RFC 3676 §4.4) | "This is a multi-part message in MIME format." preamble and `------------` + 24 characters boundary |
| `mutt-iso-8859-2.eml` | mutt 2.2 reply | `text/plain; charset=iso-8859-2`, 8bit raw Latin-2 bytes, `Content-Disposition: inline`; `Re: =?iso-8859-2?Q?…?= serveru` (only the non-ASCII word encoded); `<YYYYMMDDhhmmss.GA12345@host>` Message-ID; Mail-Followup-To; `> ` empty quote lines | mutt's default attribution `On %d, %n wrote:` |
| `mutt-attachment-patch.eml` | mutt 2.2, patch attached | `multipart/mixed`: inline text/plain + `text/x-diff` with a filename (an attachment, never text); the patch contains `From `, `---` and `-- ` lines | mutt boundary of 16 characters including "/" |
| `seznam-webmail.eml` | Seznam.cz webmail style | `multipart/alternative`, text/plain and text/html in base64 UTF-8; `=?utf-8?q?Re=3A_Odp=3A_…?=` (a webmail "Re:" on top of Outlook's "Odp:"); `Date: … +0100 (CET)`; "---------- Původní e-mail ----------" quote header | Seznam's header set is not publicly documented; Message-ID, boundary, `(CET)` date comment and quote layout are approximations, the least certain reconstruction in this corpus |
| `html-only-newsletter.eml` | bulk newsletter sender | `text/html` only, base64 UTF-8, with `<title>`, `<style>`, a comment, `<br>`, `<p>`, `<ul><li>`, `&amp;`, `&nbsp;`, `&#8211;`; `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) | Message-ID in the style of a large sending service |
| `mailing-list-footer.eml` | Mailman 2.1 list, post written in Apple Mail | `[dev-list] Re: Release plan`; List-Id, List-Post, `Precedence: list`; `multipart/mixed { multipart/alternative { QP plain, html }, footer text/plain }`: the footer part is appended to the text; References to a message not in the corpus | Mailman 2.1 cannot append a footer inside a `multipart/alternative`, so it wraps the original (copying only its `Content-*` headers) and adds the footer as a separate part; Python `email` boundary `===============<19 digits>==` |
| `mbox-lf-obsolete-date.eml` | message from an old mbox archive | LF line endings; leading mbox `From ` envelope line; `>From` escaping in the body; obsolete date `Mon, 2 Mar 26 09:30:00 EST` (2-digit year, EST, RFC 5322 §4.3); `From: address (Name)` comment form; no MIME headers; no Message-ID | Classic sendmail-era headers |
| `es-draft-layout.eml` | the layout of spec chapter 4.1 | `multipart/alternative` with text/plain, text/html and `application/vnd.es.social+json; version=2.0` holding the draft record envelope (`uri`, `cid`, `signature` ignored); a Date, a matching Message-ID and `MIME-Version: 1.0` were added | Taken from `spec/es-protocol-v2-excerpt.md` 4.1 with the recipient domain changed to `example.org` |
| `gmail-forward-carrying-es-part.eml` | Gmail web forward of an Email Social message | the original's `application/vnd.email-social.message+json` part re-attached by the forward; its `via` (alice@example.com) and `email.messageId` do not belong to this message, so it is not taken as the message's ES part and is listed as an attachment; "---------- Forwarded message ---------" block | Gmail forwards keep In-Reply-To and References of the forwarded message |
| `undisclosed-recipients.eml` | announcement sent with Bcc only | `To: undisclosed-recipients:;` (empty group, RFC 5322 §3.4); `Reply-To` with two mailboxes; subject in two B encoded-words split inside the UTF-8 bytes of "ř" | Older Postfix versions add this `To:` when a message has no recipient headers; decoders such as mailparser join adjacent encoded-words before decoding because such splits occur |

## Reply formats (`replies/`)

How ordinary clients quote the message they answer, one reply per format, for
`splitQuoted` (expected `fresh` text in `test/split-quoted.test.ts`). The
quoted original is always a message from Alice; the replies come from
invented people. The same rules as above apply (reconstructed, example
domains only, CRLF, byte-exact). The replies in the corpus above
(`gmail-web-reply`, `ios-mail-reply`, `outlook-*`, `apple-mail-fr-forward`,
`seznam-webmail`, `mutt-iso-8859-2`, `mailing-list-footer`,
`gmail-forward-carrying-es-part`) are tested the same way.

"HTML only" files carry the client's HTML part without a text/plain
alternative, as Thunderbird sends with *Send Format: Only HTML* and Exchange
with a remote domain set to HTML-only MIME; they test the HTML path
(`<blockquote>` lines become `> ` lines).

| File | Client / format reconstructed | What it exercises | Provenance note |
| --- | --- | --- | --- |
| `replies/gmail-web-en.eml` | Gmail web, English UI | answer above the quote; `On … AM Name <address>` / `wrote:` attribution wrapped onto two lines; `> ` quote | Gmail wraps long attribution lines in its text/plain part |
| `replies/gmail-web-cs.eml` | Gmail web, Czech UI | Czech attribution `út 3. 3. 2026 v 10:15 odesílatel … napsal:`, wrapped | Czech Gmail's attribution starts with the weekday |
| `replies/gmail-web-de.eml` | Gmail web, German UI | `Am Di., 3. März 2026 um 10:15 Uhr schrieb Name <` / `address>:` (name after the verb, wrapped inside the address) | German Gmail word order |
| `replies/gmail-web-fr.eml` | Gmail web, French UI | `Le mar. 3 mars 2026 à 10:15, Name <address> a` / `écrit :` with the French space before the colon | French Gmail attribution |
| `replies/gmail-app-en.eml` | Gmail app for Android | one-line answer; `On Tue, 3 Mar 2026, 10:15 Name, <address> wrote:` | the app's attribution has a comma after the name |
| `replies/gmail-web-signature.eml` | Gmail web with a signature | `-- ` signature above the quote (Gmail puts the signature before the quoted text) | text/plain as Gmail generates it |
| `replies/gmail-quote-html-only.eml` | Gmail web, HTML part only | `gmail_signature_prefix`/`gmail_signature`, the `gmail_quote` container with `gmail_attr` and `<blockquote class="gmail_quote">` | Gmail's current class names |
| `replies/outlook-desktop-en.eml` | Outlook (Microsoft 365), English | header block `From:`/`Sent:`/`To:`/`Subject:` without prefix, original not quoted; trailing space after the From address | text/plain alternative Outlook writes for an HTML reply |
| `replies/outlook-desktop-en-plain.eml` | Outlook, plain-text message format | `-----Original Message-----` above the header block | Outlook's plain-text reply layout |
| `replies/outlook-desktop-cs.eml` | Outlook (Microsoft 365), Czech | `Od:`/`Odesláno:`/`Komu:`/`Předmět:`; `Odp:` subject | Czech Outlook labels |
| `replies/outlook-desktop-de.eml` | Outlook (Microsoft 365), German | `Von:`/`Gesendet:`/`An:`/`Cc:`/`Betreff:`; `AW:` subject | German Outlook labels |
| `replies/outlook-desktop-fr.eml` | Outlook (Microsoft 365), French | `De :`/`Envoyé :`/`À :`/`Objet :` with spaces before the colons; `RE :` subject | French Outlook labels |
| `replies/outlook-desktop-html-only.eml` | Outlook (Microsoft 365), HTML part only | Word HTML: the `border-top` divider `<div>` and `<b>From:</b>` labels, `<o:p>&nbsp;</o:p>` paragraphs | Word's filtered HTML without the Microsoft namespace URLs |
| `replies/outlook-web.eml` | Outlook on the web / new Outlook | a line of 32 underscores directly above the header block | text/plain alternative of Outlook on the web |
| `replies/outlook-web-html-only.eml` | Outlook on the web, HTML part only | `elementToProof` divs, `<div id="appendonsend">`, `<hr>`, `<div id="divRplyFwdMsg">` with bold labels | Outlook on the web's element ids |
| `replies/outlook-ios.eml` | Outlook for iOS | one-word answer, `Get Outlook for iOS` mobile signature, underscore divider | the app appends its signature line above the divider |
| `replies/apple-mail-en.eml` | Apple Mail on macOS, English | the attribution is inside the quote (`> On 3 Mar 2026, at 10:15, … wrote:`); empty quote lines are `> ` | Apple Mail's plain-text alternative |
| `replies/apple-mail-cs.eml` | Apple Mail on macOS, Czech | `> Dne 3. 3. 2026 v 10:15, … napsal(a):`; „“ quotes in the answer | Czech Apple Mail attribution |
| `replies/ios-mail-en.eml` | iOS Mail, English | text/plain only; `Sent from my iPhone`; U+FEFF before the quoted text | as `ios-mail-reply.eml` in English |
| `replies/ios-mail-de.eml` | iOS Mail, German | `Von meinem iPhone gesendet`; `> Am 03.03.2026 um 10:15 schrieb … :` | German iOS strings |
| `replies/thunderbird-en.eml` | Thunderbird, English | answer below the quote (Thunderbird's default); `On 3/3/26 10:15, Name wrote:`; format=flowed; `-- ` signature | Thunderbird's default attribution |
| `replies/thunderbird-cs.eml` | Thunderbird, Czech | `Dne 03. 03. 26 v 10:15 Name napsal(a):`, answer below | Czech Thunderbird attribution |
| `replies/thunderbird-fr.eml` | Thunderbird, French | `Le 03/03/2026 à 10:15, Name a écrit :`, answer below | French Thunderbird attribution |
| `replies/thunderbird-html-only-de.eml` | Thunderbird, German, HTML only | `moz-cite-prefix` (wrapped), `<blockquote type="cite" cite="mid:…">`, answer below, `<pre class="moz-signature">` | Thunderbird's HTML reply markup |
| `replies/mutt-interleaved.eml` | mutt 2.2 | answers interleaved with the quoted questions; `-- ` signature | mutt's default attribution `On %d, %n wrote:` |
| `replies/plain-no-quote.eml` | Thunderbird, new message | lines that only look like markers: `… wrote about the release:` (no date or address), a `From:` line with only one more label | nothing to recognise: everything is fresh |

## Conversations in the corpus

- `thunderbird-flowed` → `gmail-web-reply` → `ios-mail-reply`: one conversation through References.
- `outlook-de-original` → `outlook-de-reply-in-reply-to-only`: one conversation through In-Reply-To alone.
- `apple-mail-fr-original` + `outlook-fr-reply-no-thread-headers`: one conversation through the subject fallback.
- `apple-mail-fr-forward` and `outlook-fr-forward`: same base subject, different people, separate conversations.
- `outlook-cs-1250`, `mutt-iso-8859-2`, `seznam-webmail`, `mailing-list-footer`, `gmail-forward-carrying-es-part`: replies whose root is not in the corpus; the root id comes from References.
- Every other fixture is a conversation of its own.

## Checked against mailparser

The expectations were compared with the output of `mailparser` (the
independent parser used elsewhere in the tests). Subject, addresses, dates,
references, attachments and text agree, except where es-core deliberately
differs:

- A text part is never trimmed: mailparser drops the final line break of
  `format=flowed` text (`thunderbird-flowed`, `thunderbird-attachment-rfc2231`).
- Text parts of `multipart/mixed` are joined with a line break only when the
  text so far does not end with one; mailparser always inserts one
  (`mailing-list-footer`).
- HTML is reduced to text by es-core's own rules (headings as plain lines,
  list items as `- `); mailparser's converter upper-cases headings and uses
  ` * ` bullets (`html-only-newsletter`).
- An accepted ES part is not an attachment; mailparser lists it
  (`es-draft-layout`).
- es-core lowercases the domain of addresses, keeps Content-IDs in angle
  brackets and drops the empty group `undisclosed-recipients:;`; mailparser
  keeps the domain as written, strips the brackets and returns the group name.

## Sources

The formats were reconstructed from general knowledge of these clients'
output. Web search was used to confirm a few details (the
`iPhone Mail (<build>)` X-Mailer form, German Outlook's `AW:`/`WG:`, Czech
`Odp:`); fetching reference pages was not possible from the environment the
corpus was written in, so the other details were not checked against a
primary source.
