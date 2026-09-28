/**
 * Unwrapping of text/plain; format=flowed (RFC 3676).
 */

/** A paragraph being built: lines joined so far, all of the same quote depth. */
interface Paragraph {
  depth: number;
  text: string;
}

function format(paragraph: Paragraph): string {
  if (paragraph.depth === 0) return paragraph.text;
  const marks = ">".repeat(paragraph.depth);
  return paragraph.text === "" ? marks : marks + " " + paragraph.text;
}

/**
 * Decodes format=flowed text into fixed lines.
 *
 * For each line (RFC 3676 §4.2): leading ">" marks give the quote depth;
 * then one leading space is removed as space-stuffing (§4.4); a line that
 * then ends in a space is flowed and is joined with the next line, unless
 * that line has a different quote depth (the flowed line is then treated as
 * fixed, §4.5) or is a signature separator. The "-- " signature separator is
 * neither flowed nor fixed (§4.3) and is kept as is. With DelSp=yes the
 * trailing space of a flowed line is removed.
 *
 * Quoted lines are written with their depth's ">" marks and one space. CRLF
 * and LF are both accepted; the output uses "\n", and ends with a line break
 * exactly when the input does.
 */
export function decodeFlowed(text: string, delSp: boolean): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const finalBreak = lines.length > 1 && lines[lines.length - 1] === "";
  if (finalBreak) lines.pop();

  const out: string[] = [];
  let open: Paragraph | null = null;
  for (const line of lines) {
    let depth = 0;
    while (line.charCodeAt(depth) === 0x3e) depth++;
    let content = line.slice(depth);
    if (content.startsWith(" ")) content = content.slice(1);
    const isSignature = content === "-- ";
    const flowed = !isSignature && content.endsWith(" ");

    if (open !== null && (open.depth !== depth || isSignature)) {
      out.push(format(open));
      open = null;
    }
    const piece = flowed && delSp ? content.slice(0, -1) : content;
    if (open === null) open = { depth, text: piece };
    else open.text += piece;
    if (!flowed) {
      out.push(format(open));
      open = null;
    }
  }
  if (open !== null) out.push(format(open));
  return out.join("\n") + (finalBreak ? "\n" : "");
}
