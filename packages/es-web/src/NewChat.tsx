import type { ContactView, SendRequest } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { useState } from "preact/hooks";
import { TopicControl } from "./ChatPane.js";
import { parseRecipient } from "./format.js";

interface Props {
  contacts: readonly ContactView[];
  /** Sends the first message; resolves when it is sent. */
  onSend: (request: SendRequest) => Promise<void>;
  onCancel: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Recipients to start with (from a contact page). */
  initial?: readonly string[];
}

/**
 * A new chat: recipients (suggested from contacts, any address accepted), the
 * text, and optionally a topic name (the same "+ Topic" control as in a chat).
 * There is no subject field: without a name the bridge writes the carrier
 * subject, "Message from" and the account's name.
 */
export function NewChat({ contacts, onSend, onCancel, headingRef, initial = [] }: Props) {
  const [recipients, setRecipients] = useState<string[]>([...initial]);
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const names = new Map(contacts.map((c) => [c.address, c.name]));

  /** Adds what is typed; returns the recipients, or null (with a message) when it is not an address. */
  const add = (): string[] | null => {
    if (pending.trim() === "") return recipients;
    const address = parseRecipient(pending);
    if (address === null) {
      setStatus(`Not an e-mail address: ${pending.trim()}`);
      return null;
    }
    const next = recipients.includes(address) ? recipients : [...recipients, address];
    setRecipients(next);
    setPending("");
    setStatus("");
    return next;
  };

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const to = add();
    if (to === null || busy) return;
    if (to.length === 0) {
      setStatus("Add at least one recipient.");
      return;
    }
    const text = String(data.get("text") ?? "");
    if (text.trim() === "") {
      setStatus("Write a message first.");
      return;
    }
    const label = topic === null ? "" : topic.replace(/\s+/g, " ").trim();
    setBusy(true);
    setStatus("Sending…");
    try {
      await onSend({ to, text, ...(label !== "" ? { topic: { label } } : {}) });
    } catch (e) {
      setStatus(`Not sent: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="new-chat" aria-labelledby="new-chat-title" onSubmit={submit}>
      <h2 id="new-chat-title" tabIndex={-1} ref={headingRef}>
        New chat
      </h2>
      <label for="recipient">To</label>
      {recipients.length > 0 ? (
        <ul class="recipients" aria-label="Recipients">
          {recipients.map((address) => (
            <li key={address}>
              {names.get(address) ?? address}
              <button type="button" aria-label={`Remove ${names.get(address) ?? address}`} onClick={() => setRecipients(recipients.filter((r) => r !== address))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id="recipient"
        list="contact-options"
        autocomplete="off"
        aria-describedby="recipient-hint"
        value={pending}
        onInput={(e) => setPending((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
      <p id="recipient-hint" class="hint">
        Type a name or any e-mail address and press Enter. Several recipients make a group.
      </p>
      <datalist id="contact-options">
        {contacts.map((c) => (
          <option key={c.address} value={`${c.name} <${c.address}>`} />
        ))}
      </datalist>
      <label for="text">Message</label>
      <textarea id="text" name="text" rows={5} />
      <TopicControl id="new-chat" topics={[]} bound={null} label={topic} onLabel={setTopic} onBind={() => undefined} />
      <p class="actions">
        <button type="submit" disabled={busy}>
          Send
        </button>{" "}
        <button type="button" class="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
      <p class="status" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
