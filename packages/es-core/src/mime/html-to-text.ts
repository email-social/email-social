/**
 * Reduces HTML to plain text for display. Nothing is rendered or fetched:
 * tags are dropped, a few of them become line breaks, character references
 * are decoded. Used only for messages that have no text/plain body.
 */

/** Elements whose start and end begin a new line. */
const LINE_BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "caption", "center", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "header", "hr", "li", "main", "nav", "ol", "pre",
  "section", "summary", "tbody", "tfoot", "thead", "tr", "ul",
]);

/** Elements separated from their surroundings by a blank line. */
const PARAGRAPH_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "table"]);

/** Elements whose content is never shown. */
const HIDDEN_CONTENT = new Set(["script", "style", "title", "template"]);

/** Table cells: separated by a space. */
const CELLS = new Set(["td", "th"]);

/** Named character references (a common subset of the HTML list). */
const NAMED = new Map<string, string>(
  Object.entries({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ",
    thinsp: " ", zwnj: "‌", zwj: "‍", lrm: "‎", rlm: "‏", shy: "­",
    ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”",
    bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·", copy: "©",
    reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", deg: "°",
    plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾", iexcl: "¡",
    iquest: "¿", dagger: "†", Dagger: "‡", permil: "‰", prime: "′", larr: "←", rarr: "→", uarr: "↑",
    darr: "↓", harr: "↔", aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í",
    Iacute: "Í", oacute: "ó", Oacute: "Ó", uacute: "ú", Uacute: "Ú", yacute: "ý", Yacute: "Ý",
    agrave: "à", Agrave: "À", egrave: "è", Egrave: "È", igrave: "ì", Igrave: "Ì", ograve: "ò",
    Ograve: "Ò", ugrave: "ù", Ugrave: "Ù", acirc: "â", Acirc: "Â", ecirc: "ê", Ecirc: "Ê", icirc: "î",
    Icirc: "Î", ocirc: "ô", Ocirc: "Ô", ucirc: "û", Ucirc: "Û", auml: "ä", Auml: "Ä", euml: "ë",
    Euml: "Ë", iuml: "ï", Iuml: "Ï", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", yuml: "ÿ", Yuml: "Ÿ",
    atilde: "ã", Atilde: "Ã", ntilde: "ñ", Ntilde: "Ñ", otilde: "õ", Otilde: "Õ", aring: "å",
    Aring: "Å", aelig: "æ", AElig: "Æ", oelig: "œ", OElig: "Œ", oslash: "ø", Oslash: "Ø", ccedil: "ç",
    Ccedil: "Ç", szlig: "ß", eth: "ð", ETH: "Ð", thorn: "þ", THORN: "Þ", scaron: "š", Scaron: "Š",
    ccaron: "č", Ccaron: "Č", rcaron: "ř", Rcaron: "Ř", zcaron: "ž", Zcaron: "Ž", ecaron: "ě",
    Ecaron: "Ě", dcaron: "ď", Dcaron: "Ď", tcaron: "ť", Tcaron: "Ť", ncaron: "ň", Ncaron: "Ň",
    lcaron: "ľ", Lcaron: "Ľ", uring: "ů", Uring: "Ů",
  }),
);

/** References that browsers also accept without the final ";" (a subset of the legacy list). */
const LEGACY = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"]);

const windows1252 = new TextDecoder("windows-1252");

const REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]+))(;?)/g;

function numericReference(digits: string, radix: number): string {
  const code = digits.length > 8 ? Infinity : parseInt(digits, radix);
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
  // HTML: references in the C1 range mean the windows-1252 character with that byte.
  if (code >= 0x80 && code <= 0x9f) return windows1252.decode(Uint8Array.of(code));
  return String.fromCodePoint(code);
}

function decodeReferences(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (match, dec?: string, hex?: string, name?: string, semicolon?: string) => {
    if (dec !== undefined) return numericReference(dec, 10);
    if (hex !== undefined) return numericReference(hex, 16);
    const value = NAMED.get(name!);
    if (value === undefined) return match;
    if (semicolon === ";" || LEGACY.has(name!)) return value;
    return match;
  });
}

/** Index of the ">" ending a tag whose name ends before `start`; quotes in attribute values are respected. -1 at end of input. */
function tagEnd(html: string, start: number): number {
  let quote = "";
  let previous = "";
  for (let i = start; i < html.length; i++) {
    const c = html[i]!;
    if (quote !== "") {
      if (c === quote) quote = "";
    } else if (c === ">") {
      return i;
    } else if ((c === '"' || c === "'") && previous === "=") {
      quote = c;
    }
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\f") previous = c;
  }
  return -1;
}

const TAG_NAME = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/y;

/**
 * Builds the text: collapses white space, applies pending line breaks lazily
 * so nested blocks add no blank lines. Output goes into chunks and only the
 * tail state is tracked, so appending stays linear on large input.
 */
class TextWriter {
  private readonly chunks: string[] = [];
  private empty = true;
  private lastChar = "";
  /** Number of "\n" at the end of the output (counted up to 2). */
  private trailingBreaks = 0;
  /** Line breaks required before the next visible text: 0, 1 (new line) or 2 (blank line). */
  private pending = 0;
  private bullet = false;
  /** Number of enclosing <blockquote> elements: each line inside starts with that many "> ". */
  private quoteDepth = 0;

  requestBreak(lines: 1 | 2): void {
    if (lines > this.pending) this.pending = lines;
  }

  setBullet(on: boolean): void {
    this.bullet = on;
  }

  setQuoteDepth(depth: number): void {
    this.quoteDepth = depth;
  }

  toString(): string {
    return this.chunks.join("");
  }

  private append(value: string): void {
    if (value === "") return;
    this.chunks.push(value);
    this.empty = false;
    this.lastChar = value[value.length - 1]!;
    let breaks = 0;
    while (breaks < value.length && breaks < 2 && value[value.length - 1 - breaks] === "\n") breaks++;
    this.trailingBreaks = breaks === value.length ? Math.min(2, this.trailingBreaks + breaks) : breaks;
  }

  private atLineStart(): boolean {
    return this.pending > 0 || this.empty || this.lastChar === "\n";
  }

  private flush(): void {
    if (this.pending > this.trailingBreaks && !this.empty) this.append("\n".repeat(this.pending - this.trailingBreaks));
    this.pending = 0;
    if (this.quoteDepth > 0 && (this.empty || this.lastChar === "\n")) this.append("> ".repeat(this.quoteDepth));
    if (this.bullet) {
      this.append("- ");
      this.bullet = false;
    }
  }

  lineBreak(): void {
    this.flush();
    this.append("\n");
  }

  /** Normal flow text: runs of HTML white space become one space, dropped at the start of a line. */
  text(value: string): void {
    let collapsed = value.replace(/[ \t\n\f\r]+/g, " ");
    if (collapsed.startsWith(" ") && (this.atLineStart() || this.lastChar === " ")) collapsed = collapsed.slice(1);
    if (collapsed === "") return;
    if (collapsed === " ") {
      this.append(" ");
      return;
    }
    this.flush();
    this.append(collapsed);
  }

  /** Preformatted text: written as is (inside a quote, every line gets the quote prefix). */
  raw(value: string): void {
    if (value === "") return;
    this.flush();
    this.append(this.quoteDepth > 0 ? value.replace(/\n/g, "\n" + "> ".repeat(this.quoteDepth)) : value);
  }
}

/**
 * Converts HTML to plain text: comments, <head>, <title>, <style> and
 * <script> are dropped; <br> is a line break; block elements start and end a
 * line, paragraphs, headings and tables a blank line; list items start with
 * "- "; table cells are separated by a space; character references are
 * decoded; white space is collapsed outside <pre>; lines inside
 * <blockquote> start with "> " per level, the way a plain-text reply quotes
 * (so Gmail's quote container, Apple Mail's and Thunderbird's
 * <blockquote type="cite"> read like quoted plain text); no-break spaces
 * become spaces; lines are right-trimmed, runs of blank lines reduced to one
 * and the result trimmed. Never throws.
 */
export function htmlToText(html: string): string {
  const source = html.replace(/\r\n?/g, "\n");
  const writer = new TextWriter();
  let inHead = false;
  let preDepth = 0;
  let preJustOpened = false;
  let quoteDepth = 0;

  const emit = (chunk: string): void => {
    if (inHead || chunk === "") return;
    let text = decodeReferences(chunk);
    if (preDepth > 0) {
      // The line break right after <pre> is not content (HTML parsing rules).
      if (preJustOpened && text.startsWith("\n")) text = text.slice(1);
      preJustOpened = false;
      writer.raw(text);
    } else {
      writer.text(text);
    }
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    emit(source.slice(i, lt < 0 ? source.length : lt));
    if (lt < 0) break;
    i = lt;
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }
    const next = source[i + 1];
    if (next === "!" || next === "?") {
      const gt = source.indexOf(">", i);
      i = gt < 0 ? source.length : gt + 1;
      continue;
    }
    TAG_NAME.lastIndex = i;
    const match = TAG_NAME.exec(source);
    if (match === null) {
      emit("<");
      i++;
      continue;
    }
    const end = tagEnd(source, i + match[0].length);
    if (end < 0) break; // an unterminated tag hides the rest, as in browsers
    i = end + 1;
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();

    if (name === "head") {
      inHead = !closing;
    } else if (name === "body") {
      inHead = false;
    } else if (HIDDEN_CONTENT.has(name)) {
      if (!closing) {
        const closeTag = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
        closeTag.lastIndex = i;
        const found = closeTag.exec(source);
        if (found === null) break;
        const gt = source.indexOf(">", found.index);
        i = gt < 0 ? source.length : gt + 1;
      }
    } else if (name === "br") {
      if (!inHead) writer.lineBreak();
    } else if (PARAGRAPH_BLOCKS.has(name)) {
      writer.requestBreak(2);
    } else if (LINE_BLOCKS.has(name)) {
      writer.requestBreak(1);
      if (name === "blockquote") {
        quoteDepth = closing ? Math.max(0, quoteDepth - 1) : quoteDepth + 1;
        writer.setQuoteDepth(quoteDepth);
      }
      if (name === "li") writer.setBullet(!closing);
      if (name === "pre") {
        preDepth = closing ? Math.max(0, preDepth - 1) : preDepth + 1;
        preJustOpened = !closing;
      }
    } else if (CELLS.has(name) && !closing) {
      emit(" ");
    }
  }

  return writer
    .toString()
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
