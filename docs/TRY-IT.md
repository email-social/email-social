# Try Email Social

Email Social runs on your computer. `email-social` starts a small local
service on `127.0.0.1` (your own machine only) and opens a web page where your
mailbox is shown as a messenger: one chat per person or group, whatever the
subjects. Your messages stay in your mailbox; the only
network connections are to your provider's IMAP server (to read) and SMTP
server (to send).

## 1. Install and build (once)

Requires Node.js 22.12 or later, and git.

```sh
git clone https://github.com/email-social/email-social.git
cd email-social
npm ci
npm run build
```

## 2. Try it without an account (offline)

```sh
npx email-social --demo
```

The terminal prints an address such as
`http://127.0.0.1:53817/#token=…` and the browser opens it (with `--no-open`,
open it yourself; it only works with the token). You should see 7 chats of
a demo mailbox belonging to "Alice", and below them a collapsed "Other mail"
with a mailing list and a newsletter. The newest chat is with Karel Holub
and has 3 unread messages. Opening a chat shows your messages on the right
and the others on the left, each with only what its sender wrote, never the
text their mail client quoted. A small card above a message appears only
where someone answered one specific message: who wrote that message and
what of it was answered (press the card to jump to it). The chat with Bob
Svoboda holds four topics (threads, each started under its own subject): a small
chip marks where each one starts, and **All topics ▾** at the top shows one
at a time. Typing in a chat continues the topic shown beside the text box;
**Reply** in a message's **⋯** menu answers that message. A message you send
is written into the demo folder printed in the terminal: `Sent/` gets your
copy, `Outbox/` what would have been sent, and nothing goes on the network.
Any `.eml` file you copy into its `INBOX/` appears within a few seconds.

You can also point it at any folder of `.eml` files (for example messages
saved from your mail client):

```sh
npx email-social --maildir ./my-mail --address you@example.com --name "Your Name"
```

`./my-mail/INBOX/*.eml` are received messages and `./my-mail/Sent/*.eml`
yours.

## 3. Manual smoke test with a real mailbox

**The maintainer runs these steps; the pull request records the result**
(table at the end). Use a test account, or an account where a few test
messages do no harm. Menu names at the providers change from time to time.
If a step does not match what you see, note it in the result.

Start Email Social without options:

```sh
npx email-social
```

The page shows **Sign in to your mailbox**.

### 3a. Gmail (with an app password)

1. In your Google Account, turn on **2-Step Verification** (Security → How
   you sign in to Google). Gmail app passwords need it.
2. Create an app password: Google Account → Security → 2-Step Verification →
   **App passwords** (or open `myaccount.google.com/apppasswords`). Name it
   "Email Social" and copy the 16-letter password.
3. In Gmail's settings, under **Forwarding and POP/IMAP**, check that IMAP
   access is enabled, if your account still shows that switch.
4. In Email Social, choose **Gmail**, enter your Gmail address and the app
   password (not your normal password), and optionally your name. Leave
   **Remember on this device** unticked for the first run. Click **Sign in**.

### 3b. Seznam.cz

1. In the Seznam.cz e-mail settings, make sure access for other e-mail
   programs (IMAP/SMTP) is allowed.
2. If your Seznam account uses two-step login, create an application
   password in the account's security settings and use it below. Otherwise
   use your normal password.
3. In Email Social, choose **Seznam.cz** (imap.seznam.cz:993 and
   smtp.seznam.cz:465, both TLS), enter the address and password, and click
   **Sign in**.

### 3c. Any other provider (generic IMAP/SMTP)

1. Look up your provider's IMAP and SMTP settings: host names, ports, and
   whether they use TLS (usually IMAP 993 / SMTP 465) or STARTTLS (usually
   IMAP 143 / SMTP 587). Email Social does not offer unencrypted connections.
2. Choose **Other provider (IMAP and SMTP)** and fill in both servers. If
   your login name is not your e-mail address, open **More** and enter it.
3. Click **Sign in**.

### What you should see (all providers)

| Step | Expected |
| --- | --- |
| Sign in | "Signing in as …" with a number that changes: seconds while connecting, then "Loading messages: 23 of 540". The chats appear once the newest 50 messages are in; a line at the top then shows "Loading older messages: … of …" until the rest is there. Nothing stays on "Signing in…" without a changing number. A wrong password shows the server's error in red above the form, and the password is not shown anywhere. If the server does not answer, the error and **Try again** appear within a minute. |
| Chat list | One row per person or group (at most the 500 newest messages of the inbox and of the sent folder), newest first, with names, the first line of what was last written (no quoted text) and an unread count that matches the unread messages from those people in your webmail's inbox. Someone who wrote under several subjects is one chat. |
| Other mail | Mailing lists, newsletters and automated senders (notifications, no-reply senders, delivery reports) are not chats: they are under the collapsed **Other mail**, read-only. |
| Open a chat | Bubbles in date order: your messages (from the sent folder) on the right labelled "You", the others on the left with the sender's name. Each bubble shows only what its sender wrote: no quoted text, not even behind a control (a reply written point by point keeps its quoted lines, greyed, under "answered point by point"); **Show signature** reveals the signature, and the **⋯** menu of a bubble offers **Reply** and **Open original**, which downloads the whole message as `.eml`. The unread count drops to 0, and the messages show as read in your webmail too. HTML-only mail shows as text with "Shown as plain text. Open original". |
| Quote card | A card appears only above a deliberate reply, with a coloured bar on the left: the name of the person answered in bold ("You" for your own message), what of their message was answered, and a 📎 with the file name when that message had an attachment. Pressing the card scrolls to that message and outlines it for a second. Cards appear above: your own replies made with **Reply**; replies from ordinary mail clients whose quote was cut down to a few lines of the message they answer; and Email Social messages whose sender chose **Reply** (also when the answered message is not in your mailbox; then the card cannot be pressed). A normal reply from Gmail, Outlook or another client, which quotes the whole message, has no card. There are no subject cards. |
| Topics | A chat with several threads shows a small chip on the first message of each run ("Ongoing chat" for the thread without a name) and **All topics ▾** in its header with the number of messages in each; choosing one shows only its messages and sets the text box to it. A chat with one thread shows neither. When someone's mail client changed the subject of a reply (for example a gateway adding "[EXTERNAL]"), that message shows one small "Subject: …" line and stays where it was. |
| Reply chip | **⋯ → Reply** on any message shows "Replying to <name> — <start of the message>" above the text box, with ✕ to cancel; the chip beside the box switches to that message's topic. |
| Attachments | Listed under the message by file name. Clicking downloads the file; "Open original" downloads the `.eml`. |
| Reply | Type in the box at the bottom and press Send (or Ctrl+Enter). The message appears on the right with only your text and no card. The recipient gets an ordinary e-mail whose text is readable in any client, as a reply in the same conversation ("Re: " and the thread's subject, the same for every message). If the recipient has never sent you an Email Social message, it is plain text only, with no attachment, nothing quoted, and the last line "Sent with Email Social. Reply as you normally would; this is an ordinary e-mail." under "-- ". With **Reply** chosen first, the bubble shows the card, and the e-mail quotes at most five lines of the message answered below your text ("On … wrote:" and "> " lines) before that footer. |
| New chat | **New chat**, type a name (suggestions come from your contacts) or any address and press Enter, then the text; there is no subject field. Optionally **+ Topic** and a name for the thread. Without a name the subject is "Message from <your name>" (with the other people's names in a group); with one, the name. The chat appears in the list; the recipient gets an ordinary e-mail. Several recipients make a group. |
| + Topic | In an open chat, **+ Topic** (or, in a chat with several threads, the chip beside the box → **New topic…**) and a name start a new thread: its first e-mail has the name as its subject and does not answer anything. Typing the same name again later continues that thread instead of starting another. |
| Contact page | Click a sender's name: names seen, address, first and last message, number of messages, the chat, attachments exchanged (download links) and groups you share. |
| Sent folder | Exactly one copy of each message in your webmail's Sent folder. For Gmail, Gmail stores it; for others, Email Social does. If you see two copies with a generic provider, sign in again with **More → Store a copy of sent messages** unticked, and note it in the result. |
| New mail | Send yourself a message from another account while the page is open: it appears without reloading, usually within seconds (IMAP IDLE) and at most within a minute, with an unread count. Reloading the page shows it too. A message you send from your webmail appears in the chat as yours within a minute. |
| Connection lost | Turn off the network for a minute while the page is open: the top line says "Reconnecting…"; after the network is back it disappears and new mail shows up again. |
| Remember on this device | Sign out, sign in again with the box ticked, stop `email-social` (Ctrl+C) and start it again: it signs in by itself. "Sign out and forget this device" removes the stored password from the keychain. On a system without a keychain the box cannot be ticked. |
| Network | Optional: while it runs, `lsof -i -P -n \| grep node` (macOS/Linux) lists connections only to your IMAP and SMTP servers and the local `127.0.0.1` port. |

### Two Email Social users (optional, receipts)

With two accounts that both run Email Social (A and B):

1. A replies in a chat where B has already sent an Email Social message.
   The copy in A's Sent folder has an `email-social.json` attachment after
   the text, and no quoted text (B's Email Social shows the chat).
2. When B's Email Social receives it, A's message shows **Delivered**. When B
   opens the chat, it shows **Read**. Each is sent once per message, and
   never to someone writing from an ordinary mail client.

### 3d. Topics and deliberate replies as the recipient sees them (Task 2d)

How Gmail, Outlook and Seznam.cz group what Email Social sends decides
whether a chat stays one conversation for the people you write to (see
`spec/DEVIATIONS.md` D23–D24; Seznam.cz does not document its rules). This
needs two accounts: **A** runs Email Social, **B** is read in the provider's
own webmail (Gmail, Outlook.com, Seznam.cz) and has never used Email Social.
Write `you@example.com` for any address you put in the results.

1. **Five continuations.** In A, start a **New chat** to B without a topic
   name and send five short messages one after another, without choosing
   **Reply**. In B's webmail, note how the inbox groups them (one
   conversation of five, or separate messages) and the subject they show
   ("Message from …", then "Re: Message from …").
2. **A deliberate reply.** From B's webmail, reply once to A. In A, use
   **⋯ → Reply** on that message and send. In B's webmail, note where the
   quote shows (below the text, collapsed behind "…", or not at all) and that
   it has at most five "> " lines, and whether the message joined the
   conversation of step 1.
3. **A changed subject.** In B's webmail, reply to A's latest message and
   change the subject to something else (the reply keeps its References).
   Note how B's webmail groups it (same conversation or a new one), and in A
   that the message stays in the chat with a small "Subject: …" line.
4. **A new named topic.** In A, open the chat, choose **+ Topic** (or the
   chip → **New topic…**), type a name and send. Note how B's webmail shows
   it (a new conversation with the name as its subject, or joined to the
   old one).
5. **The footer.** Open one of A's messages in B's webmail and note how the
   last line, "Sent with Email Social. Reply as you normally would; this is
   an ordinary e-mail.", appears (as a greyed signature, as plain text, or
   hidden) and whether an `email-social.json` attachment is shown (it should
   not be: B never sent an Email Social message).

## Results (filled in by the maintainer)

Task 2d rerun (topics and deliberate replies, section 3d), **open: to be
filled in by the maintainer's run before the merge**:

| Provider (recipient B) | Date | 1. Five continuations: how B's list groups them | 2. Where the deliberate reply's quote shows | 3. Same References, changed base subject: grouping | 4. How a new named topic appears | 5. What the footer looks like | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail | | | | | | | |
| Outlook (Outlook.com or Microsoft 365) | | | | | | | |
| Seznam.cz | | | | | | | |


Task 2b/2c rerun (messenger model with quote cards), to be filled in; the
Task 2 table is kept below it for comparison. Since Task 2d, "Subject cards"
no longer exist and "Reply quotes (plain)" applies to **⋯ → Reply** only.

| Provider | Date | Sign-in progress | Chat per person | Other mail | Fresh text only | Quote cards | Card jumps to parent | Subject cards | Open original | Reply quotes (plain) | New chat | Contact page | New mail live | Reconnecting | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail (app password) | | | | | | | | | | | | | | | |
| Seznam.cz | | | | | | | | | | | | | | | |
| Generic IMAP (provider: …) | | | | | | | | | | | | | | | |

Task 2 (first run):

| Provider | Date | Sign-in | List and unread | Bubbles | Reply received | Sent copy once | New mail | Remember | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail (app password) | | | | | | | | | |
| Seznam.cz | | | | | | | | | |
| Generic IMAP (provider: …) | | | | | | | | | |

If something does not match, write down the step, what you saw, and the
provider. The terminal where `email-social` runs prints errors, and those
lines are useful too. They can include your server's replies, so read them
before you share them.
