/**
 * Base subject for threading: the subject with reply/forward prefixes, list
 * tags and forward wrappers removed. Follows the "base subject" of RFC 5256
 * §2.1, extended with the prefixes localised mail clients write instead of
 * "Re:" and "Fwd:" (e.g. Outlook: "AW:"/"WG:" in German, "Odp:"/"PŘ:" in
 * Czech, "RE :"/"TR :" with a space before the colon in French).
 */

/** Result of `normalizeSubject`. */
export interface NormalizedSubject {
  /** The subject without prefixes, tags and wrappers; original casing, NFC. */
  base: string;
  /** A reply prefix ("Re:", "AW:", "Odp:", ...) was removed. */
  isReply: boolean;
  /** A forward prefix ("Fwd:", "WG:", "PŘ:", ...), "[Fwd: ...]" or "(fwd)" was removed. */
  isForward: boolean;
}

// Tokens are matched case-insensitively. Single-letter tokens (Italian "R:"
// and "I:", Hungarian "V:") are left out: they collide with ordinary subjects.
const REPLY_TOKENS = [
  "re", // English and most localisations
  "aw", // German (Antwort)
  "antw", // German, Dutch (Antwoord)
  "odp", // Czech, Polish (Odpověď, Odpowiedź)
  "odpověď", // Czech
  "sv", // Swedish, Danish, Norwegian, Icelandic (Svar)
  "rif", // Italian (Riferimento)
  "res", // Portuguese (Resposta)
  "réf", // French (Référence)
  "rép", // French (Réponse)
  "ynt", // Turkish (Yanıt)
  "atb", // Welsh (Ateb)
  "回复", // Chinese, simplified
  "答复", // Chinese, simplified
  "回覆", // Chinese, traditional
];

const FORWARD_TOKENS = [
  "fw", // English (Outlook)
  "fwd", // English
  "wg", // German (Weitergeleitet)
  "tr", // French (Transféré)
  "př", // Czech (Přeposlat)
  "přep", // Czech
  "přeposláno", // Czech
  "rv", // Spanish (Reenviado)
  "vs", // Danish, Norwegian (Videresendt)
  "vb", // Swedish (Vidarebefordrat)
  "enc", // Portuguese (Encaminhado)
  "doorst", // Dutch (Doorsturen)
  "fs", // Icelandic (Framsent)
  "转发", // Chinese, simplified
  "轉寄", // Chinese, traditional
];

const REPLY_SET = new Set(REPLY_TOKENS.map((token) => token.normalize("NFC")));

const TOKEN_ALTERNATION = [...REPLY_TOKENS, ...FORWARD_TOKENS]
  .map((token) => token.normalize("NFC"))
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Token, optional counter ("[2]", "(2)", "^2"), optional "." ("Réf."), optional space, ":" or full-width "：". */
const PREFIX = new RegExp(`^(${TOKEN_ALTERNATION})(?:\\[\\d+\\]|\\(\\d+\\)|\\^\\d+)?\\.?\\s*[:\\uff1a]\\s*`, "iu");

/** Any run of whitespace, including tabs, line breaks, NBSP (U+00A0) and narrow NBSP (U+202F). */
const WHITESPACE = /[\s  ]+/gu;

/** RFC 5256 §2.1 subj-trailer "(fwd)" (Pine and Alpine append it when forwarding). */
const FWD_TRAILER = /\s*\(fwd\)$/iu;

/** RFC 5256 §2.1 step 6: "[fwd:" ... "]" around the whole subject (older Netscape/Thunderbird forwards). */
const FWD_WRAPPER = /^\[fwd:(.*)\]$/iu;

/** RFC 5256 §2.1 subj-blob: a leading "[...]" such as a mailing-list tag. */
const BLOB = /^\[[^[\]]*\]\s*/u;

/**
 * Removes reply/forward prefixes (with counters such as "Re[2]:"), leading
 * list tags ("[dev-list]") and forward wrappers, repeating until nothing
 * changes. A list tag is kept when nothing would be left after it.
 */
export function normalizeSubject(subject: string): NormalizedSubject {
  let text = subject.normalize("NFC");
  let isReply = false;
  let isForward = false;
  for (;;) {
    const before = text;
    text = text.replace(WHITESPACE, " ").trim();

    while (FWD_TRAILER.test(text)) {
      text = text.replace(FWD_TRAILER, "");
      isForward = true;
    }

    const wrapped = FWD_WRAPPER.exec(text);
    if (wrapped) {
      text = wrapped[1]!;
      isForward = true;
      continue;
    }

    const blob = BLOB.exec(text);
    if (blob && blob[0].length < text.length) {
      text = text.slice(blob[0].length);
      continue;
    }

    const prefix = PREFIX.exec(text);
    if (prefix) {
      if (REPLY_SET.has(prefix[1]!.toLowerCase())) isReply = true;
      else isForward = true;
      text = text.slice(prefix[0].length);
      continue;
    }

    if (text === before) break;
  }
  return { base: text, isReply, isForward };
}

/** Key used to compare base subjects: NFC, lowercased. */
export function subjectKey(base: string): string {
  return base.normalize("NFC").toLowerCase();
}
