# @email-social/es-web

The web client of Email Social: conversations as chats, served by
`es-bridge` on `127.0.0.1`. It is a small Preact app built with Vite. It
loads nothing from the internet and gets all data from the bridge's local API.

- Conversation list: names, the first line of the newest message and the
  unread count as a number, newest first. Arrow keys move through it.
- Conversation: bubbles, your messages on the right labelled "You", the
  others on the left. In a group, every bubble names its sender.
  Attachments are download links. HTML-only mail is shown as text with an
  "Open original" link.
- `VerificationBadgeSlot` sits next to sender names and renders nothing
  (an extension point).
- Accessibility basics: labelled controls, keyboard use (Tab, arrows,
  Enter, Escape back to the list, Ctrl+Enter to send), focus moved to an
  opened conversation, status announced to screen readers, WCAG AA contrast
  (checked by `test/contrast.test.ts`), and no state shown by colour alone.

`npm run build` writes `dist/`, which the bridge's build copies into its own
`dist/web`. `npm test` runs the component, formatting and contrast tests.

Licence: Apache-2.0.
