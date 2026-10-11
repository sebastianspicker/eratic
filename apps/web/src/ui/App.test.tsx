// @vitest-environment jsdom
// User workflows through the real React app: storage, editing, QR routes, import/export, and recovery of
// unreadable saved data. Expectations come from the contract and DESIGN.md, not from component internals.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../../../contract/demo-deck.json";
import { STORAGE_KEY, UNREADABLE_KEY } from "../storage";
import App from "./App";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let downloads: { name: string; text: Promise<string> }[];

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
}
async function rerender() {
  await act(async () => root.unmount());
  container.remove();
  await render();
}
const $ = (selector: string) => container.querySelector(selector);
const $$ = (selector: string) => [...container.querySelectorAll(selector)];
function button(name: string) {
  const found = $$("button").find((item) => item.textContent === name);
  if (!found) throw new Error(`No button "${name}"`);
  return found as HTMLButtonElement;
}
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
async function type(selector: string, value: string) {
  const input = $(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function importFile(content: string | Uint8Array<ArrayBuffer>) {
  const input = $("input[type=file]") as HTMLInputElement;
  const file = new File([content], "deck.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {}); // let file read settle
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(check()).toBe(true);
}
const saved = () => localStorage.getItem(STORAGE_KEY);
const quarantined = () => localStorage.getItem(UNREADABLE_KEY);

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    downloads.push({ name: "", text: (blob as Blob).text() });
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads[downloads.length - 1].name = this.download;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("web companion workflows", () => {
  it("styles the inspector in the selected card's era and re-themes on a new year", async () => {
    await render();
    expect($('[role="img"][aria-label="Eratic"]')).not.toBeNull();
    expect($(".era-hero")?.getAttribute("data-era")).toBe("neon"); // 1984
    expect($(".era-label")?.textContent).toBe("1980s · Neon");
    await click($$(".song-row")[2]); // 2011
    expect($(".era-hero")?.getAttribute("data-era")).toBe("pastel");
    expect($(".era-year")?.textContent).toBe("2011");
    await type("#game-year", "1977");
    await click(button("Save changes"));
    expect($(".era-hero")?.getAttribute("data-era")).toBe("disco");
    expect($$(".row-year")[2].getAttribute("title")).toBe("1970s · Disco");
  });

  it("opens the fictional sample without storing it", async () => {
    await render();
    expect($("h1")?.textContent).toBe(demo.title);
    expect($$(".song-row")).toHaveLength(3);
    expect(container.textContent).toContain(
      "Sample deck · Import or save to keep changes",
    );
    expect(saved()).toBeNull();
  });

  it("keeps the official route empty without a mapping and renders a direct link only on request", async () => {
    await render();
    expect(container.textContent).toContain("No official card mapping");
    expect($(".qr-image")).toBeNull();
    await click($(".checkbox-label input")!);
    await waitFor(() => !!$(".qr-image svg"));
    expect($(".payload")?.textContent).toBe(demo.cards[0].links[0].url);
  });

  it("saves a curated year and source, persists them, and preserves the note and other cards", async () => {
    await render();
    await click($$(".song-row")[0]);
    await type("#game-year", "1999");
    await type("#year-source", "Liner notes");
    await click(button("Save changes"));
    expect(container.textContent).toContain("Changes saved");
    const stored = JSON.parse(saved()!);
    expect(stored.cards[0].gameYear).toEqual({
      ...demo.cards[0].gameYear,
      value: 1999,
      source: "Liner notes",
    });
    expect(stored.cards.slice(1)).toEqual(demo.cards.slice(1));
    await rerender();
    expect(container.textContent).toContain("Stored on this device");
    expect($$(".song-row")[0].querySelector(".row-year")?.textContent).toBe(
      "1999",
    );
  });

  it("rejects an out-of-range year without storing anything", async () => {
    await render();
    await type("#game-year", "1700");
    await click(button("Save changes")); // native constraint validation blocks submission
    expect(container.textContent).not.toContain("Changes saved");
    ($("form") as HTMLFormElement).noValidate = true; // the core rule still applies without it
    await click(button("Save changes"));
    expect($(".error[role=alert]")?.textContent).toMatch(/1850/);
    expect(saved()).toBeNull();
  });

  it("rejects an invalid import and keeps the current deck", async () => {
    await render();
    const bad = structuredClone(demo);
    bad.cards[0].links[0].url = "https://example.com/a​b";
    await importFile(JSON.stringify(bad));
    expect($(".notice[role=alert]")?.textContent).toMatch(
      /Unsafe provider URL/,
    );
    expect($("h1")?.textContent).toBe(demo.title);
    expect(saved()).toBeNull();
  });

  it("rejects an import whose bytes are not valid UTF-8 and keeps the current deck", async () => {
    await render();
    const bytes = new TextEncoder().encode(JSON.stringify(demo));
    bytes[bytes.indexOf(0x50)] = 0xff; // replace the "P" of "Paper Satellites"
    await importFile(bytes);
    expect($(".notice[role=alert]")?.textContent).toMatch(/not valid UTF-8/);
    expect($("h1")?.textContent).toBe(demo.title);
    expect(saved()).toBeNull();
  });

  it("imports a deck, previews its supplied mapping as unverified, and exports it unchanged", async () => {
    await render();
    const deck = structuredClone(demo) as typeof demo & {
      cards: Record<string, unknown>[];
    };
    deck.id = "imported-deck";
    deck.title = "Imported deck";
    Object.assign(deck.cards[0], {
      isrc: "USABC2400001",
      officialCard: {
        url: "https://www.hitstergame.com/se/aaaa0034/00001",
        notes: "Supplied, unverified",
      },
    });
    await importFile(JSON.stringify(deck));
    expect($("h1")?.textContent).toBe("Imported deck");
    expect(JSON.parse(saved()!)).toEqual(deck);
    await waitFor(() => !!$(".qr-image svg"));
    expect($(".payload")?.textContent).toBe(
      "https://www.hitstergame.com/se/aaaa0034/00001",
    );
    expect(container.textContent).toContain(
      "Supplied official URL. Playback has not been verified.",
    );
    await click(button("Export deck"));
    expect(downloads.at(-1)?.name).toBe("imported-deck.json");
    expect(JSON.parse(await downloads.at(-1)!.text)).toEqual(deck);
  });

  it("sets aside a saved deck it can no longer read, offers it for download, and never overwrites it", async () => {
    const legacy = structuredClone(demo);
    legacy.cards[0].links[0].url = "https://example.com/a\u0085b"; // accepted by the scaffold's web rules
    const raw = JSON.stringify(legacy);
    localStorage.setItem(STORAGE_KEY, raw);
    await render();
    expect(container.textContent).toContain(
      "The saved deck could not be read.",
    );
    expect(quarantined()).toBe(raw);
    await click(button("Download unreadable saved data"));
    expect(downloads.at(-1)?.name).toBe("eratic-unreadable-deck.json");
    expect(await downloads.at(-1)!.text).toBe(raw);
    await click(button("Save changes"));
    expect(quarantined()).toBe(raw);
    expect(JSON.parse(saved()!).cards[0].links[0].url).toBe(
      demo.cards[0].links[0].url,
    );
  });

  it("discards unreadable data on request without it returning on the next save", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    await render();
    await click(button("Discard it"));
    expect($$("button").some((item) => item.textContent === "Discard it")).toBe(
      false,
    );
    await click(button("Save changes"));
    expect(quarantined()).toBeNull();
    await rerender();
    expect($$("button").some((item) => item.textContent === "Discard it")).toBe(
      false,
    );
  });
});
