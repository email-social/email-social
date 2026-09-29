import type { MessageView } from "@email-social/es-bridge/api";
import { formatFull, formatSize, formatWhen, statusLabel, withToken } from "./format.js";
import { VerificationBadgeSlot } from "./VerificationBadgeSlot.js";

interface Props {
  message: MessageView;
  token: string;
  /** In a group every bubble names its sender; in a two-person chat only the side does. */
  group: boolean;
  now?: Date;
}

/**
 * One message. Own messages are on the right and labelled "You"; the
 * others are on the left with the sender's name. The text is shown as text
 * (never as HTML), with its line breaks.
 */
export function Bubble({ message, token, group, now = new Date() }: Props) {
  const side = message.mine ? "right" : "left";
  const sender = message.mine ? "You" : (message.from?.name ?? "Unknown sender");
  return (
    <li class={`bubble ${message.mine ? "mine" : "theirs"}`} data-side={side}>
      <p class={group || !message.mine ? "who" : "who sr-only"}>
        <span>{sender}</span>
        {message.from !== null && !message.mine ? <VerificationBadgeSlot address={message.from.address} /> : null}
      </p>
      {message.text !== "" ? <p class="text">{message.text}</p> : <p class="text empty-text">(no text)</p>}
      {message.textSource === "html" ? (
        <p class="note">
          Shown as plain text. <a href={withToken(message.originalPath, token)} download>Open original</a>
        </p>
      ) : null}
      {message.attachments.length > 0 ? (
        <ul class="attachments" aria-label="Attachments">
          {message.attachments.map((a) => (
            <li key={a.partId}>
              <a href={withToken(a.path, token)} download={a.filename}>
                {a.filename}
              </a>{" "}
              <span class="size">({formatSize(a.size)})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p class="meta">
        <time dateTime={message.date ?? undefined} title={formatFull(message.date)}>
          {formatWhen(message.date, now)}
        </time>
        {message.mine && message.status !== null ? <span class="status"> · {statusLabel(message.status)}</span> : null}
      </p>
    </li>
  );
}
