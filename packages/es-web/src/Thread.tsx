import type { ThreadView } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Bubble } from "./Bubble.js";

interface Props {
  thread: ThreadView;
  token: string;
  headingRef: Ref<HTMLHeadingElement>;
  onSend: (text: string) => Promise<void>;
}

function Composer({ to, onSend }: { to: string; onSend: (text: string) => Promise<void> }) {
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
      <label for="reply">Reply to {to}</label>
      <textarea
        id="reply"
        rows={3}
        value={text}
        aria-describedby="reply-hint"
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
      <p id="reply-hint" class="hint">
        Ctrl+Enter (⌘+Enter) sends.
      </p>
      <p class="status" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

/** The open conversation: its messages as bubbles, oldest first, and the reply box. */
export function Thread({ thread, token, headingRef, onSend }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const { conversation, messages } = thread;
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "end" });
  }, [conversation.id, messages.length]);
  const everyone = [...conversation.participants.map((p) => p.name), "you"].join(", ");
  return (
    <section class="thread" aria-labelledby="thread-title">
      <header class="thread-header">
        <h2 id="thread-title" tabIndex={-1} ref={headingRef}>
          {conversation.title}
        </h2>
        <p class="subject">{conversation.subject === "" ? "(no subject)" : conversation.subject}</p>
        {conversation.group ? <p class="people">Group of {conversation.participants.length + 1}: {everyone}</p> : null}
      </header>
      <ol class="messages" aria-label="Messages" ref={list}>
        {messages.map((m) => (
          <Bubble key={m.key} message={m} token={token} group={conversation.group} />
        ))}
      </ol>
      <Composer to={conversation.title} onSend={onSend} />
    </section>
  );
}
