import type {
  ChatSummary,
  ChatView,
  ContactDetail,
  ContactView,
  OtherSummary,
  OtherView,
  Person,
  SendRequest,
  SendResult,
  StorySender,
  StoryView,
  SyncStatus,
  UnsubscribeResult,
  UnsubscribeTarget,
} from "@email-social/es-bridge/api";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "./api.js";
import { ChatList } from "./ChatList.js";
import { ChatPane, OtherPane } from "./ChatPane.js";
import { ContactPage } from "./ContactPage.js";
import { NewChat } from "./NewChat.js";
import { OtherMail } from "./OtherMail.js";
import { StatusBar } from "./Status.js";
import { StoriesStrip, StoryViewer, stripSenders } from "./Stories.js";

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
type Pane =
  | { kind: "none" }
  | { kind: "chat"; id: string }
  | { kind: "other"; id: string }
  | { kind: "new"; to: string[] }
  | { kind: "contact"; address: string }
  | { kind: "story"; messageId: string };

type Shown = { kind: "chat"; view: ChatView } | { kind: "other"; view: OtherView } | { kind: "contact"; contact: ContactDetail } | { kind: "story"; view: StoryView } | null;

export function MailView({ api, account, mode, tick, sync, connected, onRetry, onSignOut, remembered }: Props) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [others, setOthers] = useState<OtherSummary[]>([]);
  const [stories, setStories] = useState<StorySender[]>([]);
  /** The story whose images the reader asked for; never carried over to another story. */
  const [imagesFor, setImagesFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    } else if (target.kind === "story") {
      // Opening marks the message seen; it sends no receipt and loads nothing from the sender.
      const view = await api.call<StoryView>("/api/stories/open", { method: "POST", body: { messageId: target.messageId } }).catch(() => null);
      next = view === null ? null : { kind: "story", view };
    }
    if (paneRef.current === target) setShown(next);
  };

  const refresh = async (): Promise<void> => {
    try {
      const [c, o, s] = await Promise.all([api.call<ChatSummary[]>("/api/chats"), api.call<OtherSummary[]>("/api/other"), api.call<StorySender[]>("/api/stories")]);
      setChats(c);
      setOthers(o);
      setStories(s);
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
    setNotice(null);
    if (target.kind !== "story" || target.messageId !== imagesFor) setImagesFor(null);
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

  // Stories in strip order, each sender's newest first: what left and right move through.
  const storyOrder = stripSenders(stories).flatMap((s) => s.stories.map((story) => story.messageId));
  const storyAt = (offset: number): (() => void) | null => {
    if (pane.kind !== "story") return null;
    const index = storyOrder.indexOf(pane.messageId);
    const next = index < 0 ? (offset > 0 ? storyOrder[0] : undefined) : storyOrder[index + offset];
    return next === undefined ? null : () => void go({ kind: "story", messageId: next });
  };
  const unsubscribe = async (messageId: string, target: UnsubscribeTarget): Promise<void> => {
    // A page opens in its own window, without this page as referrer; the bridge makes no request for it.
    if (target.kind === "link") window.open(target.url, "_blank", "noopener,noreferrer");
    try {
      const result = await api.call<UnsubscribeResult>("/api/stories/unsubscribe", { method: "POST", body: { messageId } });
      const done =
        result.done === "oneClick" ? `Unsubscribe request sent to ${result.host}.` : result.done === "mailto" ? `Unsubscribe e-mail sent to ${result.address}.` : "The unsubscribe page opened in a new window.";
      setNotice(`${done} This sender's stories are hidden; their messages stay under Other mail.`);
    } catch (e) {
      setNotice(`Could not unsubscribe: ${e instanceof Error ? e.message : String(e)}`);
    }
    await refresh();
  };
  const hide = async (address: string): Promise<void> => {
    try {
      await api.call("/api/stories/hide", { method: "POST", body: { sender: address } });
      setNotice("This sender's stories are hidden; their messages stay under Other mail.");
    } catch (e) {
      setNotice(`Could not hide the sender: ${e instanceof Error ? e.message : String(e)}`);
    }
    await refresh();
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
              <StoriesStrip senders={stories} open={pane.kind === "story" ? pane.messageId : null} onOpen={(messageId) => void go({ kind: "story", messageId })} />
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
          ) : shown?.kind === "story" ? (
            <StoryViewer
              key={shown.view.messageId}
              view={shown.view}
              now={new Date()}
              headingRef={heading}
              images={imagesFor === shown.view.messageId}
              onLoadImages={() => setImagesFor(shown.view.messageId)}
              onUnsubscribe={(target) => unsubscribe(shown.view.messageId, target)}
              onHide={() => hide(shown.view.sender.address)}
              onPrevious={storyAt(-1)}
              onNext={storyAt(1)}
              onClose={() => void go({ kind: "none" })}
              notice={notice}
            />
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
