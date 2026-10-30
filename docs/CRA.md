# Email Social and the Cyber Resilience Act

This is the maintainer's working reading of Regulation (EU) 2024/2847 (the Cyber Resilience Act, "CRA") for this repository. It records what we think applies, to what, and what is in place. It is a planning note, not legal advice, and it changes when our reading or the project changes.

## What is what

| Artefact | Our reading |
| --- | --- |
| `es-core`, `es-web`, `es-bridge` (this repository, Apache-2.0, free of charge) | Free and open-source software (Art. 3(48)). On its own and not monetised it is not supplied in the course of a commercial activity (recitals 18 and 19). We follow the vulnerability handling below for it anyway, because the business edition is built from it. |
| `spec/` (CC BY 4.0) | A document, not a product with digital elements (Art. 3(1)). Not covered. |
| The business edition (planned, paid) | The product. The maintainer is its manufacturer (Art. 3(13)) and carries the obligations of Art. 13 and Art. 14 for the whole product, including the open-source packages it is built from. |
| Third-party dependencies (`package-lock.json`) | Components we integrate: due diligence when integrating them (Art. 13(5)), and we report vulnerabilities we find in them to their maintainers (Art. 13(6)). |

In our reading Email Social is neither an important product (Art. 7, Annex III) nor a critical product (Art. 8, Annex IV), so the business edition falls in the default category and can use internal control, module A (Art. 32(1)(a), Annex VIII).

## Dates (Art. 71)

- 10 December 2024: the CRA entered into force.
- 11 September 2026: the reporting obligations of Art. 14 apply, also to products placed on the market before 11 December 2027 (Art. 69(3)). An actively exploited vulnerability is reported through the single reporting platform (Art. 16) to the CSIRT designated as coordinator and to ENISA: early warning within 24 hours, notification within 72 hours, final report within 14 days after a corrective measure is available (Art. 14(1) and (2)). Severe incidents follow Art. 14(3) and (4). Users are informed (Art. 14(8)).
- 11 December 2027: all other obligations apply.

## Checklist

| Obligation | Where | Status |
| --- | --- | --- |
| Contact for reporting vulnerabilities, coordinated vulnerability disclosure policy (Annex I Part II points 5 and 6; Annex II) | [`SECURITY.md`](../SECURITY.md) | Done, except the contact address: `security@<domain>` is a placeholder the maintainer must fill in. |
| SBOM of the components (Annex I Part II point 1) | `npm run sbom`, [`sbom/README.md`](../sbom/README.md) | Done for the open-source workspace (CycloneDX from `package-lock.json`). Not yet attached to releases. |
| Known vulnerabilities in dependencies checked (Annex I Part II points 2 and 3) | CI job `audit` (`npm run audit:prod`) | Done for runtime dependencies, high and critical advisories. |
| Public advisories for fixed vulnerabilities (Annex I Part II point 4) | `SECURITY.md` (GitHub security advisories) | Process written; none published yet. |
| Reporting actively exploited vulnerabilities and severe incidents (Art. 14) | `SECURITY.md` mentions it | Not yet: no written internal procedure, no account on the single reporting platform, no named person. |
| Support period, at least five years unless the product is expected to be used for less (Art. 13(8); Annex II) | `SECURITY.md` "Versions that receive fixes" | Not yet for the business edition: its supported line and end date are placeholders. For the open-source packages: the current minor only. |
| Update mechanism; security updates free of charge and, where feasible, separate from feature updates (Annex I Part I point 2(c); Annex I Part II points 7 and 8) | — | Not yet. Users update with npm; there is no update notice or automatic update in `es-bridge`. |
| Cybersecurity risk assessment (Art. 13(2) and (3)) | — | Not yet. |
| Technical documentation (Art. 31, Annex VII) | — | Not yet. |
| Information and instructions for users (Art. 13, Annex II) | `README.md`, `docs/TRY-IT.md` cover use | Not yet as Annex II requires (manufacturer name and address, support period end date, and so on). |
| Conformity assessment, EU declaration of conformity, CE marking (Art. 32, Art. 28 and Annex V, Art. 30) | — | Not yet; needed before the business edition is placed on the market. |
| Due diligence on integrated components (Art. 13(5)) | `npm run license:check`, CLAUDE.md rule 8, `audit` job | Partly: licences, abandonment rule and known advisories are checked; nothing more is documented. |
