/**
 * Reduces the HTML of a story to an allow-list of elements and attributes
 * that can be shown without running anything or loading anything (spec
 * section 12.5).
 *
 * - Elements outside the allow-list are left out; their content stays,
 *   except for script, style, head, title, template, iframe, object, embed,
 *   applet, noscript, svg, math, form controls, media and frames, whose
 *   content goes with them. Comments, doctypes and processing instructions
 *   are left out.
 * - Attributes outside the allow-list are left out: every event handler
 *   (on…), id, class, background, srcdoc, data-* and the like.
 * - `style` keeps only declarations that cannot load anything: none with
 *   url(), image(), image-set(), src(), expression(), a backslash or a
 *   comment.
 * - Links keep only http, https and mailto targets and get
 *   rel="noreferrer noopener" and target="_blank".
 * - Images never load on their own: an http, https or data:image source is
 *   moved to data-src (and srcset to data-srcset); a client that wants the
 *   images moves them back.
 *
 * The output is well-formed enough to be parsed back to the same elements:
 * attribute values are quoted and escaped, "<" and ">" in text are escaped.
 * Never throws.
 */

import { decodeReferences, tagEnd } from "./html-to-text.js";

/** Elements kept, with the attributes of KEPT_ATTRIBUTES. */
const KEEP = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center",
  "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark",
  "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "wbr",
]);

/** Elements without an end tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "frame", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);

/** Elements whose content is raw text up to their end tag (HTML parsing rules); left out with it. */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);

/** Elements left out with everything inside them. */
const DROP_WITH_CONTENT = new Set(["template", "object", "applet", "svg", "math", "select", "button", "audio", "video", "canvas", "frameset", "datalist"]);

/** Presentational attributes kept on every kept element. */
const KEPT_ATTRIBUTES = new Set([
  "abbr", "align", "alt", "bgcolor", "border", "cellpadding", "cellspacing", "clear", "color", "colspan", "dir", "face",
  "height", "hspace", "lang", "noshade", "nowrap", "reversed", "rowspan", "scope", "size", "span", "start", "title",
  "valign", "vspace", "width",
]);

/** CSS that could load something or hide a function name. */
const UNSAFE_CSS = /\\|\/\*|@|javascript:|behavior|binding|(?:url|image|image-set|cross-fade|element|src|expression)\s*\(/i;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An attribute value as a browser reads it as a URL: references decoded, tabs and line breaks removed, trimmed. */
function urlValue(value: string): string {
  return decodeReferences(value, true).replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
}

function linkTarget(value: string): string | null {
  const url = urlValue(value);
  return /^(?:https?:\/\/|mailto:)/i.test(url) ? url : null;
}

function imageSource(value: string): string | null {
  const url = urlValue(value);
  return /^(?:https?:\/\/|data:image\/(?:png|gif|jpeg|webp);base64,)/i.test(url) ? url : null;
}

/** A srcset whose every candidate is an http or https URL; null otherwise. */
function imageSourceSet(value: string): string | null {
  const set = urlValue(value);
  const candidates = set.split(",").map((c) => c.trim()).filter((c) => c !== "");
  if (candidates.length === 0 || candidates.some((c) => !/^https?:\/\/\S+(?:\s+\d+(?:\.\d+)?[wx])?$/i.test(c))) return null;
  return candidates.join(", ");
}

/** The declarations of a style attribute that load nothing, or null when none is left. */
function safeStyle(value: string): string | null {
  const kept = decodeReferences(value, true)
    .split(";")
    .map((d) => d.trim())
    .filter((d) => /^[A-Za-z-]+\s*:/.test(d) && !UNSAFE_CSS.test(d) && !/[<>"]/.test(d));
  return kept.length === 0 ? null : kept.join("; ");
}

/** The attributes of a tag (the text between its name and its ">"), names lowercased, first occurrence kept. */
function attributesOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const m of text.matchAll(pattern)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** The start tag of a kept element with its allowed attributes; counts images moved to data-src. */
function startTag(name: string, attributes: Map<string, string>, images: { count: number }): string {
  const kept: [string, string][] = [];
  for (const [attribute, value] of attributes) {
    if (KEPT_ATTRIBUTES.has(attribute)) kept.push([attribute, decodeReferences(value, true)]);
    else if (attribute === "style") {
      const style = safeStyle(value);
      if (style !== null) kept.push(["style", style]);
    } else if (attribute === "href" && name === "a") {
      const href = linkTarget(value);
      if (href !== null) kept.push(["href", href]);
    } else if (attribute === "src" && name === "img") {
      const src = imageSource(value);
      if (src !== null) kept.push(["data-src", src]);
    } else if (attribute === "srcset" && name === "img") {
      const srcset = imageSourceSet(value);
      if (srcset !== null) kept.push(["data-srcset", srcset]);
    }
  }
  if (name === "a") kept.push(["rel", "noreferrer noopener"], ["target", "_blank"]);
  if (name === "img" && kept.some(([a]) => a === "data-src" || a === "data-srcset")) images.count++;
  return "<" + name + kept.map(([a, v]) => ` ${a}="${escapeAttribute(v)}"`).join("") + ">";
}

/** The sanitized HTML and the number of images whose loading it held back. */
export function sanitizeHtml(html: string): { html: string; images: number } {
  const source = html.replace(/\r\n?/g, "\n");
  const out: string[] = [];
  const images = { count: 0 };
  /** The element being left out with its content, and how deeply it is nested in itself. */
  let dropping: { name: string; depth: number } | null = null;
  let inHead = false;
  const tagName = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/y;
  const text = (chunk: string): void => {
    if (dropping === null && !inHead && chunk !== "") out.push(chunk.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    text(source.slice(i, lt < 0 ? source.length : lt));
    if (lt < 0) break;
    i = lt;
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }
    if (source[i + 1] === "!" || source[i + 1] === "?") {
      const gt = source.indexOf(">", i);
      i = gt < 0 ? source.length : gt + 1;
      continue;
    }
    tagName.lastIndex = i;
    const match = tagName.exec(source);
    if (match === null) {
      text("<");
      i++;
      continue;
    }
    const end = tagEnd(source, i + match[0].length);
    if (end < 0) break; // an unterminated tag hides the rest, as in browsers
    const inside = source.slice(i + match[0].length, end);
    i = end + 1;
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();

    if (dropping !== null) {
      if (name === dropping.name && !VOID.has(name)) dropping.depth += closing ? -1 : 1;
      if (dropping.depth === 0) dropping = null;
      continue;
    }
    if (name === "head") {
      inHead = !closing;
      continue;
    }
    if (name === "body") {
      inHead = false;
      continue;
    }
    if (inHead) continue;
    if (RAW_TEXT.has(name)) {
      if (closing) continue;
      const closeTag = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
      closeTag.lastIndex = i;
      const found = closeTag.exec(source);
      if (found === null) break;
      const gt = source.indexOf(">", found.index);
      i = gt < 0 ? source.length : gt + 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing) dropping = { name, depth: 1 };
      continue;
    }
    if (!KEEP.has(name)) continue;
    if (closing) {
      if (!VOID.has(name)) out.push(`</${name}>`);
      continue;
    }
    out.push(startTag(name, attributesOf(inside), images));
  }
  return { html: out.join(""), images: images.count };
}
