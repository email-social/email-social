# J43 report: Cyber Resilience Act groundwork

Nothing is committed. The working-tree changes are in `J43.patch`, and `J43.status` lists the files.

## What was added or changed

| File | What |
| --- | --- |
| `SECURITY.md` (new) | How to report (one placeholder address), what happens after a report (acknowledgement within 5 working days, assessment within 14 days, fix aimed within 90 days, coordinated disclosure through a GitHub security advisory, a 30-day silence rule, credit), which versions get fixes (0.1.x, plus a placeholder row for the business edition), and scope (this repository; no server of ours). |
| `CONTRIBUTING.md` (new) | Build, test, demo, pull requests, `audit:prod`, `sbom`. Vulnerabilities go to `SECURITY.md`, not to issues. |
| `docs/CRA.md` (new) | The maintainer's reading: which artefact is what under the CRA, the dates (Art. 71, 69(3), 14), and a checklist citing the articles and annexes. Items that are not in place say "Not yet". |
| `sbom/README.md` (new) | How to regenerate the SBOM. |
| `scripts/sbom.mjs` (new) | Runs `npm sbom` and writes `sbom/email-social.cdx.json`. |
| `package.json` | Scripts `sbom` and `audit:prod`. Added `"version": "0.1.0"` to the private root (see "Decisions"). |
| `package-lock.json` | The same `"version": "0.1.0"` in its two root fields. No dependency changed. |
| `.gitignore` | `sbom/*` is ignored, except `sbom/README.md`. |
| `.github/workflows/ci.yml` | New job `audit`: `npm run audit:prod` = `npm audit --omit=dev --audit-level=high`. It fails on high or critical advisories in runtime dependencies. |
| `scripts/docs-check.mjs` | Checks `docs/`, `SECURITY.md`, `CONTRIBUTING.md` and `sbom/README.md` as well as `spec/` and `README.md`, so the new documents follow rule 4 (10 files now). |
| `README.md` | Points to `CONTRIBUTING.md` and `SECURITY.md`, and lists `audit:prod` among the CI checks. |

## SBOM: exact command and npm version

- Installed npm: **11.19.0** (Node.js v26.8.1 locally; CI uses Node 22 from `.nvmrc`, whose npm 10 also has `npm sbom`). `npm sbom` is supported, so no lockfile parser was written.
- What runs: `npm run sbom` → `node scripts/sbom.mjs` → `npm sbom --sbom-format cyclonedx --sbom-type application --package-lock-only --offline`
- Output: `sbom/email-social.cdx.json`, CycloneDX 1.5, 153 components. The 108 development components carry `cdx:npm:package:development=true`. The lockfile has 152 non-workspace packages (43 runtime, 109 development, per `license:check`).
- Two problems came up, and both were fixed:
  1. `npm sbom` failed with `EINVALIDPURLTYPE` because the root package had no `version`. Fix: `"version": "0.1.0"` in the root `package.json` and lockfile.
  2. npm names the root component after the checkout directory (here it wrote `"src"`). The wrapper sets it to `email-social` from `package.json`. npm's bom-ref and purl were already right. This is the only change made to npm's output.

## `npm audit` and the `--omit=dev` logic

`license:check` counts lockfile entries without `"dev": true` as runtime. `npm audit --omit=dev` uses the same lockfile flag, so both checks split the packages the same way. The CI job reads the lockfile only and does no `npm ci`.

## Test results

- `npm test`: green. docs:check passed its self-test and found no forbidden words in 10 files. es-core: 37 files, 1454 tests passed. es-web: 4 files, 69 tests passed. es-bridge: 10 files, 154 tests passed.
- `npm run license:check`: green (43 runtime and 109 development packages allowed; the MPL-2.0 build tools are listed).
- `npm run sbom`: succeeded, as described above.

## The maintainer must fill in by hand

- `SECURITY.md`: `security@<domain>`, the real reporting address. Also check that the 5-day / 14-day / 90-day / 30-day windows are ones you can keep.
- `SECURITY.md`: the business edition row (`<supported line>`, `<end date>`). Art. 13(8) asks for a support period of at least five years, unless the product is expected to be used for less.
- `docs/CRA.md`: confirm or correct the reading, especially the default-category and module A conclusion and the article references. They were written from the regulation's structure without a lawyer.
- Enable GitHub private vulnerability reporting / security advisories in the repository settings. `SECURITY.md` promises advisories there.

## Left out, and why

- **`npm audit` was not run locally.** It contacts the npm registry, and this task did not allow network access. The CI job has not run yet either, so whether the current lockfile has high or critical runtime advisories is **unknown**.
- **The lockfile edit was not checked by npm.** The offline `npm install --package-lock-only` I wanted to run for this needed an approval that wasn't given. The edit follows npm's field order, `npm sbom --package-lock-only`, `license:check` and the tests read the file fine, but `npm ci` has not been run against it.
- Things marked "Not yet" in `docs/CRA.md` are left out because doing them truthfully needs decisions or a product that does not exist yet:
  - an internal procedure and account for Art. 14 reporting;
  - risk assessment;
  - technical documentation (Annex VII);
  - user information (Annex II);
  - update mechanism / update notice in `es-bridge`;
  - EU declaration of conformity, CE marking;
  - attaching the SBOM to releases (there is no release process yet).
- **No business-edition files.** That code is not in this repository.
- **Not committed**, as instructed.

## Decisions

- Added a root `version` rather than writing a separate lockfile-to-CycloneDX script. It keeps "only what npm ships", and 0.1.0 matches all three workspaces.
- Widened `docs:check` to the new documents rather than leaving them unchecked.
