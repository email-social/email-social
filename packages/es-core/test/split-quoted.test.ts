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
