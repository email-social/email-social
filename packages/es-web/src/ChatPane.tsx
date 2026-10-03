import type { ChatView, MessageView, OtherView, Person } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Bubble } from "./Bubble.js";

/** The text box at the bottom of a chat; Ctrl+Enter sends. */
export function Composer({ id, label, hint, onSend }: { id: string; label: string; hint: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const send = async (): Promise<void> => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    setStatus("Sending…");
    try {
      await onSend(text);
      setText("");
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
      <textarea
        id={id}
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

/**
 * Messages oldest first. A quote card shows the message it answers: pressing
 * it scrolls to that bubble and highlights it for a second.
 */
function Messages({ messages, token, group, onPerson, now }: { messages: readonly MessageView[]; token: string; group: boolean; onPerson: (a: string) => void; now: Date | undefined }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "end" });
  }, [messages.length, messages[0]?.key]);
  const targets = new Set(messages.map((m) => m.id));
  const show = (messageId: string): void => {
    const bubble = [...(list.current?.querySelectorAll<HTMLElement>("li.bubble") ?? [])].find((el) => el.dataset.messageId === messageId);
    if (bubble === undefined) return;
    bubble.scrollIntoView?.({ block: "center", behavior: "smooth" });
    bubble.focus({ preventScroll: true });
    bubble.classList.add("highlight");
    setTimeout(() => bubble.classList.remove("highlight"), 1000);
  };
  return (
    <ol class="messages" aria-label="Messages" ref={list}>
      {messages.map((m) => (
        <Bubble key={m.key} message={m} token={token} group={group} onPerson={onPerson} onQuote={show} quoteTargets={targets} {...(now ? { now } : {})} />
      ))}
    </ol>
  );
}

interface ChatProps {
  view: ChatView;
  token: string;
  headingRef: Ref<HTMLHeadingElement>;
  onSend: (text: string) => Promise<void>;
  onPerson: (address: string) => void;
  now?: Date;
}

/** An open chat: who is in it, the messages, and the box to reply. */
export function ChatPane({ view, token, headingRef, onSend, onPerson, now }: ChatProps) {
  const { chat, messages } = view;
  const first = chat.participants[0]?.name.split(" ")[0] ?? "";
  const hint = chat.emailSocial
    ? `${chat.group ? "Someone here" : first} uses Email Social: your message carries an Email Social part and asks for Delivered and Read.`
    : "Your message is sent as an ordinary e-mail, with the message you answer quoted below it (they do not use Email Social).";
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
      </header>
      <Messages messages={messages} token={token} group={chat.group} onPerson={onPerson} now={now} />
      <Composer id="reply" label={`Message to ${chat.title}`} hint={hint} onSend={onSend} />
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
