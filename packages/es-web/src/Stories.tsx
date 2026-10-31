import type { StorySender, StoryView, UnsubscribeTarget } from "@email-social/es-bridge/api";
import type { Ref } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatFull, formatWhen } from "./format.js";
import { STORY_SANDBOX, storyDocument } from "./story-document.js";

export { STORY_SANDBOX, storyDocument, storyPolicy, withImages } from "./story-document.js";

/** Up to two initials of a name (its first two words), else the first letter of the address. */
export function initials(name: string, address: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => [...w].find((c) => /\p{L}|\p{N}/u.test(c)))
    .filter((c): c is string => c !== undefined);
  const letters = words.length > 0 ? words.slice(0, 2).join("") : ([...address][0] ?? "?");
  return letters.toLocaleUpperCase();
}

/** The senders shown in the strip: those not already in the chat list. */
export function stripSenders(senders: readonly StorySender[]): StorySender[] {
  return senders.filter((s) => !s.chat);
}

interface StripProps {
  senders: readonly StorySender[];
  /** The message open in the viewer, if any. */
  open: string | null;
  onOpen: (messageId: string) => void;
}

/**
 * The stories at the top of the chat list: one circle per sender, newest
 * first, with a ring while it has an unseen story. Nothing when there is
 * no story to show.
 */
export function StoriesStrip({ senders, open, onOpen }: StripProps) {
  const shown = stripSenders(senders);
  if (shown.length === 0) return null;
  return (
    <section class="stories" aria-label="Stories">
      <ul>
        {shown.map((s) => {
          const unseen = s.stories.filter((story) => !story.seen).length;
          const first = s.stories.find((story) => !story.seen) ?? s.stories[0]!;
          return (
            <li key={s.sender.address}>
              <button
                type="button"
                class={unseen > 0 ? "story-circle unseen" : "story-circle"}
                data-sender={s.sender.address}
                aria-current={s.stories.some((story) => story.messageId === open) ? "true" : undefined}
                aria-label={`${s.sender.name}: ${unseen > 0 ? `${unseen} new` : "seen"}`}
                title={s.sender.name}
                onClick={() => onOpen(first.messageId)}
              >
                <span class="initials" aria-hidden="true">
                  {initials(s.sender.name, s.sender.address)}
                </span>
                <span class="story-name" aria-hidden="true">
                  {s.sender.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What the Unsubscribe button says, by kind (spec section 12.3). */
export function unsubscribeLabel(target: UnsubscribeTarget): string {
  return target.kind === "oneClick" ? "Unsubscribe (one tap)" : target.kind === "mailto" ? "Unsubscribe by e-mail" : "Unsubscribe (opens a page)";
}

/** The confirmation: where the request goes. */
export function unsubscribeQuestion(target: UnsubscribeTarget): string {
  if (target.kind === "oneClick") return `Send an unsubscribe request to ${target.host}?`;
  if (target.kind === "mailto") return `Send an unsubscribe e-mail to ${target.address} (subject “${target.subject}”)?`;
  return `Open the sender's unsubscribe page (${new URL(target.url).host}) in a new window?`;
}

interface ViewerProps {
  view: StoryView;
  now: Date;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Images were asked for in this story (they never carry over to another one). */
  images: boolean;
  onLoadImages: () => void;
  onUnsubscribe: (target: UnsubscribeTarget) => Promise<void>;
  onHide: () => Promise<void>;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  /** A sentence about the last action (what was done, or what went wrong). */
  notice: string | null;
}

/**
 * One story: the reduced HTML in a sandboxed frame that may run nothing and
 * load nothing, or the text of a text-only message. Images load only after
 * the reader asks, for this story only; Unsubscribe asks first and names
 * where it goes. Left and right arrows move between stories.
 */
export function StoryViewer({ view, now, headingRef, images, onLoadImages, onUnsubscribe, onHide, onPrevious, onNext, onClose, notice }: ViewerProps) {
  const [askingImages, setAskingImages] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Left and right move between stories wherever the focus is, except in a field being typed in.
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (event.key === "ArrowLeft" && onPrevious !== null) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && onNext !== null) {
        event.preventDefault();
        onNext();
      } else if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onPrevious, onNext, onClose]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const target = view.unsubscribe;
  return (
    <section class="story-viewer" aria-labelledby="story-title">
      <header class="story-head">
        <p class="story-sender">
          {view.sender.name}
          {view.sender.name !== view.sender.address ? <span class="address"> {view.sender.address}</span> : null}
        </p>
        <h2 id="story-title" tabIndex={-1} ref={headingRef}>
          {view.title}
        </h2>
        <p class="story-meta">
          <time dateTime={view.receivedAt} title={formatFull(view.receivedAt)}>
            {formatWhen(view.receivedAt, now)}
          </time>
          {" · shown until "}
          <time dateTime={view.expiresAt} title={formatFull(view.expiresAt)}>
            {formatFull(view.expiresAt)}
          </time>
        </p>
        <p class="story-nav">
          <button type="button" onClick={() => onPrevious?.()} disabled={onPrevious === null} aria-label="Previous story">
            ←
          </button>
          <button type="button" onClick={() => onNext?.()} disabled={onNext === null} aria-label="Next story">
            →
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </p>
      </header>
      {view.html !== null ? (
        <>
          {view.images > 0 && !images ? (
            <div class="story-images">
              {askingImages ? (
                <p>
                  Loading images tells the sender that you opened this message.{" "}
                  <button type="button" onClick={onLoadImages}>
                    Load images
                  </button>{" "}
                  <button type="button" onClick={() => setAskingImages(false)}>
                    Not now
                  </button>
                </p>
              ) : (
                <button type="button" onClick={() => setAskingImages(true)}>
                  Load images
                </button>
              )}
            </div>
          ) : null}
          <iframe
            class="story-frame"
            title={`Story from ${view.sender.name}`}
            sandbox={STORY_SANDBOX}
            referrerpolicy="no-referrer"
            srcdoc={storyDocument(view.html, images)}
          />
        </>
      ) : (
        <div class="story-text">{view.text}</div>
      )}
      <footer class="story-actions">
        {notice !== null ? (
          <p class="story-notice" role="status">
            {notice}
          </p>
        ) : null}
        {confirming && target !== null ? (
          <p class="story-confirm" role="group" aria-label="Confirm unsubscribe">
            {unsubscribeQuestion(target)}{" "}
            <button type="button" disabled={busy} onClick={() => void run(() => onUnsubscribe(target))}>
              Unsubscribe
            </button>{" "}
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </p>
        ) : (
          <p>
            {target !== null ? (
              <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
                {unsubscribeLabel(target)}
              </button>
            ) : (
              <span class="hint">This sender gives no way to unsubscribe.</span>
            )}{" "}
            <button type="button" disabled={busy} onClick={() => void run(onHide)}>
              Hide sender
            </button>
          </p>
        )}
      </footer>
    </section>
  );
}
