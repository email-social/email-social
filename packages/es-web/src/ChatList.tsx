import type { ChatSummary } from "@email-social/es-bridge/api";
import { formatFull, formatWhen, unreadLabel } from "./format.js";

interface Props {
  chats: readonly ChatSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  now: Date;
}

/** Moves focus between the buttons of a list with the arrow keys (Home/End to the ends). */
export function listKeys(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.tagName !== "BUTTON") return;
  const buttons = [...(target.closest("ul")?.querySelectorAll<HTMLButtonElement>(":scope > li > button") ?? [])];
  const index = buttons.indexOf(target as HTMLButtonElement);
  const next =
    event.key === "ArrowDown" ? buttons[index + 1] : event.key === "ArrowUp" ? buttons[index - 1] : event.key === "Home" ? buttons[0] : event.key === "End" ? buttons[buttons.length - 1] : undefined;
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

/** One row per person or group, newest first: name, time, unread count and the last line. */
export function ChatList({ chats, selected, onSelect, now }: Props) {
  if (chats.length === 0) return <p class="empty">No chats yet. Start one with “New chat”.</p>;
  return (
    <ul class="chats" aria-label="Chats" onKeyDown={listKeys}>
      {chats.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            class={c.unread > 0 ? "chat-row unread" : "chat-row"}
            aria-current={c.id === selected ? "true" : undefined}
            data-id={c.id}
            onClick={() => onSelect(c.id)}
          >
            <span class="row">
              <span class="title">{c.title}</span>
              <time dateTime={c.lastDate ?? undefined} title={formatFull(c.lastDate)}>
                {formatWhen(c.lastDate, now)}
              </time>
            </span>
            <span class="row">
              <span class="last-line">
                {c.group ? <span class="group-label">Group of {c.participants.length + 1} · </span> : null}
                {c.lastFromMe ? `You: ${c.lastLine}` : c.lastLine}
              </span>
              {c.unread > 0 ? (
                <>
                  <span class="badge" aria-hidden="true">{c.unread}</span>
                  <span class="sr-only">{unreadLabel(c.unread)}</span>
                </>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
