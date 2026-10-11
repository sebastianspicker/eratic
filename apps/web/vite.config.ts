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

export default defineConfig({ plugins: [react(), devWithoutCsp], base: "./" });
