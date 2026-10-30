# Contributing to Email Social

Read [`CLAUDE.md`](CLAUDE.md) first: it holds the rules every change follows (plain e-mail always works, no server of ours, no secrets or real addresses, no claims, tests first, short permissive dependency list).

**Vulnerabilities are not reported here.** Do not open an issue or pull request for one; follow [`SECURITY.md`](SECURITY.md) instead.

## Build

You need Node.js 22.12 or later (the version in `.nvmrc` is what CI uses).

```sh
npm ci          # install exactly what package-lock.json lists
npm run build   # build es-core, es-web and es-bridge
```

## Test

```sh
npm test               # docs:check, then the unit tests of every package
npm run typecheck
npm run license:check  # licences of every package in package-lock.json
npm run test:browser   # needs Chromium, see below
npm run test:e2e       # web client in Chromium against the bridge
```

The browser and end-to-end tests need the Chromium build that matches `playwright-core`; `.github/workflows/ci.yml` shows how CI installs it. Tests are deterministic and use no real network.

`npm run audit:prod` runs `npm audit --omit=dev --audit-level=high`: it fails when a runtime dependency (a lockfile entry not marked `dev`, the same split `license:check` uses) has a high or critical advisory. It asks the npm registry for advisories, so it needs the network; CI runs it as its own job on every pull request. If it fails, update the dependency, or explain in the pull request why the advisory does not affect Email Social.

`npm run sbom` writes a CycloneDX software bill of materials to `sbom/`; see [`sbom/README.md`](sbom/README.md).

## Run the demo

```sh
npm run build
npx email-social --demo
```

A browser page opens on a demo mailbox and nothing goes on the network. [`docs/TRY-IT.md`](docs/TRY-IT.md) explains the rest.

## Submit a pull request

1. Pick the next work item in [`tasks/`](tasks/); one task is one pull request.
2. Write the failing test first, then the code.
3. Keep commits small, with messages that describe the behaviour, not the file names. Do not force-push.
4. Before pushing, run `npm test`, `npm run typecheck`, `npm run build` and `npm run license:check`. CI also runs the browser and end-to-end tests and `npm run audit:prod`.
5. Write a short plan in the pull request description, and list any choices the task left open under "Decisions".
6. A change to the protocol changes [`spec/es-protocol.md`](spec/es-protocol.md) together with the tests or vectors that cover it.

By contributing you agree that your contribution is licensed like the files it changes: Apache-2.0 for code, CC BY 4.0 for the specification.
