# Email Social

Email Social turns the mailbox you already have into a chat-like client. It shows one chat per person or group, whatever the subjects, and each message as a bubble with what its sender wrote rather than headers and quoted history. Every message it sends is an ordinary e-mail whose first part is the whole text as plain text, so anyone can read and answer it in any mail client. Your mailbox, reached over IMAP and SMTP, is the only place messages are stored: there is no server of ours, and nothing is sent to a third-party service. The message format and the rules for reading and grouping mail are written down in [`spec/es-protocol.md`](spec/es-protocol.md), with test vectors, so that other clients can work with it.

## Try it

With Node.js 22.12 or later, run `npm ci`, `npm run build` and `npx email-social --demo`: a browser page opens on a demo mailbox, and nothing goes on the network. [`docs/TRY-IT.md`](docs/TRY-IT.md) explains what you see, how to open a folder of `.eml` files, and how to sign in to your own IMAP account.

## Contribute

- Read [`CLAUDE.md`](CLAUDE.md) first: plain e-mail always works, no server of ours, no secrets or real addresses (fixtures use `example.com`, `example.org` and `example.net`), no claims, tests first.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) says how to build, test and submit a pull request. Report vulnerabilities as [`SECURITY.md`](SECURITY.md) describes, not in an issue.
- Work items are in [`tasks/`](tasks/), each with an acceptance test; one task is one pull request.
- `npm test` (which includes `npm run docs:check`), `npm run typecheck`, `npm run build`, `npm run test:browser`, `npm run test:e2e`, `npm run license:check` and `npm run audit:prod` run in CI on every pull request.
- A change to the protocol changes [`spec/es-protocol.md`](spec/es-protocol.md) together with the tests or vectors that cover it; where real mail clients do something other than the draft, [`spec/DEVIATIONS.md`](spec/DEVIATIONS.md) records it with the evidence.

## Licences

The specification in [`spec/`](spec/) is licensed under CC BY 4.0 ([`spec/LICENSE`](spec/LICENSE)). The code in [`packages/`](packages/) and [`scripts/`](scripts/) is licensed under Apache-2.0 ([`LICENSE`](LICENSE)).

Runtime dependencies are permissively licensed (MIT, MIT-0, Apache-2.0, BSD, ISC); there is no GPL, AGPL or unlicensed package. `npm run license:check` (`scripts/license-check.mjs`) checks every package in `package-lock.json` against these rules.

### MPL-2.0 build tools

These are used only to build the web client (Vite processes the stylesheet with them); nothing from them is shipped in the bundle.

- `lightningcss`, `lightningcss-*` (its platform binaries): CSS parsing and minification in Vite.
