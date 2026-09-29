#!/usr/bin/env node
/**
 * `npx email-social`: starts the bridge on 127.0.0.1 and opens the web
 * client. Nothing listens on other interfaces; the URL carries the session
 * token, so only whoever has the URL can use the page.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalAddress } from "@email-social/es-core";
import { startBridge } from "./bridge.js";
import { parseArgs, USAGE } from "./cli-args.js";
import { KeychainStore } from "./credentials.js";
import { DEMO_ACCOUNT, writeDemoMaildir } from "./demo.js";

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No browser opener; the URL is printed anyway.
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const webRoot = fileURLToPath(new URL("./web/", import.meta.url));
  if (!existsSync(join(webRoot, "index.html"))) {
    throw new Error("The web client is not built. Run `npm run build` at the repository root first.");
  }
  let maildir: { root: string; account: { address: string; name: string } } | undefined;
  if (options.demo) {
    const root = await mkdtemp(join(tmpdir(), "email-social-demo-"));
    await writeDemoMaildir(root);
    maildir = { root, account: DEMO_ACCOUNT };
    process.stdout.write(`Demo mailbox: ${root} (messages you send are written to its Outbox/ and Sent/ folders)\n`);
  } else if (options.maildir !== null) {
    const address = canonicalAddress(options.address!);
    maildir = { root: resolve(options.maildir), account: { address, name: options.name ?? address } };
  }
  const bridge = await startBridge({
    webRoot,
    port: options.port,
    ...(maildir === undefined ? { credentials: new KeychainStore() } : { maildir }),
    cacheDir: options.cacheDir === null ? null : resolve(options.cacheDir),
    maxMessages: options.maxMessages,
  });
  process.stdout.write(`Email Social is running at ${bridge.url}\nOpen that address in your browser. Press Ctrl+C to stop.\n`);
  if (options.open) openBrowser(bridge.url);
  const stop = (): void => {
    void bridge.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((e: unknown) => {
  process.stderr.write(`email-social: ${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
  process.exit(1);
});
