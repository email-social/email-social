/**
 * unquotedLines, unquote and collapse (what a quote says, without the quote
 * markup), and isInterleaved, on the reply formats of fixtures/replies and
 * the corpus.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { isInterleaved, splitQuoted, unquote, unquotedLines } from "../src/quotes.js";
import { serializeMessage } from "../src/serialize.js";
import { collapse } from "../src/util/text.js";
import { listAllFixtures, listReplyFixtures, readFixture } from "./helpers/fixtures.js";

const quotedOf = (name: string): string => splitQuoted(parseMessage(readFixture(name))).quoted;

/** The messages Alice wrote and the reply fixtures quote (see fixtures/README.md, "Reply formats"). */
const ORIGINAL = {
  en: "Hi Bob, could you send me the contract draft by Friday? Thanks, Alice",
  enJulien: "Hi Julien, can we move the meeting notes review to Thursday? Alice",
  cs: "Ahoj Karle, pošleš mi prosím fotky z výletu? Chci je dát do alba. Díky, Alice",
  de: "Hallo Anna, kannst du mir die Projektübersicht bis Freitag schicken? Viele Grüße Alice",
  fr: "Bonjour Camille, peux-tu m'envoyer le compte rendu de la réunion ? Merci, Alice",
};

describe("collapse", () => {
  it("turns every run of white space, NBSP and narrow NBSP included, into one space and trims", () => {
    expect(collapse("  a\t\tb\n\nc  d e \r\n ")).toBe("a b c d e");
    expect(collapse(" ")).toBe("");
    expect(collapse("")).toBe("");
  });
});

describe("unquotedLines / unquote: every default reply format quotes exactly the original", () => {
  const expected: Record<string, string> = {
    "replies/gmail-web-en.eml": ORIGINAL.en,
    "replies/gmail-app-en.eml": ORIGINAL.en,
    "replies/gmail-web-signature.eml": ORIGINAL.en,
    "replies/gmail-quote-html-only.eml": ORIGINAL.en,
    "replies/gmail-web-cs.eml": ORIGINAL.cs,
    "replies/gmail-web-de.eml": ORIGINAL.de,
    "replies/gmail-web-fr.eml": ORIGINAL.fr,
    "replies/apple-mail-en.eml": ORIGINAL.en,
    "replies/apple-mail-cs.eml": ORIGINAL.cs,
    "replies/ios-mail-en.eml": ORIGINAL.en,
    "replies/ios-mail-de.eml": ORIGINAL.de,
    "replies/thunderbird-en.eml": ORIGINAL.en,
    "replies/thunderbird-cs.eml": ORIGINAL.cs,
    "replies/thunderbird-fr.eml": ORIGINAL.fr,
    "replies/thunderbird-html-only-de.eml": ORIGINAL.de,
    "replies/outlook-desktop-en.eml": ORIGINAL.en,
    "replies/outlook-desktop-en-plain.eml": ORIGINAL.en,
    "replies/outlook-desktop-html-only.eml": ORIGINAL.en,
    "replies/outlook-desktop-cs.eml": ORIGINAL.cs,
    "replies/outlook-desktop-de.eml": ORIGINAL.de,
    "replies/outlook-desktop-fr.eml": ORIGINAL.fr,
    "replies/outlook-web.eml": ORIGINAL.enJulien,
    "replies/outlook-web-html-only.eml": ORIGINAL.enJulien,
    "replies/outlook-ios.eml": ORIGINAL.enJulien,
  };

  it.each(Object.entries(expected))("%s", (name, text) => {
    expect(unquote(quotedOf(name))).toBe(text);
  });

  it("covers every reply fixture that quotes Alice's original", () => {
    const quoting = listReplyFixtures().filter((name) => !["replies/plain-no-quote.eml", "replies/mutt-interleaved.eml", "replies/gmail-long-quote.eml", "replies/gmail-web-fragment.eml", "replies/outlook-desktop-fragment.eml"].includes(name));
    expect(Object.keys(expected).sort()).toEqual(quoting);
  });
});

describe("unquotedLines: the parts it drops and keeps", () => {
  it("removes '>' at any depth, with or without the space after each one", () => {
    expect(unquotedLines("> one\n>> two\n> > three\n>>> four\n>five\n   > six")).toEqual(["one", "two", "three", "four", "five", "six"]);
  });

  it("keeps blank quote lines as empty lines and keeps the indentation after the first space", () => {
    expect(unquotedLines("> a\n>\n> \n>   indented")).toEqual(["a", "", "", "  indented"]);
  });

  it("removes the U+FEFF iOS Mail writes before the quoted text, and the one some clients put first", () => {
    expect(unquotedLines("> ﻿Hi Bob,\n﻿> Thanks")).toEqual(["Hi Bob,", "Thanks"]);
    expect(unquote(quotedOf("replies/ios-mail-en.eml"))).not.toContain("﻿");
  });

  it.each([
    ["en, Gmail wrapped", "On Tue, Mar 3, 2026 at 10:15 AM Alice <alice@example.com>\nwrote:\n\n> Hi"],
    ["en, Thunderbird", "On 3/3/26 10:15, Alice Dvořáková wrote:\n> Hi"],
    ["en, Apple inside the quote", "> On 3 Mar 2026, at 10:15, Alice <alice@example.com> wrote:\n>\n> Hi"],
    ["cs, Gmail", "út 3. 3. 2026 v 10:15 odesílatel Alice <alice@example.com>\nnapsal:\n\n> Hi"],
    ["cs, Apple", "> Dne 3. 3. 2026 v 10:15, Alice <alice@example.com> napsal(a):\n> Hi"],
    ["de, Gmail wrapped inside the address", "Am Di., 3. März 2026 um 10:15 Uhr schrieb Alice <\nalice@example.com>:\n\n> Hi"],
    ["de, Thunderbird", "Am 03.03.26 um 10:15 schrieb Alice:\n> Hi"],
    ["fr, Gmail", "Le mar. 3 mars 2026 à 10:15, Alice <alice@example.com> a\nécrit :\n\n> Hi"],
    ["fr, Thunderbird", "Le 03/03/2026 à 10:15, Alice a écrit :\n> Hi"],
  ])("drops the attribution line (%s)", (_, quoted) => {
    expect(unquote(quoted)).toBe("Hi");
  });

  it("drops attributions at every depth of a nested quote", () => {
    expect(unquote(quotedOf("ios-mail-reply.eml"))).toBe(
      "Ahoj Alice, v pátek můžu, 12:30 je super. Zarezervuju stůl pro tři. Bob " +
        "Ahoj Bobe, nechceš v pátek zajít na oběd? Myslela jsem, že bychom mohli zkusit to nové bistro na rohu u nádraží, prý tam mají výborné polední menu a není tam taková fronta jako jinde. " +
        "Jana už říkala, že by šla taky. Hodí se ti 12:30? Alice -- Alice Dvořáková Example s.r.o.",
    );
  });

  it("drops Outlook header blocks in en, cs, de and fr, and only their lines", () => {
    expect(unquotedLines("From: Alice <alice@example.com> \nSent: Tuesday, March 3, 2026 10:15 AM\nTo: Bob <bob@example.org>\nSubject: Draft\n\nHi Bob")).toEqual(["", "Hi Bob"]);
    expect(unquote("Od: Alice <alice@example.com>\nOdesláno: úterý 3. března 2026 10:15\nKomu: Karel <karel@example.org>\nPředmět: Fotky\n\nAhoj")).toBe("Ahoj");
    expect(unquote("Von: Alice <alice@example.com>\nGesendet: Dienstag, 3. März 2026 10:15\nAn: Anna <anna@example.net>\nCc: Lukas <lukas@example.net>\nBetreff: Übersicht\n\nHallo")).toBe("Hallo");
    expect(unquote("De : Alice <alice@example.com>\nEnvoyé : mardi 3 mars 2026 10:15\nÀ : Camille <camille@example.org>\nObjet : Compte rendu\n\nBonjour")).toBe("Bonjour");
  });

  it("keeps the first line of text right under a header block without a blank line (Seznam.cz)", () => {
    expect(unquote(quotedOf("seznam-webmail.eml"))).toBe(
      '"Dobrý den, ve vyúčtování za březen chybí položka za dopravu. Můžete ho prosím poslat znovu? Děkuji Marie Svobodová"',
    );
  });

  it("drops -----Original Message----- (and its cs/fr forms) and the line of underscores above a header block", () => {
    expect(unquotedLines("-----Original Message-----\nFrom: Alice <alice@example.com>\nSent: Tuesday\nTo: Bob <bob@example.org>\nSubject: Draft\n\nHi")).toEqual(["", "Hi"]);
    expect(unquote(quotedOf("outlook-cs-1250.eml"))).toBe("Dobrý den, v příloze posílám opravenou „fakturu“ za únor, doplnil jsem IČO. Prosím o potvrzení přijetí. Petr Novák");
    expect(unquote(quotedOf("outlook-fr-reply-no-thread-headers.eml"))).toBe(
      "Bonjour à tous, La réunion de lundi est déplacée à 14 h 30, salle B. Merci de préparer vos points pour l’ordre du jour. Bonne soirée, Camille",
    );
    expect(unquotedLines("________________________________\nFrom: Alice <alice@example.com>\nSent: Tuesday\nTo: Julien <julien@example.org>\nSubject: Notes\n\nHi")).toEqual(["", "Hi"]);
  });

  it("gives the one sentence a sender kept of the original (Gmail web, Outlook desktop under a header block)", () => {
    expect(unquote(quotedOf("replies/gmail-web-fragment.eml"))).toBe("Jana už říkala, že by šla taky.");
    expect(unquotedLines(quotedOf("replies/outlook-desktop-fragment.eml"))).toEqual(["", "Podívej se prosím hlavně na článek 4 (termíny plnění)."]);
  });

  it("keeps signatures, list items and the '[...]' marker of a cut quote", () => {
    expect(unquote(quotedOf("gmail-web-reply.eml"))).toMatch(/Alice -- Alice Dvořáková Example s\.r\.o\.$/);
    expect(unquote(quotedOf("mailing-list-footer.eml"))).toBe(
      "Proposed schedule: - feature freeze on 20 March - release candidate on 27 March - final release on 3 April Objections?",
    );
    expect(unquote("On Tue, 3 Mar 2026 at 10:15, Alice <alice@example.com> wrote:\n> one\n> [...]")).toBe("one [...]");
  });

  it("does not drop text that only looks like an attribution or a header", () => {
    expect(unquote("> Here is what Bob wrote:\n> fine")).toBe("Here is what Bob wrote: fine");
    expect(unquote("> From: the checklist\n> Date: to be decided")).toBe("From: the checklist Date: to be decided");
  });

  it("never leaves a quote marker at the start of a line, in any fixture", () => {
    for (const name of listAllFixtures()) {
      for (const line of unquotedLines(quotedOf(name))) expect(line, name).not.toMatch(/^[ \t﻿]{0,3}>/);
    }
  });

  it("returns [''] for an empty quote and unquote returns ''", () => {
    expect(unquotedLines("")).toEqual([""]);
    expect(unquote("")).toBe("");
  });
});

describe("isInterleaved", () => {
  it("is true for answers between quoted points (mutt) and false for every other reply format", () => {
    // The mbox archive's ">From" line (mboxrd escaping) sits between two paragraphs, so splitQuoted keeps it in fresh the same way.
    const interleaved = ["mbox-lf-obsolete-date.eml", "replies/mutt-interleaved.eml"];
    for (const name of listAllFixtures()) {
      expect(isInterleaved(parseMessage(readFixture(name))), name).toBe(interleaved.includes(name));
    }
  });

  it("is false for a quote above or below the answer and for text without quotes", () => {
    expect(isInterleaved({ text: "> question?\n\nanswer" })).toBe(false);
    expect(isInterleaved({ text: "answer\n\nOn 3/3/26 10:15, Alice wrote:\n> question?" })).toBe(false);
    expect(isInterleaved({ text: "just text" })).toBe(false);
    expect(isInterleaved({ text: "a\n> q\nb" })).toBe(true);
  });

  it("is false for an Email Social post, whose text is all its own", () => {
    const post = parseMessage(
      serializeMessage(
        { from: { name: "", address: "alice@example.com" }, to: [{ name: "", address: "bob@example.org" }], text: "a\n> q\nb" },
        { date: "2026-03-03T10:00:00Z", messageId: "<interleaved-es@example.com>" },
      ),
    );
    expect(post.es?.$type).toBe("es.social.post");
    expect(isInterleaved(post)).toBe(false);
    expect(splitQuoted(post).fresh).toBe("a\n> q\nb");
  });
});
