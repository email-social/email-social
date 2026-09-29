# Try Email Social

Email Social runs on your computer. `email-social` starts a small local
service on `127.0.0.1` (your own machine only) and opens a web page where your
mailbox is shown as chats. Your messages stay in your mailbox; the only
network connections are to your provider's IMAP server (to read) and SMTP
server (to send).

## 1. Install and build (once)

Requires Node.js 22 and git.

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
open it yourself; it only works with the token). You should see 9
conversations of a demo mailbox belonging to "Alice". The newest is with
Karel Holub and has 3 unread messages. Opening a conversation shows your
messages on the right and the others on the left. A reply is written into
the demo folder printed in the terminal: `Sent/` gets your copy, `Outbox/`
what would have been sent, and nothing goes on the network.

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
| Sign in | "Signing in as …", then the conversation list. A wrong password shows the server's error in red above the form, and the password is not shown anywhere. |
| Conversation list | Your most recent conversations (at most the 500 newest messages of the inbox and of the sent folder), newest first, with names, the first line of the newest message and an unread count that matches the number of unread messages in your webmail's inbox for that conversation. |
| Open a conversation | Bubbles in date order: your messages (from the sent folder) on the right labelled "You", the others on the left with the sender's name. The unread count drops to 0, and the messages show as read in your webmail too. HTML-only newsletters show as text with "Shown as plain text. Open original". |
| Attachments | Listed under the message by file name. Clicking downloads the file; "Open original" downloads the `.eml`. |
| Reply | Type in the box at the bottom and press Send (or Ctrl+Enter). The reply appears on the right. The recipient gets an ordinary e-mail whose text is readable in any client. If the recipient has never sent you an Email Social message, it is plain text only, with no attachment. |
| Sent folder | Exactly one copy of the reply in your webmail's Sent folder. For Gmail, Gmail stores it; for others, Email Social does. If you see two copies with a generic provider, sign in again with **More → Store a copy of sent messages** unticked, and note it in the result. |
| New mail | Send yourself a message from another account: it appears within a few seconds (IMAP IDLE) with an unread count. |
| Remember on this device | Sign out, sign in again with the box ticked, stop `email-social` (Ctrl+C) and start it again: it signs in by itself. "Sign out and forget this device" removes the stored password from the keychain. On a system without a keychain the box cannot be ticked. |
| Network | Optional: while it runs, `lsof -i -P -n \| grep node` (macOS/Linux) lists connections only to your IMAP and SMTP servers and the local `127.0.0.1` port. |

### Two Email Social users (optional, receipts)

With two accounts that both run Email Social (A and B):

1. A replies in a conversation where B has already sent an Email Social
   message. The copy in A's Sent folder has an `email-social.json`
   attachment after the text.
2. When B's Email Social receives it, A's message shows **Delivered**. When B
   opens the conversation, it shows **Read**. Each is sent once per message,
   and never to someone writing from an ordinary mail client.

## Results (filled in by the maintainer)

| Provider | Date | Sign-in | List and unread | Bubbles | Reply received | Sent copy once | New mail | Remember | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail (app password) | | | | | | | | | |
| Seznam.cz | | | | | | | | | |
| Generic IMAP (provider: …) | | | | | | | | | |

If something does not match, write down the step, what you saw, and the
provider. The terminal where `email-social` runs prints errors, and those
lines are useful too. They can include your server's replies, so read them
before you share them.
