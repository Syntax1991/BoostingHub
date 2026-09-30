/**
 * @deprecated Prefer `npm run guide:raidlead:preview` / `guide:raidlead:publish`.
 *
 * Forwards to the idempotent v2 publisher. `--post` is accepted as an alias for
 * `--publish` and no longer appends duplicate guide messages.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).map((a) => (a === "--post" ? "--publish" : a));

const child = spawn(
  process.execPath,
  ["--import", "tsx", resolve(here, "publish-raidlead-guide.mts"), ...args],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
