import type { ConversationSummary } from "@email-social/es-bridge/api";
import { formatFull, formatWhen, unreadLabel } from "./format.js";

interface Props {
  conversations: readonly ConversationSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  now: Date;
}

/** Moves focus between conversation buttons with the arrow keys (Home/End to the ends). */
function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.tagName !== "BUTTON") return;
  const buttons = [...(target.closest("ul")?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const index = buttons.indexOf(target as HTMLButtonElement);
  const next =
    event.key === "ArrowDown" ? buttons[index + 1] : event.key === "ArrowUp" ? buttons[index - 1] : event.key === "Home" ? buttons[0] : event.key === "End" ? buttons[buttons.length - 1] : undefined;
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

export function ConversationList({ conversations, selected, onSelect, now }: Props) {
  if (conversations.length === 0) return <p class="empty">No conversations yet.</p>;
  return (
    <ul class="conversations" aria-label="Conversations" onKeyDown={onKeyDown}>
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            class={c.unread > 0 ? "conversation unread" : "conversation"}
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
              <span class="subject">
                {c.group ? <span class="group-label">Group of {c.participants.length + 1} · </span> : null}
                {c.subject === "" ? "(no subject)" : c.subject}
              </span>
              {c.unread > 0 ? (
                <>
                  <span class="badge" aria-hidden="true">{c.unread}</span>
                  <span class="sr-only">{unreadLabel(c.unread)}</span>
                </>
              ) : null}
            </span>
            <span class="last-line">{c.lastFromMe ? `You: ${c.lastLine}` : c.lastLine}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
