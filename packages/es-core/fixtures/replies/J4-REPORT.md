# J4: more reply formats for `splitQuoted`

55 new fixtures in `fixtures/replies/` (29 before, 84 now). Every one has an
entry in `CASES` in `test/split-quoted.test.ts`, below the comment
`J4: more clients, languages and shapes`. The expectations say what a reader
wants: the fresh text, the signature, and the first line of the quote. They
are not what the code happens to return. `src/` is unchanged. The original 29
fixtures and their cases are unchanged.

All addresses are at `example.com`, `example.org` or `example.net`, Message-IDs
and links included (the Proton footer link points to `proton.example.net`).

## Result

`npx vitest run --root packages/es-core test/split-quoted.test.ts`:

```
Tests  24 failed | 80 passed (104)
```

- all 49 tests that existed before J4 pass (original cases, rules, property tests);
- 31 of the 55 new fixtures pass;
- 24 new fixtures fail. Each failure is a pattern `splitQuoted` does not know, listed below.

## Fixtures

Confidence is how sure I am that the client really writes this format. All 55
are high or medium, so none were left out ("not confident" is empty, see below).

| file | client | lang | shape | confidence | kept | result |
|---|---|---|---|---|---|---|
| `outlook-new-web-cs.eml` | Outlook on the web / new Outlook | cs | underscore divider + Od:/Odesláno:/Komu:/Předmět: header block, original not prefixed | high | kept | pass |
| `outlook-new-web-de.eml` | Outlook on the web / new Outlook | de | underscore divider + Von:/Gesendet:/An:/Betreff: header block, original not prefixed | high | kept | pass |
| `outlook-new-web-fr.eml` | Outlook on the web / new Outlook | fr | underscore divider + De :/Envoyé :/À :/Objet : header block, original not prefixed | high | kept | pass |
| `outlook-new-web-sk.eml` | Outlook on the web / new Outlook | sk | underscore divider + Od:/Odoslané:/Komu:/Predmet: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-web-pl.eml` | Outlook on the web / new Outlook | pl | underscore divider + Od:/Wysłane:/Do:/Temat: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-web-es.eml` | Outlook on the web / new Outlook | es | underscore divider + De:/Enviado:/Para:/Asunto: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-web-it.eml` | Outlook on the web / new Outlook | it | underscore divider + Da:/Inviato:/A:/Oggetto: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-web-nl.eml` | Outlook on the web / new Outlook | nl | underscore divider + Van:/Verzonden:/Aan:/Onderwerp: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-web-pt.eml` | Outlook on the web / new Outlook | pt | underscore divider + De:/Enviado:/Para:/Assunto: header block, original not prefixed | high | kept | **fail** (signature, quotedFrom) |
| `outlook-new-windows-cs-cc.eml` | new Outlook for Windows | cs | divider + Od:/Odesláno:/Komu:/Kopie:/Předmět: (Cc line in the block) | high | kept | pass |
| `outlook-new-web-cs-html-only.eml` | Outlook on the web, HTML part only | cs | HTML only: `<hr>` + divRplyFwdMsg with bold Czech labels | high | kept | pass |
| `outlook-android-cs.eml` | Outlook for Android | cs | mobile signature "Získejte Outlook pro Android" above the divider and header block | medium | kept | **fail** (fresh, signature) |
| `outlook-android-de.eml` | Outlook for Android | de | mobile signature "Outlook für Android herunterladen" above the divider and header block | medium | kept | **fail** (fresh, signature) |
| `outlook-android-fr.eml` | Outlook for Android | fr | mobile signature "Obtenir Outlook pour Android" above the divider and header block | medium | kept | **fail** (fresh, signature) |
| `gmail-web-sk.eml` | Gmail web | sk | attribution "ut 3. 3. 2026 o 10:15 Alice Dvořáková <alice@example.com> napísal(a):" | medium | kept | **fail** (fresh, quotedFrom) |
| `gmail-web-pl.eml` | Gmail web | pl | attribution "wt., 3 mar 2026 o 10:15 Alice Dvořáková <alice@example.com> napisał(a):" | high | kept | pass |
| `gmail-web-es.eml` | Gmail web | es | attribution "El mar, 3 mar 2026 a las 10:15, Alice Dvořáková (<alice@example.com>) escribió:", wrapped onto 2 lines | high | kept | pass |
| `gmail-web-it.eml` | Gmail web | it | attribution "Il giorno mar 3 mar 2026 alle ore 10:15 Alice Dvořáková <alice@example.com> ha scritto:", wrapped onto 2 lines | high | kept | pass |
| `gmail-web-nl.eml` | Gmail web | nl | attribution "Op di 3 mrt 2026 om 10:15 schreef Alice Dvořáková <alice@example.com>:" | high | kept | **fail** (fresh, quotedFrom) |
| `gmail-web-pt.eml` | Gmail web | pt | attribution "Em ter., 3 de mar. de 2026 às 10:15, Alice Dvořáková <alice@example.com> escreveu:", wrapped onto 2 lines | high | kept | pass |
| `gmail-android-de.eml` | Gmail app for Android | de | one-line answer; unwrapped attribution "Alice Dvořáková <alice@example.com> schrieb am Di., 3. März 2026, 10:15:" | medium | kept | **fail** (fresh, quotedFrom) |
| `gmail-android-fr.eml` | Gmail app for Android | fr | one-line answer; unwrapped attribution "Le mar. 3 mars 2026, 10:15, Alice Dvořáková <alice@example.com> a écrit :" | medium | kept | pass |
| `gmail-ios-en.eml` | Gmail app for iOS | en | one-line answer; unwrapped attribution "On Tue, Mar 3, 2026 at 10:15 AM Alice Dvořáková <alice@example.com> wrote:" (U+202F before AM) | medium | kept | pass |
| `gmail-nested-reply-en.eml` | Gmail web | en | reply to a reply: two attribution blocks, the inner one at depth 2 (`> >`) | high | kept | pass |
| `gmail-interleaved-en.eml` | Gmail web | en | interleaved answers between quoted questions under a Gmail attribution; quoted sign-off left at the end | high | kept | pass |
| `gmail-forward-in-reply-en.eml` | Gmail web | en | a reply quoting a Gmail forward: `> ---------- Forwarded message ---------` inside the quote | high | kept | pass |
| `apple-mail-de.eml` | Apple Mail (macOS) | de | attribution inside the quote, split by a QP soft line break: "> Am 03.03.2026 um 10:15 schrieb Alice Dvořáková <alice@example.com>:" | high | kept | pass |
| `apple-mail-fr.eml` | Apple Mail (macOS) | fr | attribution inside the quote, split by a QP soft line break: "> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :" | high | kept | pass |
| `ios-mail-cs-ipad.eml` | iOS Mail (iPad) | cs | mobile signature "Odesláno z iPadu"; attribution "> Dne 3. 3. 2026 v 10:15, Alice Dvořáková <alice@example.com> napsal(a):" | high | kept | pass |
| `ios-mail-fr.eml` | iOS Mail (iPhone) | fr | mobile signature "Envoyé de mon iPhone"; attribution "> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :" | high | kept | pass |
| `ios-mail-sk.eml` | iOS Mail (iPhone) | sk | mobile signature "Odoslané z iPhonu"; attribution "> Dňa 3. 3. 2026 o 10:15 používateľ Alice Dvořáková <alice@example.com> napísal:" | medium | kept | **fail** (fresh, signature) |
| `ios-mail-pl.eml` | iOS Mail (iPhone) | pl | mobile signature "Wysłane z iPhone'a"; attribution "> Wiadomość napisana przez Alice Dvořáková <alice@example.com> w dniu 3 mar 2026, o godz. 10:15:" | medium | kept | **fail** (fresh, signature) |
| `ios-mail-es.eml` | iOS Mail (iPhone) | es | mobile signature "Enviado desde mi iPhone"; attribution "> El 3 mar 2026, a las 10:15, Alice Dvořáková <alice@example.com> escribió:" | high | kept | **fail** (fresh, signature) |
| `ios-mail-it.eml` | iOS Mail (iPhone) | it | mobile signature "Inviato da iPhone"; attribution "> Il giorno 3 mar 2026, alle ore 10:15, Alice Dvořáková <alice@example.com> ha scritto:" | high | kept | **fail** (fresh, signature) |
| `ios-mail-nl.eml` | iOS Mail (iPhone) | nl | mobile signature "Verstuurd vanaf mijn iPhone"; attribution "> Op 3 mrt 2026 om 10:15 heeft Alice Dvořáková <alice@example.com> het volgende geschreven:" | high | kept | **fail** (fresh, signature) |
| `ios-mail-pt.eml` | iOS Mail (iPhone) | pt | mobile signature "Enviado do meu iPhone"; attribution "> Em 3 de mar. de 2026, à(s) 10:15, Alice Dvořáková <alice@example.com> escreveu:" | medium | kept | **fail** (fresh, signature) |
| `thunderbird-sk.eml` | Thunderbird | sk | answer below the quote; attribution "Dňa 3. 3. 2026 o 10:15 Alice Dvořáková napísal(a):" | medium | kept | **fail** (fresh, quotedFrom) |
| `thunderbird-pl.eml` | Thunderbird | pl | answer below the quote; attribution "W dniu 3.03.2026 o 10:15, Alice Dvořáková pisze:"; the answer is a long format=flowed paragraph | medium | kept | **fail** (fresh, quotedFrom) |
| `thunderbird-es.eml` | Thunderbird | es | answer below the quote; attribution "El 3/3/26 a las 10:15, Alice Dvořáková escribió:" | high | kept | pass |
| `thunderbird-it.eml` | Thunderbird | it | answer below the quote; attribution "Il 03/03/26 10:15, Alice Dvořáková ha scritto:" | high | kept | pass |
| `thunderbird-nl.eml` | Thunderbird | nl | answer below the quote; attribution "Op 03-03-2026 om 10:15 schreef Alice Dvořáková:" | medium | kept | **fail** (fresh, quotedFrom) |
| `thunderbird-pt.eml` | Thunderbird | pt | answer below the quote; attribution "Em 03/03/2026 10:15, Alice Dvořáková escreveu:" | medium | kept | pass |
| `thunderbird-flowed-attribution.eml` | Thunderbird | en | format=flowed: the 79-character attribution and the long lines are soft-wrapped at 72 (trailing space) | high | kept | pass |
| `thunderbird-en-signature-above-quote.eml` | Thunderbird (reply and signature above the quote) | en | `-- ` signature between the answer and the attribution | high | kept | pass |
| `thunderbird-cs-signature-above-quote.eml` | Thunderbird (reply and signature above the quote) | cs | `-- ` signature between the answer and the attribution | high | kept | pass |
| `thunderbird-de-forward.eml` | Thunderbird, inline forward | de | forward: `-------- Weitergeleitete Nachricht --------` and the tab-separated header table | high | kept | pass |
| `samsung-mail-en.eml` | Samsung Email | en | signature "Sent from my Galaxy" above "-------- Original message --------" and a header block with trailing spaces; base64 | high | kept | pass |
| `samsung-mail-de.eml` | Samsung Email | de | signature "Von meinem Samsung Galaxy Smartphone gesendet." above "-------- Ursprüngliche Nachricht --------" and a header block with trailing spaces; base64 | high | kept | **fail** (fresh, signature) |
| `samsung-mail-fr.eml` | Samsung Email | fr | signature "Envoyé depuis mon appareil Galaxy" above "-------- Message d'origine --------" and a header block with trailing spaces; base64 | medium | kept | pass |
| `proton-mail-en.eml` | Proton Mail (web) | en | "Sent with Proton Mail secure email." footer above the attribution; base64 | high | kept | **fail** (fresh, signature) |
| `proton-mail-html-only.eml` | Proton Mail (web), HTML part only | en | HTML only: protonmail_signature_block, attribution in div.protonmail_quote, `<blockquote class="protonmail_quote">` | medium | kept | **fail** (fresh, signature) |
| `fastmail-en.eml` | Fastmail (web) | en | attribution "On Tue, 3 Mar 2026, at 10:15, Alice Dvořáková wrote:" (no address) directly above the "> " lines | medium | kept | pass |
| `yahoo-mail-web-en.eml` | Yahoo Mail (web) | en | indented attribution with trailing spaces, original not prefixed with `>` but indented by one space | medium | kept | pass |
| `yahoo-mail-android-en.eml` | Yahoo Mail for Android | en | "Sent from Yahoo Mail on Android"; attribution with no space before `<`, original indented, not prefixed | medium | kept | pass |
| `roundcube-en.eml` | Roundcube 1.6 (default: answer below the quote) | en | attribution "On 2026-03-03 10:15, Alice Dvořáková wrote:" (ISO date, no address), answer below | high | kept | pass |

### Not confident (left out)

None of the 55 written fixtures. These parts of the brief have **no new fixture**
because I am not sure enough of the exact format:

- **Seznam.cz mobile app (Czech).** Seznam webmail is already covered by the
  corpus fixture `fixtures/seznam-webmail.eml` (`---------- Původní e-mail ----------`
  + `Od:/Komu:/Datum:/Předmět:`), which has a case in `CASES` and passes. I don't
  know whether the app writes the same block.
- **Gmail for iOS in cs, de, fr; Gmail for Android in cs.** I'm not sure which
  attribution the apps write in these languages: the web form (`út 3. 3. 2026
  v 10:15 odesílatel … napsal:`, `Am … schrieb …:`) or the Android "name first"
  form (`… schrieb am …:`, which `gmail-android-de.eml` shows for German), or
  how they wrap it. The covered app cases are Gmail Android de and fr and
  Gmail iOS en.

### Notes on the expectations

- `gmail-interleaved-en.eml`: the expected `fresh` contains the attribution and
  the quoted questions, and `quoted` starts at the trailing `> Thanks,`. This
  follows the documented rule in `src/quotes.ts` ("a quote between two things
  the sender wrote stays in `fresh`"). Answers without their questions don't
  make sense, so this is what a reader wants.
- Mobile and webmail footers ("Sent with Proton Mail secure email.", "Get
  Outlook for Android" in each language, "Sent from my Galaxy") are expected
  as `signature`, like the existing "Sent from my iPhone" cases.

## Failures: the patterns `splitQuoted` misses

Fixtures that fail for the same reason are grouped, but each fixture's exact
line is given.

### Outlook header block in sk, pl, es, it, nl, pt (6 fixtures)

`headerBlockAt` needs a From label (`FROM_LABELS`) followed by at least two
labels from `OTHER_LABELS`. `OTHER_LABELS` only has the en, cs, de and fr
labels, so none of these blocks is recognised. The divider of 32 underscores
then matches `FOOTER_DIVIDER` (a list footer), so the divider and **the whole
original message end up in `signature`**, and `quoted` is empty. Expected:
`signature` "", `quoted` starting at `________________________________`.

- `outlook-new-web-sk.eml`: `Od: Alice Dvořáková <alice@example.com>` /
  `Odoslané: utorok 3. marca 2026 10:15` / `Komu: …` / `Predmet: Fotky z výletu`.
  `od` and `komu` are known, but `odoslané` and `predmet` are not, so only one
  other label counts.
- `outlook-new-web-pl.eml`: `Od: …` / `Wysłane: wtorek, 3 marca 2026 10:15` /
  `Do: …` / `Temat: Zdjęcia z wycieczki`. `wysłane`, `do` and `temat` are unknown.
- `outlook-new-web-es.eml`: `De: …` / `Enviado: martes, 3 de marzo de 2026 10:15` /
  `Para: …` / `Asunto: Borrador del contrato`. `enviado`, `para` and `asunto` are unknown.
- `outlook-new-web-it.eml`: `Da: …` / `Inviato: martedì 3 marzo 2026 10:15` /
  `A: …` / `Oggetto: Bozza del contratto`. `inviato`, `a` and `oggetto` are unknown.
- `outlook-new-web-nl.eml`: `Van: …` / `Verzonden: dinsdag 3 maart 2026 10:15` /
  `Aan: …` / `Onderwerp: Conceptcontract`. `verzonden`, `aan` and `onderwerp` are unknown.
- `outlook-new-web-pt.eml`: `De: …` / `Enviado: terça-feira, 3 de março de 2026 10:15` /
  `Para: …` / `Assunto: Rascunho do contrato`. `enviado`, `para` and `assunto` are unknown.

### Outlook for Android footer, localised (3 fixtures)

`MOBILE_SIGNATURE` knows only the English `get outlook for (ios|android)`. The
header block below is recognised (cs/de/fr labels), so `quoted` is right. But
the footer line above the divider stays in `fresh`: actual `fresh` = answer +
blank line + footer, `signature` "".

- `outlook-android-cs.eml`: `Získejte Outlook pro Android`
- `outlook-android-de.eml`: `Outlook für Android herunterladen`
- `outlook-android-fr.eml`: `Obtenir Outlook pour Android`

### Slovak verb "napísal" (gmail-web-sk, thunderbird-sk)

`ATTRIBUTION_END` has the Czech `napsal(a)` and the Polish `napisał(a)`, but not
the Slovak `napísal(a)` / `napísal`.

- `gmail-web-sk.eml`: `ut 3. 3. 2026 o 10:15 Alice Dvořáková <alice@example.com> napísal(a):`.
  The line is not an attribution, so it stays as the last paragraph of `fresh`.
  The `>` lines below it are still quoted, so `quoted` starts at `> Ahoj Martina,`
  and not at the attribution.
- `thunderbird-sk.eml`: `Dňa 3. 3. 2026 o 10:15 Alice Dvořáková napísal(a):` sits
  above the quote, and the answer is below. The unrecognised attribution counts
  as something the sender wrote above the quote, with the answer below it, so
  the reply is taken as **interleaved** and the whole message (quote included)
  is `fresh`; `quoted` is empty. (`ATTRIBUTION_START` doesn't list `Dňa` either.
  That matters only for the strict check of an attribution not followed by `>`
  lines.)

### Polish Thunderbird verb "pisze" (thunderbird-pl)

`W dniu 3.03.2026 o 10:15, Alice Dvořáková pisze:`. `ATTRIBUTION_END` has
`napisał(a)` (Gmail) but not Thunderbird's present tense `pisze`, and
`ATTRIBUTION_START` has `Dnia` but not `W dniu`. The result is the same as for
`thunderbird-sk`: the reply is taken as interleaved, everything is `fresh` and
`quoted` is empty.

### Dutch "Op … schreef <name>:" with the name after the verb (gmail-web-nl, thunderbird-nl)

`ATTRIBUTION_END` wants `schreef` right before the colon. Dutch Gmail and
Thunderbird put the name after the verb, as German Gmail does with `schrieb`.
There is a `GERMAN_ATTRIBUTION` (`^Am\s.*\bschrieb\b.*:$`) but no Dutch
counterpart (`^Op\s.*\bschreef\b.*:$`).

- `gmail-web-nl.eml`: `Op di 3 mrt 2026 om 10:15 schreef Alice Dvořáková <alice@example.com>:`.
  The attribution stays in `fresh`, and `quoted` starts at `> Hoi Daan,`.
- `thunderbird-nl.eml`: `Op 03-03-2026 om 10:15 schreef Alice Dvořáková:`. This
  is above the quote with the answer below, so the reply is taken as
  interleaved: everything is `fresh`, `quoted` empty.

### German Gmail for Android, name first (gmail-android-de)

`Alice Dvořáková <alice@example.com> schrieb am Di., 3. März 2026, 10:15:`. The
line starts with the name, so `GERMAN_ATTRIBUTION`, which is anchored at `^Am`,
doesn't match. `ATTRIBUTION_END` doesn't match either, because the date comes
after `schrieb`. The attribution stays in `fresh`, and `quoted` starts at
`> Hallo Anna,`.

### iOS Mail "Sent from my iPhone" in sk, pl, es, it, nl, pt (6 fixtures)

The quote and its `> `-prefixed attribution are recognised in all six, and
`quotedFrom` passes. But `MOBILE_SIGNATURE` has the iPhone line only in en, cs,
de and fr, so the line stays in `fresh` (answer + blank line + footer) and
`signature` is "".

- `ios-mail-sk.eml`: `Odoslané z iPhonu`
- `ios-mail-pl.eml`: `Wysłane z iPhone'a`
- `ios-mail-es.eml`: `Enviado desde mi iPhone`
- `ios-mail-it.eml`: `Inviato da iPhone`
- `ios-mail-nl.eml`: `Verstuurd vanaf mijn iPhone`
- `ios-mail-pt.eml`: `Enviado do meu iPhone`

### Samsung Email in German, multi-word device name (samsung-mail-de)

`Von meinem Samsung Galaxy Smartphone gesendet.`. `MOBILE_SIGNATURE` has
`von meinem \S+ gesendet.*`, which allows only one word between "meinem" and
"gesendet", so "Samsung Galaxy Smartphone" doesn't match. The separator
`-------- Ursprüngliche Nachricht --------` is recognised and `quoted` is right.
The footer stays in `fresh`, after the three blank lines Samsung leaves:
actual `fresh` = `"Mache ich, bis Freitag.\n\n\n\nVon meinem Samsung Galaxy Smartphone gesendet."`.

### Proton Mail footer "Sent with …" (proton-mail-en, proton-mail-html-only)

`MOBILE_SIGNATURE` matches `sent from …` but not Proton's `sent with …`. The
attribution `On Tuesday, March 3rd, 2026 at 10:15 AM, Alice Dvořáková <alice@example.com> wrote:`
is recognised in both, and `quotedFrom` passes. The footer stays in `fresh`.

- `proton-mail-en.eml` (text/plain, Proton writes the link as Markdown):
  `Sent with [Proton Mail](https://proton.example.net/) secure email.`
- `proton-mail-html-only.eml` (HTML reduced by `parseMessage`):
  `Sent with Proton Mail secure email.`

## Side effect on other test files (not fixed, out of scope)

The new fixtures also make 4 tests fail outside `split-quoted.test.ts`
(`npx vitest run --root packages/es-core`: 28 failed, 1645 passed. That is the
24 above plus these 4). They are bookkeeping tests that require every fixture
to be registered elsewhere:

- `test/unquote.test.ts` › "covers every reply fixture that quotes Alice's
  original": the 55 new files are not in its list.
- `test/unquote.test.ts` › `isInterleaved` "false for every other reply
  format": `gmail-interleaved-en.eml` is (correctly) interleaved, so it would
  have to join `mutt-interleaved.eml` in that test's allow-list.
- `test/vectors.test.ts` › "one vector per fixture" and "stores each fixture
  byte for byte": `vectors/replies-*.json` doesn't exist yet for the new
  fixtures.

The brief limited changes to `CASES` and this report, so these were left as
they are.

## Housekeeping

- Nothing is committed.
- `test/j4-dump.test.ts`, a temporary helper from the previous session that
  wrote actual outputs to `.j4-gen/`, has been deleted.
- `.j4-gen/` at the repository root (untracked) still holds the generator
  (`fixtures.mjs`, `clients.mjs`, `lib.mjs`), the metadata (`meta.json`) and
  the comparison scripts. It isn't needed by any test and can be deleted.
