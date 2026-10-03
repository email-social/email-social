import type { OtherSummary } from "@email-social/es-bridge/api";
import { listKeys } from "./ChatList.js";
import { formatFull, formatWhen, unreadLabel } from "./format.js";

interface Props {
  senders: readonly OtherSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  now: Date;
}

/** The collapsed "Other mail" section: mailing lists, newsletters and automated senders, read-only. */
export function OtherMail({ senders, selected, onSelect, now }: Props) {
  if (senders.length === 0) return null;
  const unread = senders.reduce((sum, s) => sum + s.unread, 0);
  const open = senders.some((s) => s.id === selected);
  return (
    <details class="other-mail" open={open || undefined}>
      <summary>
        Other mail{unread > 0 ? <span class="summary-count"> · {unreadLabel(unread)}</span> : null}
      </summary>
      <p class="hint">Mailing lists, newsletters and automated senders. Read only.</p>
      <ul class="chats" aria-label="Other mail" onKeyDown={listKeys}>
        {senders.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              class={s.unread > 0 ? "chat-row unread" : "chat-row"}
              aria-current={s.id === selected ? "true" : undefined}
              data-id={s.id}
              onClick={() => onSelect(s.id)}
            >
              <span class="row">
                <span class="title">{s.title}</span>
                <time dateTime={s.lastDate ?? undefined} title={formatFull(s.lastDate)}>
                  {formatWhen(s.lastDate, now)}
                </time>
              </span>
              <span class="row">
                <span class="last-line">{s.lastLine}</span>
                {s.unread > 0 ? (
                  <>
                    <span class="badge" aria-hidden="true">{s.unread}</span>
                    <span class="sr-only">{unreadLabel(s.unread)}</span>
                  </>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
