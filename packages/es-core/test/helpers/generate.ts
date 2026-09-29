/**
 * Seeded generator of outgoing messages for the round-trip and mailparser
 * compatibility tests. The same seed always gives the same cases.
 */
import type { EsAddress, EsOutgoing, ReceiptKind, SerializeOptions } from "../../src/types.js";
import { mulberry32, pick, randomInt } from "./prng.js";

/** The seed of the 20 generated cases (any change must be deliberate). */
export const ROUND_TRIP_SEED = 20260928;

const NAMES = [
  "",
  "Alice Example",
  "Jana Nováková",
  "Jürgen Groß",
  "Élodie Lefèvre",
  'Bob "the Builder" Smith',
  "Smith, John",
  "Ředitel (ÚŘAD) Bureš",
  "🌻 Květa",
  "O'Brien",
  "=?utf-8?q?looks-encoded?=",
  "Zoë @ home",
];

const LOCALS = ["alice", "bob.smith", "Jana.Novakova", "j+tag", "info", "o_brien", "Q.User", "x-y"];
const DOMAINS = ["example.com", "Example.ORG", "mail.example.net", "EXAMPLE.net", "lists.example.org"];

const LINES = [
  "Ahoj, jak se máš?",
  "Příliš žluťoučký kůň úpěl ďábelské ódy.",
  "Grüße aus München — bis Montag.",
  "Réunion à 10 h, salle « Lumière ».",
  "From here on, everything is plain.",
  ".",
  ". a line that starts with a dot",
  "trailing spaces   ",
  "a tab\tinside and at the end\t",
  "",
  "> quoted line from the previous message",
  "-- ",
  "=?utf-8?q?this_is_not_an_encoded_word?=",
  "--=_es_0000 a line that looks like a boundary",
  "emoji 👋🏽 and 👨‍👩‍👧 family",
  "https://www.example.com/path?query=1&x=2",
  "Mixed script: Ελληνικά, кириллица, 中文.",
];

const SUBJECTS = [
  "",
  "Lunch",
  "Oběd v pátek",
  "Re: Projektübersicht Q2",
  "  spaces   around  ",
  "A very long subject line that keeps going well past the seventy-eight character folding limit of headers",
  "Emoji 🎉 party",
  "=?utf-8?q?literal?= text",
  "Réunion : ordre du jour",
];

function address(random: () => number): EsAddress {
  return { name: pick(random, NAMES), address: pick(random, LOCALS) + "@" + pick(random, DOMAINS) };
}

function text(random: () => number): string {
  const lines: string[] = [];
  const count = randomInt(random, 0, 12);
  for (let i = 0; i < count; i++) {
    const roll = random();
    if (roll < 0.08) lines.push("long ".repeat(randomInt(random, 150, 260)).trim()); // > 998 characters
    else lines.push(pick(random, LINES));
  }
  const newline = random() < 0.3 ? "\r\n" : "\n";
  return lines.join(newline) + (random() < 0.5 ? newline : "");
}

export interface GeneratedCase {
  out: EsOutgoing;
  options: SerializeOptions;
}

/** `count` outgoing messages from `seed`. */
export function generateCases(seed: number, count: number): GeneratedCase[] {
  const random = mulberry32(seed);
  const cases: GeneratedCase[] = [];
  for (let i = 0; i < count; i++) {
    const to = Array.from({ length: randomInt(random, 1, 4) }, () => address(random));
    const cc = Array.from({ length: randomInt(random, 0, 3) }, () => address(random));
    const out: EsOutgoing = { from: address(random), to, text: text(random) };
    if (cc.length > 0) out.cc = cc;
    if (random() < 0.7) out.subject = pick(random, SUBJECTS);
    if (random() < 0.5) {
      out.inReplyTo = {
        messageId: `<parent-${i}@mail.example.com>`,
        references: random() < 0.5 ? [`<root-${i}@mail.example.com>`] : [],
        subject: pick(random, SUBJECTS),
      };
    }
    const receipts: ReceiptKind[][] = [[], ["read"], ["delivered"], ["delivered", "read"], ["read", "delivered", "read"]];
    const requestReceipts = pick(random, receipts);
    if (requestReceipts.length > 0 || random() < 0.3) {
      out.es = { requestReceipts };
      if (random() < 0.5) out.es.author = "did:es:example.com:" + i.toString(16).padStart(32, "0");
    }
    const minute = randomInt(random, 0, 59);
    const options: SerializeOptions = {
      date: `2026-03-${String(randomInt(random, 1, 28)).padStart(2, "0")}T${String(randomInt(random, 0, 23)).padStart(2, "0")}:${String(minute).padStart(2, "0")}:07${random() < 0.5 ? ".456" : ""}Z`,
      messageId: `<gen-${seed}-${i}@mail.example.com>`,
    };
    cases.push({ out, options });
  }
  return cases;
}

/** Collapses whitespace runs to one space and trims (what headers keep of a name or subject). */
export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The subject a serialised message ends up with (RFC 5322 §3.6.5 "Re: " default). */
export function expectedSubject(out: EsOutgoing): string {
  if (out.subject !== undefined) return collapse(out.subject);
  const parent = out.inReplyTo?.subject;
  if (parent === undefined) return "";
  const base = collapse(parent);
  return /^re:/i.test(base) ? base : collapse("Re: " + base);
}

/** The text a serialised message carries: line endings normalised to "\n". */
export function expectedText(out: EsOutgoing): string {
  return out.text.replace(/\r\n?/g, "\n");
}

/** The address as the parser returns it: display name collapsed, domain lowercased. */
export function expectedAddress(a: EsAddress): EsAddress {
  const at = a.address.lastIndexOf("@");
  return { name: collapse(a.name), address: a.address.slice(0, at) + "@" + a.address.slice(at + 1).toLowerCase() };
}
