import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (!existsSync(".env")) {
  console.error("Сначала выполните npm run setup");
  process.exit(1);
}
const children = [
  spawn(process.execPath, ["--env-file=.env", "server/index.mjs"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
    { stdio: "inherit" },
  ),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  process.exitCode = code;
};
children.forEach((child) => child.on("exit", (code) => stop(code ?? 0)));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
