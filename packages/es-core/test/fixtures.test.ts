/**
 * Real-world fixture corpus (fixtures/*.eml, see fixtures/README.md) parsed
 * with parseMessage and compared with hand-written expectations.
 *
 * Text semantics pinned here: CRLF becomes "\n"; the line break before a MIME
 * delimiter belongs to the delimiter (RFC 2046 §5.1.1) and is not content;
 * format=flowed is unwrapped (RFC 3676); nothing is trimmed from text/plain.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import type { EsAddress, EsMessage } from "../src/types.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";

const lines = (...parts: string[]): string => parts.join("\n");
const NNBSP = " "; // Gmail writes U+202F before AM/PM in its attribution lines.

// ---------------------------------------------------------------- people

const alice: EsAddress = { name: "Alice Dvořáková", address: "alice@example.com" };
const bob: EsAddress = { name: "Bob Svoboda", address: "bob@example.org" };
const jana: EsAddress = { name: "Jana Nováková", address: "jana@example.net" };
const anna: EsAddress = { name: "Anna Becker", address: "Anna.Becker@example.net" };
const lukas: EsAddress = { name: "Lukas Weber", address: "Lukas.Weber@example.net" };
const marie: EsAddress = { name: "Marie Svobodová", address: "marie.svobodova@example.com" };
const petr: EsAddress = { name: "Petr Novák", address: "petr.novak@example.org" };
const camille: EsAddress = { name: "Camille Lefèvre", address: "camille@example.org" };
const julien: EsAddress = { name: "Julien Moreau", address: "julien@example.org" };
const amelie: EsAddress = { name: "Amélie Rousseau", address: "amelie@example.org" };
const ondrej: EsAddress = { name: "Ondřej Beneš", address: "ondrej@host.example.com" };
const karel: EsAddress = { name: "Karel Holub", address: "karel@example.org" };
const daniel: EsAddress = { name: "Daniel Brooks", address: "daniel@example.com" };

// ---------------------------------------------------------------- message ids

const ID = {
  thunderbird: "<3f2a9c1e-6b4d-4e8a-9f1c-2d7e5b8a0c34@example.com>",
  gmailReply: "<CAH7x9kN4q2Lr8vT6YpW3mZs1bQ5dF0gJ+uE_aK8cR2xV9nB7eQ=w@mail.example.com>",
  ios: "<8C1F4E2A-3B7D-4A9E-B5C6-D2E1F0A9B8C7@example.net>",
  outlookDe: "<AM0PR07MB62114F2E8A1C3B5D7E9F0A2B4C6D8E0FA@AM0PR07MB6211.eurprd07.prod.outlook.example.com>",
  outlookDeReply: "<001a01dcaaf1$4b2c3d10$e1847730$@example.net>",
  csRoot: "<DB9PR08MB6921A0B1C2D3E4F5A6B7C8D9E0F1A2B3C@DB9PR08MB6921.eurprd08.prod.outlook.example.com>",
  csMiddle: "<VI1PR02MB58347E6D5C4B3A2918F7E6D5C4B3A2918@VI1PR02MB5834.eurprd02.prod.outlook.example.com>",
  csParent: "<DB9PR08MB69213F4E5D6C7B8A9F0E1D2C3B4A5968@DB9PR08MB6921.eurprd08.prod.outlook.example.com>",
  cs: "<VI1PR02MB58341D3E5F7A9B0C2D4E6F8A0B2C4D6E8@VI1PR02MB5834.eurprd02.prod.outlook.example.com>",
  appleFr: "<4E7A9C2B-1D3F-4B6A-8E5C-9F0A1B2C3D4E@example.org>",
  outlookFr: "<000601dcac5e$1a2b3c40$4e5f6a70$@example.org>",
  appleFrForward: "<9B3D5F7A-2C4E-4F6A-8B0C-1D3E5F7A9B2C@example.org>",
  outlookFrForward: "<PR3P192MB07415C2A8E1B4D6F9A0C3E5B7D9F1A3C5@PR3P192MB0741.EURP192.PROD.OUTLOOK.example.com>",
  appleImage: "<E2B4C6D8-0A1C-4E3F-9B5D-7F8A9C0D1E2F@example.com>",
  gmailAttachment: "<CAH7x9kP8sT2vW4yZ6bD0fH3jL5nQ7rU9wA1cE3gI5kM7oQ9sU@mail.example.com>",
  thunderbirdAttachment: "<7d4e2b91-3c5a-4f8e-a0b6-5e1c9d2f8a73@example.com>",
  mutt: "<20260302093000.GA12345@host.example.com>",
  muttParent: "<20260301174512.GB4411@example.org>",
  muttPatch: "<20260311211405.GA23456@host.example.com>",
  seznam: "<5Nt.Vkq2.7pLcY0bRmTe.1fXk9D@example.net>",
  seznamRoot: "<5Mz.Vjx1.2aQwE4tYuIo.1fWb3C@example.net>",
  seznamParent: "<VI1PR02MB5834B6C7D8E9F0A1B2C3D4E5F6A7B8C9D@VI1PR02MB5834.eurprd02.prod.outlook.example.com>",
  newsletter: "<0100018e2f4a7b3c-9d1e5f20-4a6b-4c8d-9e0f-1a2b3c4d5e6f-000000@email.example.org>",
  list: "<C3A1E5F7-9B2D-4C6E-8A0F-1B3D5F7A9C2E@example.net>",
  listParent: "<6f1d2c3b-4a5e-4f6d-9c8b-7a6e5d4c3b2a@example.org>",
  esDraft: "<unique-id@mail.example.com>",
  gmailForward: "<CAH7x9kQ2wE3rT4yU5iO6pA7sD8fG9hJ0kL1zX2cV3bN4mQ+w@mail.example.com>",
  esOriginal: "<es.7f3a9c2e41b8d605@example.com>",
  undisclosed: "<announce-20260316-0730@example.com>",
} as const;

/** SHA-256 of the raw bytes of mbox-lf-obsolete-date.eml (it has no Message-ID). */
const MBOX_SHA256 = "13aedcc5ecf5599bb63a2d2c0d2d39d162396c0401f8005bdd2a28db7090b9c4";

// ---------------------------------------------------------------- shared texts

const THUNDERBIRD_PARAGRAPH =
  "nechceš v pátek zajít na oběd? Myslela jsem, že bychom mohli zkusit to nové bistro na rohu u nádraží, " +
  "prý tam mají výborné polední menu a není tam taková fronta jako jinde.";

const OUTLOOK_DE_TEXT = lines(
  "Hallo Lukas,",
  "",
  "anbei die Projektübersicht für das zweite Quartal:",
  "",
  "",
  "  *   Meilenstein 1: Anforderungen abgeschlossen (bis 15.04.)",
  "  *   Meilenstein 2: Prototyp für die Kundenpräsentation",
  "  *   Budget: 42.000 EUR (unverändert)",
  "",
  "Kannst du bis Freitag kurz drüberschauen?",
  "",
  "Viele Grüße",
  "Anna",
  "",
  "Anna Becker",
  "Projektleitung",
  "Example GmbH | Musterstraße 1 | 12345 Musterstadt",
  "",
);

const APPLE_FR_TEXT = lines(
  "Bonjour à tous,",
  "",
  "La réunion de lundi est déplacée à 14 h 30, salle B. Merci de préparer vos points pour l’ordre du jour.",
  "",
  "Bonne soirée,",
  "Camille",
  "",
);

// ---------------------------------------------------------------- expectations

interface Case {
  /** What the fixture exercises; used in test names. */
  exercises: string;
  expected: EsMessage;
}

const CASES: Record<string, Case> = {
  "thunderbird-flowed.eml": {
    exercises: "8bit UTF-8, format=flowed unwrapped, '-- ' signature separator kept",
    expected: {
      id: ID.thunderbird,
      from: alice,
      to: [bob],
      cc: [jana],
      replyTo: [],
      date: "2026-03-02T09:15:42.000Z",
      subject: "Oběd v pátek",
      text: lines(
        "Ahoj Bobe,",
        "",
        THUNDERBIRD_PARAGRAPH,
        "",
        "Jana už říkala, že by šla taky. Hodí se ti 12:30?",
        "",
        "Alice",
        "",
        "-- ",
        "Alice Dvořáková",
        "Example s.r.o.",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.thunderbird, inReplyTo: [], references: [] },
    },
  },

  "gmail-web-reply.eml": {
    exercises: "multipart/alternative, quoted-printable UTF-8 with soft breaks inside words, HTML alternative ignored",
    expected: {
      id: ID.gmailReply,
      from: bob,
      to: [alice],
      cc: [jana],
      replyTo: [],
      date: "2026-03-02T10:02:17.000Z",
      subject: "Re: Oběd v pátek",
      text: lines(
        "Ahoj Alice,",
        "",
        "v pátek můžu, 12:30 je super. Zarezervuju stůl pro tři.",
        "",
        "Bob",
        "",
        `On Mon, Mar 2, 2026 at 10:15${NNBSP}AM Alice Dvořáková <alice@example.com> wrote:`,
        "",
        "> Ahoj Bobe,",
        ">",
        "> " + THUNDERBIRD_PARAGRAPH,
        ">",
        "> Jana už říkala, že by šla taky. Hodí se ti 12:30?",
        ">",
        "> Alice",
        ">",
        "> --",
        "> Alice Dvořáková",
        "> Example s.r.o.",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.gmailReply, inReplyTo: [ID.thunderbird], references: [ID.thunderbird] },
    },
  },

  "ios-mail-reply.eml": {
    exercises: "quoted-printable with an emoji split by a soft line break, iOS U+FEFF before the quote",
    expected: {
      id: ID.ios,
      from: jana,
      to: [bob],
      cc: [alice],
      replyTo: [],
      date: "2026-03-02T10:20:05.000Z",
      subject: "Re: Oběd v pátek",
      text: lines(
        "Jasně, jdu taky! Stůl pro tři je super, přijdu 👍 Těším se.",
        "",
        "Odesláno z iPhonu",
        "",
        "> Dne 2. 3. 2026 v 11:02, Bob Svoboda <bob@example.org> napsal:",
        ">",
        "> ﻿Ahoj Alice,",
        ">",
        "> v pátek můžu, 12:30 je super. Zarezervuju stůl pro tři.",
        ">",
        "> Bob",
        ">",
        `>> On Mon, Mar 2, 2026 at 10:15${NNBSP}AM Alice Dvořáková <alice@example.com> wrote:`,
        ">>",
        ">> Ahoj Bobe,",
        ">>",
        ">> " + THUNDERBIRD_PARAGRAPH,
        ">>",
        ">> Jana už říkala, že by šla taky. Hodí se ti 12:30?",
        ">>",
        ">> Alice",
        ">>",
        ">> --",
        ">> Alice Dvořáková",
        ">> Example s.r.o.",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.ios, inReplyTo: [ID.gmailReply], references: [ID.thunderbird, ID.gmailReply] },
    },
  },

  "outlook-de-original.eml": {
    exercises: 'charset="iso-8859-1" quoted-printable, Outlook plain-text list layout',
    expected: {
      id: ID.outlookDe,
      from: anna,
      to: [lukas],
      cc: [],
      replyTo: [],
      date: "2026-03-03T08:47:12.000Z",
      subject: "Projektübersicht Q2",
      text: OUTLOOK_DE_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.outlookDe, inReplyTo: [], references: [] },
    },
  },

  "outlook-de-reply-in-reply-to-only.eml": {
    exercises: "trailing space kept from '=20', German quote header, In-Reply-To without References",
    expected: {
      id: ID.outlookDeReply,
      from: lukas,
      // Outlook wraps address-book names in single quotes; only the outer double quotes are syntax.
      to: [{ name: "'Anna Becker'", address: "Anna.Becker@example.net" }],
      cc: [],
      replyTo: [],
      date: "2026-03-03T09:31:40.000Z",
      subject: "AW: Projektübersicht Q2",
      text:
        lines(
          "Hallo Anna,",
          "",
          "danke, sieht gut aus. Zu Meilenstein 2 melde ich mich morgen noch mal.",
          "",
          "Gruß",
          "Lukas",
          "",
          "Von: Anna Becker <Anna.Becker@example.net> ",
          "Gesendet: Dienstag, 3. März 2026 09:47",
          "An: Lukas Weber <Lukas.Weber@example.net>",
          "Betreff: Projektübersicht Q2",
          "",
          "",
        ) + OUTLOOK_DE_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.outlookDeReply, inReplyTo: [ID.outlookDe], references: [] },
    },
  },

  "outlook-cs-1250.eml": {
    exercises: 'charset="windows-1250" quoted-printable (0x84/0x93 quotes, Č), Czech quote header',
    expected: {
      id: ID.cs,
      from: marie,
      to: [petr],
      cc: [],
      replyTo: [],
      date: "2026-03-04T08:12:33.000Z",
      subject: "Odp: Faktura za únor",
      text: lines(
        "Dobrý den, pane Nováku,",
        "",
        "děkuji za opravenou fakturu. Předala jsem ji účtárně, platba odejde nejpozději v pátek 6. 3.",
        "",
        "S pozdravem",
        "Marie Svobodová",
        "Účtárna | Example s.r.o.",
        "",
        "-----Původní zpráva-----",
        "Od: Petr Novák <petr.novak@example.org> ",
        "Odesláno: úterý 3. března 2026 16:05",
        "Komu: Marie Svobodová <marie.svobodova@example.com>",
        "Předmět: RE: Faktura za únor",
        "",
        "Dobrý den,",
        "",
        "v příloze posílám opravenou „fakturu“ za únor, doplnil jsem IČO. Prosím o potvrzení přijetí.",
        "",
        "Petr Novák",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.cs, inReplyTo: [ID.csParent], references: [ID.csRoot, ID.csMiddle, ID.csParent] },
    },
  },

  "apple-mail-fr-original.eml": {
    exercises: "Apple Mail quoted-printable UTF-8, soft break before a space, empty preamble",
    expected: {
      id: ID.appleFr,
      from: camille,
      to: [julien],
      cc: [amelie],
      replyTo: [],
      date: "2026-03-04T16:42:09.000Z",
      subject: "Réunion de lundi",
      text: APPLE_FR_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.appleFr, inReplyTo: [], references: [] },
    },
  },

  "outlook-fr-reply-no-thread-headers.eml": {
    exercises: "windows-1252 quoted-printable, French 'RE :' subject, no threading headers",
    expected: {
      id: ID.outlookFr,
      from: julien,
      to: [camille],
      cc: [amelie],
      replyTo: [],
      date: "2026-03-05T07:15:27.000Z",
      subject: "RE : Réunion de lundi",
      text:
        lines(
          "Bonjour Camille,",
          "",
          "14 h 30 me convient. J'apporterai les chiffres du trimestre.",
          "",
          "Bonne journée,",
          "Julien",
          "",
          "-----Message d'origine-----",
          "De : Camille Lefèvre [mailto:camille@example.org] ",
          "Envoyé : mercredi 4 mars 2026 17:42",
          "À : Julien Moreau",
          "Cc : Amélie Rousseau",
          "Objet : Réunion de lundi",
          "",
          "",
        ) + APPLE_FR_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.outlookFr, inReplyTo: [], references: [] },
    },
  },

  "apple-mail-fr-forward.eml": {
    exercises: "Apple Mail forward ('Fwd:' is not localised by Apple Mail) with the French forward header",
    expected: {
      id: ID.appleFrForward,
      from: camille,
      to: [{ name: "Sophie Girard", address: "sophie@example.net" }],
      cc: [],
      replyTo: [],
      date: "2026-03-05T08:03:51.000Z",
      subject: "Fwd: Réunion de lundi",
      text:
        lines(
          "Bonjour Sophie,",
          "",
          "Je te transfère l’invitation, au cas où tu voudrais te joindre à nous lundi.",
          "",
          "Camille",
          "",
          "Début du message réexpédié :",
          "",
          "De: Camille Lefèvre <camille@example.org>",
          "Objet: Réunion de lundi",
          "Date: 4 mars 2026 à 17:42:09 UTC+1",
          "À: Julien Moreau <julien@example.org>",
          "Cc: Amélie Rousseau <amelie@example.org>",
          "",
          "",
        ) + APPLE_FR_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.appleFrForward, inReplyTo: [], references: [] },
    },
  },

  "outlook-fr-forward.eml": {
    exercises: "French 'TR :' forward, Exchange quoted-printable UTF-8",
    expected: {
      id: ID.outlookFrForward,
      from: amelie,
      to: [{ name: "Hugo Petit", address: "hugo@example.com" }],
      cc: [],
      replyTo: [],
      date: "2026-03-05T09:20:44.000Z",
      subject: "TR : Réunion de lundi",
      text:
        lines(
          "Bonjour Hugo,",
          "",
          "Pour info, voir ci-dessous.",
          "",
          "Amélie",
          "",
          "De : Camille Lefèvre <camille@example.org> ",
          "Envoyé : mercredi 4 mars 2026 17:42",
          "À : Julien Moreau <julien@example.org>",
          "Cc : Amélie Rousseau <amelie@example.org>",
          "Objet : Réunion de lundi",
          "",
          "",
        ) + APPLE_FR_TEXT,
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.outlookFrForward, inReplyTo: [], references: [] },
    },
  },

  "apple-mail-inline-image.eml": {
    exercises: "two text/plain parts around an inline image are joined with one line break",
    expected: {
      id: ID.appleImage,
      from: daniel,
      to: [{ name: "Emma Clarke", address: "emma@example.net" }],
      cc: [],
      replyTo: [],
      date: "2026-03-07T19:05:31.000Z",
      subject: "Photo from Saturday",
      // Part 1 ends without a line break, so one "\n" is inserted before part 3 ("\nWorth…").
      text: lines("Hi Emma,", "", "here is the view from the top:", "", "Worth the climb. See you on Monday.", "", "Daniel"),
      textSource: "plain",
      es: null,
      attachments: [
        {
          filename: "IMG_0412.jpeg",
          contentType: "image/jpeg",
          disposition: "inline",
          size: 159,
          contentId: "<5A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D>",
          partId: "2",
        },
      ],
      refs: { messageId: ID.appleImage, inReplyTo: [], references: [] },
    },
  },

  "gmail-web-attachment.eml": {
    exercises: "nested multipart/mixed > multipart/alternative, RFC 2047 filename inside quotes",
    expected: {
      id: ID.gmailAttachment,
      from: bob,
      to: [alice],
      cc: [],
      replyTo: [],
      date: "2026-03-10T13:22:03.000Z",
      subject: "Návrh smlouvy",
      text: lines(
        "Ahoj Alice,",
        "",
        "v příloze posílám návrh smlouvy. Podívej se prosím hlavně na článek 4 (termíny plnění).",
        "",
        "Díky,",
        "Bob",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [
        {
          filename: "Návrh smlouvy 2026.pdf",
          contentType: "application/pdf",
          disposition: "attachment",
          size: 607,
          contentId: "<f_mm4k2x1a0>",
          partId: "2",
        },
      ],
      refs: { messageId: ID.gmailAttachment, inReplyTo: [], references: [] },
    },
  },

  "thunderbird-attachment-rfc2231.eml": {
    exercises: "RFC 2231 filename continuations, flowed text with a space-stuffed 'From ' line",
    expected: {
      id: ID.thunderbirdAttachment,
      from: alice,
      to: [daniel],
      cc: [],
      replyTo: [],
      date: "2026-03-10T15:40:18.000Z",
      subject: "Spring budget overview",
      text: lines(
        "Hi Daniel,",
        "",
        "attached is the spring budget overview (the file name is in Czech, sorry about that).",
        "From Monday on, please send new expenses to the finance team directly.",
        "",
        "Thanks,",
        "Alice",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [
        {
          filename: "Rozpočet na jaro 2026 – přehled výdajů.ods",
          contentType: "application/vnd.oasis.opendocument.spreadsheet",
          disposition: "attachment",
          size: 1478,
          contentId: null,
          partId: "2",
        },
      ],
      refs: { messageId: ID.thunderbirdAttachment, inReplyTo: [], references: [] },
    },
  },

  "mutt-iso-8859-2.eml": {
    exercises: "raw 8-bit iso-8859-2 body (š = 0xB9), mutt quoting with '> ' empty lines",
    expected: {
      id: ID.mutt,
      from: ondrej,
      to: [karel],
      cc: [],
      replyTo: [],
      date: "2026-03-02T09:30:00.000Z",
      subject: "Re: Zálohování serveru",
      text: lines(
        "On Sun, Mar 01, 2026 at 06:45:12PM +0100, Karel Holub wrote:",
        "> Ahoj Ondřeji,",
        "> ",
        "> zálohy na novém serveru běží, ale rotace starých snapshotů zatím",
        "> nefunguje. Můžeš se na to podívat?",
        "",
        "Ahoj Karle,",
        "",
        "podívám se na to dnes odpoledne. Nejspíš je špatně nastavená cesta",
        "v cronu, skript hledá snapshoty ve starém adresáři.",
        "",
        "Díky za upozornění,",
        "Ondřej",
        "",
        "-- ",
        "Ondřej Beneš",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.mutt, inReplyTo: [ID.muttParent], references: [ID.muttParent] },
    },
  },

  "mutt-attachment-patch.eml": {
    exercises: "inline text/plain body, text/x-diff with a filename stays an attachment",
    expected: {
      id: ID.muttPatch,
      from: ondrej,
      to: [karel],
      cc: [],
      replyTo: [],
      date: "2026-03-11T21:14:05.000Z",
      subject: "Patch for the snapshot rotation",
      text: lines(
        "Hi Karel,",
        "",
        "the attached patch fixes the rotation: the script compared the snapshot",
        'age with ">" instead of ">=", so the oldest snapshot was never removed.',
        "",
        "Tested on the staging box, three rotations in a row.",
        "",
        "Ondrej",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [
        {
          filename: "0001-rotate-remove-oldest-snapshot.patch",
          contentType: "text/x-diff",
          disposition: "attachment",
          size: 636,
          contentId: null,
          partId: "2",
        },
      ],
      refs: { messageId: ID.muttPatch, inReplyTo: [], references: [] },
    },
  },

  "seznam-webmail.eml": {
    exercises: "base64 UTF-8 text/plain, lowercase ?q? subject, 'Re: Odp:' chain, date with a (CET) comment",
    expected: {
      id: ID.seznam,
      from: { name: "Tomáš Král", address: "tomas.kral@example.net" },
      to: [marie],
      cc: [],
      replyTo: [],
      date: "2026-03-11T19:14:37.000Z",
      subject: "Re: Odp: Vyúčtování za březen",
      text: lines(
        "Dobrý den,",
        "",
        "posílám opravené vyúčtování za březen, chybějící položku jsem doplnil.",
        "",
        "S pozdravem",
        "Tomáš Král",
        "",
        "---------- Původní e-mail ----------",
        "Od: Marie Svobodová <marie.svobodova@example.com>",
        "Komu: Tomáš Král <tomas.kral@example.net>",
        "Datum: 10. 3. 2026 15:22:47",
        "Předmět: Odp: Vyúčtování za březen",
        '"Dobrý den,',
        "",
        "ve vyúčtování za březen chybí položka za dopravu. Můžete ho prosím poslat",
        "znovu?",
        "",
        "Děkuji",
        'Marie Svobodová"',
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.seznam, inReplyTo: [ID.seznamParent], references: [ID.seznamRoot, ID.seznamParent] },
    },
  },

  "html-only-newsletter.eml": {
    exercises: "text/html only (base64): head/style/comment dropped, entities, lists, whitespace collapsed",
    expected: {
      id: ID.newsletter,
      from: { name: "Example Garden Club", address: "news@news.example.org" },
      to: [{ name: "", address: "alice@example.com" }],
      cc: [],
      replyTo: [],
      date: "2026-03-12T06:00:00.000Z",
      subject: "March news from the garden club",
      text: lines(
        "March news",
        "",
        "Hello gardeners,",
        "spring is almost here & the seed swap is back.",
        "",
        "- Seed swap: Saturday 14 March, 10:00 – 12:00",
        "- Pruning workshop: Sunday 22 March",
        "",
        "See you there!",
        "",
        "You receive this because you joined the Example Garden Club.",
        "Unsubscribe: https://news.example.org/u/abc123",
      ),
      textSource: "html",
      es: null,
      attachments: [],
      refs: { messageId: ID.newsletter, inReplyTo: [], references: [] },
    },
  },

  "mailing-list-footer.eml": {
    exercises: "Mailman wrapped a multipart/alternative and its footer part in multipart/mixed; the footer is appended",
    expected: {
      id: ID.list,
      from: { name: "Martin Horák", address: "martin.horak@example.net" },
      to: [{ name: "", address: "dev-list@lists.example.org" }],
      cc: [],
      replyTo: [],
      date: "2026-03-13T10:48:22.000Z",
      subject: "[dev-list] Re: Release plan",
      text: lines(
        "Sounds good to me. One note: the Czech translation update needs about a week, so could we keep the string freeze on 18 March?",
        "",
        "Martin Horák",
        "",
        "> On 12. 3. 2026, at 16:20, Karel Holub <karel@example.org> wrote:",
        "> ",
        "> Proposed schedule:",
        "> - feature freeze on 20 March",
        "> - release candidate on 27 March",
        "> - final release on 3 April",
        "> ",
        "> Objections?",
        "_______________________________________________",
        "dev-list mailing list",
        "dev-list@lists.example.org",
        "https://lists.example.org/mailman/listinfo/dev-list",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.list, inReplyTo: [ID.listParent], references: [ID.listParent] },
    },
  },

  "mbox-lf-obsolete-date.eml": {
    exercises: "LF line endings, mbox 'From ' line, 2-digit year and EST zone, no Message-ID",
    expected: {
      id: "sha256:" + MBOX_SHA256,
      from: { name: "Old Timer", address: "sender@example.org" },
      to: [{ name: "", address: "alice@example.com" }],
      cc: [],
      replyTo: [],
      date: "2026-03-02T14:30:00.000Z",
      subject: "Minutes of the March meeting",
      text: lines(
        "Hi all,",
        "",
        "the minutes of the March meeting are below.",
        "",
        ">From the treasurer: the budget is unchanged.",
        "",
        "Regards,",
        "OT",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: null, inReplyTo: [], references: [] },
    },
  },

  "es-draft-layout.eml": {
    exercises: "the spec 4.1 layout: ES part (draft media type) inside multipart/alternative",
    expected: {
      id: ID.esDraft,
      from: { name: "", address: "user@example.com" },
      to: [{ name: "", address: "recipient@example.org" }],
      cc: [],
      replyTo: [],
      date: "2024-10-10T12:00:00.000Z",
      subject: "Hello Email.Social!",
      text: lines("Hello Email.Social!", "", "This is a test message.", ""),
      textSource: "plain",
      es: {
        $type: "es.social.post",
        author: "did:es:mail.example.com:abc123",
        text: "Hello Email.Social!\n\nThis is a test message.",
        via: "user@example.com",
        createdAt: "2024-10-10T12:00:00.000Z",
        email: { messageId: ID.esDraft, subject: "Hello Email.Social!", inReplyTo: null, references: [] },
        requestReceipts: [],
      },
      attachments: [],
      refs: { messageId: ID.esDraft, inReplyTo: [], references: [] },
    },
  },

  "gmail-forward-carrying-es-part.eml": {
    exercises: "an ES part re-attached by a forward is rejected (via and messageId differ) and listed as attachment",
    expected: {
      id: ID.gmailForward,
      from: bob,
      to: [{ name: "Eva Horáková", address: "eva@example.net" }],
      cc: [],
      replyTo: [],
      date: "2026-03-14T08:41:12.000Z",
      subject: "Fwd: Kdy dorazíš?",
      text: lines(
        "Evo, tohle mi poslala Alice, ať víš, kdy vyrážíme.",
        "",
        "---------- Forwarded message ---------",
        "From: Alice Dvořáková <alice@example.com>",
        `Date: Fri, Mar 13, 2026 at 6:05${NNBSP}PM`,
        "Subject: Kdy dorazíš?",
        "To: Bob Svoboda <bob@example.org>",
        "",
        "",
        "Ahoj Bobe, kdy dorazíš v sobotu? Stačí odpovědět, jestli to stihneš do 10:00.",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [
        {
          filename: "email-social.json",
          contentType: "application/vnd.email-social.message+json",
          disposition: "attachment",
          size: 385,
          contentId: "<f_mm7q3b2c0>",
          partId: "2",
        },
      ],
      refs: { messageId: ID.gmailForward, inReplyTo: [ID.esOriginal], references: [ID.esOriginal] },
    },
  },

  "undisclosed-recipients.eml": {
    exercises: "empty group 'undisclosed-recipients:;', two Reply-To entries, subject split inside a UTF-8 character",
    expected: {
      id: ID.undisclosed,
      from: { name: "Kancelář Example", address: "office@example.com" },
      to: [],
      cc: [],
      replyTo: [
        { name: "Kancelář Example", address: "office@example.com" },
        { name: "", address: "helpdesk@example.com" },
      ],
      date: "2026-03-16T06:30:00.000Z",
      subject: "Plánovaná odstávka e-mailu v sobotu 21. března",
      text: lines(
        "Dobrý den,",
        "",
        "v sobotu 21. března od 8:00 do 12:00 proběhne údržba poštovního serveru. V této době nebude možné odesílat ani přijímat e-maily.",
        "",
        "Dotazy prosím posílejte na helpdesk@example.com.",
        "",
        "Kancelář Example",
        "",
      ),
      textSource: "plain",
      es: null,
      attachments: [],
      refs: { messageId: ID.undisclosed, inReplyTo: [], references: [] },
    },
  },
};

// ---------------------------------------------------------------- helpers

const parsedCache = new Map<string, EsMessage>();
function parsed(name: string): EsMessage {
  const cached = parsedCache.get(name);
  if (cached !== undefined) return cached;
  const message: EsMessage = parseMessage(readFixture(name));
  parsedCache.set(name, message);
  return message;
}

const latin1 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};

const isUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- the corpus itself

describe("fixture corpus", () => {
  it("has at least 16 fixtures and a hand-written expectation for each of them", () => {
    expect(listFixtures().length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(CASES).sort()).toEqual(listFixtures());
  });

  it("uses only example.com, example.org and example.net domains (also in Message-IDs, URLs and Received)", () => {
    const hostname = /\b((?:[a-z0-9-]+\.)+(?:com|net|org|cz|de|fr|uk|io|eu|info|biz|gov|edu|co|us|me))\b/gi;
    const mailDomain = /@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
    const allowed = /(?:^|\.)example\.(?:com|net|org)$/i;
    for (const name of listFixtures()) {
      // Quoted-printable soft line breaks may split a domain; join them before looking.
      const text = latin1(readFixture(name)).replace(/=\r?\n/g, "");
      for (const m of text.matchAll(hostname)) expect(m[1], `${name}: ${m[1]}`).toMatch(allowed);
      for (const m of text.matchAll(mailDomain)) expect(m[1], `${name}: ${m[1]}`).toMatch(allowed);
    }
  });

  it("uses only documentation IPv4 ranges (RFC 5737) in Received fields", () => {
    const quad = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
    for (const name of listFixtures()) {
      for (const m of latin1(readFixture(name)).matchAll(quad)) {
        const octets = m.slice(1, 5).map(Number);
        if (octets.some((o) => o > 255)) continue; // a version number such as 2.3774.600.62
        expect(m[0], name).toMatch(/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/);
      }
    }
  });

  it("keeps wire line endings: CRLF everywhere except the deliberate LF (mbox) fixture", () => {
    for (const name of listFixtures()) {
      const text = latin1(readFixture(name));
      const lf = (text.match(/\n/g) ?? []).length;
      const crlf = (text.match(/\r\n/g) ?? []).length;
      const cr = (text.match(/\r/g) ?? []).length;
      if (name === "mbox-lf-obsolete-date.eml") {
        expect(cr, name).toBe(0);
      } else {
        expect(crlf, name).toBe(lf);
        expect(cr, name).toBe(lf);
      }
      expect(text.endsWith("\n"), name).toBe(true);
    }
  });

  it("keeps every line within the RFC 5322 §2.1.1 limit of 998 characters", () => {
    for (const name of listFixtures()) {
      for (const line of latin1(readFixture(name)).split(/\r?\n/)) expect(line.length, name).toBeLessThanOrEqual(998);
    }
  });

  it("is read as plain Uint8Array, not as a Node Buffer", () => {
    const bytes = readFixture(listFixtures()[0]!);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(bytes)).toBe(false);
  });
});

// ---------------------------------------------------------------- parsing

describe("parseMessage on the fixture corpus", () => {
  it.each(listFixtures())("parses %s without throwing", (name) => {
    expect(() => parseMessage(readFixture(name))).not.toThrow();
  });

  it("gives the same result for a UTF-8 string as for its bytes", () => {
    for (const name of listFixtures()) {
      const bytes = readFixture(name);
      if (!isUtf8(bytes)) continue; // a string cannot carry raw 8-bit iso-8859-2 or windows-1250 bytes
      expect(parseMessage(new TextDecoder().decode(bytes)), name).toEqual(parsed(name));
    }
  });
});

describe.each(Object.entries(CASES))("%s", (name, { exercises, expected }) => {
  it("addresses: from, to, cc, reply-to", () => {
    const m = parsed(name);
    expect({ from: m.from, to: m.to, cc: m.cc, replyTo: m.replyTo }).toEqual({
      from: expected.from,
      to: expected.to,
      cc: expected.cc,
      replyTo: expected.replyTo,
    });
  });

  it("date (UTC) and decoded subject", () => {
    const m = parsed(name);
    expect({ date: m.date, subject: m.subject }).toEqual({ date: expected.date, subject: expected.subject });
  });

  it("id and threading references", () => {
    const m = parsed(name);
    expect({ id: m.id, refs: m.refs }).toEqual({ id: expected.id, refs: expected.refs });
  });

  it(`text: ${exercises}`, () => {
    const m = parsed(name);
    expect(m.textSource).toBe(expected.textSource);
    expect(m.text).toBe(expected.text);
  });

  it("attachments and ES part", () => {
    const m = parsed(name);
    expect(m.attachments).toEqual(expected.attachments);
    expect(m.es).toEqual(expected.es);
  });
});

// ---------------------------------------------------------------- behaviours, named

describe("real-world details", () => {
  it("decodes an emoji whose UTF-8 bytes are split by a quoted-printable soft line break (iOS)", () => {
    const raw = latin1(readFixture("ios-mail-reply.eml"));
    expect(raw).toContain("=F0=9F=\r\n=91=8D"); // the fixture really splits the sequence
    expect(parsed("ios-mail-reply.eml").text.split("\n")[0]).toBe("Jasně, jdu taky! Stůl pro tři je super, přijdu 👍 Těším se.");
  });

  it("keeps the U+FEFF that iOS Mail puts in front of quoted text", () => {
    expect(parsed("ios-mail-reply.eml").text).toContain("> ﻿Ahoj Alice,\n");
  });

  it("does not join the '-- ' signature separator of a format=flowed message with the next line", () => {
    const text = parsed("thunderbird-flowed.eml").text;
    expect(text).toContain("\n-- \nAlice Dvořáková\n");
    expect(text).toContain(THUNDERBIRD_PARAGRAPH + "\n");
  });

  it("removes flowed space-stuffing from a line that starts with 'From ' (RFC 3676 §4.4)", () => {
    const raw = latin1(readFixture("thunderbird-attachment-rfc2231.eml"));
    expect(raw).toContain("\r\n From Monday on,");
    expect(parsed("thunderbird-attachment-rfc2231.eml").text).toContain("\nFrom Monday on,");
  });

  it("decodes single-byte charsets by their label: windows-1250 0x84/0x93 quotes, iso-8859-2 0xB9 'š'", () => {
    expect(parsed("outlook-cs-1250.eml").text).toContain("„fakturu“");
    expect(parsed("mutt-iso-8859-2.eml").text).toContain("Nejspíš je špatně nastavená cesta");
  });

  it("lowercases only the domain of an address written as Anna.Becker@Example.NET", () => {
    expect(parsed("outlook-de-reply-in-reply-to-only.eml").to[0]!.address).toBe("Anna.Becker@example.net");
  });

  it("takes the display name from a trailing comment when there is no phrase (sender@example.org (Old Timer))", () => {
    expect(parsed("mbox-lf-obsolete-date.eml").from).toEqual({ name: "Old Timer", address: "sender@example.org" });
  });

  it("derives the id of a message without Message-ID from SHA-256 of its raw bytes", () => {
    const bytes = readFixture("mbox-lf-obsolete-date.eml");
    const hex = createHash("sha256").update(bytes).digest("hex");
    expect(hex).toBe(MBOX_SHA256);
    expect(parsed("mbox-lf-obsolete-date.eml").id).toBe("sha256:" + hex);
  });

  it("decodes a subject whose UTF-8 character is split across two encoded-words", () => {
    const raw = latin1(readFixture("undisclosed-recipients.eml"));
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[^?]+\?=\r\n =\?UTF-8\?B\?[^?]+\?=/);
    expect(parsed("undisclosed-recipients.eml").subject).toBe("Plánovaná odstávka e-mailu v sobotu 21. března");
  });

  it("keeps the plain text first and never shows a diff attachment as text", () => {
    const m = parsed("mutt-attachment-patch.eml");
    expect(m.text).not.toContain("diff --git");
    expect(m.attachments.map((a) => a.filename)).toEqual(["0001-rotate-remove-oldest-snapshot.patch"]);
  });

  it("accepts the ES part of the spec 4.1 example and does not list it as an attachment", () => {
    const m = parsed("es-draft-layout.eml");
    expect(m.es?.$type).toBe("es.social.post");
    expect(m.attachments).toEqual([]);
  });

  it("rejects an ES part that a forward carried along: its via is not the From address", () => {
    const m = parsed("gmail-forward-carrying-es-part.eml");
    expect(m.from?.address).toBe("bob@example.org");
    expect(m.es).toBeNull();
    expect(m.attachments.map((a) => a.contentType)).toEqual(["application/vnd.email-social.message+json"]);
  });

  it("uses HTML only when a message has no text/plain part", () => {
    const html = CASES["html-only-newsletter.eml"]!.expected;
    for (const [name, { expected }] of Object.entries(CASES)) {
      if (expected !== html) expect(parsed(name).textSource, name).toBe("plain");
    }
    expect(parsed("html-only-newsletter.eml").textSource).toBe("html");
  });
});
