import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL(".", import.meta.url);
const sources = (sub: string) =>
  readdirSync(new URL(sub, dir))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => sub + name);
// Files directly in src/core and in src/core/game/.
const files = [...sources(""), ...sources("game/")];

// Words in comments must not trip the checks; "://" in strings is not a comment.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("core boundary", () => {
  it("has sources to check", () => expect(files.length).toBeGreaterThan(0));
  for (const name of files)
    describe(name, () => {
      const source = readFileSync(new URL(name, dir), "utf8");
      it("imports only core, ajv or contract files", () => {
        const specifiers = [
          ...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
        ].map((match) => match[1]);
        for (const specifier of specifiers)
          expect(
            specifier.startsWith("./") ||
              (name.startsWith("game/") && /^\.\.\/[^.]/.test(specifier)) ||
              specifier.startsWith("ajv/") ||
              /^(\.\.\/)+contract\//.test(specifier),
            specifier,
          ).toBe(true);
      });
      it("does not touch browser or UI globals", () => {
        const code = stripComments(source);
        for (const word of [
          "localStorage",
          "sessionStorage",
          "indexedDB",
          "document",
          "window",
          "navigator",
          "fetch",
          "XMLHttpRequest",
          "react",
        ])
          expect(code).not.toContain(word);
      });
    });
});
