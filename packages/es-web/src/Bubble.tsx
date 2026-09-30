import type { MessageView } from "@email-social/es-bridge/api";
import { formatFull, formatSize, formatWhen, statusLabel, withToken } from "./format.js";
import { VerificationBadgeSlot } from "./VerificationBadgeSlot.js";

interface Props {
  message: MessageView;
  token: string;
  /** In a group every bubble names its sender; in a two-person chat only the side does. */
  group: boolean;
  /** Opens the contact page of an address. */
  onPerson: (address: string) => void;
  now?: Date;
}

/**
 * One message. Own messages are on the right and labelled "You"; the
 * others are on the left with the sender's name (a button to their page).
 * Only what the sender wrote is shown; quoted earlier messages and the
 * signature are behind "Show quoted text" and "Show signature". Text is
 * shown as text (never as HTML), with its line breaks.
 */
export function Bubble({ message, token, group, onPerson, now = new Date() }: Props) {
  const side = message.mine ? "right" : "left";
  const nothingNew = message.fresh === "";
  return (
    <li class={`bubble ${message.mine ? "mine" : "theirs"}`} data-side={side}>
      <p class={group || !message.mine ? "who" : "who sr-only"}>
        {message.mine || message.from === null ? (
          <span>{message.mine ? "You" : "Unknown sender"}</span>
        ) : (
          <button type="button" class="person" data-address={message.from.address} onClick={() => onPerson(message.from!.address)}>
            {message.from.name}
          </button>
        )}
        {message.from !== null && !message.mine ? <VerificationBadgeSlot address={message.from.address} /> : null}
      </p>
      {!nothingNew ? <p class="text">{message.fresh}</p> : message.quoted === "" && message.signature === "" ? <p class="text empty-text">(no text)</p> : null}
      {message.quoted !== "" ? (
        <details class="quoted" open={nothingNew || undefined}>
          <summary>Show quoted text</summary>
          <p class="text">{message.quoted}</p>
        </details>
      ) : null}
      {message.signature !== "" ? (
        <details class="signature" open={(nothingNew && message.quoted === "") || undefined}>
          <summary>Show signature</summary>
          <p class="text">{message.signature}</p>
        </details>
      ) : null}
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
