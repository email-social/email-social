import type { MessageView, ReplyCardView } from "@email-social/es-bridge/api";
import { Fragment } from "preact";
import { EMAIL_SOCIAL_FOOTER, formatFull, formatSize, formatWhen, statusLabel, withToken } from "./format.js";
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
  /** Starts a deliberate reply to this message (the ⋯ menu offers "Reply" only when given). */
  onReply?: (message: MessageView) => void;
  /** The name of the topic this message starts a run of, shown as a chip; omitted for no chip. */
  topicChip?: string;
  now?: Date;
}

/** A quoted line, as es-core recognises one: ">" after at most three spaces or the U+FEFF iOS Mail writes. */
const QUOTE = /^[ \t﻿]{0,3}>/;

/**
 * The card above a deliberate reply, as messengers show it: who is answered
 * (bold) and what of their message (muted), with its attachment. A button
 * that shows the answered message when it is a bubble of this chat; plain
 * text otherwise (for example when it is not in the mailbox).
 */
export function QuoteCard({ card, onQuote }: { card: ReplyCardView | null; onQuote?: ((messageId: string) => void) | undefined }) {
  if (card === null) return null;
  const body = (
    <>
      <span class="sr-only">In reply to </span>
      <span class="quote-from">{card.fromMe ? "You" : card.from === "" ? "Unknown sender" : card.from}</span>
      {card.excerpt !== "" ? <span class="quote-excerpt">{card.excerpt}</span> : null}
      {card.attachment !== null ? (
        <span class="quote-attachment">
          <span aria-hidden="true">📎 </span>
          <span class="sr-only">Attachment: </span>
          {card.attachment}
        </span>
      ) : null}
    </>
  );
  const target = card.messageId;
  if (onQuote === undefined || !card.clickable || target === null) return <p class="quote-card">{body}</p>;
  return (
    <button type="button" class="quote-card" data-target={target} title="Show the message this answers" onClick={() => onQuote(target)}>
      {body}
    </button>
  );
}

/** What was written point by point: every line in place, the quoted ones muted and without their ">". */
function Interleaved({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      <p class="note">answered point by point</p>
      <p class="text interleaved">
        {lines.map((line, i) => (
          <Fragment key={i}>
            {QUOTE.test(line) ? <span class="quoted-line">{line.replace(/^[ \t﻿]{0,3}(?:>[ \t]?)+/, "")}</span> : <span class="plain-line">{line}</span>}
            {i < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </p>
    </>
  );
}

/**
 * One message. Own messages are on the right and labelled "You"; the
 * others are on the left with the sender's name (a button to their page).
 * A quote card above the text appears only on a deliberate reply. The
 * bubble shows only what the sender wrote, never what their mail client
 * quoted (an answer given point by point keeps its quoted lines, muted);
 * the signature is behind "Show signature", and the whole message is under
 * ⋯ → "Open original". Text is shown as text (never as HTML), with its line
 * breaks.
 */
export function Bubble({ message, token, group, onPerson, onQuote, onReply, topicChip, now = new Date() }: Props) {
  const side = message.mine ? "right" : "left";
  // The footer Email Social adds to plain e-mail is not worth a "Show signature" on one's own messages.
  const footerOnly = message.mine && message.signature.trimEnd().endsWith(EMAIL_SOCIAL_FOOTER);
  return (
    <li class={`bubble ${message.mine ? "mine" : "theirs"}`} data-side={side} data-message-id={message.id} tabIndex={-1}>
      {topicChip !== undefined ? (
        <p class="topic-run">
          <span class="sr-only">Topic: </span>
          {topicChip}
        </p>
      ) : null}
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
      <QuoteCard card={message.replyCard} onQuote={onQuote} />
      {message.subjectNote !== null ? <p class="note subject-note">Subject: {message.subjectNote}</p> : null}
      {message.fresh === "" ? (
        <p class="text empty-text">(no new text; the full message is under ⋯ → Open original)</p>
      ) : message.interleaved ? (
        <Interleaved text={message.fresh} />
      ) : (
        <p class="text">{message.fresh}</p>
      )}
      {message.signature !== "" && !footerOnly ? (
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
            {onReply !== undefined ? (
              <li>
                <button
                  type="button"
                  class="menu-reply"
                  onClick={(e) => {
                    (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
                    onReply(message);
                  }}
                >
                  Reply
                </button>
              </li>
            ) : null}
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
