import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ConversationSummary, MessageView, ProviderPreset } from "@email-social/es-bridge/api";
import { Bubble } from "../src/Bubble.js";
import { ConversationList } from "../src/ConversationList.js";
import { LoginForm } from "../src/LoginForm.js";
import { VerificationBadgeSlot } from "../src/VerificationBadgeSlot.js";

const NOW = new Date("2026-03-20T18:30:00Z");

const conversations: ConversationSummary[] = [
  {
    id: "conv-a",
    title: "Karel Holub",
    subject: "Kdy dorazíš?",
    participants: [{ address: "karel@example.org", name: "Karel Holub" }],
    group: false,
    lastLine: "Vidím tě!",
    lastDate: "2026-03-20T17:00:00Z",
    lastFromMe: false,
    unread: 3,
  },
  {
    id: "conv-b",
    title: "Bob Svoboda, Jana Nováková",
    subject: "Oběd v pátek",
    participants: [
      { address: "bob@example.org", name: "Bob Svoboda" },
      { address: "jana@example.net", name: "Jana Nováková" },
    ],
    group: true,
    lastLine: "Tak zítra!",
    lastDate: "2026-03-02T10:05:00Z",
    lastFromMe: true,
    unread: 0,
  },
];

const theirs: MessageView = {
  key: "inbox:a.eml",
  from: { address: "karel@example.org", name: "Karel Holub" },
  mine: false,
  date: "2026-03-20T17:00:00Z",
  text: "Ahoj <b>Alice</b>\nkdy dorazíš?",
  textSource: "html",
  attachments: [{ partId: "2", filename: "plán.pdf", contentType: "application/pdf", size: 12_300, path: "/api/messages/inbox%3Aa.eml/attachments/2" }],
  originalPath: "/api/messages/inbox%3Aa.eml/original",
  status: null,
  emailSocial: true,
};

const mine: MessageView = { ...theirs, key: "sent:b.eml", from: { address: "alice@example.com", name: "Alice" }, mine: true, text: "Kolem desáté.", textSource: "plain", attachments: [], status: "read" };

describe("conversation list", () => {
  const html = render(<ConversationList conversations={conversations} selected="conv-b" onSelect={() => undefined} now={NOW} />);

  it("is a labelled list of buttons, the open one marked with aria-current", () => {
    expect(html).toContain('<ul class="conversations"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*aria-current="true"[^>]*data-id="conv-b"/);
  });

  it("shows names, the last line and unread counts as text, not only as colour", () => {
    expect(html).toContain("Karel Holub");
    expect(html).toContain("Vidím tě!");
    expect(html).toContain('<span class="badge" aria-hidden="true">3</span>');
    expect(html).toContain('<span class="sr-only">3 unread messages</span>');
    expect(html).toContain("You: Tak zítra!");
  });

  it("marks a conversation with many recipients as a group", () => {
    expect(html).toContain("Group of 3");
  });
});

describe("message bubbles", () => {
  it("puts the other side's messages on the left with the sender's name and an empty verification slot", () => {
    const html = render(<Bubble message={theirs} token="tok" group={false} />);
    expect(html).toContain('data-side="left"');
    expect(html).toContain("Karel Holub");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Ahoj &lt;b>Alice&lt;/b>");
  });

  it("puts own messages on the right, labelled You, with their receipt status in words", () => {
    const html = render(<Bubble message={mine} token="tok" group={false} />);
    expect(html).toContain('data-side="right"');
    expect(html).toContain(">You<");
    expect(html).toContain("Read");
  });

  it("lists attachments as named download links and offers the original of an HTML-only message", () => {
    const html = render(<Bubble message={theirs} token="tok" group={false} />);
    expect(html).toContain('href="/api/messages/inbox%3Aa.eml/attachments/2?token=tok"');
    expect(html).toContain("plán.pdf");
    expect(html).toContain("12 KB");
    expect(html).toContain("download");
    expect(html).toContain("Shown as plain text");
    expect(html).toContain('href="/api/messages/inbox%3Aa.eml/original?token=tok"');
    expect(html).toContain("Open original");
  });

  it("has a VerificationBadgeSlot that renders nothing (an extension point)", () => {
    expect(render(<VerificationBadgeSlot address="karel@example.org" />)).toBe("");
  });
});

describe("sign-in form", () => {
  const presets: ProviderPreset[] = [
    { id: "gmail", label: "Gmail", imap: { host: "imap.gmail.com", port: 993, security: "tls" }, smtp: { host: "smtp.gmail.com", port: 465, security: "tls" }, appendToSent: false, hint: "Use an app password." },
    { id: "other", label: "Other provider", imap: { host: "", port: 993, security: "tls" }, smtp: { host: "", port: 465, security: "tls" }, appendToSent: true, hint: "Use your provider's settings." },
  ];
  const html = render(<LoginForm presets={presets} keychain={true} error="IMAP imap.example.com: authentication failed" onSubmit={async () => undefined} />);

  it("labels every field", () => {
    const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) expect(html, id).toContain(`for="${id}"`);
  });

  it("asks for an app password and says where a remembered password is kept", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain("Use an app password.");
    expect(html).toContain("keychain");
  });

  it("shows a sign-in error as an alert", () => {
    expect(html).toMatch(/role="alert"[^>]*>[^<]*authentication failed/);
  });
});
