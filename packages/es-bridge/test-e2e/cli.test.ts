/** The built `email-social` command starts, prints its URL and serves the demo mailbox. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/email-social.js", import.meta.url));
const built = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let child: ChildProcess | null = null;

afterAll(() => {
  child?.kill("SIGINT");
});

describe("email-social command", () => {
  it("starts on 127.0.0.1 with --demo and serves the web client and the API", async () => {
    expect(existsSync(built), "run npm run build first").toBe(true);
    child = spawn(process.execPath, [bin, "--demo", "--no-open"], { stdio: ["ignore", "pipe", "pipe"] });
    const url = await new Promise<string>((resolve, reject) => {
      let out = "";
      child!.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const match = /http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]+/.exec(out);
        if (match) resolve(match[0]);
      });
      child!.once("exit", (code) => reject(new Error(`exited with ${code}: ${out}`)));
      setTimeout(() => reject(new Error(`no URL printed: ${out}`)), 20_000);
    });
    const [base, token] = url.split("/#token=") as [string, string];
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Email Social</title>");
    const list = (await (await fetch(`${base}/api/conversations`, { headers: { authorization: `Bearer ${token}` } })).json()) as unknown[];
    expect(list).toHaveLength(9);
  });

  it("prints its usage for --help", async () => {
    const help = spawn(process.execPath, [bin, "--help"]);
    let out = "";
    help.stdout.on("data", (c: Buffer) => (out += c.toString()));
    await new Promise((resolve) => help.once("exit", resolve));
    expect(out).toContain("Usage: email-social");
  });
});
