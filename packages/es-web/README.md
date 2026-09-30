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
  the sender wrote: quoted earlier messages and the signature are behind
  "Show quoted text" and "Show signature". A small separator marks where
  the subject changes. Attachments are download links; HTML-only mail is
  shown as text with an "Open original" link.
- **Writing.** The box under a chat replies to everyone in it and says how
  the message is sent (with an Email Social part, or as an ordinary e-mail
  with the answered message quoted below). "New chat" takes recipients
  (suggested from your contacts, any address accepted, several make a
  group), an optional subject and the text.
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
