// What a tester attaches to a bug report: the build and the latest problems the
// app showed. Kept in memory on this device only; nothing is sent anywhere
// (ADR 0005), and the text leaves only when the user copies or saves it.
export const BUILD = __ERATIC_BUILD__;
const LIMIT = 50;
type Entry = { at: string; area: string; message: string };
const entries: Entry[] = [];

export function record(area: string, message: string, now = new Date()): void {
  entries.push({ at: now.toISOString(), area, message });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}
// The message shown to the user plus the underlying cause (a quota error, say) when it adds something.
export function withCause(problem: string, failure: unknown): string {
  const cause = (failure as { message?: unknown } | null)?.message;
  return typeof cause === "string" && cause && cause !== problem ? `${problem} (${cause})` : problem;
}
export function diagnosticsText(now = new Date()): string {
  let agent = "unknown";
  try {
    agent = navigator.userAgent;
  } catch {
    // no navigator
  }
  return [
    `Eratic web ${BUILD}`,
    `Copied ${now.toISOString()}`,
    `Browser ${agent}`,
    "",
    ...(entries.length
      ? entries.map((entry) => `${entry.at} [${entry.area}] ${entry.message}`)
      : ["No problems recorded since the page opened."]),
  ].join("\n");
}
export function clearDiagnostics(): void {
  entries.length = 0;
}
// Uncaught errors and rejections, which otherwise only reach the browser console.
export function recordUncaught(target: Window = window): void {
  target.addEventListener("error", (event) => record("uncaught", event.message || "Script error"));
  target.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    record("uncaught", reason instanceof Error ? reason.message : String(reason));
  });
}
