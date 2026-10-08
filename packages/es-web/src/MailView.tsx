import type { ChatSummary, ChatView, ContactDetail, ContactView, OtherSummary, OtherView, Person, SendRequest, SendResult, SyncStatus } from "@email-social/es-bridge/api";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "./api.js";
import { ChatList } from "./ChatList.js";
import { ChatPane, OtherPane } from "./ChatPane.js";
import { ContactPage } from "./ContactPage.js";
import { NewChat } from "./NewChat.js";
import { OtherMail } from "./OtherMail.js";
import { StatusBar } from "./Status.js";

interface Props {
  api: Api;
  account: Person;
  mode: "imap" | "maildir";
  /** Increases on every "changed" event from the bridge. */
  tick: number;
  sync: SyncStatus;
  /** The page's own connection to the bridge. */
  connected: boolean;
  onRetry: () => void;
  onSignOut: (forget: boolean) => Promise<void>;
  remembered: boolean;
}

/** What the right-hand pane shows. */
type Pane = { kind: "none" } | { kind: "chat"; id: string } | { kind: "other"; id: string } | { kind: "new"; to: string[] } | { kind: "contact"; address: string };

type Shown = { kind: "chat"; view: ChatView } | { kind: "other"; view: OtherView } | { kind: "contact"; contact: ContactDetail } | null;

export function MailView({ api, account, mode, tick, sync, connected, onRetry, onSignOut, remembered }: Props) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [others, setOthers] = useState<OtherSummary[]>([]);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [pane, setPane] = useState<Pane>({ kind: "none" });
  const [shown, setShown] = useState<Shown>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<Pane>(pane);
  paneRef.current = pane;

  const loadPane = async (target: Pane): Promise<void> => {
    let next: Shown = null;
    if (target.kind === "chat") {
      const view = await api.call<ChatView>(`/api/chats/${encodeURIComponent(target.id)}`).catch(() => null);
      next = view === null ? null : { kind: "chat", view };
    } else if (target.kind === "other") {
      const view = await api.call<OtherView>(`/api/other/${encodeURIComponent(target.id)}`).catch(() => null);
      next = view === null ? null : { kind: "other", view };
    } else if (target.kind === "contact") {
      const contact = await api.call<ContactDetail>(`/api/contacts/${encodeURIComponent(target.address)}`).catch(() => null);
      next = contact === null ? null : { kind: "contact", contact };
    }
    if (paneRef.current === target) setShown(next);
  };

  const refresh = async (): Promise<void> => {
    try {
      const [c, o] = await Promise.all([api.call<ChatSummary[]>("/api/chats"), api.call<OtherSummary[]>("/api/other")]);
      setChats(c);
      setOthers(o);
      await loadPane(paneRef.current);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, [tick]);

  useEffect(() => {
    const unread = (chats?.reduce((sum, c) => sum + c.unread, 0) ?? 0) + others.reduce((sum, o) => sum + o.unread, 0);
    document.title = unread > 0 ? `(${unread}) Email Social` : "Email Social";
  }, [chats, others]);

  const go = async (target: Pane): Promise<void> => {
    setPane(target);
    paneRef.current = target;
    setShown(null);
    if (target.kind === "new") {
      setContacts(await api.call<ContactView[]>("/api/contacts").catch(() => []));
      heading.current?.focus();
      return;
    }
    await loadPane(target);
    heading.current?.focus();
    if (target.kind === "chat" || target.kind === "other") {
      // Opening marks the messages read; the bridge sends any Read receipts that were asked for.
      await api.call(`/api/${target.kind === "chat" ? "chats" : "other"}/${encodeURIComponent(target.id)}/read`, { method: "POST", body: {} }).catch(() => undefined);
      await refresh();
    }
  };

  const send = async (request: SendRequest): Promise<SendResult> => {
    const result = await api.call<SendResult>("/api/messages", { method: "POST", body: request });
    if (request.chatId === undefined) await go({ kind: "chat", id: result.chatId });
    else await refresh();
    return result;
  };

  const selectedId = pane.kind === "chat" || pane.kind === "other" ? pane.id : null;
  const backToList = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || selectedId === null) return;
    document.querySelector<HTMLButtonElement>(`button[data-id="${CSS.escape(selectedId)}"]`)?.focus();
  };
  const person = (address: string): void => void go({ kind: "contact", address });

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
      <StatusBar sync={sync} connected={connected} onRetry={onRetry} />
      {error !== null ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      <div class="panes">
        <nav class="list-pane" aria-label="Chats">
          <div class="list-head">
            <h1>Chats</h1>
            <button type="button" class="new-chat-button" onClick={() => void go({ kind: "new", to: [] })}>
              New chat
            </button>
          </div>
          {chats === null ? (
            <p class="empty">Loading your mailbox…</p>
          ) : (
            <>
              <ChatList chats={chats} selected={pane.kind === "chat" ? pane.id : null} onSelect={(id) => void go({ kind: "chat", id })} now={new Date()} />
              <OtherMail senders={others} selected={pane.kind === "other" ? pane.id : null} onSelect={(id) => void go({ kind: "other", id })} now={new Date()} />
            </>
          )}
        </nav>
        <main class="thread-pane" onKeyDown={backToList}>
          {pane.kind === "new" ? (
            <NewChat contacts={contacts} initial={pane.to} headingRef={heading} onSend={async (request) => void (await send(request))} onCancel={() => void go({ kind: "none" })} />
          ) : shown?.kind === "chat" ? (
            <ChatPane key={shown.view.chat.id} view={shown.view} token={api.token} headingRef={heading} onPerson={person} onSend={(request) => send({ chatId: shown.view.chat.id, ...request })} />
          ) : shown?.kind === "other" ? (
            <OtherPane view={shown.view} token={api.token} headingRef={heading} onPerson={person} />
          ) : shown?.kind === "contact" ? (
            <ContactPage
              contact={shown.contact}
              token={api.token}
              headingRef={heading}
              onOpenChat={(id) => void go({ kind: "chat", id })}
              onWrite={(address) => void go({ kind: "new", to: [address] })}
            />
          ) : (
            <p class="empty">{pane.kind === "none" ? "Choose a chat, or start a new one." : "Loading…"}</p>
          )}
        </main>
      </div>
    </div>
  );
}
