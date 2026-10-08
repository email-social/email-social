// After tsc: make the CLI executable and bundle the built web client into dist/web.
import { chmodSync, cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const web = fileURLToPath(new URL("../../es-web/dist/", import.meta.url));

chmodSync(dist + "cli.js", 0o755);
if (!existsSync(web + "index.html")) {
  console.error("es-web is not built (packages/es-web/dist/index.html is missing); run `npm run build` at the repository root.");
  process.exit(1);
}
rmSync(dist + "web", { recursive: true, force: true });
cpSync(web, dist + "web", { recursive: true });
console.log("es-bridge: bundled the web client into dist/web");
