# Reporting a vulnerability

If you find a vulnerability in Email Social, please tell us privately first. Do not open a public issue, pull request or discussion for it.

**Contact:** `security@<domain>` — *placeholder: the maintainer replaces this with the real reporting address before publishing.*

Please include, as far as you can:

- the version or commit you looked at, and the package (`es-core`, `es-bridge`, `es-web`) or the part of the specification;
- what an attacker can do, and what they need to do it (for example "a crafted incoming e-mail", "access to the local machine");
- steps to reproduce, or a minimal message or test that shows it. Use `example.com`, `example.org` or `example.net` addresses, never real mailbox content.

## What happens after a report

1. **Acknowledgement:** we confirm that we received the report within 5 working days.
2. **Assessment:** we tell you whether we can reproduce it and how serious we think it is, within 14 days of the acknowledgement, and keep you informed while we work on it.
3. **Fix:** we aim to publish a fix within 90 days of the report. If that is not possible, we agree a later date with you and explain why.
4. **Coordinated disclosure:** we publish an advisory (a GitHub security advisory in this repository) when the fix is released, or at the agreed date. Please keep the details private until then. If we stop answering for more than 30 days, you may publish.
5. **Credit:** the advisory names you as the reporter, as you wish to be named, unless you ask to stay anonymous.

If the vulnerability is being actively exploited, we also notify the authorities as Regulation (EU) 2024/2847 (the Cyber Resilience Act) requires; see [`docs/CRA.md`](docs/CRA.md).

## Versions that receive fixes

| Line | Receives fixes |
| --- | --- |
| 0.1.x (the current minor release of `es-core`, `es-bridge`, `es-web`) | yes |
| older 0.x releases | no — please update to the current minor |
| business edition `<supported line>` | yes, until `<end date>` — *placeholder: the maintainer fills in the line and the end of its support period when the business edition is released* |

Fixes are released as a new patch version of the current minor; there are no back-ports to earlier minors of the open-source packages.

## Scope

In scope is what is in this repository: the specification in `spec/`, the packages in `packages/` (`es-core`, `es-bridge`, `es-web`), the scripts in `scripts/`, and the way they use their dependencies. Email Social runs on your own computer and talks to your own mail provider; there is no server of ours, so there is no hosted service to test. Out of scope are your mail provider's IMAP and SMTP servers, other mail clients, and vulnerabilities in a dependency that do not affect Email Social (please report those to the dependency's own maintainers; tell us too if Email Social is affected).
