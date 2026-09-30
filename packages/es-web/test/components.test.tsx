import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ChatSummary, ChatView, ContactDetail, MessageView, OtherSummary, ProviderPreset } from "@email-social/es-bridge/api";
import { Bubble } from "../src/Bubble.js";
import { ChatList } from "../src/ChatList.js";
import { ChatPane } from "../src/ChatPane.js";
import { ContactPage } from "../src/ContactPage.js";
import { LoginForm } from "../src/LoginForm.js";
import { NewChat } from "../src/NewChat.js";
import { OtherMail } from "../src/OtherMail.js";
import { SigningIn, StatusBar } from "../src/Status.js";
import { VerificationBadgeSlot } from "../src/VerificationBadgeSlot.js";

const NOW = new Date("2026-03-20T18:30:00Z");
const noop = (): void => undefined;
const asyncNoop = async (): Promise<void> => undefined;

const chats: ChatSummary[] = [
  {
    id: "chat-a",
    title: "Karel Holub",
    participants: [{ address: "karel@example.org", name: "Karel Holub" }],
    group: false,
    lastLine: "Vidím tě!",
    lastDate: "2026-03-20T17:00:00Z",
    lastFromMe: false,
    unread: 3,
    emailSocial: true,
  },
  {
    id: "chat-b",
    title: "Bob Svoboda, Jana Nováková",
    participants: [
      { address: "bob@example.org", name: "Bob Svoboda" },
      { address: "jana@example.net", name: "Jana Nováková" },
    ],
    group: true,
    lastLine: "Tak zítra!",
    lastDate: "2026-03-02T10:05:00Z",
    lastFromMe: true,
    unread: 0,
    emailSocial: false,
  },
];

const theirs: MessageView = {
  key: "inbox:a.eml",
  from: { address: "bob@example.org", name: "Bob Svoboda" },
  mine: false,
  date: "2026-03-20T17:00:00Z",
  subject: "Víkend na chatě",
  text: "Jedu! <b>Dřevo</b> se hodí.\n\n-- \nBob\n\nOn Sat, Mar 7, 2026 at 9:30 AM Alice <alice@example.com> wrote:\n> Jedeš?",
  fresh: "Jedu! <b>Dřevo</b> se hodí.",
  quoted: "On Sat, Mar 7, 2026 at 9:30 AM Alice <alice@example.com> wrote:\n> Jedeš?",
  signature: "-- \nBob",
  textSource: "html",
  attachments: [{ partId: "2", filename: "plán.pdf", contentType: "application/pdf", size: 12_300, path: "/api/messages/inbox%3Aa.eml/attachments/2" }],
  originalPath: "/api/messages/inbox%3Aa.eml/original",
  status: null,
  emailSocial: false,
};

const mine: MessageView = {
  ...theirs,
  key: "sent:b.eml",
  from: { address: "alice@example.com", name: "Alice" },
  mine: true,
  text: "Kolem desáté.",
  fresh: "Kolem desáté.",
  quoted: "",
  signature: "",
  textSource: "plain",
  attachments: [],
  status: "read",
};

describe("chat list", () => {
  const html = render(<ChatList chats={chats} selected="chat-b" onSelect={noop} now={NOW} />);

  it("is a labelled list of buttons, the open one marked with aria-current", () => {
    expect(html).toContain('<ul class="chats" aria-label="Chats"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*aria-current="true"[^>]*data-id="chat-b"/);
  });

  it("shows names, the last line and unread counts as text, not only as colour", () => {
    expect(html).toContain("Karel Holub");
    expect(html).toContain("Vidím tě!");
    expect(html).toContain('<span class="badge" aria-hidden="true">3</span>');
    expect(html).toContain('<span class="sr-only">3 unread messages</span>');
    expect(html).toContain("You: Tak zítra!");
    expect(html).not.toContain("subject");
  });

  it("marks a chat with several people as a group", () => {
    expect(html).toContain("Group of 3");
  });
});

describe("Other mail", () => {
  const senders: OtherSummary[] = [
    { id: "other-1", kind: "list", title: "dev-list@lists.example.org", address: "dev-list@lists.example.org", count: 5, unread: 2, lastLine: "Thanks Alice!", lastDate: "2026-03-13T11:02:00Z" },
    { id: "other-2", kind: "list", title: "Garden Club", address: "news@news.example.org", count: 1, unread: 1, lastLine: "March news", lastDate: "2026-03-12T06:00:00Z" },
  ];

  it("is a collapsed section listing lists and automated senders with their unread counts", () => {
    const html = render(<OtherMail senders={senders} selected={null} onSelect={noop} now={NOW} />);
    expect(html).toMatch(/^<details class="other-mail"><summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain("Other mail");
    expect(html).toContain("3 unread messages");
    expect(html).toContain("Garden Club");
    expect(html).toContain("Mailing lists, newsletters and automated senders");
  });

  it("opens when one of its senders is shown", () => {
    expect(render(<OtherMail senders={senders} selected="other-2" onSelect={noop} now={NOW} />)).toMatch(/<details class="other-mail" open/);
  });
});

describe("message bubbles", () => {
  it("shows what the sender wrote, as text, and hides the quoted text and the signature behind controls", () => {
    const html = render(<Bubble message={theirs} token="tok" group={false} onPerson={noop} now={NOW} />);
    expect(html).toContain('data-side="left"');
    expect(html).toContain('<p class="text">Jedu! &lt;b>Dřevo&lt;/b> se hodí.</p>');
    expect(html).toMatch(/<details class="quoted"><summary>Show quoted text<\/summary><p class="text">On Sat, Mar 7/);
    expect(html).toMatch(/<details class="signature"><summary>Show signature<\/summary><p class="text">-- \nBob<\/p>/);
  });

  it("makes the sender's name a button that opens the contact page, and leaves the verification slot empty", () => {
    const html = render(<Bubble message={theirs} token="tok" group={false} onPerson={noop} now={NOW} />);
    expect(html).toMatch(/<button type="button" class="person" data-address="bob@example.org">Bob Svoboda<\/button>/);
    expect(render(<VerificationBadgeSlot address="bob@example.org" />)).toBe("");
  });

  it("puts own messages on the right, labelled You, with their receipt status in words", () => {
    const html = render(<Bubble message={mine} token="tok" group={false} onPerson={noop} now={NOW} />);
    expect(html).toContain('data-side="right"');
    expect(html).toContain(">You<");
    expect(html).toContain("Read");
    expect(html).not.toContain("Show quoted text");
  });

  it("lists attachments as named download links and offers the original of an HTML-only message", () => {
    const html = render(<Bubble message={theirs} token="tok" group={false} onPerson={noop} now={NOW} />);
    expect(html).toContain('href="/api/messages/inbox%3Aa.eml/attachments/2?token=tok"');
    expect(html).toContain("plán.pdf");
    expect(html).toContain("12 KB");
    expect(html).toContain("Shown as plain text");
    expect(html).toContain('href="/api/messages/inbox%3Aa.eml/original?token=tok"');
  });

  it("shows the quoted text at once when the sender wrote nothing new (a plain forward)", () => {
    const html = render(<Bubble message={{ ...theirs, fresh: "", signature: "" }} token="tok" group={false} onPerson={noop} now={NOW} />);
    expect(html).toMatch(/<details class="quoted" open/);
  });
});

describe("chat pane", () => {
  const view: ChatView = {
    chat: chats[0]!,
    messages: [
      { ...theirs, key: "1", subject: "Kdy dorazíš?" },
      { ...mine, key: "2", subject: "Kdy dorazíš?" },
      { ...theirs, key: "3", subject: "Fotky" },
      { ...theirs, key: "4", subject: "Fotky" },
      { ...mine, key: "5", subject: "" },
      { ...theirs, key: "6", subject: "Kdy dorazíš?" },
    ],
  };

  it("marks where the subject changes with a small separator, starting with the first subject", () => {
    const html = render(<ChatPane view={view} token="tok" headingRef={{ current: null }} onSend={asyncNoop} onPerson={noop} now={NOW} />);
    const separators = [...html.matchAll(/<li class="subject-separator"><h3>([^<]*)<\/h3><\/li>/g)].map((m) => m[1]);
    expect(separators).toEqual(["Kdy dorazíš?", "Fotky", "(no subject)", "Kdy dorazíš?"]);
    expect(html.match(/class="bubble /g)).toHaveLength(6);
  });

  it("names the people in the heading as buttons and says how a reply is sent", () => {
    const html = render(<ChatPane view={view} token="tok" headingRef={{ current: null }} onSend={asyncNoop} onPerson={noop} now={NOW} />);
    expect(html).toMatch(/<h2[^>]*>Karel Holub<\/h2>/);
    expect(html).toContain('<label for="reply">Message to Karel Holub</label>');
    expect(html).toContain("Karel uses Email Social");
    const plain = render(<ChatPane view={{ ...view, chat: chats[1]! }} token="tok" headingRef={{ current: null }} onSend={asyncNoop} onPerson={noop} now={NOW} />);
    expect(plain).toContain("Group of 3");
    expect(plain).toMatch(/<button type="button" class="person" data-address="jana@example.net">Jana Nováková<\/button>/);
    expect(plain).toContain("sent as an ordinary e-mail, with the message you answer quoted below it");
  });
});

describe("new chat", () => {
  const contacts = [
    { address: "karel@example.org", name: "Karel Holub", lastSeen: null, count: 8, emailSocial: true },
    { address: "bob@example.org", name: "Bob Svoboda", lastSeen: null, count: 15, emailSocial: false },
  ];
  const html = render(<NewChat contacts={contacts} onSend={async () => undefined} onCancel={noop} />);

  it("labels the recipient, subject and message fields, and suggests contacts", () => {
    for (const id of ["recipient", "subject", "text"]) expect(html, id).toContain(`for="${id}"`);
    expect(html).toMatch(/<input[^>]*id="recipient"[^>]*list="contact-options"/);
    expect(html).toContain('<datalist id="contact-options"><option value="Karel Holub &lt;karel@example.org>"></option>');
    expect(html).toContain("Several recipients make a group");
    expect(html).toContain("(optional)");
  });
});

describe("contact page", () => {
  const contact: ContactDetail = {
    address: "bob@example.org",
    name: "Bob Svoboda",
    names: ["Bob Svoboda", "Bobík"],
    firstDate: "2026-03-02T08:15:42Z",
    lastDate: "2026-03-17T18:20:00Z",
    count: 15,
    emailSocial: false,
    chatId: "chat-bob",
    attachments: [
      { partId: "2", filename: "Návrh smlouvy.pdf", contentType: "application/pdf", size: 607, path: "/api/messages/inbox%3AI1.eml/attachments/2", date: "2026-03-10T12:22:03Z", fromMe: false },
    ],
    groups: [chats[1]!],
  };
  const html = render(<ContactPage contact={contact} token="tok" headingRef={{ current: null }} onOpenChat={noop} onWrite={noop} now={NOW} />);

  it("shows the names seen, the address, the first and last message dates and the number of messages", () => {
    expect(html).toMatch(/<h2[^>]*>Bob Svoboda<\/h2>/);
    expect(html).toContain("bob@example.org");
    expect(html).toContain("Bobík");
    expect(html).toContain("15 messages");
    expect(html).toMatch(/datetime="2026-03-02T08:15:42Z"/i);
    expect(html).toMatch(/datetime="2026-03-17T18:20:00Z"/i);
  });

  it("links the chat, the attachments exchanged (downloads through the bridge) and the groups you share", () => {
    expect(html).toContain("Open chat");
    expect(html).toContain('href="/api/messages/inbox%3AI1.eml/attachments/2?token=tok"');
    expect(html).toContain("Návrh smlouvy.pdf");
    expect(html).toContain("from Bob Svoboda");
    expect(html).toContain("Bob Svoboda, Jana Nováková");
  });
});

describe("progress and connection", () => {
  it("never says only 'Signing in…': it shows the step and a number that changes", () => {
    const connecting = render(<SigningIn address="alice@example.com" progress={{ step: "connecting", loaded: 0, total: null }} seconds={4} />);
    expect(connecting).toContain("Signing in as alice@example.com");
    expect(connecting).toContain("Connecting to the mail server… 4 s");
    const loading = render(<SigningIn address="alice@example.com" progress={{ step: "loading", loaded: 23, total: 540 }} seconds={9} />);
    expect(loading).toContain("Loading messages: 23 of 540");
    expect(loading).toContain('role="status"');
    expect(loading).toMatch(/<progress[^>]*max="540"[^>]*value="23"/);
  });

  it("says what is going on after sign-in: older messages loading, reconnecting, or an error with Try again", () => {
    expect(render(<StatusBar sync={{ loading: { loaded: 120, total: 540 }, connection: "online", error: null }} connected={true} onRetry={noop} />)).toContain(
      "Loading older messages: 120 of 540",
    );
    expect(render(<StatusBar sync={{ loading: null, connection: "reconnecting", error: null }} connected={true} onRetry={noop} />)).toContain("Reconnecting…");
    expect(render(<StatusBar sync={{ loading: null, connection: "online", error: null }} connected={false} onRetry={noop} />)).toContain("Reconnecting…");
    const error = render(<StatusBar sync={{ loading: null, connection: "online", error: "Loading stopped: no answer." }} connected={true} onRetry={noop} />);
    expect(error).toMatch(/role="alert"[^>]*>Loading stopped: no answer\./);
    expect(error).toContain(">Try again</button>");
    expect(render(<StatusBar sync={{ loading: null, connection: "online", error: null }} connected={true} onRetry={noop} />)).toBe("");
  });
});

describe("sign-in form", () => {
  const presets: ProviderPreset[] = [
    { id: "gmail", label: "Gmail", imap: { host: "imap.gmail.com", port: 993, security: "tls" }, smtp: { host: "smtp.gmail.com", port: 465, security: "tls" }, appendToSent: false, hint: "Use an app password." },
    { id: "other", label: "Other provider", imap: { host: "", port: 993, security: "tls" }, smtp: { host: "", port: 465, security: "tls" }, appendToSent: true, hint: "Use your provider's settings." },
  ];
  const html = render(<LoginForm presets={presets} keychain={true} error="IMAP imap.example.com: authentication failed" onSubmit={asyncNoop} />);

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

  it("asks for both servers, TLS or STARTTLS only, for another provider", () => {
    const other = render(<LoginForm presets={[presets[1]!]} keychain={false} error={null} onSubmit={asyncNoop} />);
    for (const id of ["imap-host", "imap-port", "imap-security", "smtp-host", "smtp-port", "smtp-security", "append-sent"]) {
      expect(other, id).toContain(`for="${id}"`);
    }
    expect(other.match(/<option[^>]*value="(tls|starttls)"/g)).toHaveLength(4);
    expect(other).not.toContain('value="none"');
    expect(other).toMatch(/id="remember"[^>]*disabled/);
  });

  it("shows a sign-in error as an alert, with Try again when the bridge can repeat the attempt", () => {
    expect(html).toMatch(/role="alert"[^>]*>[^<]*authentication failed/);
    expect(html).not.toContain("Try again");
    const retry = render(<LoginForm presets={presets} keychain={true} error="No answer from the mail server for 45 seconds." onSubmit={asyncNoop} onRetry={noop} />);
    expect(retry).toContain(">Try again</button>");
  });
});
