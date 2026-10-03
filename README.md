# Email Social

Email Social turns the mailbox you already have into a messenger. One chat per person instead of folders and threads, bubbles with what was written instead of headers and quoted history, and every message you send is still a normal e-mail that anyone can read in any client. There is no server of ours: your mailbox is the only place your messages live.

- Protocol specification: `spec/` (CC BY 4.0)
- Library, bridge and web client: `packages/` (Apache-2.0)
- Work items and their acceptance tests: `tasks/`

Status: `es-core` (Task 1), the local bridge with its web client (Task 2) and the messenger model (Task 2b: chats per person, clean bubbles, new chats, live updates; Task 2c: reply context as quote cards) are in place. To try it, see [`docs/TRY-IT.md`](docs/TRY-IT.md).

Requires Node.js 22.12 or later. `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`, `npm run test:e2e` and `npm run license:check` run in CI on every pull request.

## Dependencies and licences

Runtime dependencies are permissively licensed (MIT, MIT-0, Apache-2.0, BSD, ISC); there is no GPL, AGPL or unlicensed package. `npm run license:check` (`scripts/license-check.mjs`) checks every package in `package-lock.json` against these rules.

### MPL-2.0 build tools

These are used only to build the web client (Vite processes the stylesheet with them); nothing from them is shipped in the bundle.

- `lightningcss`, `lightningcss-*` (its platform binaries): CSS parsing and minification in Vite.

