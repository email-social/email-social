import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ChatSummary, ChatView, ContactDetail, MessageView, OtherSummary, ProviderPreset } from "@email-social/es-bridge/api";
import { Bubble } from "../src/Bubble.js";
import { ChatList } from "../src/ChatList.js";
import { ChatPane, Composer, Messages, TopicControl, TopicsFilter } from "../src/ChatPane.js";
import { ContactPage } from "../src/ContactPage.js";
import { LoginForm } from "../src/LoginForm.js";
import { NewChat } from "../src/NewChat.js";
import { OtherMail } from "../src/OtherMail.js";
import { SigningIn, StatusBar } from "../src/Status.js";
import { topicName } from "../src/format.js";
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
  id: "<k2@example.org>",
  from: { address: "bob@example.org", name: "Bob Svoboda" },
  mine: false,
  date: "2026-03-20T17:00:00Z",
  subject: "Víkend na chatě",
  text: "Jedu! <b>Dřevo</b> se hodí.\n\n-- \nBob\n\nOn Sat, Mar 7, 2026 at 9:30 AM Alice <alice@example.com> wrote:\n> Jedeš o víkendu na chatu?",
  fresh: "Jedu! <b>Dřevo</b> se hodí.",
  quoted: "On Sat, Mar 7, 2026 at 9:30 AM Alice <alice@example.com> wrote:\n> Jedeš o víkendu na chatu?",
  signature: "-- \nBob",
  textSource: "html",
  attachments: [{ partId: "2", filename: "plán.pdf", contentType: "application/pdf", size: 12_300, path: "/api/messages/inbox%3Aa.eml/attachments/2" }],
  originalPath: "/api/messages/inbox%3Aa.eml/original",
  status: null,
  emailSocial: false,
  topic: { rootId: "<k1@example.com>", label: null, kind: "plain" },
  topicStart: false,
  replyCard: { messageId: "<k1@example.com>", from: "Alice Dvořáková", fromMe: true, excerpt: "Jedeš o víkendu na chatu?", attachment: null, clickable: true },
  subjectNote: null,
  interleaved: false,
};

const mine: MessageView = {
  ...theirs,
  key: "sent:b.eml",
  id: "<k1@example.com>",
  from: { address: "alice@example.com", name: "Alice" },
  mine: true,
  text: "Jedeš o víkendu na chatu?",
  fresh: "Jedeš o víkendu na chatu?",
  quoted: "",
  signature: "",
  textSource: "plain",
  attachments: [],
  status: "read",
  topicStart: true,
  replyCard: null,
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
  const bubble = (message: MessageView, extra: { onReply?: (m: MessageView) => void; topicChip?: string } = {}) =>
    render(<Bubble message={message} token="tok" group={false} onPerson={noop} onQuote={noop} now={NOW} {...extra} />);

  it("shows only what the sender wrote, as text: no quoted text anywhere, the signature collapsed", () => {
    const html = bubble(theirs);
    expect(html).toContain('data-side="left"');
    expect(html).toContain('<p class="text">Jedu! &lt;b>Dřevo&lt;/b> se hodí.</p>');
    expect(html).not.toContain("wrote:");
    expect(html).not.toContain("Show quoted text");
    expect(html).not.toContain("&gt; Jedeš");
    expect(html).toMatch(/<details class="signature"><summary>Show signature<\/summary><p class="text">-- \nBob<\/p>/);
  });

  it("puts a quote card above a deliberate reply: who is answered in bold, the excerpt muted, a button to the answered message", () => {
    const html = bubble(theirs);
    expect(html).toMatch(
      /<button type="button" class="quote-card" data-target="&lt;k1@example.com>" title="Show the message this answers"><span class="sr-only">In reply to <\/span><span class="quote-from">You<\/span><span class="quote-excerpt">Jedeš o víkendu na chatu\?<\/span><\/button><p class="text">/,
    );
    const named = bubble({ ...theirs, replyCard: { messageId: "<x@example.org>", from: "Karel Holub", fromMe: false, excerpt: "Fotky jsou v příloze.", attachment: "výlet.zip", clickable: true } });
    expect(named).toContain('<span class="quote-from">Karel Holub</span>');
    expect(named).toContain('<span class="quote-attachment"><span aria-hidden="true">📎 </span><span class="sr-only">Attachment: </span>výlet.zip</span>');
  });

  it("shows a card whose message is not in this chat (or not in the mailbox) as text, not as a button", () => {
    const html = bubble({ ...theirs, replyCard: { messageId: null, from: "Karel Holub", fromMe: false, excerpt: "Kdy dorazíš?", attachment: null, clickable: false } });
    expect(html).toContain('<p class="quote-card"><span class="sr-only">In reply to </span><span class="quote-from">Karel Holub</span><span class="quote-excerpt">Kdy dorazíš?</span></p>');
    expect(html).not.toContain("data-target");
  });

  it("shows no card for a continuation, and never a subject card", () => {
    const html = bubble(mine);
    expect(html).not.toContain("quote-card");
    expect(html).not.toContain("Víkend na chatě");
  });

  it("makes the sender's name a button that opens the contact page, and leaves the verification slot empty", () => {
    expect(bubble(theirs)).toMatch(/<button type="button" class="person" data-address="bob@example.org">Bob Svoboda<\/button>/);
    expect(render(<VerificationBadgeSlot address="bob@example.org" />)).toBe("");
  });

  it("puts own messages on the right, labelled You, with their receipt status in words", () => {
    const html = bubble(mine);
    expect(html).toContain('data-side="right"');
    expect(html).toContain(">You<");
    expect(html).toContain("Read");
  });

  it("offers Reply (in a chat) and the original message in the ⋯ menu, as a download through the bridge", () => {
    expect(bubble(mine, { onReply: noop })).toMatch(
      /<details class="message-menu"><summary aria-label="Message actions">⋯<\/summary><ul><li><button type="button" class="menu-reply">Reply<\/button><\/li><li><a href="\/api\/messages\/inbox%3Aa.eml\/original\?token=tok" download>Open original<\/a><\/li><\/ul><\/details>/,
    );
    expect(bubble(mine)).toMatch(/<details class="message-menu"><summary aria-label="Message actions">⋯<\/summary><ul><li><a href="\/api\/messages\/inbox%3Aa.eml\/original\?token=tok" download>Open original<\/a><\/li><\/ul><\/details>/);
  });

  it("lists attachments as named download links and notes HTML-only mail", () => {
    const html = bubble(theirs);
    expect(html).toContain('href="/api/messages/inbox%3Aa.eml/attachments/2?token=tok"');
    expect(html).toContain("plán.pdf");
    expect(html).toContain("12 KB");
    expect(html).toContain("Shown as plain text");
  });

  it("says when the sender wrote nothing new (a plain forward), without showing what they quoted", () => {
    const html = bubble({ ...theirs, fresh: "", signature: "" });
    expect(html).toContain('<p class="text empty-text">(no new text; the full message is under ⋯ → Open original)</p>');
    expect(html).not.toContain("wrote:");
  });

  it("shows a changed subject as one small line, and nothing else changes", () => {
    const html = bubble({ ...theirs, subjectNote: "Invoice 114 [EXTERNAL]" });
    expect(html).toContain('<p class="note subject-note">Subject: Invoice 114 [EXTERNAL]</p>');
    expect(bubble(theirs)).not.toContain("subject-note");
  });

  it("renders a point-by-point answer line by line, the quoted lines muted without their '>', under a note", () => {
    const html = bubble({ ...theirs, interleaved: true, fresh: "> Kdy dorazíš?\nV deset.\n>> Vlakem?\nAno." });
    expect(html).toContain('<p class="note">answered point by point</p>');
    expect(html).toContain(
      '<p class="text interleaved"><span class="quoted-line">Kdy dorazíš?</span>\n<span class="plain-line">V deset.</span>\n<span class="quoted-line">Vlakem?</span>\n<span class="plain-line">Ano.</span></p>',
    );
    expect(bubble({ ...theirs, fresh: "> not interleaved" })).not.toContain("quoted-line");
  });

  it("hides Show signature on own messages whose signature is, or ends with, the Email Social footer", () => {
    const footer = "Sent with Email Social. Reply as you normally would; this is an ordinary e-mail.";
    expect(bubble({ ...mine, signature: `-- \n${footer}` })).not.toContain("Show signature");
    expect(bubble({ ...mine, signature: `-- \nAlice\n${footer}` })).not.toContain("Show signature");
    expect(bubble({ ...mine, signature: "-- \nAlice" })).toContain("Show signature");
    expect(bubble({ ...theirs, signature: `-- \n${footer}` })).toContain("Show signature");
  });

  it("shows the topic chip it is given, as text", () => {
    expect(bubble(mine, { topicChip: "Výlet" })).toContain('<p class="topic-run"><span class="sr-only">Topic: </span>Výlet</p>');
    expect(bubble(mine)).not.toContain("topic-run");
  });
});

describe("chat pane", () => {
  const plainTopic = { rootId: "<1@x>", label: null, base: "Kdy dorazíš?", kind: "carrier" as const, count: 2 };
  const named = { rootId: "<3@x>", label: "Fotky z hor", base: "Fotky z hor", kind: "named" as const, count: 2 };
  const view: ChatView = {
    chat: chats[0]!,
    messages: [
      { ...mine, key: "1", id: "<1@x>", subject: "Kdy dorazíš?", topic: { rootId: "<1@x>", label: null, kind: "carrier" }, topicStart: true, replyCard: null },
      { ...theirs, key: "2", id: "<2@x>", subject: "Kdy dorazíš?", topic: { rootId: "<1@x>", label: null, kind: "carrier" }, topicStart: false, replyCard: { messageId: "<1@x>", from: "Alice", fromMe: true, excerpt: "Kdy?", attachment: null, clickable: true } },
      { ...theirs, key: "3", id: "<3@x>", subject: "Fotky z hor", topic: { rootId: "<3@x>", label: "Fotky z hor", kind: "named" }, topicStart: true, replyCard: null },
      { ...theirs, key: "4", id: "<4@x>", subject: "Fotky z hor", topic: { rootId: "<3@x>", label: "Fotky z hor", kind: "named" }, topicStart: false, replyCard: null },
    ],
    topics: [plainTopic, named],
    composerTopic: "<1@x>",
  };
  const single: ChatView = { ...view, messages: view.messages.slice(0, 2), topics: [plainTopic] };
  const pane = (v: ChatView) => render(<ChatPane view={v} token="tok" headingRef={{ current: null }} onSend={async () => ({ chatId: "", message: mine })} onPerson={noop} now={NOW} />);

  it("has no separators or subject cards: a topic chip on the first bubble of each run, when the chat has more than one topic", () => {
    const html = pane(view);
    expect(html).not.toContain("subject-separator");
    expect(html).not.toContain("quote-card subject");
    expect(html.match(/class="bubble /g)).toHaveLength(4);
    expect([...html.matchAll(/<p class="topic-run"><span class="sr-only">Topic: <\/span>([^<]*)<\/p>/g)].map((m) => m[1])).toEqual(["Ongoing chat", "Fotky z hor"]);
    expect(html.match(/data-target=/g)).toHaveLength(1);
  });

  it("shows a chat with a single topic without chips or a topic filter, and offers '+ Topic' beside the text box", () => {
    const html = pane(single);
    expect(html).not.toContain("topic-run");
    expect(html).not.toContain("All topics");
    expect(html).toContain('<button type="button" class="topic-chip">+ Topic</button>');
  });

  it("with more topics, names the bound topic on the composer chip and offers All topics in the header", () => {
    const html = pane(view);
    expect(html).toMatch(/<button type="button" class="topic-chip" aria-expanded="false" aria-controls="reply-topics"><span class="sr-only">Topic: <\/span>Ongoing chat <span aria-hidden="true">▾<\/span><\/button>/);
    expect(html).toMatch(/<button type="button" class="topics-button" aria-expanded="false" aria-controls="topics-filter-list">All topics <span aria-hidden="true">▾<\/span><\/button>/);
    expect(pane({ ...view, composerTopic: "<3@x>" })).toMatch(/class="topic-chip"[^>]*><span class="sr-only">Topic: <\/span>Fotky z hor </);
  });

  it("offers Reply on every bubble of a chat", () => {
    expect(pane(view).match(/class="menu-reply">Reply</g)).toHaveLength(4);
  });

  it("marks every bubble with its message id, so a card can scroll to it", () => {
    expect(pane(view)).toMatch(/<li class="bubble mine" data-side="right" data-message-id="&lt;1@x>" tabIndex="-1"|<li class="bubble mine" data-side="right" data-message-id="&lt;1@x>" tabindex="-1"/);
  });

  it("names the people in the heading as buttons and says how a message is sent", () => {
    const html = pane(view);
    expect(html).toMatch(/<h2[^>]*>Karel Holub<\/h2>/);
    expect(html).toContain('<label for="reply">Message to Karel Holub</label>');
    expect(html).toContain("Karel uses Email Social");
    const plain = pane({ ...view, chat: chats[1]! });
    expect(plain).toContain("Group of 3");
    expect(plain).toMatch(/<button type="button" class="person" data-address="jana@example.net">Jana Nováková<\/button>/);
    expect(plain).toContain("sent as an ordinary e-mail");
    expect(plain).toContain("choose Reply in its ⋯ menu");
  });
});

describe("timeline pieces", () => {
  const topics = [
    { rootId: "<1@x>", label: null, base: "Kdy dorazíš?", kind: "carrier" as const, count: 1 },
    { rootId: "<3@x>", label: "Fotky", base: "Fotky", kind: "named" as const, count: 1 },
  ];
  const runs = [
    { ...mine, key: "1", id: "<1@x>", topic: { rootId: "<1@x>", label: null, kind: "carrier" as const }, topicStart: true },
    { ...theirs, key: "3", id: "<3@x>", topic: { rootId: "<3@x>", label: "Fotky", kind: "named" as const }, topicStart: true },
  ];

  it("shows no run chips while the timeline is filtered to one topic", () => {
    expect(render(<Messages messages={runs} token="tok" group={false} onPerson={noop} now={NOW} topics={topics} showRuns={true} />)).toContain("topic-run");
    expect(render(<Messages messages={runs.slice(1)} token="tok" group={false} onPerson={noop} now={NOW} topics={topics} showRuns={false} />)).not.toContain("topic-run");
  });

  it("names the filtered topic in the header button", () => {
    expect(render(<TopicsFilter topics={topics} filter="<3@x>" onFilter={noop} />)).toContain('class="topics-button" aria-expanded="false" aria-controls="topics-filter-list">Fotky <span aria-hidden="true">▾</span>');
  });

  it("shows the reply chip above the text box with the name and the excerpt, and a ✕ to cancel", () => {
    const html = render(<Composer id="reply" label="Message" hint="" onSend={asyncNoop} replying={{ name: "Bob Svoboda", excerpt: "Jedu! Dřevo se hodí." }} onCancelReply={noop} />);
    expect(html).toContain('<p class="reply-chip"><span>Replying to <strong>Bob Svoboda</strong> — Jedu! Dřevo se hodí.</span><button type="button" class="reply-cancel" aria-label="Cancel the reply">✕</button></p>');
    expect(html.indexOf("reply-chip")).toBeLessThan(html.indexOf("<textarea"));
  });

  it("opens a short name field for a new topic, labelled, with what an empty name means", () => {
    const html = render(<TopicControl id="reply" topics={[]} bound={null} label="" onLabel={noop} onBind={noop} />);
    expect(html).toContain('<label for="reply-topic">Topic</label>');
    expect(html).toMatch(/<input id="reply-topic" class="topic-name" value maxlength="200" autocomplete="off" aria-describedby="reply-topic-hint"\/>/);
    expect(html).toContain("A name for this thread; leave empty for the ongoing chat.");
  });

  it("names topics by label, else subject, else 'Ongoing chat'", () => {
    expect(topicName({ label: "Výlet", base: "Message from Alice", kind: "named" })).toBe("Výlet");
    expect(topicName({ label: null, base: "Invoice 114", kind: "plain" })).toBe("Invoice 114");
    expect(topicName({ label: null, base: "Message from Alice", kind: "carrier" })).toBe("Ongoing chat");
    expect(topicName({ label: null, base: "", kind: "plain" })).toBe("Ongoing chat");
  });
});

describe("new chat", () => {
  const contacts = [
    { address: "karel@example.org", name: "Karel Holub", lastSeen: null, count: 8, emailSocial: true },
    { address: "bob@example.org", name: "Bob Svoboda", lastSeen: null, count: 15, emailSocial: false },
  ];
  const html = render(<NewChat contacts={contacts} onSend={async () => undefined} onCancel={noop} />);

  it("labels the recipient and message fields, suggests contacts, and offers a topic instead of a subject", () => {
    for (const id of ["recipient", "text"]) expect(html, id).toContain(`for="${id}"`);
    expect(html).toMatch(/<input[^>]*id="recipient"[^>]*list="contact-options"/);
    expect(html).toContain('<datalist id="contact-options"><option value="Karel Holub &lt;karel@example.org>"></option>');
    expect(html).toContain("Several recipients make a group");
    expect(html).not.toMatch(/subject/i);
    expect(html).toContain('<button type="button" class="topic-chip">+ Topic</button>');
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
