// @vitest-environment jsdom
// Deck format 2 game fields through the real app: editing, the one-time migration
// notice, core validation messages, and the exported deck.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../../../contract/demo-deck.json";
import { demoDeck, migrateDeck } from "../core/deck";
import { STORAGE_KEY } from "../storage";
import App from "./App";
import { MIGRATION_NOTICE, withCardGameFields, withDeckClipStart } from "./CardGameFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let downloads: Promise<string>[];

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
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
async function set(selector: string, value: string) {
  const element = $(selector) as HTMLInputElement | HTMLSelectElement;
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!);
const notice = () => $(".notice[role=alert]")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    downloads.push((blob as Blob).text());
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("deck format 2 game fields", () => {
  it("saves clip start, difficulty and a related recording, migrates once, and exports version 2", async () => {
    await render();
    expect(($("#clip-start") as HTMLInputElement).value).toBe("");
    expect($$("#related-card option").map((option) => option.textContent)).toEqual([
      "None",
      `${demo.cards[1].title} · ${demo.cards[1].artist}`,
      `${demo.cards[2].title} · ${demo.cards[2].artist}`,
    ]);
    await set("#clip-start", "12.5");
    await set("#difficulty", "2");
    await set("#relation", "coverOf");
    await set("#related-card", "demo-002");
    await click(button("Save game settings"));
    expect(notice()).toBe(MIGRATION_NOTICE);
    expect($(".game-fields .save-status")?.textContent).toBe("Game settings saved");
    const deck = stored();
    expect(deck.schemaVersion).toBe(2);
    expect(deck.cards[0]).toMatchObject({
      clip: { startMs: 12500 },
      difficulty: 2,
      relatedTo: { cardId: "demo-002", relation: "coverOf" },
    });
    expect(deck.cards[0].gameYear).toEqual(demo.cards[0].gameYear);
    expect(deck.cards[1]).toEqual(demo.cards[1]);

    // Already version 2: later saves say nothing more.
    await set("#difficulty", "");
    await click(button("Save game settings"));
    expect(notice()).toBe("");
    expect(stored().cards[0].difficulty).toBeUndefined();

    await set("#default-clip-start", "15");
    await click(button("Save default"));
    expect(stored().defaultClipStartMs).toBe(15000);
    expect($(".deck-game-fields .save-status")?.textContent).toBe("Default saved");

    await click(button("Export deck"));
    const exported = JSON.parse(await downloads.at(-1)!);
    expect(exported.schemaVersion).toBe(2);
    expect(exported.defaultClipStartMs).toBe(15000);
    expect(exported.cards[0].clip).toEqual({ startMs: 12500 });
  });

  it("shows the core's validation message and saves nothing", async () => {
    await render();
    await set("#clip-start", "-5");
    await click(button("Save game settings"));
    expect($(".game-fields .error[role=alert]")?.textContent).toMatch(/^Invalid deck: \/cards\/0\/clip\/startMs/);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await set("#clip-start", "");
    await set("#relation", "remasterOf");
    await click(button("Save game settings"));
    expect($(".game-fields .error[role=alert]")?.textContent).toBe(
      "Choose both a related recording and how it relates, or neither.",
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps a version 1 deck at version 1 when no game value is set", () => {
    const deck = demoDeck();
    const empty = { clipStart: "", difficulty: "", related: "", relation: "" } as const;
    expect(withCardGameFields(deck, "demo-001", empty)).toEqual({ deck, migrated: false });
    expect(withDeckClipStart(deck, "")).toEqual({ deck, migrated: false });
    expect(withDeckClipStart(deck, "3")).toEqual({
      deck: { ...migrateDeck(deck), defaultClipStartMs: 3000 },
      migrated: true,
    });
  });
});
