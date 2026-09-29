import type { ConversationSummary, Person, ThreadView } from "@email-social/es-bridge/api";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "./api.js";
import { ConversationList } from "./ConversationList.js";
import { Thread } from "./Thread.js";

interface Props {
  api: Api;
  account: Person;
  mode: "imap" | "maildir";
  /** Increases on every "changed" event from the bridge. */
  tick: number;
  onSignOut: (forget: boolean) => Promise<void>;
  remembered: boolean;
}

export function MailView({ api, account, mode, tick, onSignOut, remembered }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const loadThread = async (id: string): Promise<void> => {
    const view = await api.call<ThreadView>(`/api/conversations/${encodeURIComponent(id)}`).catch(() => null);
    if (selectedRef.current === id) setThread(view);
  };

  const refresh = async (): Promise<void> => {
    try {
      setConversations(await api.call<ConversationSummary[]>("/api/conversations"));
      if (selectedRef.current !== null) await loadThread(selectedRef.current);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, [tick]);

  useEffect(() => {
    const unread = conversations?.reduce((sum, c) => sum + c.unread, 0) ?? 0;
    document.title = unread > 0 ? `(${unread}) Email Social` : "Email Social";
  }, [conversations]);

  const open = async (id: string): Promise<void> => {
    setSelected(id);
    selectedRef.current = id;
    await loadThread(id);
    heading.current?.focus();
    // Opening a conversation marks it read; the bridge sends any Read receipts that were asked for.
    await api.call(`/api/conversations/${encodeURIComponent(id)}/read`, { method: "POST", body: {} }).catch(() => undefined);
    await refresh();
  };

  const send = async (text: string): Promise<void> => {
    if (selected === null) return;
    await api.call(`/api/conversations/${encodeURIComponent(selected)}/messages`, { method: "POST", body: { text } });
    await refresh();
  };

  const backToList = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || selected === null) return;
    document.querySelector<HTMLButtonElement>(`button[data-id="${CSS.escape(selected)}"]`)?.focus();
  };

  return (
    <div class="app">
      <header class="top">
        <p class="brand">Email Social</p>
        <p class="account">
          {account.name === account.address ? account.address : `${account.name} <${account.address}>`}
          {mode === "maildir" ? " · local folder" : ""}
        </p>
        {mode === "imap" ? (
          <p class="sign-out">
            <button type="button" onClick={() => void onSignOut(false)}>
              Sign out
            </button>
            {remembered ? (
              <button type="button" onClick={() => void onSignOut(true)}>
                Sign out and forget this device
              </button>
            ) : null}
          </p>
        ) : null}
      </header>
      {error !== null ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      <div class="panes">
        <nav class="list-pane" aria-label="Conversations">
          <h1 class="sr-only">Conversations</h1>
          {conversations === null ? <p class="empty">Loading your mailbox…</p> : <ConversationList conversations={conversations} selected={selected} onSelect={(id) => void open(id)} now={new Date()} />}
        </nav>
        <main class="thread-pane" onKeyDown={backToList}>
          {thread !== null ? (
            <Thread thread={thread} token={api.token} headingRef={heading} onSend={send} />
          ) : (
            <p class="empty">{selected === null ? "Choose a conversation." : "Loading…"}</p>
          )}
        </main>
      </div>
    </div>
  );
}
