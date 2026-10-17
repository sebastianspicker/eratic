// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { BUILD, clearDiagnostics, diagnosticsText, record, recordUncaught, withCause } from "./diagnostics";

afterEach(clearDiagnostics);

describe("diagnostics", () => {
  it("names the package version in the build identifier", () => {
    expect(BUILD.startsWith(packageJson.version)).toBe(true);
  });

  it("lists recorded problems after the build and browser", () => {
    record("deck", "Browser storage is unavailable.", new Date("2026-10-17T08:00:00Z"));
    const lines = diagnosticsText(new Date("2026-10-17T08:05:00Z")).split("\n");
    expect(lines[0]).toBe(`Eratic web ${BUILD}`);
    expect(lines[1]).toBe("Copied 2026-10-17T08:05:00.000Z");
    expect(lines[2]).toMatch(/^Browser /);
    expect(lines.at(-1)).toBe("2026-10-17T08:00:00.000Z [deck] Browser storage is unavailable.");
  });

  it("says when nothing was recorded", () => {
    expect(diagnosticsText()).toContain("No problems recorded since the page opened.");
  });

  it("keeps only the latest 50 entries", () => {
    for (let i = 0; i < 60; i++) record("test", `problem ${i}`);
    const text = diagnosticsText();
    expect(text).not.toContain("problem 9\n");
    expect(text).toContain("problem 10\n");
    expect(text.endsWith("problem 59")).toBe(true);
  });

  it("records uncaught errors and rejections", () => {
    const target = new EventTarget() as Window;
    recordUncaught(target);
    target.dispatchEvent(Object.assign(new Event("error"), { message: "boom" }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("rejected") }));
    const text = diagnosticsText();
    expect(text).toContain("[uncaught] boom");
    expect(text).toContain("[uncaught] rejected");
  });

  it("adds a failure's own message to the shown problem only when it differs", () => {
    expect(withCause("Storage is full.", new DOMException("Quota exceeded", "QuotaExceededError"))).toBe(
      "Storage is full. (Quota exceeded)",
    );
    expect(withCause("Storage is full.", new Error("Storage is full."))).toBe("Storage is full.");
    expect(withCause("Storage is full.", "text")).toBe("Storage is full.");
    expect(withCause("Storage is full.", null)).toBe("Storage is full.");
  });
});
