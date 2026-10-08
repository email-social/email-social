#!/usr/bin/env node
// The `email-social` command. It exists before the first build, so npm can link
// it on `npm ci`; the program itself is compiled into dist/ by `npm run build`.
import { existsSync } from "node:fs";

const cli = new URL("../dist/cli.js", import.meta.url);
if (!existsSync(cli)) {
  process.stderr.write("email-social: not built yet. Run `npm run build` at the repository root, then `npx email-social` again.\n");
  process.exit(1);
}
await import(cli.href);
