import { afterEach, expect, it, vi } from "vitest";
import demo from "../../../../contract/demo-deck.json";
import sessions from "../../../../contract/cases/session-files.json";

afterEach(() => vi.unstubAllGlobals());

it("loads deck and session validation when CSP forbids dynamic code evaluation", async () => {
  vi.resetModules();
  const blocked = () => {
    throw new EvalError("Dynamic code evaluation blocked by CSP");
  };
  vi.stubGlobal("Function", new Proxy(Function, { construct: blocked, apply: blocked }));
  vi.stubGlobal("eval", blocked);
  const { validateDeck } = await import("./deck");
  const { validateSession } = await import("./session");
  expect(validateDeck(demo)).toEqual(demo);
  expect(validateDeck({ ...demo, schemaVersion: 2, defaultClipStartMs: 1000 }).schemaVersion).toBe(2);
  expect(() => validateDeck({ ...demo, schemaVersion: 3 })).toThrow();
  const session = sessions.cases.find((item) => item.name === "valid-minimal-session")!.session;
  expect(validateSession(session)).toEqual(session);
  expect(() => validateSession({ ...session, sessionVersion: 3 })).toThrow();
});
