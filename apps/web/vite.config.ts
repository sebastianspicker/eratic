import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The dev server injects an inline React refresh preamble that the build's
// Content Security Policy (index.html) forbids; only `vite dev` drops the tag.
const devWithoutCsp: Plugin = {
  name: "eratic-dev-without-csp",
  apply: "serve",
  transformIndexHtml: (html) =>
    html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>/u, ""),
};

// The build testers quote in bug reports: the package version and, when known, the commit.
function buildID(): string {
  const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  if (!commit)
    try {
      commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // Not a Git checkout: the version alone.
    }
  return commit ? `${version} (${commit})` : version;
}

export default defineConfig({
  plugins: [react(), devWithoutCsp],
  base: "./",
  define: { __ERATIC_BUILD__: JSON.stringify(buildID()) },
});
