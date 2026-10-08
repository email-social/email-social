import type { ChatView, MessageView, OtherView, Person, SendRequest, SendResult, TopicView } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Bubble } from "./Bubble.js";
import { shortExcerpt, topicName } from "./format.js";

const noop = (): void => undefined;

interface TopicControlProps {
  /** Prefix of the element ids. */
  id: string;
  /** The chat's topics; [] for a new chat. */
  topics: readonly TopicView[];
  /** Root of the topic the composer is bound to. */
  bound: string | null;
  /** The name of a new topic being typed, or null when none is. */
  label: string | null;
  onLabel: (label: string | null) => void;
  onBind: (root: string) => void;
}

/**
 * The topic control beside the text box. In a new chat and in a chat with
 * one topic it is a "+ Topic" chip that opens a short name field; in a chat
 * with more topics the chip names the topic the composer is bound to and
 * offers the others and "New topic…".
 */
export function TopicControl({ id, topics, bound, label, onLabel, onBind }: TopicControlProps) {
  const [open, setOpen] = useState(false);
  if (label !== null) {
    return (
      <div class="topic-control">
        <label for={`${id}-topic`}>Topic</label>
        <input
          id={`${id}-topic`}
          class="topic-name"
          value={label}
          maxLength={200}
          autocomplete="off"
          aria-describedby={`${id}-topic-hint`}
          onInput={(e) => onLabel((e.target as HTMLInputElement).value)}
        />
        <button type="button" class="topic-cancel" aria-label="No new topic" onClick={() => onLabel(null)}>
          ✕
        </button>
        <span id={`${id}-topic-hint`} class="hint">
          A name for this thread; leave empty for the ongoing chat.
        </span>
      </div>
    );
  }
  if (topics.length <= 1) {
    return (
      <div class="topic-control">
        <button type="button" class="topic-chip" onClick={() => onLabel("")}>
          + Topic
        </button>
      </div>
    );
  }
  const current = topics.find((t) => t.rootId === bound) ?? topics[topics.length - 1]!;
  return (
    <div class="topic-control">
      <button type="button" class="topic-chip" aria-expanded={open ? "true" : "false"} aria-controls={`${id}-topics`} onClick={() => setOpen(!open)}>
        <span class="sr-only">Topic: </span>
        {topicName(current)} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul id={`${id}-topics`} class="topic-menu" aria-label="Topics">
          {topics.map((t) => (
            <li key={t.rootId}>
              <button
                type="button"
                data-root={t.rootId}
                aria-current={t.rootId === current.rootId ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onBind(t.rootId);
                }}
              >
                {topicName(t)}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              class="new-topic"
              onClick={() => {
                setOpen(false);
                onLabel("");
              }}
            >
              New topic…
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  id: string;
  label: string;
  hint: string;
  /** Sends the text, with the name of a new topic when one was typed. */
  onSend: (text: string, topicLabel: string | null) => Promise<void>;
  topics?: readonly TopicView[];
  bound?: string | null;
  onBind?: (root: string) => void;
  /** The message a deliberate reply answers, shown as a chip above the text box. */
  replying?: { name: string; excerpt: string } | null;
  onCancelReply?: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/** The text box at the bottom of a chat, with the topic control beside it; Ctrl+Enter sends. */
export function Composer({ id, label, hint, onSend, topics = [], bound = null, onBind = noop, replying = null, onCancelReply = noop, textareaRef }: ComposerProps) {
  const [text, setText] = useState("");
  const [topicLabel, setTopicLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const send = async (): Promise<void> => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    setStatus("Sending…");
    try {
      const name = topicLabel === null ? "" : topicLabel.replace(/\s+/g, " ").trim();
      await onSend(text, name === "" ? null : name);
      setText("");
      setTopicLabel(null);
      setStatus("Sent.");
    } catch (e) {
      setStatus(`Not sent: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label for={id}>{label}</label>
      {replying !== null ? (
        <p class="reply-chip">
          <span>
            Replying to <strong>{replying.name}</strong>
            {replying.excerpt !== "" ? ` — ${replying.excerpt}` : ""}
          </span>
          <button type="button" class="reply-cancel" aria-label="Cancel the reply" onClick={onCancelReply}>
            ✕
          </button>
        </p>
      ) : null}
      <textarea
        id={id}
        ref={textareaRef}
        rows={3}
        value={text}
        aria-describedby={`${id}-hint`}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" disabled={busy || text.trim() === ""}>
        Send
      </button>
      <TopicControl
        id={id}
        topics={topics}
        bound={bound}
        label={topicLabel}
        onLabel={(next) => {
          if (next !== null) onCancelReply();
          setTopicLabel(next);
        }}
        onBind={(root) => {
          onCancelReply();
          onBind(root);
        }}
      />
      <p id={`${id}-hint`} class="hint">
        {hint} Ctrl+Enter (⌘+Enter) sends.
      </p>
      <p class="status" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

/** Buttons that open the contact pages of these people. */
export function People({ people, onPerson }: { people: readonly Person[]; onPerson: (address: string) => void }) {
  return (
    <>
      {people.map((p, i) => (
        <Fragment key={p.address}>
          {i > 0 ? ", " : null}
          <button type="button" class="person" data-address={p.address} onClick={() => onPerson(p.address)}>
            {p.name}
          </button>
        </Fragment>
      ))}
    </>
  );
}

interface MessagesProps {
  messages: readonly MessageView[];
  token: string;
  group: boolean;
  onPerson: (a: string) => void;
  now: Date | undefined;
  /** The chat's topics; a run of a topic gets a chip only when there is more than one and the timeline is not filtered. */
  topics?: readonly TopicView[];
  showRuns?: boolean;
  onReply?: (message: MessageView) => void;
  onQuote?: (messageId: string) => void;
  listRef?: Ref<HTMLOListElement>;
}

/** Messages oldest first, with a topic chip where a run of another topic starts. */
export function Messages({ messages, token, group, onPerson, now, topics = [], showRuns = false, onReply, onQuote, listRef }: MessagesProps) {
  const own = useRef<HTMLOListElement>(null);
  const list = (listRef ?? own) as { current: HTMLOListElement | null };
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "end" });
  }, [messages.length, messages[0]?.key]);
  const byRoot = new Map(topics.map((t) => [t.rootId, t]));
  return (
    <ol class="messages" aria-label="Messages" ref={list}>
      {messages.map((m) => {
        const topic = showRuns && m.topicStart && m.topic !== null ? byRoot.get(m.topic.rootId) : undefined;
        return (
          <Bubble
            key={m.key}
            message={m}
            token={token}
            group={group}
            onPerson={onPerson}
            {...(onQuote ? { onQuote } : {})}
            {...(onReply ? { onReply } : {})}
            {...(topic ? { topicChip: topicName(topic) } : {})}
            {...(now ? { now } : {})}
          />
        );
      })}
    </ol>
  );
}

/** "All topics ▾" in the chat header: the topics with their counts; choosing one shows only its messages. */
export function TopicsFilter({ topics, filter, onFilter }: { topics: readonly TopicView[]; filter: string | null; onFilter: (root: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const total = topics.reduce((n, t) => n + t.count, 0);
  const current = filter === null ? null : (topics.find((t) => t.rootId === filter) ?? null);
  const choose = (root: string | null): void => {
    setOpen(false);
    onFilter(root);
  };
  return (
    <div class="topics-filter">
      <button type="button" class="topics-button" aria-expanded={open ? "true" : "false"} aria-controls="topics-filter-list" onClick={() => setOpen(!open)}>
        {current === null ? "All topics" : topicName(current)} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul id="topics-filter-list" class="topic-menu" aria-label="Show topics">
          <li>
            <button type="button" aria-current={filter === null ? "true" : undefined} onClick={() => choose(null)}>
              All topics ({total})
            </button>
          </li>
          {topics.map((t) => (
            <li key={t.rootId}>
              <button type="button" data-root={t.rootId} aria-current={filter === t.rootId ? "true" : undefined} onClick={() => choose(t.rootId)}>
                {topicName(t)} ({t.count})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ChatProps {
  view: ChatView;
  token: string;
  headingRef: Ref<HTMLHeadingElement>;
  /** Sends into this chat; resolves with what was sent. */
  onSend: (request: Omit<SendRequest, "chatId" | "to">) => Promise<SendResult>;
  onPerson: (address: string) => void;
  now?: Date;
}

/**
 * An open chat: who is in it, the messages, and the box to write. The
 * composer is bound to a topic: the one the bridge suggests when the chat
 * opens, then whatever was last sent or chosen (a topic, a new name, or the
 * topic of the message being replied to); mail arriving in another topic
 * never moves it.
 */
export function ChatPane({ view, token, headingRef, onSend, onPerson, now }: ChatProps) {
  const { chat, messages, topics } = view;
  const [bound, setBound] = useState<string | null>(view.composerTopic);
  const [filter, setFilter] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const multi = topics.length > 1;
  const visible = filter === null ? messages : messages.filter((m) => m.topic?.rootId === filter);

  // A quote card shows the answered bubble: scroll to it and highlight it for a second.
  useEffect(() => {
    if (pending === null) return;
    const bubble = [...(list.current?.querySelectorAll<HTMLElement>("li.bubble") ?? [])].find((el) => el.dataset.messageId === pending);
    if (bubble === undefined) return;
    setPending(null);
    bubble.scrollIntoView?.({ block: "center", behavior: "smooth" });
    bubble.focus({ preventScroll: true });
    bubble.classList.add("highlight");
    setTimeout(() => bubble.classList.remove("highlight"), 1000);
  }, [pending, filter]);
  const show = (messageId: string): void => {
    if (!visible.some((m) => m.id === messageId)) setFilter(null);
    setPending(messageId);
  };

  const reply = (message: MessageView): void => {
    setReplyTo(message);
    if (message.topic !== null) setBound(message.topic.rootId);
    textarea.current?.focus();
  };

  const send = async (text: string, label: string | null): Promise<void> => {
    const request = replyTo !== null ? { text, replyTo: replyTo.id } : label !== null ? { text, topic: { label } } : bound !== null ? { text, topic: { root: bound } } : { text };
    const result = await onSend(request);
    setReplyTo(null);
    const sentTopic = result.message.topic?.rootId ?? null;
    if (sentTopic !== null) setBound(sentTopic);
    if (filter !== null && sentTopic !== filter) setFilter(sentTopic);
  };

  const first = chat.participants[0]?.name.split(" ")[0] ?? "";
  const hint = chat.emailSocial
    ? `${chat.group ? "Someone here" : first} uses Email Social: your message carries an Email Social part and asks for Delivered and Read.`
    : "Your message is sent as an ordinary e-mail (they do not use Email Social). To answer one message, choose Reply in its ⋯ menu: up to five lines of it are quoted below yours.";
  return (
    <section class="thread" aria-labelledby="thread-title">
      <header class="thread-header">
        <h2 id="thread-title" tabIndex={-1} ref={headingRef}>
          {chat.title}
        </h2>
        {chat.group ? (
          <p class="people">
            Group of {chat.participants.length + 1}: <People people={chat.participants} onPerson={onPerson} />, you
          </p>
        ) : chat.participants.length === 1 ? (
          <p class="people">
            <button type="button" class="person" data-address={chat.participants[0]!.address} onClick={() => onPerson(chat.participants[0]!.address)}>
              {chat.participants[0]!.address}
            </button>
          </p>
        ) : null}
        {multi ? (
          <TopicsFilter
            topics={topics}
            filter={filter}
            onFilter={(root) => {
              setFilter(root);
              if (root !== null) {
                setBound(root);
                setReplyTo(null);
              }
            }}
          />
        ) : null}
      </header>
      <Messages
        messages={visible}
        token={token}
        group={chat.group}
        onPerson={onPerson}
        now={now}
        topics={topics}
        showRuns={multi && filter === null}
        onReply={reply}
        onQuote={show}
        listRef={list}
      />
      <Composer
        id="reply"
        label={`Message to ${chat.title}`}
        hint={hint}
        onSend={send}
        topics={topics}
        bound={bound}
        onBind={setBound}
        replying={replyTo === null ? null : { name: replyTo.mine ? "yourself" : (replyTo.from?.name ?? "Unknown sender"), excerpt: shortExcerpt(replyTo.fresh !== "" ? replyTo.fresh : replyTo.text) }}
        onCancelReply={() => setReplyTo(null)}
        textareaRef={textarea}
      />
    </section>
  );
}

interface OtherProps {
  view: OtherView;
  token: string;
  headingRef: Ref<HTMLHeadingElement>;
  onPerson: (address: string) => void;
  now?: Date;
}

/** Messages from a list or an automated sender: read-only, no reply box. */
export function OtherPane({ view, token, headingRef, onPerson, now }: OtherProps) {
  return (
    <section class="thread" aria-labelledby="thread-title">
      <header class="thread-header">
        <h2 id="thread-title" tabIndex={-1} ref={headingRef}>
          {view.sender.title}
        </h2>
        <p class="people">
          {view.sender.kind === "list" ? "Mailing list or newsletter" : "Automated sender"} · {view.sender.address} · Read only
        </p>
      </header>
      <Messages messages={view.messages} token={token} group={true} onPerson={onPerson} now={now} />
    </section>
  );
}
