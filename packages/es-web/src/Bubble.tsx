import type { MessageView, ReplyContextView } from "@email-social/es-bridge/api";
import { formatFull, formatSize, formatWhen, statusLabel, withToken } from "./format.js";
import { VerificationBadgeSlot } from "./VerificationBadgeSlot.js";

interface Props {
  message: MessageView;
  token: string;
  /** In a group every bubble names its sender; in a two-person chat only the side does. */
  group: boolean;
  /** Opens the contact page of an address. */
  onPerson: (address: string) => void;
  /** Shows the answered message (by MessageView.id) when its quote card is pressed. */
  onQuote?: (messageId: string) => void;
  /** Ids of the messages a card can show (those in the same chat); every id when omitted. */
  quoteTargets?: ReadonlySet<string>;
  now?: Date;
}

/**
 * The card above a message, as messengers show it: who is answered and how
 * their message began (a button that shows it, when it is in this chat), or
 * the subject where a new one starts. It is the only place a subject or any
 * part of an earlier message appears.
 */
export function QuoteCard({ context, onQuote, quoteTargets }: { context: ReplyContextView | null; onQuote?: ((messageId: string) => void) | undefined; quoteTargets?: ReadonlySet<string> | undefined }) {
  if (context === null) return null;
  if (context.kind === "subject") {
    return (
      <p class="quote-card subject">
        <span class="quote-excerpt">{context.subject}</span>
      </p>
    );
  }
  const body = (
    <>
      <span class="sr-only">In reply to </span>
      <span class="quote-from">{context.fromMe ? "You" : context.from === "" ? "Unknown sender" : context.from}</span>
      {context.excerpt !== "" ? <span class="quote-excerpt">{context.excerpt}</span> : null}
      {context.attachment !== null ? (
        <span class="quote-attachment">
          <span aria-hidden="true">📎 </span>
          <span class="sr-only">Attachment: </span>
          {context.attachment}
        </span>
      ) : null}
    </>
  );
  if (onQuote === undefined || (quoteTargets !== undefined && !quoteTargets.has(context.messageId))) return <p class="quote-card">{body}</p>;
  return (
    <button type="button" class="quote-card" data-target={context.messageId} title="Show the message this answers" onClick={() => onQuote(context.messageId)}>
      {body}
    </button>
  );
}

/**
 * One message. Own messages are on the right and labelled "You"; the
 * others are on the left with the sender's name (a button to their page).
 * A quote card above the text says what the message answers. The bubble
 * shows only what the sender wrote, never what their mail client quoted;
 * the signature is behind "Show signature", and the whole message is under
 * ⋯ → "Open original". Text is shown as text (never as HTML), with its line
 * breaks.
 */
export function Bubble({ message, token, group, onPerson, onQuote, quoteTargets, now = new Date() }: Props) {
  const side = message.mine ? "right" : "left";
  return (
    <li class={`bubble ${message.mine ? "mine" : "theirs"}`} data-side={side} data-message-id={message.id} tabIndex={-1}>
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
      <QuoteCard context={message.replyContext} onQuote={onQuote} quoteTargets={quoteTargets} />
      {message.fresh !== "" ? <p class="text">{message.fresh}</p> : <p class="text empty-text">(no new text; the full message is under ⋯ → Open original)</p>}
      {message.signature !== "" ? (
        <details class="signature">
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
      <div class="meta">
        <time dateTime={message.date ?? undefined} title={formatFull(message.date)}>
          {formatWhen(message.date, now)}
        </time>
        {message.mine && message.status !== null ? <span class="status"> · {statusLabel(message.status)}</span> : null}
        <details class="message-menu">
          <summary aria-label="Message actions">⋯</summary>
          <ul>
            <li>
              <a href={withToken(message.originalPath, token)} download="">
                Open original
              </a>
            </li>
          </ul>
        </details>
      </div>
    </li>
  );
}
