import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/mime/html-to-text.js";

describe("htmlToText", () => {
  it("drops comments, <head>, <title>, <style> and <script> with their content", () => {
    const html =
      "<!DOCTYPE html><html><head><meta charset=utf-8><title>Title</title>" +
      "<style>p { color: red; }</style></head><body><!-- hidden <p>x</p> -->" +
      "<script>var a = '<p>no</p>';</script><p>Shown</p></body></html>";
    expect(htmlToText(html)).toBe("Shown");
  });

  it("ends <head> at <body> when </head> is missing", () => {
    expect(htmlToText("<html><head><meta name=x><body>Text</body></html>")).toBe("Text");
  });

  it("turns <br> into a line break and separates paragraphs and headings with a blank line", () => {
    expect(htmlToText("<h1>Title</h1><p>One<br>two<br/>three</p><p>Next</p>")).toBe("Title\n\nOne\ntwo\nthree\n\nNext");
  });

  it("starts block elements on a new line without adding blank lines for nested blocks", () => {
    expect(htmlToText("a<div><div>b</div></div>c<section>d</section><blockquote>e</blockquote>")).toBe("a\nb\nc\nd\n> e");
  });

  it("quotes the lines inside <blockquote> with '> ' per level, as a plain-text reply does", () => {
    expect(htmlToText("Fresh<blockquote>One<br>two<br><br>three<blockquote><p>Older</p><p>text</p></blockquote>back</blockquote>after")).toBe(
      "Fresh\n> One\n> two\n>\n> three\n\n> > Older\n\n> > text\n\n> back\nafter",
    );
    expect(htmlToText("<blockquote><ul><li>item</li></ul><pre>a\nb</pre></blockquote>")).toBe("> - item\n> a\n> b");
    expect(htmlToText("<blockquote>unclosed")).toBe("> unclosed");
    expect(htmlToText("</blockquote>stray close")).toBe("stray close");
  });

  it("writes list items as lines starting with '- '", () => {
    expect(htmlToText("<p>Intro</p><ul>\n  <li>One</li>\n  <li>Two</li>\n</ul><p>After</p>")).toBe(
      "Intro\n\n- One\n- Two\n\nAfter",
    );
    expect(htmlToText("<ol><li>First<li>Second</ol>")).toBe("- First\n- Second");
  });

  it("puts table rows on their own lines and separates cells with a space", () => {
    expect(htmlToText("<table><tr><td>A</td><td>B</td></tr><tr><th>C</th><td>D</td></tr></table>after")).toBe(
      "A B\nC D\n\nafter",
    );
  });

  it("decodes named, decimal and hexadecimal character references", () => {
    expect(htmlToText("&amp; &lt;b&gt; &quot;q&quot; &apos;s&apos; &copy; &reg; &euro; &laquo;x&raquo; &hellip;")).toBe(
      "& <b> \"q\" 's' © ® € «x» …",
    );
    expect(htmlToText("a&ndash;b&mdash;c &#8211; &#x2014; &#X41; &#65")).toBe("a–b—c – — A A");
    expect(htmlToText("&scaron;&ccaron;&rcaron;&zcaron;&uuml;&szlig;&eacute;&agrave;")).toBe("ščřžüßéà");
  });

  it("maps numeric references in the C1 range as windows-1252 and invalid ones to U+FFFD, as browsers do", () => {
    expect(htmlToText("&#150; &#147;x&#148; &#0; &#xD800; &#x110000;")).toBe("– “x” � � �");
  });

  it("leaves unknown or incomplete references as written", () => {
    expect(htmlToText("&unknown; a&b R&D &#; &#x;")).toBe("&unknown; a&b R&D &#; &#x;");
    expect(htmlToText("Tom &amp Jerry")).toBe("Tom & Jerry");
  });

  it("collapses HTML white space, drops it at the start of a line, and turns no-break spaces into spaces", () => {
    expect(htmlToText("<p>\n   Hello\t  <b> big </b>\n world  </p>")).toBe("Hello big world");
    expect(htmlToText("10:00&nbsp;&ndash;&nbsp;12:00 and raw")).toBe("10:00 – 12:00 and raw");
  });

  it("keeps white space and line breaks inside <pre>", () => {
    expect(htmlToText("<p>Code:</p><pre>\n  if (a &lt; b)\n    run();\n</pre><p>end</p>")).toBe(
      "Code:\n\n  if (a < b)\n    run();\n\nend",
    );
  });

  it("right-trims lines, reduces runs of blank lines to one and trims the result", () => {
    expect(htmlToText("\n<p>a </p><br><br><br><br><p> b</p>\n")).toBe("a\n\nb");
  });

  it("reads tags case-insensitively and ignores attributes, also ones containing '>'", () => {
    expect(htmlToText('<P CLASS="x">One<BR>Two</P><a title="a > b" href="https://example.com/">link</a>')).toBe(
      "One\nTwo\n\nlink",
    );
  });

  it("keeps a '<' that does not start a tag, and survives unterminated comments and tags", () => {
    expect(htmlToText("a < b and c<3 <p>x")).toBe("a < b and c<3\n\nx");
    expect(htmlToText("before<!-- never closed")).toBe("before");
    expect(htmlToText("before<p class='x")).toBe("before");
    expect(htmlToText("<script>unterminated")).toBe("");
  });

  it("reduces a newsletter-style page to readable lines", () => {
    const html = [
      "<!DOCTYPE html>",
      "<html><head><title>News &#8211; March</title></head>",
      "<body>",
      "<h1>March news</h1>",
      "<p>Hello,<br>spring is here &amp; so is the fair.</p>",
      "<ul>",
      "<li>Fair: Saturday</li>",
      "<li>Workshop: Sunday</li>",
      "</ul>",
      "<p>See you!</p>",
      "</body></html>",
    ].join("\n");
    expect(htmlToText(html)).toBe(
      "March news\n\nHello,\nspring is here & so is the fair.\n\n- Fair: Saturday\n- Workshop: Sunday\n\nSee you!",
    );
  });
});
