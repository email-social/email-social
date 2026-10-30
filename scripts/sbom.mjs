#!/usr/bin/env node
/**
 * Writes the CycloneDX software bill of materials of the workspace to
 * sbom/email-social.cdx.json (see sbom/README.md), from package-lock.json
 * only, with the npm that runs it:
 *
 *   npm sbom --sbom-format cyclonedx --sbom-type application --package-lock-only --offline
 *
 * One correction: npm names the root component after the checkout directory
 * ("src", "email-social-main", ...); it is set to the name in package.json,
 * which the bom-ref and purl npm writes already use.
 *
 *   npm run sbom
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NPM_ARGS = ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--package-lock-only", "--offline"];

const npm = process.env.npm_execpath;
if (!npm) {
  console.error("Run this with `npm run sbom`, so that it uses the npm you run it with.");
  process.exit(1);
}
const bom = JSON.parse(execFileSync(process.execPath, [npm, ...NPM_ARGS], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
bom.metadata.component.name = JSON.parse(readFileSync(ROOT + "package.json", "utf8")).name;
writeFileSync(ROOT + "sbom/email-social.cdx.json", JSON.stringify(bom, null, 2) + "\n");
console.log(`sbom: ${bom.components.length} components, CycloneDX ${bom.specVersion}, npm ${bom.metadata.tools[0]?.version} -> sbom/email-social.cdx.json`);
