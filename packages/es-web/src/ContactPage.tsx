import type { ContactDetail } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { formatFull, formatSize, formatWhen, withToken } from "./format.js";
import { VerificationBadgeSlot } from "./VerificationBadgeSlot.js";

interface Props {
  contact: ContactDetail;
  token: string;
  headingRef: Ref<HTMLHeadingElement>;
  onOpenChat: (chatId: string) => void;
  /** Starts a new chat with this person. */
  onWrite: (address: string) => void;
  now?: Date;
}

function When({ iso, now }: { iso: string | null; now: Date }) {
  return iso === null ? <>—</> : <time dateTime={iso} title={formatFull(iso)}>{formatFull(iso) || formatWhen(iso, now)}</time>;
}

/** A person: names, address, first and last message, how many, the chat, attachments exchanged, shared groups. */
export function ContactPage({ contact, token, headingRef, onOpenChat, onWrite, now = new Date() }: Props) {
  const otherNames = contact.names.filter((n) => n !== contact.name);
  return (
    <section class="contact" aria-labelledby="contact-title">
      <header class="thread-header">
        <h2 id="contact-title" tabIndex={-1} ref={headingRef}>
          {contact.name}
        </h2>
        <p class="people">
          {contact.address}
          <VerificationBadgeSlot address={contact.address} />
        </p>
      </header>
      <div class="contact-body">
        <dl class="facts">
          {otherNames.length > 0 ? (
            <>
              <dt>Also known as</dt>
              <dd>{otherNames.join(", ")}</dd>
            </>
          ) : null}
          <dt>Messages</dt>
          <dd>
            {contact.count} message{contact.count === 1 ? "" : "s"}
          </dd>
          <dt>First message</dt>
          <dd>
            <When iso={contact.firstDate} now={now} />
          </dd>
          <dt>Last message</dt>
          <dd>
            <When iso={contact.lastDate} now={now} />
          </dd>
          <dt>Mail client</dt>
          <dd>{contact.emailSocial ? "Uses Email Social" : "An ordinary mail client"}</dd>
        </dl>
        <p class="actions">
          {contact.chatId !== null ? (
            <button type="button" onClick={() => onOpenChat(contact.chatId!)}>
              Open chat
            </button>
          ) : (
            <button type="button" onClick={() => onWrite(contact.address)}>
              Write a message
            </button>
          )}
        </p>
        <h3>Attachments</h3>
        {contact.attachments.length === 0 ? (
          <p class="empty">No attachments exchanged.</p>
        ) : (
          <ul class="attachments">
            {contact.attachments.map((a) => (
              <li key={`${a.path}`}>
                <a href={withToken(a.path, token)} download={a.filename}>
                  {a.filename}
                </a>{" "}
                <span class="size">({formatSize(a.size)})</span> · {a.fromMe ? "from you" : `from ${contact.name}`} · <When iso={a.date} now={now} />
              </li>
            ))}
          </ul>
        )}
        <h3>Groups you share</h3>
        {contact.groups.length === 0 ? (
          <p class="empty">None.</p>
        ) : (
          <ul class="groups">
            {contact.groups.map((g) => (
              <li key={g.id}>
                <button type="button" class="person" data-id={g.id} onClick={() => onOpenChat(g.id)}>
                  {g.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
