/**
 * splitQuoted on real reply formats (fixtures/replies/*.eml and the replies
 * in the corpus) and a seeded property test that no line is ever lost.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { splitQuoted } from "../src/quotes.js";
import { serializeMessage } from "../src/serialize.js";
import type { QuotedSplit } from "../src/types.js";
import { listReplyFixtures, readFixture } from "./helpers/fixtures.js";
import { mulberry32, pick, randomInt } from "./helpers/prng.js";

const lines = (...parts: string[]): string => parts.join("\n");
const NNBSP = " ";
const GMAIL_EN = `On Tue, Mar 3, 2026 at 10:15${NNBSP}AM Alice Dvořáková <alice@example.com>`;

interface Case {
  /** Client and language, for the test name. */
  client: string;
  fresh: string;
  /** "" when the message has none. */
  signature?: string;
  /** The first line of `quoted` ("" when nothing is quoted). */
  quotedFrom: string;
}

const CASES: Record<string, Case> = {
  // ---------------------------------------------------------------- Gmail
  "replies/gmail-web-en.eml": {
    client: "Gmail web, English, attribution wrapped before 'wrote:'",
    fresh: lines("Thanks, the draft is ready. I'll send it on Thursday.", "", "Bob"),
    quotedFrom: GMAIL_EN,
  },
  "replies/gmail-web-cs.eml": {
    client: "Gmail web, Czech ('… odesílatel … napsal:'), wrapped",
    fresh: lines("Ahoj Alice,", "", "fotky jsem nahrál do sdíleného alba, odkaz pošlu večer.", "", "Karel"),
    quotedFrom: "út 3. 3. 2026 v 10:15 odesílatel Alice Dvořáková <alice@example.com>",
  },
  "replies/gmail-web-de.eml": {
    client: "Gmail web, German ('Am … schrieb …:'), wrapped inside the address",
    fresh: lines("Hallo Alice,", "", "die Übersicht kommt am Donnerstag, ich muss noch zwei Zahlen prüfen.", "", "Viele Grüße", "Anna"),
    quotedFrom: "Am Di., 3. März 2026 um 10:15 Uhr schrieb Alice Dvořáková <",
  },
  "replies/gmail-web-fr.eml": {
    client: "Gmail web, French ('Le … a écrit :'), wrapped",
    fresh: lines("Bonjour Alice,", "", "le compte rendu est presque prêt, je te l'envoie demain matin.", "", "Camille"),
    quotedFrom: "Le mar. 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a",
  },
  "replies/gmail-app-en.eml": {
    client: "Gmail app (Android), English",
    fresh: "Sure, Thursday it is!",
    quotedFrom: "On Tue, 3 Mar 2026, 10:15 Alice Dvořáková, <alice@example.com> wrote:",
  },
  "replies/gmail-web-fragment.eml": {
    client: "Gmail web, the quote cut down to one sentence of the original",
    fresh: lines("Super, ať jde taky. Stůl zarezervuju pro tři.", "", "Bob"),
    quotedFrom: `On Mon, Mar 2, 2026 at 10:15${NNBSP}AM Alice Dvořáková <alice@example.com>`,
  },
  "replies/gmail-long-quote.eml": {
    client: "Gmail web, a two-line answer above 40 quoted lines",
    fresh: lines("Looks good, I'll bring the tent.", "", "Bob"),
    quotedFrom: `${GMAIL_EN} wrote:`,
  },
  "replies/gmail-web-signature.eml": {
    client: "Gmail web with a signature above the quote",
    fresh: lines("Hi Alice,", "", "the invoice for February is attached.", "", "Best,", "Bob"),
    signature: lines("-- ", "Bob Svoboda", "Example s.r.o. | Sales"),
    quotedFrom: `${GMAIL_EN} wrote:`,
  },
  "replies/gmail-quote-html-only.eml": {
    client: "Gmail HTML only: gmail_signature and the gmail_quote container",
    fresh: lines("Thanks, the draft is ready.", "", "Bob"),
    signature: lines("--", "Bob Svoboda", "Example s.r.o."),
    quotedFrom: `${GMAIL_EN} wrote:`,
  },
  "gmail-web-reply.eml": {
    client: "Gmail web, Czech text, English UI (corpus)",
    fresh: lines("Ahoj Alice,", "", "v pátek můžu, 12:30 je super. Zarezervuju stůl pro tři.", "", "Bob"),
    quotedFrom: `On Mon, Mar 2, 2026 at 10:15${NNBSP}AM Alice Dvořáková <alice@example.com> wrote:`,
  },
  "gmail-forward-carrying-es-part.eml": {
    client: "Gmail web forward (corpus)",
    fresh: "Evo, tohle mi poslala Alice, ať víš, kdy vyrážíme.",
    quotedFrom: "---------- Forwarded message ---------",
  },

  // ---------------------------------------------------------------- Outlook
  "replies/outlook-desktop-en.eml": {
    client: "Outlook desktop, English header block",
    fresh: lines("Hi Alice,", "", "the draft is attached, article 4 is new.", "", "Bob"),
    quotedFrom: "From: Alice Dvořáková <alice@example.com> ",
  },
  "replies/outlook-desktop-en-plain.eml": {
    client: "Outlook desktop, plain-text format, -----Original Message-----",
    fresh: lines("Hi Alice,", "", "see the attached draft.", "", "Bob"),
    quotedFrom: "-----Original Message-----",
  },
  "replies/outlook-desktop-cs.eml": {
    client: "Outlook desktop, Czech header block (Od/Odesláno/Komu/Předmět)",
    fresh: lines("Dobrý den,", "", "posílám fotky z výletu v příloze, další budou zítra.", "", "S pozdravem", "Karel Holub"),
    quotedFrom: "Od: Alice Dvořáková <alice@example.com> ",
  },
  "replies/outlook-desktop-de.eml": {
    client: "Outlook desktop, German header block (Von/Gesendet/An/Cc/Betreff)",
    fresh: lines("Hallo Alice,", "", "anbei die Übersicht, Meilenstein 3 ist neu.", "", "Viele Grüße", "Anna"),
    quotedFrom: "Von: Alice Dvořáková <alice@example.com> ",
  },
  "replies/outlook-desktop-fr.eml": {
    client: "Outlook desktop, French header block (De :/Envoyé :/À :/Objet :)",
    fresh: lines("Bonjour Alice,", "", "voici le compte rendu, les décisions sont en gras.", "", "Bonne journée,", "Camille"),
    quotedFrom: "De : Alice Dvořáková <alice@example.com> ",
  },
  "replies/outlook-desktop-html-only.eml": {
    client: "Outlook desktop HTML only: the border-top divider and bold labels",
    fresh: lines("Hi Alice,", "", "the signed contract is attached.", "", "Bob"),
    quotedFrom: "From: Alice Dvořáková <alice@example.com>",
  },
  "replies/outlook-desktop-fragment.eml": {
    client: "Outlook desktop, Czech, one sentence of the original kept under the header block",
    fresh: lines("Ahoj Bobe,", "", "článek 4 jsem prošla, termíny bych posunula o týden.", "", "Alice"),
    quotedFrom: "Od: Bob Svoboda <bob@example.org> ",
  },
  "replies/outlook-web.eml": {
    client: "Outlook on the web: underscore divider above the header block",
    fresh: lines("Hi Alice,", "", "sure, Thursday is fine.", "", "Julien"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-web-html-only.eml": {
    client: "Outlook on the web HTML only: divRplyFwdMsg after an <hr>",
    fresh: lines("Hi Alice,", "", "Thursday at 10 in room B?", "", "Julien"),
    quotedFrom: "From: Alice Dvořáková <alice@example.com>",
  },
  "replies/outlook-ios.eml": {
    client: "Outlook for iOS: 'Get Outlook for iOS' and the divider",
    fresh: "Sure!",
    signature: "Get Outlook for iOS",
    quotedFrom: "________________________________",
  },
  "outlook-cs-1250.eml": {
    client: "Outlook, Czech, -----Původní zpráva----- (corpus)",
    fresh: lines(
      "Dobrý den, pane Nováku,",
      "",
      "děkuji za opravenou fakturu. Předala jsem ji účtárně, platba odejde nejpozději v pátek 6. 3.",
      "",
      "S pozdravem",
      "Marie Svobodová",
      "Účtárna | Example s.r.o.",
    ),
    quotedFrom: "-----Původní zpráva-----",
  },
  "outlook-de-reply-in-reply-to-only.eml": {
    client: "Outlook 2016, German header block (corpus)",
    fresh: lines("Hallo Anna,", "", "danke, sieht gut aus. Zu Meilenstein 2 melde ich mich morgen noch mal.", "", "Gruß", "Lukas"),
    quotedFrom: "Von: Anna Becker <Anna.Becker@example.net> ",
  },
  "outlook-fr-reply-no-thread-headers.eml": {
    client: "Outlook 2007, French, -----Message d'origine----- (corpus)",
    fresh: lines("Bonjour Camille,", "", "14 h 30 me convient. J'apporterai les chiffres du trimestre.", "", "Bonne journée,", "Julien"),
    quotedFrom: "-----Message d'origine-----",
  },
  "outlook-fr-forward.eml": {
    client: "Outlook, French forward header block (corpus)",
    fresh: lines("Bonjour Hugo,", "", "Pour info, voir ci-dessous.", "", "Amélie"),
    quotedFrom: "De : Camille Lefèvre <camille@example.org> ",
  },

  // ---------------------------------------------------------------- Apple
  "replies/apple-mail-en.eml": {
    client: "Apple Mail (macOS), English, attribution inside the quote",
    fresh: lines("Hi Alice,", "", "yes, Friday works. The draft needs one more signature.", "", "Bob"),
    quotedFrom: "> On 3 Mar 2026, at 10:15, Alice Dvořáková <alice@example.com> wrote:",
  },
  "replies/apple-mail-cs.eml": {
    client: "Apple Mail (macOS), Czech ('napsal(a):')",
    fresh: lines("Ahoj Alice,", "", "fotky jsou v albu „Výlet 2026“.", "", "Karel"),
    quotedFrom: "> Dne 3. 3. 2026 v 10:15, Alice Dvořáková <alice@example.com> napsal(a):",
  },
  "apple-mail-fr-forward.eml": {
    client: "Apple Mail forward, French (corpus)",
    fresh: lines("Bonjour Sophie,", "", "Je te transfère l’invitation, au cas où tu voudrais te joindre à nous lundi.", "", "Camille"),
    quotedFrom: "Début du message réexpédié :",
  },
  "replies/ios-mail-en.eml": {
    client: "iOS Mail, English, 'Sent from my iPhone'",
    fresh: "Sounds great 👍",
    signature: "Sent from my iPhone",
    quotedFrom: "> On 3 Mar 2026, at 10:15, Alice Dvořáková <alice@example.com> wrote:",
  },
  "replies/ios-mail-de.eml": {
    client: "iOS Mail, German, 'Von meinem iPhone gesendet'",
    fresh: "Bis Donnerstag!",
    signature: "Von meinem iPhone gesendet",
    quotedFrom: "> Am 03.03.2026 um 10:15 schrieb Alice Dvořáková <alice@example.com>:",
  },
  "ios-mail-reply.eml": {
    client: "iOS Mail, Czech, 'Odesláno z iPhonu', nested quotes (corpus)",
    fresh: "Jasně, jdu taky! Stůl pro tři je super, přijdu 👍 Těším se.",
    signature: "Odesláno z iPhonu",
    quotedFrom: "> Dne 2. 3. 2026 v 11:02, Bob Svoboda <bob@example.org> napsal:",
  },

  // ---------------------------------------------------------------- Thunderbird, mutt, Seznam, lists
  "replies/thunderbird-en.eml": {
    client: "Thunderbird, English, answer below the quote, '-- ' signature",
    fresh: lines("Hi Alice,", "", "the draft is on its way, you should have it by tonight.", "", "Bob"),
    signature: lines("-- ", "Bob Svoboda", "Example s.r.o."),
    quotedFrom: "On 3/3/26 10:15, Alice Dvořáková wrote:",
  },
  "replies/thunderbird-cs.eml": {
    client: "Thunderbird, Czech ('Dne … napsal(a):'), answer below the quote",
    fresh: lines("Ahoj Alice,", "", "fotky nahraju dnes večer, je jich asi dvě stě.", "", "Karel"),
    quotedFrom: "Dne 03. 03. 26 v 10:15 Alice Dvořáková napsal(a):",
  },
  "replies/thunderbird-fr.eml": {
    client: "Thunderbird, French ('Le … a écrit :'), answer below the quote",
    fresh: lines("Bonjour Alice,", "", "je te l'envoie ce soir.", "", "Camille"),
    quotedFrom: "Le 03/03/2026 à 10:15, Alice Dvořáková a écrit :",
  },
  "replies/thunderbird-html-only-de.eml": {
    client: "Thunderbird HTML only, German: moz-cite-prefix, <blockquote type=cite>, moz-signature",
    fresh: lines("Hallo Alice,", "", "ja, die Übersicht kommt am Donnerstag.", "", "Viele Grüße", "Anna"),
    signature: lines("--", "Anna Becker", "Example GmbH"),
    quotedFrom: "Am 03.03.26 um 10:15 schrieb Alice Dvořáková:",
  },
  "mutt-iso-8859-2.eml": {
    client: "mutt, answer below the quote, '-- ' signature (corpus)",
    fresh: lines(
      "Ahoj Karle,",
      "",
      "podívám se na to dnes odpoledne. Nejspíš je špatně nastavená cesta",
      "v cronu, skript hledá snapshoty ve starém adresáři.",
      "",
      "Díky za upozornění,",
      "Ondřej",
    ),
    signature: lines("-- ", "Ondřej Beneš"),
    quotedFrom: "On Sun, Mar 01, 2026 at 06:45:12PM +0100, Karel Holub wrote:",
  },
  "replies/mutt-interleaved.eml": {
    client: "mutt, interleaved answers: the quotes between them stay",
    fresh: lines(
      "On Tue, Mar 03, 2026 at 10:15:00AM +0100, Alice Dvořáková wrote:",
      "> Hi Ondřej,",
      ">",
      "> two questions about the backup server:",
      "> 1. Does the rotation keep 14 snapshots now?",
      "",
      "Yes, since last night.",
      "",
      "> 2. Can we move the backups to the new disk this week?",
      "",
      "Thursday evening works for me.",
    ),
    signature: lines("-- ", "Ondřej Beneš"),
    quotedFrom: "> Thanks,",
  },
  "seznam-webmail.eml": {
    client: "Seznam.cz webmail, ---------- Původní e-mail ---------- (corpus)",
    fresh: lines("Dobrý den,", "", "posílám opravené vyúčtování za březen, chybějící položku jsem doplnil.", "", "S pozdravem", "Tomáš Král"),
    quotedFrom: "---------- Původní e-mail ----------",
  },
  "mailing-list-footer.eml": {
    client: "Apple Mail post through Mailman: quote, then the list footer (corpus)",
    fresh: lines(
      "Sounds good to me. One note: the Czech translation update needs about a week, so could we keep the string freeze on 18 March?",
      "",
      "Martin Horák",
    ),
    signature: lines(
      "_______________________________________________",
      "dev-list mailing list",
      "dev-list@lists.example.org",
      "https://lists.example.org/mailman/listinfo/dev-list",
    ),
    quotedFrom: "> On 12. 3. 2026, at 16:20, Karel Holub <karel@example.org> wrote:",
  },
  "replies/plain-no-quote.eml": {
    client: "Thunderbird, nothing quoted: lines that only look like markers",
    fresh: lines(
      "Hi team,",
      "",
      "Here is what Bob wrote about the release:",
      "the build is green and the notes are ready.",
      "",
      "From: the release checklist",
      "Date: to be decided",
      "",
      "Thanks,",
      "Eva",
    ),
    quotedFrom: "",
  },

  // ---------------------------------------------------------------- J4: more clients, languages and shapes
  // See fixtures/replies/J4-REPORT.md: the expectations are what a reader wants, failures are the gaps.
  "replies/outlook-new-web-cs.eml": {
    client: "Outlook on the web / new Outlook, Czech: underscore divider + Od:/Odesláno:/Komu:/Předmět: header block, original not prefixed",
    fresh: lines("Ahoj Alice,", "", "fotky jsou ve sdíleném albu, odkaz ti pošlu odpoledne.", "", "Karel"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-de.eml": {
    client: "Outlook on the web / new Outlook, German: underscore divider + Von:/Gesendet:/An:/Betreff: header block, original not prefixed",
    fresh: lines("Hallo Alice,", "", "die Übersicht schicke ich dir morgen früh.", "", "Viele Grüße", "Anna"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-fr.eml": {
    client: "Outlook on the web / new Outlook, French: underscore divider + De :/Envoyé :/À :/Objet : header block, original not prefixed",
    fresh: lines("Bonjour Alice,", "", "je t'envoie le compte rendu demain matin.", "", "Bonne journée,", "Camille"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-sk.eml": {
    client: "Outlook on the web / new Outlook, Slovak: underscore divider + Od:/Odoslané:/Komu:/Predmet: header block, original not prefixed",
    fresh: lines("Ahoj Alice,", "", "fotky sú v zdieľanom albume, odkaz ti pošlem poobede.", "", "Martina"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-pl.eml": {
    client: "Outlook on the web / new Outlook, Polish: underscore divider + Od:/Wysłane:/Do:/Temat: header block, original not prefixed",
    fresh: lines("Cześć Alice,", "", "zdjęcia są we wspólnym albumie, link wyślę po południu.", "", "Piotr"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-es.eml": {
    client: "Outlook on the web / new Outlook, Spanish: underscore divider + De:/Enviado:/Para:/Asunto: header block, original not prefixed",
    fresh: lines("Hola Alice,", "", "te envío el borrador mañana por la mañana.", "", "Un saludo,", "Lucía"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-it.eml": {
    client: "Outlook on the web / new Outlook, Italian: underscore divider + Da:/Inviato:/A:/Oggetto: header block, original not prefixed",
    fresh: lines("Ciao Alice,", "", "ti mando la bozza domani mattina.", "", "Giulia"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-nl.eml": {
    client: "Outlook on the web / new Outlook, Dutch: underscore divider + Van:/Verzonden:/Aan:/Onderwerp: header block, original not prefixed",
    fresh: lines("Hoi Alice,", "", "ik stuur je het concept morgenochtend.", "", "Groet,", "Daan"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-pt.eml": {
    client: "Outlook on the web / new Outlook, Portuguese (BR): underscore divider + De:/Enviado:/Para:/Assunto: header block, original not prefixed",
    fresh: lines("Oi Alice,", "", "mando o rascunho amanhã de manhã.", "", "Abraço,", "João"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-windows-cs-cc.eml": {
    client: "new Outlook for Windows, Czech: divider + Od:/Odesláno:/Komu:/Kopie:/Předmět: (Cc line in the block)",
    fresh: lines("Dobrý den,", "", "fotky z výletu jsou nahrané, zbytek dodá Eva.", "", "S pozdravem", "Karel Holub"),
    quotedFrom: "________________________________",
  },
  "replies/outlook-new-web-cs-html-only.eml": {
    client: "Outlook on the web, HTML part only, Czech: HTML only: <hr> + divRplyFwdMsg with bold Czech labels",
    fresh: lines("Ahoj Alice,", "", "album je hotové, mrkni na něj.", "", "Karel"),
    quotedFrom: "Od: Alice Dvořáková <alice@example.com>",
  },
  "replies/outlook-android-cs.eml": {
    client: "Outlook for Android, Czech: mobile signature \"Získejte Outlook pro Android\" above the divider and header block",
    fresh: "Jasně, pošlu je večer.",
    signature: "Získejte Outlook pro Android",
    quotedFrom: "________________________________",
  },
  "replies/outlook-android-de.eml": {
    client: "Outlook for Android, German: mobile signature \"Outlook für Android herunterladen\" above the divider and header block",
    fresh: "Klar, kommt morgen.",
    signature: "Outlook für Android herunterladen",
    quotedFrom: "________________________________",
  },
  "replies/outlook-android-fr.eml": {
    client: "Outlook for Android, French: mobile signature \"Obtenir Outlook pour Android\" above the divider and header block",
    fresh: "Oui, je te l'envoie demain.",
    signature: "Obtenir Outlook pour Android",
    quotedFrom: "________________________________",
  },
  "replies/gmail-web-sk.eml": {
    client: "Gmail web, Slovak: attribution \"ut 3. 3. 2026 o 10:15 Alice Dvořáková <alice@example.com> napísal(a):\"",
    fresh: lines("Ahoj Alice,", "", "fotky som nahrala do zdieľaného albumu, odkaz pošlem večer.", "", "Martina"),
    quotedFrom: "ut 3. 3. 2026 o 10:15 Alice Dvořáková <alice@example.com> napísal(a):",
  },
  "replies/gmail-web-pl.eml": {
    client: "Gmail web, Polish: attribution \"wt., 3 mar 2026 o 10:15 Alice Dvořáková <alice@example.com> napisał(a):\"",
    fresh: lines("Cześć Alice,", "", "zdjęcia wrzuciłem do wspólnego albumu, link wyślę wieczorem.", "", "Piotr"),
    quotedFrom: "wt., 3 mar 2026 o 10:15 Alice Dvořáková <alice@example.com> napisał(a):",
  },
  "replies/gmail-web-es.eml": {
    client: "Gmail web, Spanish: attribution \"El mar, 3 mar 2026 a las 10:15, Alice Dvořáková (<alice@example.com>) escribió:\", wrapped onto 2 lines",
    fresh: lines("Hola Alice,", "", "el borrador está casi listo, te lo envío el jueves.", "", "Lucía"),
    quotedFrom: "El mar, 3 mar 2026 a las 10:15, Alice Dvořáková (<alice@example.com>)",
  },
  "replies/gmail-web-it.eml": {
    client: "Gmail web, Italian: attribution \"Il giorno mar 3 mar 2026 alle ore 10:15 Alice Dvořáková <alice@example.com> ha scritto:\", wrapped onto 2 lines",
    fresh: lines("Ciao Alice,", "", "la bozza è quasi pronta, te la mando giovedì.", "", "Giulia"),
    quotedFrom: "Il giorno mar 3 mar 2026 alle ore 10:15 Alice Dvořáková <",
  },
  "replies/gmail-web-nl.eml": {
    client: "Gmail web, Dutch: attribution \"Op di 3 mrt 2026 om 10:15 schreef Alice Dvořáková <alice@example.com>:\"",
    fresh: lines("Hoi Alice,", "", "het concept is bijna klaar, ik stuur het donderdag.", "", "Daan"),
    quotedFrom: "Op di 3 mrt 2026 om 10:15 schreef Alice Dvořáková <alice@example.com>:",
  },
  "replies/gmail-web-pt.eml": {
    client: "Gmail web, Portuguese (BR): attribution \"Em ter., 3 de mar. de 2026 às 10:15, Alice Dvořáková <alice@example.com> escreveu:\", wrapped onto 2 lines",
    fresh: lines("Oi Alice,", "", "o rascunho está quase pronto, mando na quinta.", "", "João"),
    quotedFrom: "Em ter., 3 de mar. de 2026 às 10:15, Alice Dvořáková <alice@example.com>",
  },
  "replies/gmail-android-de.eml": {
    client: "Gmail app for Android, German: one-line answer; unwrapped attribution \"Alice Dvořáková <alice@example.com> schrieb am Di., 3. März 2026, 10:15:\"",
    fresh: "Mach ich, bis Freitag!",
    quotedFrom: "Alice Dvořáková <alice@example.com> schrieb am Di., 3. März 2026, 10:15:",
  },
  "replies/gmail-android-fr.eml": {
    client: "Gmail app for Android, French: one-line answer; unwrapped attribution \"Le mar. 3 mars 2026, 10:15, Alice Dvořáková <alice@example.com> a écrit :\"",
    fresh: "Oui, vendredi sans problème !",
    quotedFrom: "Le mar. 3 mars 2026, 10:15, Alice Dvořáková <alice@example.com> a écrit :",
  },
  "replies/gmail-ios-en.eml": {
    client: "Gmail app for iOS, English: one-line answer; unwrapped attribution \"On Tue, Mar 3, 2026 at 10:15\u202fAM Alice Dvořáková <alice@example.com> wrote:\"",
    fresh: "Will do, Friday at the latest.",
    quotedFrom: "On Tue, Mar 3, 2026 at 10:15\u202fAM Alice Dvořáková <alice@example.com> wrote:",
  },
  "replies/gmail-nested-reply-en.eml": {
    client: "Gmail web, English: reply to a reply: two attribution blocks, the inner one at depth 2 (> >)",
    fresh: lines("Great, I'll bring the map too.", "", "Bob"),
    quotedFrom: "On Wed, Mar 4, 2026 at 9:02\u202fAM Alice Dvořáková <alice@example.com>",
  },
  "replies/gmail-interleaved-en.eml": {
    client: "Gmail web, English: interleaved answers between quoted questions under a Gmail attribution; quoted sign-off left at the end",
    fresh: lines("Hi Alice,", "", "answers inline.", "", "On Tue, Mar 3, 2026 at 10:15\u202fAM Alice Dvořáková <alice@example.com>", "wrote:", "", "> Hi Bob,", ">", "> 1. Can you book the train?", ">", "", "Done, the 7:40 from the main station.", "", "> 2. Do we need a tent?", ">", "", "No, the cabin has beds."),
    quotedFrom: "> Thanks,",
  },
  "replies/gmail-forward-in-reply-en.eml": {
    client: "Gmail web, English: a reply quoting a Gmail forward: '> ---------- Forwarded message ---------' inside the quote",
    fresh: lines("Thanks, I'll call them tomorrow and confirm the dates.", "", "Bob"),
    quotedFrom: "On Tue, Mar 3, 2026 at 10:15\u202fAM Alice Dvořáková <alice@example.com>",
  },
  "replies/apple-mail-de.eml": {
    client: "Apple Mail (macOS), German: attribution inside the quote, split by a QP soft line break: \"> Am 03.03.2026 um 10:15 schrieb Alice Dvořáková <alice@example.com>:\"",
    fresh: lines("Hallo Alice,", "", "klar, die Übersicht kommt bis Freitag.", "", "Anna"),
    quotedFrom: "> Am 03.03.2026 um 10:15 schrieb Alice Dvořáková <alice@example.com>:",
  },
  "replies/apple-mail-fr.eml": {
    client: "Apple Mail (macOS), French: attribution inside the quote, split by a QP soft line break: \"> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :\"",
    fresh: lines("Bonjour Alice,", "", "oui, tu l'auras avant vendredi.", "", "Camille"),
    quotedFrom: "> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :",
  },
  "replies/ios-mail-cs-ipad.eml": {
    client: "iOS Mail (iPad), Czech: mobile signature \"Odesláno z iPadu\"; attribution \"> Dne 3. 3. 2026 v 10:15, Alice Dvořáková <alice@example.com> napsal(a):\"",
    fresh: "Jasně, pošlu je večer.",
    signature: "Odesláno z iPadu",
    quotedFrom: "> Dne 3. 3. 2026 v 10:15, Alice Dvořáková <alice@example.com> napsal(a):",
  },
  "replies/ios-mail-fr.eml": {
    client: "iOS Mail (iPhone), French: mobile signature \"Envoyé de mon iPhone\"; attribution \"> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :\"",
    fresh: "Oui, avant vendredi !",
    signature: "Envoyé de mon iPhone",
    quotedFrom: "> Le 3 mars 2026 à 10:15, Alice Dvořáková <alice@example.com> a écrit :",
  },
  "replies/ios-mail-sk.eml": {
    client: "iOS Mail (iPhone), Slovak: mobile signature \"Odoslané z iPhonu\"; attribution \"> Dňa 3. 3. 2026 o 10:15 používateľ Alice Dvořáková <alice@example.com> napísal:\"",
    fresh: "Jasné, pošlem ich večer.",
    signature: "Odoslané z iPhonu",
    quotedFrom: "> Dňa 3. 3. 2026 o 10:15 používateľ Alice Dvořáková <alice@example.com> napísal:",
  },
  "replies/ios-mail-pl.eml": {
    client: "iOS Mail (iPhone), Polish: mobile signature \"Wysłane z iPhone'a\"; attribution \"> Wiadomość napisana przez Alice Dvořáková <alice@example.com> w dniu 3 mar 2026, o godz. 10:15:\"",
    fresh: "Jasne, wyślę wieczorem.",
    signature: "Wysłane z iPhone'a",
    quotedFrom: "> Wiadomość napisana przez Alice Dvořáková <alice@example.com> w dniu 3 mar 2026, o godz. 10:15:",
  },
  "replies/ios-mail-es.eml": {
    client: "iOS Mail (iPhone), Spanish: mobile signature \"Enviado desde mi iPhone\"; attribution \"> El 3 mar 2026, a las 10:15, Alice Dvořáková <alice@example.com> escribió:\"",
    fresh: "Claro, te lo mando el jueves.",
    signature: "Enviado desde mi iPhone",
    quotedFrom: "> El 3 mar 2026, a las 10:15, Alice Dvořáková <alice@example.com> escribió:",
  },
  "replies/ios-mail-it.eml": {
    client: "iOS Mail (iPhone), Italian: mobile signature \"Inviato da iPhone\"; attribution \"> Il giorno 3 mar 2026, alle ore 10:15, Alice Dvořáková <alice@example.com> ha scritto:\"",
    fresh: "Certo, te la mando giovedì.",
    signature: "Inviato da iPhone",
    quotedFrom: "> Il giorno 3 mar 2026, alle ore 10:15, Alice Dvořáková <alice@example.com> ha scritto:",
  },
  "replies/ios-mail-nl.eml": {
    client: "iOS Mail (iPhone), Dutch: mobile signature \"Verstuurd vanaf mijn iPhone\"; attribution \"> Op 3 mrt 2026 om 10:15 heeft Alice Dvořáková <alice@example.com> het volgende geschreven:\"",
    fresh: "Prima, ik stuur het donderdag.",
    signature: "Verstuurd vanaf mijn iPhone",
    quotedFrom: "> Op 3 mrt 2026 om 10:15 heeft Alice Dvořáková <alice@example.com> het volgende geschreven:",
  },
  "replies/ios-mail-pt.eml": {
    client: "iOS Mail (iPhone), Portuguese (BR): mobile signature \"Enviado do meu iPhone\"; attribution \"> Em 3 de mar. de 2026, à(s) 10:15, Alice Dvořáková <alice@example.com> escreveu:\"",
    fresh: "Claro, mando na quinta.",
    signature: "Enviado do meu iPhone",
    quotedFrom: "> Em 3 de mar. de 2026, à(s) 10:15, Alice Dvořáková <alice@example.com> escreveu:",
  },
  "replies/thunderbird-sk.eml": {
    client: "Thunderbird, Slovak: answer below the quote; attribution \"Dňa 3. 3. 2026 o 10:15 Alice Dvořáková napísal(a):\"",
    fresh: lines("Ahoj Alice,", "", "fotky nahrám dnes večer.", "", "Martina"),
    quotedFrom: "Dňa 3. 3. 2026 o 10:15 Alice Dvořáková napísal(a):",
  },
  "replies/thunderbird-pl.eml": {
    client: "Thunderbird, Polish: answer below the quote; attribution \"W dniu 3.03.2026 o 10:15, Alice Dvořáková pisze:\"; the answer is a long format=flowed paragraph",
    fresh: lines("Cześć Alice,", "", "zdjęcia wrzucę dziś wieczorem, jest ich około dwustu, więc najpierw wybiorę te najlepsze i dopiero potem dodam resztę do albumu.", "", "Piotr"),
    quotedFrom: "W dniu 3.03.2026 o 10:15, Alice Dvořáková pisze:",
  },
  "replies/thunderbird-es.eml": {
    client: "Thunderbird, Spanish: answer below the quote; attribution \"El 3/3/26 a las 10:15, Alice Dvořáková escribió:\"",
    fresh: lines("Hola Alice,", "", "te lo envío esta tarde.", "", "Lucía"),
    quotedFrom: "El 3/3/26 a las 10:15, Alice Dvořáková escribió:",
  },
  "replies/thunderbird-it.eml": {
    client: "Thunderbird, Italian: answer below the quote; attribution \"Il 03/03/26 10:15, Alice Dvořáková ha scritto:\"",
    fresh: lines("Ciao Alice,", "", "te la mando stasera.", "", "Giulia"),
    quotedFrom: "Il 03/03/26 10:15, Alice Dvořáková ha scritto:",
  },
  "replies/thunderbird-nl.eml": {
    client: "Thunderbird, Dutch: answer below the quote; attribution \"Op 03-03-2026 om 10:15 schreef Alice Dvořáková:\"",
    fresh: lines("Hoi Alice,", "", "ik stuur het vanavond.", "", "Daan"),
    quotedFrom: "Op 03-03-2026 om 10:15 schreef Alice Dvořáková:",
  },
  "replies/thunderbird-pt.eml": {
    client: "Thunderbird, Portuguese (BR): answer below the quote; attribution \"Em 03/03/2026 10:15, Alice Dvořáková escreveu:\"",
    fresh: lines("Oi Alice,", "", "mando hoje à noite.", "", "João"),
    quotedFrom: "Em 03/03/2026 10:15, Alice Dvořáková escreveu:",
  },
  "replies/thunderbird-flowed-attribution.eml": {
    client: "Thunderbird, English: format=flowed: the 79-character attribution and the long lines are soft-wrapped at 72 (trailing space)",
    fresh: lines("Hi Alice,", "", "the draft is on its way. I changed the payment terms in article 4 as we discussed and left a comment where Legal should look first.", "", "Bob"),
    quotedFrom: "On 3/3/26 10:15, Alice Dvořáková (Example Projects, Coordination Office) wrote:",
  },
  "replies/thunderbird-en-signature-above-quote.eml": {
    client: "Thunderbird (reply above the quote, signature above the quote), English: '-- ' signature between the answer and the attribution",
    fresh: lines("Hi Alice,", "", "yes, Friday works.", "", "Bob"),
    signature: lines("-- ", "Bob Svoboda", "Example s.r.o."),
    quotedFrom: "On 3/3/26 10:15, Alice Dvořáková wrote:",
  },
  "replies/thunderbird-cs-signature-above-quote.eml": {
    client: "Thunderbird (reply above the quote, signature above the quote), Czech: '-- ' signature between the answer and the attribution",
    fresh: lines("Ahoj Alice,", "", "fotky pošlu v pátek.", "", "Karel"),
    signature: lines("-- ", "Karel Holub", "Example s.r.o."),
    quotedFrom: "Dne 03. 03. 26 v 10:15 Alice Dvořáková napsal(a):",
  },
  "replies/thunderbird-de-forward.eml": {
    client: "Thunderbird, inline forward, German: forward: '-------- Weitergeleitete Nachricht --------' and the tab-separated header table",
    fresh: lines("Hallo Lukas,", "", "zur Info, siehe unten.", "", "Anna"),
    quotedFrom: "-------- Weitergeleitete Nachricht --------",
  },
  "replies/samsung-mail-en.eml": {
    client: "Samsung Email, English: signature \"Sent from my Galaxy\" above \"-------- Original message --------\" and a header block with trailing spaces; base64",
    fresh: "Sure, I'll send it on Thursday.",
    signature: "Sent from my Galaxy",
    quotedFrom: "-------- Original message --------",
  },
  "replies/samsung-mail-de.eml": {
    client: "Samsung Email, German: signature \"Von meinem Samsung Galaxy Smartphone gesendet.\" above \"-------- Ursprüngliche Nachricht --------\" and a header block with trailing spaces; base64",
    fresh: "Mache ich, bis Freitag.",
    signature: "Von meinem Samsung Galaxy Smartphone gesendet.",
    quotedFrom: "-------- Ursprüngliche Nachricht --------",
  },
  "replies/samsung-mail-fr.eml": {
    client: "Samsung Email, French: signature \"Envoyé depuis mon appareil Galaxy\" above \"-------- Message d'origine --------\" and a header block with trailing spaces; base64",
    fresh: "D'accord, je l'envoie jeudi.",
    signature: "Envoyé depuis mon appareil Galaxy",
    quotedFrom: "-------- Message d'origine --------",
  },
  "replies/proton-mail-en.eml": {
    client: "Proton Mail (web), English: 'Sent with Proton Mail secure email.' footer above the attribution; base64",
    fresh: lines("Hi Alice,", "", "yes, the draft will be ready on Thursday.", "", "Bob"),
    signature: "Sent with [Proton Mail](https://proton.example.net/) secure email.",
    quotedFrom: "On Tuesday, March 3rd, 2026 at 10:15 AM, Alice Dvořáková <alice@example.com> wrote:",
  },
  "replies/proton-mail-html-only.eml": {
    client: "Proton Mail (web), HTML part only, English: HTML only: protonmail_signature_block, attribution in div.protonmail_quote, <blockquote class=\"protonmail_quote\">",
    fresh: lines("Hi Alice,", "", "Thursday, as promised.", "", "Bob"),
    signature: "Sent with Proton Mail secure email.",
    quotedFrom: "On Tuesday, March 3rd, 2026 at 10:15 AM, Alice Dvořáková <alice@example.com> wrote:",
  },
  "replies/fastmail-en.eml": {
    client: "Fastmail (web), English: attribution \"On Tue, 3 Mar 2026, at 10:15, Alice Dvořáková wrote:\" (no address) directly above the \"> \" lines",
    fresh: lines("Hi Alice,", "", "Friday is fine, the draft is nearly done.", "", "Bob"),
    quotedFrom: "On Tue, 3 Mar 2026, at 10:15, Alice Dvořáková wrote:",
  },
  "replies/yahoo-mail-web-en.eml": {
    client: "Yahoo Mail (web), English: indented attribution with trailing spaces, original not prefixed with '>' but indented by one space",
    fresh: lines("Hi Alice,", "", "Friday works, I'll send the draft on Thursday.", "", "Bob"),
    quotedFrom: "    On Tuesday, March 3, 2026 at 10:15:00 AM GMT+1, Alice Dvořáková <alice@example.com> wrote:  ",
  },
  "replies/yahoo-mail-android-en.eml": {
    client: "Yahoo Mail for Android, English: 'Sent from Yahoo Mail on Android'; attribution with no space before '<', original indented, not prefixed",
    fresh: "Sure, see you Friday!",
    signature: "Sent from Yahoo Mail on Android",
    quotedFrom: "  On Tue, Mar 3, 2026 at 10:15, Alice Dvořáková<alice@example.com> wrote:   ",
  },
  "replies/roundcube-en.eml": {
    client: "Roundcube 1.6 (default: answer below the quote), English: attribution \"On 2026-03-03 10:15, Alice Dvořáková wrote:\" (ISO date, no address), answer below",
    fresh: lines("Hi Alice,", "", "the draft is attached to the ticket, see you on Friday.", "", "Bob"),
    quotedFrom: "On 2026-03-03 10:15, Alice Dvořáková wrote:",
  },
};

/** Non-blank lines, as a sorted multiset. */
const nonBlank = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .sort();

function expectNothingLost(text: string, split: QuotedSplit): void {
  expect(nonBlank([split.fresh, split.quoted, split.signature].join("\n"))).toEqual(nonBlank(text));
}

describe("splitQuoted on real reply formats", () => {
  it("has at least 25 reply fixtures, and every file in fixtures/replies has an expectation", () => {
    expect(Object.keys(CASES).length).toBeGreaterThanOrEqual(25);
    expect(listReplyFixtures().filter((name) => !(name in CASES))).toEqual([]);
  });

  it.each(Object.entries(CASES))("%s", (name, expected) => {
    const message = parseMessage(readFixture(name));
    const split = splitQuoted(message);
    expect(split.fresh, expected.client).toBe(expected.fresh);
    expect(split.signature, expected.client).toBe(expected.signature ?? "");
    expect(split.quoted.split("\n")[0], expected.client).toBe(expected.quotedFrom);
    expectNothingLost(message.text, split);
  });
});

describe("splitQuoted rules", () => {
  it("keeps everything as fresh when nothing is recognised", () => {
    const text = "Hi,\n\nsee you at 10.\n\nAlice\n";
    expect(splitQuoted({ text })).toEqual({ fresh: "Hi,\n\nsee you at 10.\n\nAlice", quoted: "", signature: "" });
    expect(splitQuoted({ text: "" })).toEqual({ fresh: "", quoted: "", signature: "" });
  });

  it("does not take a sentence ending in 'wrote:' for an attribution unless it names a date or an address", () => {
    const text = lines("Here is what Karel wrote:", "we leave at ten.", "", "In 2019 Karel wrote:", "the old plan.");
    expect(splitQuoted({ text }).fresh).toBe(text);
  });

  it("treats an Email Social post as fresh text, whatever it contains", () => {
    const raw = serializeMessage(
      { from: { name: "Bob", address: "bob@example.org" }, to: [{ name: "", address: "alice@example.com" }], subject: "Hi", text: "> this is how I quote\nand my answer\n-- \nBob" },
      { date: "2026-03-03T10:00:00Z", messageId: "<es-q1@example.org>" },
    );
    const message = parseMessage(raw);
    expect(message.es?.$type).toBe("es.social.post");
    expect(splitQuoted(message)).toEqual({ fresh: "> this is how I quote\nand my answer\n-- \nBob", quoted: "", signature: "" });
  });

  it("reads CRLF line endings like LF", () => {
    const text = "Thanks!\r\n\r\nOn Tue, 3 Mar 2026 at 10:15, Karel <karel@example.org> wrote:\r\n> Hi\r\n";
    expect(splitQuoted({ text })).toEqual({ fresh: "Thanks!", quoted: "On Tue, 3 Mar 2026 at 10:15, Karel <karel@example.org> wrote:\n> Hi", signature: "" });
  });

  it("quotes everything after an attribution whose original is not prefixed with '>'", () => {
    const text = lines("Sure.", "", "On Tue, 3 Mar 2026 at 10:15, Karel Holub <karel@example.org> wrote:", "Can you come?", "Karel");
    expect(splitQuoted({ text })).toEqual({
      fresh: "Sure.",
      quoted: lines("On Tue, 3 Mar 2026 at 10:15, Karel Holub <karel@example.org> wrote:", "Can you come?", "Karel"),
      signature: "",
    });
  });

  it("quotes a message that is only a quote, leaving fresh empty", () => {
    const text = lines("> Hello", "> there");
    expect(splitQuoted({ text })).toEqual({ fresh: "", quoted: text, signature: "" });
  });
});

describe("splitQuoted never drops a line (seeded property test)", () => {
  const vocabulary = [
    () => "Plain words of the reply.",
    () => "Another line, with a date 3. 3. 2026.",
    () => "",
    () => "   ",
    () => "> quoted line",
    () => ">",
    () => ">> nested quote",
    () => "On Tue, 3 Mar 2026 at 10:15, Karel Holub <karel@example.org> wrote:",
    () => "Dne 3. 3. 2026 v 10:15 Karel Holub napsal(a):",
    () => "Am 03.03.26 um 10:15 schrieb Anna Becker:",
    () => "Le 03/03/2026 à 10:15, Camille a écrit :",
    () => "-----Original Message-----",
    () => "---------- Forwarded message ---------",
    () => "From: Alice <alice@example.com>",
    () => "Sent: Tuesday, March 3, 2026 10:15 AM",
    () => "To: Bob <bob@example.org>",
    () => "Subject: Contract",
    () => "________________________________",
    () => "-- ",
    () => "--",
    () => "Sent from my iPhone",
    () => "Begin forwarded message:",
    () => "Bob",
  ];

  it("puts every non-blank input line into exactly one part, for 1000 generated texts", () => {
    const random = mulberry32(0x5911);
    for (let n = 0; n < 1000; n++) {
      const count = randomInt(random, 0, 25);
      const text = Array.from({ length: count }, () => pick(random, vocabulary)()).join(random() < 0.2 ? "\r\n" : "\n");
      const split = splitQuoted({ text });
      expectNothingLost(text.replace(/\r\n/g, "\n"), split);
      for (const part of [split.fresh, split.quoted, split.signature]) {
        for (const line of part.split("\n")) if (line.trim() !== "") expect(text).toContain(line);
      }
    }
  });

  it("returns the text itself as fresh when no line is a marker", () => {
    const random = mulberry32(0x5912);
    const plain = ["Hello Bob,", "", "the plan: leave at 10.", "Alice", "What she wrote was fine.", "- item one"];
    for (let n = 0; n < 200; n++) {
      const text = Array.from({ length: randomInt(random, 1, 12) }, () => pick(random, plain)).join("\n");
      expect(splitQuoted({ text }).fresh).toBe(text.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ""));
    }
  });
});
