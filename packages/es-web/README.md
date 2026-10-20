# @email-social/es-web

The web client of Email Social: your mailbox as a messenger, served by
`es-bridge` on `127.0.0.1`. It is a small Preact app built with Vite. It
loads nothing from the internet and gets all data from the bridge's local API.

- **Chats.** One row per person or group (everything exchanged with the
  same people, whatever the subject), newest first: names, the first line of
  what was last written and the unread count as a number. Arrow keys move
  through the list. Mailing lists, newsletters and automated senders are in
  a collapsed, read-only "Other mail" section below.
- **Bubbles.** Your messages on the right labelled "You", the others on the
  left; in a group every bubble names its sender. A bubble shows only what
  the sender wrote, never the text their mail client quoted (an answer given
  point by point keeps its quoted lines, muted, under "answered point by
  point"). A quote card appears only above a deliberate reply, as messengers
  do: the answered sender in bold, what of their message is answered, its
  attachment, with an accent bar; pressing the card scrolls to that message
  and highlights it. A subject changed by another mail client shows as one
  small line on that bubble. The signature is behind "Show signature" (not
  for the footer Email Social adds to your own plain messages), and the ⋯
  menu offers "Reply" and "Open original" (the raw `.eml`). Attachments are
  download links; HTML-only mail is shown as text with an "Open original"
  link.
- **Topics.** A chat can hold several topics (threads). When it does, a chip
  marks where a run of another topic starts, and "All topics ▾" in the header
  lists them with counts and shows one at a time. There is no subject
  anywhere.
- **Writing.** The box under a chat is bound to a topic: the one you last
  wrote in when the chat opens, then whatever you last sent or chose; mail
  arriving in another topic never moves it. Beside it, "+ Topic" names a new
  topic (in a chat with several topics the chip names the bound one and
  offers the others and "New topic…"). "Reply" in a message's ⋯ menu shows
  "Replying to …" above the box and sends a deliberate reply. The hint says
  how the message is sent (with an Email Social part, or as an ordinary
  e-mail). "New chat" takes recipients (suggested from your contacts, any
  address accepted, several make a group), the text and an optional topic.
- **People.** A sender's name opens their page: names seen, address, first
  and last message, number of messages, the chat, attachments exchanged and
  the groups you share.
- **Progress.** Signing in shows the step and a number that changes
  (seconds, then messages loaded); afterwards a status line shows older
  messages still loading, "Reconnecting…" while the bridge or the mail
  server is away, and errors with "Try again".
- `VerificationBadgeSlot` sits next to sender names and renders nothing
  (an extension point).
- Accessibility basics: labelled controls, keyboard use (Tab, arrows,
  Enter, Escape back to the list, Ctrl+Enter to send), focus moved to what
  was opened, status announced to screen readers, WCAG AA contrast (checked
  by `test/contrast.test.ts`), and no state shown by colour alone.

`npm run build` writes `dist/`, which the bridge's build copies into its own
`dist/web`. `npm test` runs the component, formatting and contrast tests.

Licence: Apache-2.0.
