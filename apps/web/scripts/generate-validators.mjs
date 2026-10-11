import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

// Compile the canonical schemas before tests/dev/build. Browser CSP forbids
// AJV's runtime Function constructor; standalone validators need no compiler.
// https://ajv.js.org/standalone.html
const ajv = new Ajv2020({ allErrors: true, inlineRefs: false, code: { source: true } });
const exports = {};
for (const [name, file] of Object.entries({
  deckV1: "deck-v1.schema.json",
  deckV2: "deck-v2.schema.json",
  sessionV1: "session-v1.schema.json",
  sessionV2: "session-v2.schema.json",
  candidateV1: "candidate-v1.schema.json",
})) {
  const schema = JSON.parse(await readFile(new URL(`../../../contract/${file}`, import.meta.url), "utf8"));
  ajv.addSchema(schema);
  exports[name] = schema.$id;
}
const output = new URL("../.cache/validators.cjs", import.meta.url);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(output, standaloneCode(ajv, exports));
const entry = new URL("./validators.mjs", output);
await writeFile(entry, `import validators from "./validators.cjs";
export const { deckV1, deckV2, sessionV1, sessionV2, candidateV1 } = validators;
`);

// Bundle AJV's small runtime helpers into ESM so dev, tests and production all
// consume the same browser-ready module, without CommonJS globals or eval.
await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: fileURLToPath(new URL("../src/core/generated", import.meta.url)),
    emptyOutDir: false,
    minify: false,
    lib: { entry: fileURLToPath(entry), formats: ["es"], fileName: () => "validators.js" },
    commonjsOptions: { include: [/node_modules/, /validators\.cjs$/] },
  },
});
