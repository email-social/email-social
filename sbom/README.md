# Software bill of materials

This directory holds the software bill of materials (SBOM) of the Email Social workspace in CycloneDX JSON format. The generated file is not committed (it is listed in `.gitignore`); only this README is.

To regenerate it, from the repository root:

```sh
npm run sbom
```

This runs `scripts/sbom.mjs`, which runs `npm sbom --sbom-format cyclonedx --sbom-type application --package-lock-only --offline` with the npm you started it with and writes the result to `sbom/email-social.cdx.json`. The only change it makes to npm's output: the root component is named `email-social` (from `package.json`) instead of after the directory the repository is checked out in. It reads `package-lock.json` only: it does not need `node_modules`, adds no dependency, and does not use the network. It needs npm 10 or later (the npm that comes with Node.js 22).

The SBOM lists every package in the lockfile, the development and build tools included; npm marks those with the property `cdx:npm:package:development` and the scope `optional`. Regenerate it after every change to `package-lock.json`, and attach it to each release.
