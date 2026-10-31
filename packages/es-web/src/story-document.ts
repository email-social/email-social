/**
 * The document a story is shown in (spec section 12.5), kept apart from the
 * components so the end-to-end privacy test can render exactly this in a
 * browser.
 */

/** The frame's sandbox: no scripts, no forms, no shared origin; links may open a new window. */
export const STORY_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/** The policy of a story document: nothing may load, except images once the reader asked for them. */
export function storyPolicy(images: boolean): string {
  return `default-src 'none'; img-src data:${images ? " https:" : ""}; style-src 'unsafe-inline'`;
}

/** The story's HTML with the held-back image sources put back (only inside <img> tags; text has its "<" escaped). */
export function withImages(html: string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => tag.replace(/ data-src="/g, ' src="').replace(/ data-srcset="/g, ' srcset="'));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The document shown in the sandboxed frame: its own policy first, then the reduced HTML. */
export function storyDocument(html: string, images: boolean): string {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(storyPolicy(images))}">` +
    '<meta name="referrer" content="no-referrer"></head>' +
    '<body style="margin:0;padding:12px;background:#ffffff;color:#1b1d21;font-family:system-ui,sans-serif;overflow-wrap:anywhere">' +
    (images ? withImages(html) : html) +
    "</body></html>"
  );
}
