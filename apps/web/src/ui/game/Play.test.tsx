// @vitest-environment jsdom
// Play workflows through the real React app: navigation, setup, the host screen, reveal, results,
// persistence and resume, Daily Eratic and scanning. Scores come from the core engine; the
// expectations restate contract/game-rules.md and DESIGN.md.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../../../../contract/demo-deck.json";
import { eraName, eraOf, ERA_IDS } from "../../core/eras";
import { dailySelection, drawOrder, pickAnchors } from "../../core/random";
import {
  DAILY_KEY,
  ENTRY_KEY,
  loadEntryStyle,
  loadRoster,
  PLAY_PREFS_KEY,
  ROSTER_KEY,
  saveRoster,
  SESSION_DECK_KEY,
  SESSION_KEY,
  SESSION_UNREADABLE_KEY,
} from "../../sessions";
import { friendlyError, GameController } from "./useGame";
import { STORAGE_KEY } from "../../storage";
import { BESTS_KEY } from "../../bests";
import { parseDeck } from "../../core/deck";
import { parseSession } from "../../core/session";
import { recapLines } from "./Results";
import { SCAN_HINT } from "./Setup";
import App from "../App";

const scan = vi.hoisted(() => ({ payload: "" }));
vi.mock("../ScannerView", () => ({
  ScannerView: ({ onPayload, onClose }: { onPayload: (text: string) => void; onClose: () => void }) => (
    <div className="scanner">
      <button onClick={() => onPayload(scan.payload)}>Fake scan</button>
      <button onClick={onClose}>Close scanner</button>
    </div>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 42;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const ids = demo.cards.map((card) => card.id);
const yearOf = (id: string) => demo.cards.find((card) => card.id === id)!.gameYear.value;
const order = drawOrder(ids, SEED);

let root: Root;
let container: HTMLDivElement;
let downloads: { name: string; text: Promise<string> }[];
let opened: string[];

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
const text = () => container.textContent ?? "";
function button(name: string) {
  const found = $$("button").find((item) => item.textContent === name);
  if (!found) throw new Error(`No button "${name}"`);
  return found as HTMLButtonElement;
}
const hasButton = (name: string) => $$("button").some((item) => item.textContent === name);
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
async function type(selector: string, value: string) {
  const input = $(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(selector: string, value: string) {
  await type(selector, value);
  await act(async () => (($(selector) as HTMLInputElement).form as HTMLFormElement).requestSubmit());
}
// Play is a lazy chunk; load it first so the click renders it within act.
async function toPlay() {
  await act(async () => {
    await import("./Play");
  });
  await click(button("Play"));
}
async function connectManual() {
  await click(button("Use playback"));
}
async function setUp(mode: string, names: string[], options: Record<string, string> = {}) {
  await click(button(`Play ${mode}`));
  while ($$(".player-row").length > names.length)
    await click($$(".player-row button").at(-1)!);
  for (const [i, name] of names.entries()) await type(`#player-${i}`, name);
  for (const [selector, value] of Object.entries(options)) {
    const input = $(selector) as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") await click(input);
    else await type(selector, value);
  }
  await click(button("Start"));
}
// Taps a song (by title, in Lineup by name) in the order entry's pool.
async function tapSong(title: string) {
  const found = $$('[aria-label$="songs left to place"] button').find((item) => item.textContent?.includes(title));
  if (!found) throw new Error(`No song "${title}" left to place`);
  await click(found);
}
const resultLines = () => $$(".result-lines li").map((item) => item.textContent);
const scores = () => $$(".score-value").map((item) => item.textContent);
const savedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY)!);

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  opened = [];
  scan.payload = "";
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as unknown as Uint32Array)[0] = SEED;
    return array;
  });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    downloads.push({ name: "", text: (blob as Blob).text() });
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads[downloads.length - 1].name = this.download;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Play home", () => {
  it.each(["spotify", "appleMusic"])("plays %s links without configuration or sign-in", async (provider) => {
    const stored = {
      ...demo,
      cards: demo.cards.map((card, i) => ({
        ...card,
        links: [
          ...card.links,
          { provider: "spotify", url: `https://open.spotify.com/track/${String(i).padStart(22, "0")}` },
          { provider: "appleMusic", url: `https://music.apple.com/us/album/example/123?i=${100 + i}` },
        ],
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const fetch = vi.fn().mockRejectedValue(new Error("Unexpected provider request"));
    vi.stubGlobal("fetch", fetch);
    await render();
    await toPlay();
    await click($(`input[value="${provider}"]`)!);
    await click(button("Use playback"));
    expect(hasButton("Enable timed clips")).toBe(false);
    expect($("[role=alert]")).toBeNull();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect($(".song-qr")).not.toBeNull();
    const card = stored.cards.find((item) => item.id === order[0])!;
    expect(text()).not.toContain(card.title);
    await click(button(provider === "spotify" ? "Play on Spotify" : "Play on Apple Music"));
    expect(opened).toEqual([card.links.find((link) => link.provider === provider)!.url]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("navigates between Deck and Play and lists all nine modes with reasons in words", async () => {
    await render();
    expect(button("Deck").getAttribute("aria-current")).toBe("page");
    await toPlay();
    expect(button("Play").getAttribute("aria-current")).toBe("page");
    expect($("h1")?.textContent).toBe("Play");
    const tiles = $$(".mode-tile");
    expect(tiles.map((tile) => tile.querySelector("h3")?.textContent)).toEqual([
      "Snippet Ladder",
      "Timeline",
      "Bullseye",
      "Era Sort",
      "Higher or Lower",
      "Relay",
      "Lineup by name",
      "Daily Eratic",
      "Original or Imposter",
    ]);
    // Without exact clips every mode can start: Ladder and Imposter play by hand from the song backup.
    expect(tiles.filter((tile) => tile.textContent?.includes("Needs exact clips"))).toHaveLength(0);
    expect(tiles.filter((tile) => tile.textContent?.includes("Coming in this build"))).toHaveLength(0);
    const spotify = $('input[value="spotify"]') as HTMLInputElement;
    expect(spotify.disabled).toBe(false);
    expect(spotify.closest("label")?.textContent).toBe("Spotify");
    await connectManual();
    expect($(".tier")?.textContent).toBe("Play it yourself: you start each song yourself");
    await click(button("Deck"));
    expect($(".workspace")).not.toBeNull();
  });

  it("keeps an unreadable saved game aside with Download and Discard", async () => {
    localStorage.setItem(SESSION_KEY, "{bad");
    await render();
    await toPlay();
    expect($(".notice[role=alert]")?.textContent).toContain("A saved game could not be read.");
    expect(localStorage.getItem(SESSION_UNREADABLE_KEY)).toBe("{bad");
    await click(button("Download unreadable saved game"));
    expect(downloads.at(-1)?.name).toBe("eratic-unreadable-session.json");
    expect(await downloads.at(-1)!.text).toBe("{bad");
    await click(button("Discard unreadable game"));
    expect(hasButton("Discard unreadable game")).toBe(false);
    expect(localStorage.getItem(SESSION_UNREADABLE_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("Bullseye", () => {
  it("plays a short game: draw, open the song, locked guesses, reveal, standings", async () => {
    await render();
    await toPlay();
    await connectManual();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "2" });
    expect($("h1")?.textContent).toBe("Bullseye");
    expect($(".round-text")?.textContent).toBe("Round 1 of 2");

    await click(button("Draw card"));
    expect(text()).toContain("Mystery card");
    await click(button("Open song link"));
    expect(opened).toEqual([demo.cards.find((card) => card.id === order[0])!.links[0].url]);
    expect(savedSession().actions.map((action: { type: string }) => action.type)).toEqual(["draw", "clip"]);

    const first = yearOf(order[0]);
    expect(button("Reveal").disabled).toBe(true);
    await submit("#guess-p1", String(first));
    expect($$(".lock-list li").map((item) => item.textContent)).toEqual(["AdaLocked", "LinEntering"]);
    expect(text()).not.toContain(String(first) + " ");
    await submit("#guess-p2", String(first + 1));
    await click(button("Reveal"));
    expect($(".reveal .era-hero")?.getAttribute("data-era")).toBe(eraOf(first));
    expect($(".round-text")?.textContent).toBe("Round 1 of 2");
    expect($(".reveal .era-year")?.textContent).toBe(String(first));
    expect(resultLines()).toEqual([`Ada +10, exact (guessed ${first})`, `Lin +7, 1 year off (guessed ${first + 1})`]);
    expect(scores()).toEqual(["10", "7"]);
    expect($(".ruler-list")?.textContent).toContain(`Answer: ${first}`);

    await click(button("Next card"));
    expect($(".round-text")?.textContent).toBe("Round 2 of 2");
    const second = yearOf(order[1]);
    await submit("#guess-p1", String(second + 20));
    await submit("#guess-p2", String(second));
    await click(button("Reveal"));
    expect($(".round-text")?.textContent).toBe("Final results");
    const standings = $$(".standings li");
    expect(standings[0].textContent).toContain("1Lin17 points");
    expect(standings[1].textContent).toContain("2Ada10 points");
    expect(standings[1].textContent).toContain("1 exact");
    await click(button("Download session JSON"));
    expect(JSON.parse(await downloads.at(-1)!.text).actions.at(-1).type).toBe("reveal");
    await click(button("Play again"));
    expect($(".round-text")?.textContent).toBe("Round 1 of 2");
    expect(scores()).toEqual(["0", "0"]);
  });

  it("resumes an unfinished game after a reload", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"]);
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await rerender();
    await toPlay();
    expect($(".resume")?.textContent).toContain("Bullseye with Ada and Lin, round 1");
    await click(button("Resume"));
    expect($("h1")?.textContent).toBe("Bullseye");
    expect($$(".lock-list li").map((item) => item.textContent)).toEqual(["AdaLocked", "LinEntering"]);
    await click(button("End game"));
    expect(text()).toContain("Final standings");
    await click(button("New game"));
    expect($(".resume")).toBeNull();
  });

  it("offers finished results again after a reload until the host leaves them", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"]);
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await click(button("End game"));
    expect(text()).toContain("Final standings");
    const standings = $(".standings")?.textContent;
    await rerender();
    await toPlay();
    expect($(".resume h2")?.textContent).toBe("Results waiting");
    expect($(".resume")?.textContent).toContain("Bullseye with Ada and Lin, game over");
    await click(button("Show results"));
    expect($(".standings")?.textContent).toBe(standings);
    expect(hasButton("Download session JSON")).toBe(true);
    await rerender(); // reloading on the results screen again keeps them
    await toPlay();
    await click(button("Show results"));
    expect($(".standings")?.textContent).toBe(standings);
    await click(button("New game"));
    expect($(".resume")).toBeNull();
    await rerender();
    await toPlay();
    expect($(".resume")).toBeNull();
  });

  it("dismisses waiting results, and a new game starts without asking", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await click(button("Reveal"));
    expect(text()).toContain("Final standings");
    await rerender();
    await toPlay();
    await click(button("Dismiss"));
    expect($(".resume")).toBeNull();
    await rerender();
    await toPlay();
    expect($(".resume")).toBeNull();
    const confirm = vi.mocked(window.confirm);
    confirm.mockClear();
    await setUp("Bullseye", ["Ada"]);
    expect(confirm).not.toHaveBeenCalled();
    expect($("h1")?.textContent).toBe("Bullseye");
  });

  it("tells hosts without printed cards how to get a scannable code", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
    await render();
    await toPlay();
    await click(button("Play Bullseye"));
    expect(text()).not.toContain(SCAN_HINT);
    await click($('input[value="scan"]')!);
    expect(text()).toContain(SCAN_HINT);
    await click($('input[value="draw"]')!);
    expect(text()).not.toContain(SCAN_HINT);
  });

  it("scans printed cards: another deck, a deck card, an unmatched song and a repeat", async () => {
    vi.stubEnv("VITE_ERATIC_CARD_HOSTS", " cards.example , ");
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { 'input[value="scan"]': "" });
    await click(button("Scan card"));
    scan.payload = "https://cards.example/c/other-deck/x1";
    await click(button("Fake scan"));
    expect($(".scan-message")?.textContent).toContain(
      "This card belongs to deck other-deck. Import that deck first.",
    );
    scan.payload = "https://open.spotify.com/track/0123456789abcdefghijkl";
    await click(button("Fake scan"));
    expect(hasButton("Play audio only (not scored)")).toBe(true);
    scan.payload = demo.cards[1].links[0].url;
    await click(button("Fake scan"));
    expect(text()).toContain("Mystery card");
    expect(savedSession().actions[0].card.cardId).toBe("demo-002");
    await submit("#guess-p1", "1997");
    await click(button("Reveal"));
    await click(button("Next card"));
    await click(button("Scan card"));
    await click(button("Fake scan"));
    expect($(".scan-message")?.textContent).toContain("Already played; scan another card.");
  });
});

describe("Era Sort and Higher or Lower", () => {
  it("selects era tiles by click and arrow keys, and Kids credits a neighbouring era", async () => {
    await render();
    await toPlay();
    await setUp("Era Sort", ["Ada"], { "#option-eraSort-rounds": "1", "#option-eraSort-kids": "" });
    await click(button("Draw card"));
    const era = eraOf(yearOf(order[0]));
    const neighbour = ERA_IDS[ERA_IDS.indexOf(era) - 1];
    const before = ERA_IDS[ERA_IDS.indexOf(neighbour) - 1];
    await click($(`.era-tile[data-era="${before}"]`)!);
    expect($(`.era-tile[data-era="${before}"]`)?.getAttribute("aria-checked")).toBe("true");
    expect($(`.era-tile[data-era="${before}"]`)?.textContent).toContain("Selected");
    await act(async () => {
      $(`.era-tile[data-era="${before}"]`)!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect($(".era-tile.selected")?.getAttribute("data-era")).toBe(neighbour);
    expect(document.activeElement?.getAttribute("data-era")).toBe(neighbour);
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect(resultLines()).toEqual([`Ada +3, neighbouring era (picked ${eraName(neighbour)})`]);
    expect(text()).toContain("Final standings");
    expect($(".standings")?.textContent).toContain("1 right eras");
  });

  it("ends a solo Higher or Lower game on the first miss", async () => {
    await render();
    await toPlay();
    await setUp("Higher or Lower", ["Ada"]);
    const reference = yearOf(order[0]);
    const year = yearOf(order[1]);
    expect(text()).toContain("Ada's turn");
    await click(button("Draw card"));
    expect($(".hl-reference .row-year")?.textContent).toBe(String(reference));
    // One decision: the call reveals at once, with no separate Reveal button.
    expect(hasButton("Reveal")).toBe(false);
    await click(button(year > reference ? "Earlier" : "Later"));
    expect(resultLines()[0]).toContain("missed");
    expect($(".round-text")?.textContent).toBe("Final results");
    expect($(".standings")?.textContent).toContain("0 streak");
  });
});

describe("Higher or Lower for everyone", () => {
  async function choose(selector: string, value: string) {
    const select = $(selector) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  // A player's call: choose, then Lock in.
  async function call(value: "Earlier" | "Later") {
    await click($$(".entry-form button[aria-pressed]").find((item) => item.textContent === value)!);
    await click(button("Lock in"));
  }
  const orderYears = () => bigOrder.map(bigYear);

  it("offers the options in words and sends only non-default values", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await click(button("Play Higher or Lower"));
    expect($("#option-higherLower-play")?.parentElement?.textContent).toContain("Who calls each card");
    expect([...($("#option-higherLower-play") as HTMLSelectElement).options].map((item) => item.textContent)).toEqual([
      "Take turns",
      "Everyone, with lives",
    ]);
    expect($("#option-higherLower-lives")).toBeNull();
    expect(text()).toContain("Closer years as the game goes on");
    await click(button("Start"));
    expect(savedSession().options).toEqual({ cards: 10 });
    expect(savedSession().sessionVersion).toBe(2);
    await click(button("End game"));
    await click(button("New game"));
    await click(button("Play Higher or Lower"));
    await choose("#option-higherLower-play", "everyone");
    expect(($("#option-higherLower-lives") as HTMLInputElement).value).toBe("3");
    await type("#option-higherLower-lives", "2");
    await click($("#option-higherLower-closer")!);
    await click(button("Start"));
    expect(savedSession().options).toEqual({ cards: 10, play: "everyone", lives: 2, closer: true });
  });

  it("has every player call with lives, shows Out, and reveals from the host", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await click(button("Play Higher or Lower"));
    await type("#player-0", "Ada");
    await type("#player-1", "Lin");
    await choose("#option-higherLower-play", "everyone");
    await type("#option-higherLower-lives", "1");
    await click(button("Start"));
    expect(text()).not.toContain("Ada's turn");
    expect($$(".scoreboard .score-extra").map((item) => item.textContent)).toEqual([
      "Streak 0",
      "Lives 1 of 1",
      "Streak 0",
      "Lives 1 of 1",
    ]);
    await click(button("Draw card"));
    const [reference, year] = orderYears();
    const right = year > reference ? "Later" : "Earlier";
    const wrong = right === "Later" ? "Earlier" : "Later";
    // The reveal waits for every call, and the list says only "Locked".
    expect(button("Reveal").disabled).toBe(true);
    expect($(".entry-form h3")?.textContent).toBe("Ada's call");
    await call(right);
    expect($(".lock-list")?.textContent).toContain("Locked");
    expect($(".entry-form h3")?.textContent).toBe("Lin's call");
    expect(text()).not.toContain(`Ada called`);
    await call(wrong);
    expect(button("Reveal").disabled).toBe(false);
    await click(button("Reveal"));
    expect(resultLines()).toEqual([`Ada called ${right}: right, streak 1`, `Lin called ${wrong}: missed, out`]);
    expect($$(".scoreboard .score-extra").map((item) => item.textContent)).toEqual([
      "Streak 1",
      "Lives 1 of 1",
      "Streak 0",
      "Lives 0 of 1",
      "Out",
    ]);
    // The game ends with one player left.
    expect($(".round-text")?.textContent).toBe("Final results");
    expect(savedSession().actions.filter((action: { type: string }) => action.type === "call")).toHaveLength(2);
  });

  it("keeps the one-decision reveal for turns", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await setUp("Higher or Lower", ["Ada", "Lin"]);
    await click(button("Draw card"));
    expect(hasButton("Reveal")).toBe(false);
    const [reference, year] = orderYears();
    await click(button(year > reference ? "Later" : "Earlier"));
    expect(resultLines()[0]).toContain("right, streak 1");
  });

  it("shows lives left after a miss that does not eliminate", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await click(button("Play Higher or Lower"));
    await type("#player-0", "Ada");
    await type("#player-1", "Lin");
    await choose("#option-higherLower-play", "everyone");
    await click(button("Start"));
    await click(button("Draw card"));
    const [reference, year] = orderYears();
    const right = year > reference ? "Later" : "Earlier";
    const wrong = right === "Later" ? "Earlier" : "Later";
    await call(wrong);
    await call(right);
    await click(button("Reveal"));
    expect(resultLines()).toEqual([`Ada called ${wrong}: missed, 2 lives left`, `Lin called ${right}: right, streak 1`]);
  });
});

describe("Daily Eratic", () => {
  const deck = structuredClone(demo) as Omit<typeof demo, "cards"> & {
    cards: (Omit<(typeof demo.cards)[number], "gameYear"> & { gameYear: { value: number; source: string } })[];
  };
  deck.cards.push(
    { ...structuredClone(demo.cards[0]), id: "demo-004", title: "Velvet Hour", gameYear: { value: 1966, source: "Fictional" } },
    { ...structuredClone(demo.cards[1]), id: "demo-005", title: "Glass Parade", gameYear: { value: 2003, source: "Fictional" } },
  );
  const cards = dailySelection(deck.cards.map((card) => card.id), "2026-10-11", deck.id);
  const year = (id: string) => deck.cards.find((card) => card.id === id)!.gameYear.value;

  it("plays the day's five rounds, shares the result, and shows it again the same day", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render();
    await toPlay();
    await click(button("Play today's round"));
    await click(button("Start"));
    expect($(".round-text")?.textContent).toBe("Round 1 of 5");
    for (const [i, id] of cards.entries()) {
      if (i > 0) await click(button("Next card"));
      else await click(button("Draw card"));
      if (i < 3) {
        await click($(`.era-tile[data-era="${eraOf(year(id))}"]`)!);
        await click(button("Lock in"));
      } else await submit(`#daily-p1`, String(year(id)));
      await click(button("Reveal"));
    }
    const share = `Eratic 2026-10-11 · 29/29 · ${cards.map((id) => eraName(eraOf(year(id)))).join(" ")}`;
    expect($(".share-text")?.textContent).toBe(share);
    expect(text()).toContain("Streak: 1 day");
    await click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith(share);
    expect(text()).toContain("Copied.");
    expect(JSON.parse(localStorage.getItem(DAILY_KEY)!)).toMatchObject({
      lastDate: "2026-10-11",
      streak: 1,
      lastScore: 29,
      deckId: deck.id,
    });
    await click(button("New game"));
    expect(text()).toContain("Played today: 29 points.");
    expect($(".share-text")?.textContent).toBe(share);
    expect(hasButton("Play today's round")).toBe(false);
    expect($('[data-mode="daily"]')?.textContent).toContain("Played today");
  });
});

// A larger fictional deck with distinct years, stored as the open deck.
const YEARS = [1955, 1962, 1971, 1979, 1984, 1990, 1997, 2003, 2011, 2019];
function bigDeck(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: "big-deck",
    title: "Big deck",
    ...extra,
    cards: YEARS.map((year, i) => ({
      id: `big-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      gameYear: { value: year, source: "Fictional sample for software testing" },
      links: [{ provider: "other", url: `https://example.com/music/big-${i}` }],
    })),
  };
}
const big = bigDeck();
const bigIds = big.cards.map((card) => card.id);
const bigYear = (id: string) => big.cards.find((card) => card.id === id)!.gameYear.value;
const bigTitle = (id: string) => big.cards.find((card) => card.id === id)!.title;
const bigOrder = drawOrder(bigIds, SEED);
const actionTypes = () => savedSession().actions.map((action: { type: string }) => action.type);
// The slot label for placing year into a line of years, right or wrong.
function slotFor(years: number[], year: number, right: boolean): string {
  const sorted = [...years].sort((a, b) => a - b);
  const index = sorted.filter((value) => value <= year).length;
  const slot = right ? index : index === 0 ? 1 : index - 1;
  if (slot === 0) return `Before ${sorted[0]}`;
  if (slot === sorted.length) return `After ${sorted[sorted.length - 1]}`;
  return `Between ${sorted[slot - 1]} and ${sorted[slot]}`;
}
// Selecting a slot only marks it; the confirm button below places (or challenges).
async function pick(label: string, verb = "Place") {
  await click(button(label));
  expect(document.activeElement).toBe(button(`${verb}: ${label}`));
  await click(button(`${verb}: ${label}`));
}
async function check(label: string) {
  const input = $$("label").find((item) => item.textContent?.trim() === label)?.querySelector("input");
  if (!input) throw new Error(`No checkbox "${label}"`);
  await click(input);
}

describe("Timeline and Relay", () => {
  it("plays a personal Timeline to the target with a challenge and Name It", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const anchors = pickAnchors(
      big.cards.map((card) => ({ id: card.id, year: card.gameYear.value })),
      "random",
      SEED,
      2,
    );
    const draws = bigOrder.filter((id) => !anchors.includes(id));
    await render();
    await toPlay();
    await setUp("Timeline", ["Ada", "Lin"], {
      "#option-timeline-target": "3",
      "#option-timeline-nameIt": "",
    });
    expect($(".announcement")?.textContent).toBe(
      `Give Ada ${bigTitle(anchors[0])} (${bigYear(anchors[0])}) as their first card. ` +
        `Give Lin ${bigTitle(anchors[1])} (${bigYear(anchors[1])}) as their first card.`,
    );
    expect($(".round-text")?.textContent).toBe("First to 3 cards");
    expect(text()).toContain("Ada's turn");
    expect($$(".scoreboard .score-extra").map((item) => item.textContent)).toEqual(["Tokens 2", "Tokens 2"]);

    // Ada misplaces the first card; Lin challenges the right slot and takes it.
    await click(button("Draw card"));
    const first = bigYear(draws[0]);
    const slots = $$(".tl-slot button");
    expect(slots).toHaveLength(2);
    expect(slots.map((item) => item.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    await act(async () => {
      slots[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(slots[1]);
    await pick(slotFor([bigYear(anchors[0])], first, false));
    expect($(".tl-marker")?.textContent).toContain("Your slot");
    await click(button("Challenge as Lin"));
    await pick(slotFor([bigYear(anchors[0])], first, true), "Challenge");
    expect(text()).toContain("Challenged");
    await check("Title right");
    await check("Artist right");
    await click(button("Record Name It"));
    expect(text()).toContain("Name It recorded: title right, artist right.");
    await click(button("Reveal"));
    expect($(".reveal .era-year")?.textContent).toBe(String(first));
    expect(text()).toContain("Lin takes the card.");
    expect(text()).toContain("Ada named it and gains a token.");
    expect(resultLines()).toEqual(["Ada no card, +1 token", "Lin +1 card from the challenge"]);
    expect(scores()).toEqual(["1", "2"]);
    expect(savedSession().actions.slice(-5).map((action: { type: string }) => action.type)).toEqual([
      "draw",
      "place",
      "challenge",
      "nameIt",
      "reveal",
    ]);

    // Lin places the next card right, reaches the target, and the round is complete.
    await click(button("Next card"));
    expect(text()).toContain("Lin's turn");
    const second = bigYear(draws[1]);
    await pick(slotFor([bigYear(anchors[1]), first], second, true));
    await click(button("Reveal"));
    expect(text()).toContain("Correct! Lin keeps it.");
    expect($(".round-text")?.textContent).toBe("Final results");
    const standings = $$(".standings li");
    expect(standings[0].textContent).toContain("1Lin3 points");
    expect(standings[1].textContent).toContain("2Ada1 points");
    expect(standings[1].textContent).toContain("0 wrong placements"); // a challenger took the card
  });

  it("wins and loses Relay games with lives and the voice", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const anchor = pickAnchors(
      big.cards.map((card) => ({ id: card.id, year: card.gameYear.value })),
      "random",
      SEED,
      1,
    )[0];
    const card = bigOrder.find((id) => id !== anchor)!;
    await render();
    await toPlay();
    await setUp("Relay", ["Ada", "Lin"], { "#option-relay-target": "2", "#option-relay-lives": "1" });
    expect($(".announcement")?.textContent).toBe(`Start the line with ${bigTitle(anchor)} (${bigYear(anchor)}).`);
    await click(button("Draw card"));
    expect(text()).toContain("Voice: Ada");
    expect(text()).toContain("Lives 1 of 1");
    await pick(slotFor([bigYear(anchor)], bigYear(card), true));
    await click(button("Reveal"));
    expect(text()).toContain("Correct! The line now has 2 cards.");
    expect(text()).toContain("The line is complete. The team wins!");
    expect($(".relay-results")?.textContent).toContain("Team score 12");

    await click(button("Play again"));
    await click(button("Draw card"));
    await pick(slotFor([bigYear(anchor)], bigYear(card), false));
    await click(button("Reveal"));
    expect(text()).toContain("Wrong. The card is discarded and the team loses a life.");
    expect(text()).toContain("Out of lives. The team loses.");
    expect($(".relay-results")?.textContent).toContain("Team score 1,");
  });
});

describe("Lineup", () => {
  it("orders a lineup by name with Move up and Move down", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const set = bigOrder.slice(0, 3);
    await render();
    await toPlay();
    await setUp("Lineup by name", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    expect($$(".lineup-tile .tile-name strong").map((item) => item.textContent)).toEqual(set.map(bigTitle));
    expect(hasButton("Play A")).toBe(false);
    // Tap the songs earliest first.
    const want = [...set].sort((a, b) => bigYear(a) - bigYear(b));
    await click(button("Lock in"));
    expect(text()).toContain("Place every song first.");
    for (const id of want) await tapSong(bigTitle(id));
    expect($$(".order-name").map((item) => item.textContent)).toEqual(want.map(bigTitle));
    await click(button("Lock in"));
    await click(button("Reveal"));
    const letters = want.map((id) => "ABC"[set.indexOf(id)]).join(", ");
    expect(resultLines()).toEqual([`Ada +5, perfect (ordered ${letters})`]);
    expect($$(".right-order .tl-year").map((item) => item.textContent)).toEqual(want.map((id) => String(bigYear(id))));
    expect($(".standings")?.textContent).toContain("1 perfect lines");
  });

  it("breaks a tie with a lineup sudden death", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const used = bigOrder.slice(0, 3);
    const sudden = bigOrder.slice(3, 6);
    await render();
    await toPlay();
    await setUp("Lineup by name", ["Ada", "Lin"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    // Both players give the same order, so they tie.
    for (let player = 0; player < 2; player++) {
      for (const id of used) await tapSong(bigTitle(id));
      await click(button("Lock in"));
    }
    await click(button("Reveal"));
    expect($(".sudden-death-banner")?.textContent).toBe("Sudden death: Ada and Lin. Order 3 songs. The best order wins.");
    expect($(".leader-line")).toBeNull();
    await click(button("Next card"));
    expect(savedSession().actions.at(-1)).toMatchObject({
      type: "sdDraw",
      cards: sudden.map((id) => ({ cardId: id })),
    });
    expect(used.every((id) => !sudden.includes(id))).toBe(true);
    // Ada taps the cards in year order; Lin taps them latest first.
    const want = [...sudden].sort((a, b) => bigYear(a) - bigYear(b));
    for (const id of want) await tapSong(bigTitle(id));
    await click(button("Lock in"));
    for (const id of [...want].reverse()) await tapSong(bigTitle(id));
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect(text()).toContain("Ada wins the sudden death.");
    expect($$(".right-order .tl-year").map((item) => item.textContent)).toEqual(want.map((id) => String(bigYear(id))));
    expect($$(".standings li")[0].textContent).toContain("1Ada");
    expect(actionTypes().slice(-4)).toEqual(["sdDraw", "sdOrder", "sdOrder", "reveal"]);
  });
});

describe("Part 1 gaps", () => {
  it("refuses a Timeline that is too big for the deck before saving anything", async () => {
    await render();
    await toPlay();
    await click(button("Play Timeline"));
    await click(button("Add player"));
    await click(button("Start"));
    expect($(".error[role=alert]")?.textContent).toBe("Deck too small: this game needs 4 cards.");
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("keeps easy-only and the deck snapshot for Resume when another deck is open", async () => {
    const easy = bigDeck({ schemaVersion: 2 });
    easy.cards.forEach((card, i) => Object.assign(card, { difficulty: i < 3 ? 1 : 4 }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(easy));
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-easy": "" });
    expect(JSON.parse(localStorage.getItem(PLAY_PREFS_KEY)!)).toEqual({
      [savedSession().id]: { easyOnly: true, source: "draw" },
    });
    expect(JSON.parse(localStorage.getItem(SESSION_DECK_KEY)!).id).toBe("big-deck");
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await click(button("Reveal"));
    // Another deck is opened; the saved game still plays its own deck's easy cards.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
    await rerender();
    await toPlay();
    await click(button("Resume"));
    await click(button("Next card"));
    expect(text()).not.toContain("This game uses deck");
    const drawn = savedSession().actions.filter((action: { type: string }) => action.type === "draw");
    expect(drawn).toHaveLength(2);
    for (const action of drawn) expect(["big-0", "big-1", "big-2"]).toContain(action.card.cardId);
  });

  it("ignores corrupt preferences and quarantines an unreadable deck snapshot", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"]);
    await click(button("Draw card"));
    localStorage.setItem(PLAY_PREFS_KEY, "{corrupt");
    localStorage.setItem(SESSION_DECK_KEY, "{bad deck");
    await rerender();
    await toPlay();
    await click(button("Resume"));
    expect($("h1")?.textContent).toBe("Bullseye");
    expect(localStorage.getItem(`${SESSION_DECK_KEY}.unreadable`)).toBe("{bad deck");
    expect(localStorage.getItem(SESSION_DECK_KEY)).toBe("{bad deck");
  });

  it("words common engine errors for players", () => {
    const session = { players: [{ id: "p1", name: "Ada" }] } as Parameters<typeof friendlyError>[1];
    expect(friendlyError("p1 already gave this input.", session)).toBe("Ada has already answered.");
    expect(friendlyError("p1 is not the active player.", session)).toBe("It isn't Ada's turn.");
    expect(friendlyError("Something else.", session)).toBe("Something else.");
  });
});

describe("Review fixes", () => {
  it("asks before a new game replaces the unfinished saved game", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"]);
    await click(button("Draw card"));
    const saved = localStorage.getItem(SESSION_KEY);
    await rerender();
    await toPlay();
    const confirm = vi.mocked(window.confirm);
    confirm.mockReturnValue(false);
    await setUp("Era Sort", ["Ada"]);
    expect(confirm).toHaveBeenLastCalledWith("Starting replaces the unfinished saved game.");
    expect($("h1")?.textContent).toBe("Era Sort");
    expect(localStorage.getItem(SESSION_KEY)).toBe(saved);
    confirm.mockReturnValue(true);
    await click(button("Start"));
    expect($(".round-text")?.textContent).toBe("Round 1 of 10");
    expect(savedSession().mode).toBe("eraSort");
  });

  it("asks once before Play today's round replaces a saved game, and resumes today's Daily", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"]);
    await rerender();
    await toPlay();
    const confirm = vi.mocked(window.confirm);
    confirm.mockClear();
    await click(button("Play today's round"));
    await click(button("Start"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(savedSession().mode).toBe("daily");
    await rerender();
    await toPlay();
    expect(hasButton("Play today's round")).toBe(false);
    confirm.mockClear();
    await click($$("button").filter((item) => item.textContent === "Resume today's round")[0]);
    expect(confirm).not.toHaveBeenCalled();
    expect($("h1")?.textContent).toBe("Daily Eratic");
  });

  it("shows the first reveal of a game started with Play again", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "2" });
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await click(button("Reveal"));
    await click(button("Next card"));
    await submit("#guess-p1", "1990");
    await click(button("Reveal"));
    await click(button("Play again"));
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await click(button("Reveal"));
    expect($(".reveal")).not.toBeNull();
    expect(hasButton("Next card")).toBe(true);
  });

  it("moves focus to the reveal's heading and announces the result with it", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "2" });
    await click(button("Draw card"));
    expect(document.activeElement?.textContent).toBe("Ada's guess");
    const year = yearOf(order[0]);
    await submit("#guess-p1", String(year));
    await click(button("Reveal"));
    const heading = $(".reveal h2.song-title");
    expect(document.activeElement).toBe(heading);
    const summary = document.getElementById(heading!.getAttribute("aria-describedby")!);
    expect(summary?.textContent).toBe(`${year} · ${eraName(eraOf(year))}. Ada +10, exact (guessed ${year}).`);
    await click(button("Next card"));
    expect(document.activeElement?.textContent).toBe("Ada's guess");
  });

  it("announces clip transitions without a per-second live countdown", async () => {
    await render();
    await toPlay();
    await connectManual();
    await setUp("Bullseye", ["Ada"]);
    await click(button("Draw card"));
    expect($(".clip-status")?.getAttribute("aria-hidden")).toBe("true");
    expect($(".clip-status")?.hasAttribute("aria-live")).toBe(false);
  });

  it("shows scores with the chips they include under Stakes", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1", "#option-bullseye-stakes": "" });
    await click(button("Draw card"));
    expect($$(".scoreboard .score-extra").map((item) => item.textContent)).toEqual(["incl. 5 chips"]);
    await submit("#guess-p1", String(yearOf(order[0])));
    await click(button("Reveal"));
    expect(scores()).toEqual(["16"]);
    expect($$(".scoreboard .score-extra").map((item) => item.textContent)).toEqual(["incl. 6 chips"]);
    expect($(".standing-score")?.textContent).toBe("16 points (incl. 6 chips)");
  });
});

describe("Daily Eratic review fixes", () => {
  const deck = bigDeck({ schemaVersion: 2 });
  deck.cards.forEach((card, i) => Object.assign(card, { difficulty: i < 3 ? 1 : 4 }));
  const cards = dailySelection(deck.cards.map((card) => card.id), "2026-10-11", deck.id);

  it("picks the day's cards from the whole deck and offers no easy-only choice", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    await render();
    await toPlay();
    await click(button("Play today's round"));
    expect($("#option-easy")).toBeNull();
    await click(button("Start"));
    expect(savedSession().options.cards).toEqual(cards);
    await click(button("Draw card"));
    expect(hasButton("Skip card")).toBe(false);
  });

  it("after a skipped card, only End game finishes the round", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    const ref = (id: string) => {
      const year = deck.cards.find((card) => card.id === id)!.gameYear.value;
      return { cardId: id, year, era: eraOf(year) };
    };
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        format: "eratic-session",
        sessionVersion: 1,
        id: "s-daily",
        createdAt: "2026-10-11T12:00:00Z",
        deckId: deck.id,
        deckTitle: deck.title,
        mode: "daily",
        options: { date: "2026-10-11", cards },
        seed: 1,
        players: [{ id: "p1", name: "Player 1" }],
        actions: [
          { type: "draw", at: 0, card: ref(cards[0]) },
          { type: "skip", at: 1 },
        ],
      }),
    );
    await render();
    await toPlay();
    await click(button("Resume"));
    expect(text()).toContain("This round's card was skipped. End the game to finish today's round.");
    expect(hasButton("Draw card")).toBe(false);
    await click($$("button").filter((item) => item.textContent === "End game").at(-1)!);
    expect(text()).toContain("Final standings");
  });
});

describe("Play surface polish", () => {
  it("selects a timeline slot first and places only from the confirm button", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const anchor = pickAnchors(
      big.cards.map((card) => ({ id: card.id, year: card.gameYear.value })),
      "random",
      SEED,
      1,
    )[0];
    await render();
    await toPlay();
    await setUp("Relay", ["Ada", "Lin"], { "#option-relay-target": "2", "#option-relay-lives": "1" });
    expect($(".round-text")?.textContent).toBe("Line of 2 · Lives 1 of 1");
    await click(button("Draw card"));
    const before = `Before ${bigYear(anchor)}`;
    await click(button(before));
    expect(button(before).getAttribute("aria-pressed")).toBe("true");
    expect($(".tl-slot.selected")).not.toBeNull();
    expect(actionTypes()).not.toContain("place");
    expect(document.activeElement).toBe(button(`Place: ${before}`));
    await click(button("Cancel"));
    expect(hasButton(`Place: ${before}`)).toBe(false);
    expect(button(before).getAttribute("aria-pressed")).toBe("false");
    await click(button(before));
    await click(button(`Place: ${before}`));
    expect(actionTypes()).toContain("place");
    expect($(".tl-marker")?.textContent).toContain("Your slot");
  });

  it("says who a disabled Reveal is waiting for", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect($(".inputs .muted")?.textContent).toBe("Still to answer: Ada and Lin");
    await submit("#guess-p1", "1990");
    expect($(".inputs .muted")?.textContent).toBe("Still to answer: Lin");
    await submit("#guess-p2", "1991");
    expect(text()).not.toContain("Still to answer");
    expect(button("Reveal").disabled).toBe(false);
  });

  it("names the pending player in Timeline, and the rule in a closest-year sudden death", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await setUp("Timeline", ["Ada", "Lin"]);
    await click(button("Draw card"));
    expect(text()).toContain("Still to answer: Ada");
    await click(button("End game"));
    await click(button("New game"));
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await submit("#guess-p1", "1990");
    await submit("#guess-p2", "1990");
    await click(button("Reveal"));
    expect($(".sudden-death-banner")?.textContent).toBe(
      "Sudden death: Ada and Lin. One song. The closest year wins.",
    );
  });

  it("numbers Bullseye ruler markers so similar names stay distinct", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Anna"], { "#option-bullseye-rounds": "2" });
    await click(button("Draw card"));
    const answer = yearOf(order[0]);
    await submit("#guess-p1", String(answer));
    await submit("#guess-p2", String(answer + 1));
    await click(button("Reveal"));
    expect($$(".ruler-mark").map((item) => item.textContent)).toEqual(["1", "2", "★"]);
    expect($$(".ruler-list li").map((item) => item.textContent)).toEqual([
      `Answer: ${answer}`,
      "1 · Ada: " + answer + " (exact)",
      "2 · Anna: " + (answer + 1) + " (1 year off)",
    ]);
  });

  it("marks the host as Kids for the preset and Era Sort, and keeps it on resume", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await setUp("Timeline", ["Ada", "Lin"], { "#option-kids-preset": "" });
    expect($(".host")?.classList.contains("kids")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PLAY_PREFS_KEY)!)[savedSession().id]).toMatchObject({ kids: true });
    await rerender();
    await toPlay();
    await click(button("Resume"));
    expect($(".host")?.classList.contains("kids")).toBe(true);
    await click(button("End game"));
    await click(button("New game"));
    await setUp("Era Sort", ["Ada"], { "#option-eraSort-kids": "" });
    expect($(".host")?.classList.contains("kids")).toBe(true);
    await click(button("End game"));
    await click(button("New game"));
    await setUp("Era Sort", ["Ada"]);
    expect($(".host")?.classList.contains("kids")).toBe(false);
  });

  it("shows Daily without a pass-the-device list and with years off", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await click(button("Play today's round"));
    await click(button("Start"));
    await click(button("Draw card"));
    expect($(".lock-list")).toBeNull();
    expect($(".entry-form")).not.toBeNull();
    for (let round = 0; round < 3; round++) {
      await click($(".era-tile")!);
      await click(button("Lock in"));
      await click(button("Reveal"));
      await click(button("Next card"));
    }
    expect($(".lock-list")).toBeNull();
    await submit("#daily-p1", "1990");
    await click(button("Reveal"));
    expect(resultLines()[0]).toMatch(/^[^,]*\+\d+, (exact|\d+ years? off) \(guessed 1990\)$/);
  });
});

describe("Undo and the remembered roster", () => {
  it("takes back the last entry before the reveal and offers nothing after it", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect(hasButton("Undo Ada's entry")).toBe(false);
    await submit("#guess-p1", "1990");
    expect($$(".lock-list li").map((item) => item.textContent)).toEqual(["AdaLocked", "LinEntering"]);
    await click(button("Undo Ada's entry"));
    expect($$(".lock-list li").map((item) => item.textContent)).toEqual(["AdaEntering", "LinWaiting"]);
    expect(savedSession().actions.map((action: { type: string }) => action.type)).toEqual(["draw"]);
    expect(hasButton("Undo Ada's entry")).toBe(false);
    await submit("#guess-p1", "1991");
    await submit("#guess-p2", "1992");
    await click(button("Undo Lin's entry"));
    await submit("#guess-p2", "1993");
    await click(button("Reveal"));
    expect($$("button").some((item) => item.textContent?.startsWith("Undo"))).toBe(false);
  });

  it("remembers the last game's names, clamped to the next mode's range", async () => {
    await render();
    await toPlay();
    await click(button("Play Bullseye"));
    await click(button("Add player"));
    for (const [i, name] of ["Ada", "Lin", "Kim"].entries()) await type(`#player-${i}`, name);
    await click(button("Start"));
    expect(JSON.parse(localStorage.getItem(ROSTER_KEY)!)).toEqual(["Ada", "Lin", "Kim"]);
    await click(button("End game"));
    await click(button("New game"));
    // Higher or Lower holds 1-6 players: all three names come back.
    await click(button("Play Higher or Lower"));
    expect($$(".player-input input").map((item) => (item as HTMLInputElement).value)).toEqual(["Ada", "Lin", "Kim"]);
    await click(button("Back"));
    // Daily has one seat: the first name.
    await click(button("Play Daily Eratic"));
    expect($$(".player-input input").map((item) => (item as HTMLInputElement).value)).toEqual(["Ada"]);
  });

  it("defaults to Player 1, Player 2 without a remembered roster", async () => {
    await render();
    await toPlay();
    await click(button("Play Bullseye"));
    expect($$(".player-input input").map((item) => (item as HTMLInputElement).value)).toEqual(["Player 1", "Player 2"]);
  });

  it("round-trips the roster and treats anything else as absent", () => {
    expect(loadRoster()).toBeUndefined();
    expect(saveRoster(["  Ada ", "Lin"])).toBe(true);
    expect(loadRoster()).toEqual(["Ada", "Lin"]);
    for (const bad of [
      "not json",
      "{}",
      "[]",
      '[""]',
      "[1]",
      '[" Ada"]',
      JSON.stringify(["x".repeat(41)]),
      JSON.stringify(Array.from({ length: 11 }, (_, i) => `P${i}`)),
    ]) {
      localStorage.setItem(ROSTER_KEY, bad);
      expect(loadRoster()).toBeUndefined();
    }
    localStorage.setItem(ROSTER_KEY, JSON.stringify(["🎵".repeat(40)]));
    expect(loadRoster()).toHaveLength(1);
    expect(saveRoster([])).toBe(false);
    expect(saveRoster(["x".repeat(41)])).toBe(false);
  });

  it("pads a short roster up to the mode's minimum", async () => {
    saveRoster(["Ada"]);
    await render();
    await toPlay();
    await click(button("Play Relay"));
    expect($$(".player-input input").map((item) => (item as HTMLInputElement).value)).toEqual(["Ada", "Player 2"]);
  });
});

describe("Tap-in-order Lineup entry", () => {
  it("builds the order from the pool, with Move, Remove and Clear", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    await render();
    await toPlay();
    await setUp("Lineup by name", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    const set = bigOrder.slice(0, 3);
    expect($$(".order-item")).toHaveLength(0);
    expect($$('[aria-label$="songs left to place"] button')).toHaveLength(3);
    await tapSong(bigTitle(set[1]));
    await tapSong(bigTitle(set[0]));
    expect($$(".order-item").map((item) => item.querySelector(".order-position")?.textContent)).toEqual(["1.", "2."]);
    expect($$(".order-item .tile-letter").map((item) => item.textContent)).toEqual(["B", "A"]);
    await click(button("Move A up"));
    expect($$(".order-item .tile-letter").map((item) => item.textContent)).toEqual(["A", "B"]);
    await click(button("Remove A"));
    expect($$(".order-item .tile-letter").map((item) => item.textContent)).toEqual(["B"]);
    await tapSong(bigTitle(set[0]));
    await click(button("Lock in"));
    expect($(".error")?.textContent).toBe("Place every song first.");
    expect(savedSession().actions.some((action: { type: string }) => action.type === "order")).toBe(false);
    await click(button("Clear"));
    expect($$(".order-item")).toHaveLength(0);
    for (const id of set) await tapSong(bigTitle(id));
    await click(button("Lock in"));
    expect(savedSession().actions.at(-1)).toMatchObject({ type: "order", order: set });
  });
});

describe("All-at-once entry", () => {
  const years = () => $$("input[type=number]");
  async function fill(selector: string, value: string) {
    await type(selector, value);
  }
  async function toAll() {
    await click(button("All at once"));
  }

  it("remembers the choice per device and treats a corrupt value as one at a time", async () => {
    expect(loadEntryStyle()).toBe("each");
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect(button("One at a time").getAttribute("aria-pressed")).toBe("true");
    await toAll();
    expect(JSON.parse(localStorage.getItem(ENTRY_KEY)!)).toBe("all");
    expect(loadEntryStyle()).toBe("all");
    localStorage.setItem(ENTRY_KEY, "{oops");
    expect(loadEntryStyle()).toBe("each");
  });

  it("locks every Bullseye player at once, and an invalid row blocks all", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await toAll();
    expect(years()).toHaveLength(2);
    await fill("#guess-all-p1", "1990");
    await click(button("Lock in all"));
    expect($(".error")?.textContent).toBe("Lin: Enter a year from 1850 to 2100.");
    // Nothing was sent, not even Ada's row.
    expect(savedSession().actions.map((action: { type: string }) => action.type)).toEqual(["draw"]);
    await fill("#guess-all-p2", "1991");
    await click(button("Lock in all"));
    expect(savedSession().actions.slice(1).map((action: { type: string; playerId: string }) => action.playerId)).toEqual([
      "p1",
      "p2",
    ]);
    expect(text()).toContain("Everyone is locked in.");
    expect(hasButton("Undo Lin's entry")).toBe(true);
  });

  it("asks for each wager under Stakes and sends it before the guess", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1", "#option-bullseye-stakes": "" });
    await click(button("Draw card"));
    await toAll();
    expect($$(".wager")).toHaveLength(2);
    await click($$(".wager")[1].querySelectorAll("button")[2]);
    await fill("#guess-all-p1", "1990");
    await fill("#guess-all-p2", "1991");
    await click(button("Lock in all"));
    expect(
      savedSession().actions.slice(1).map((action: { type: string; playerId: string; chips?: number }) =>
        [action.type, action.playerId, action.chips ?? ""].join(":"),
      ),
    ).toEqual(["wager:p1:1", "guess:p1:", "wager:p2:3", "guess:p2:"]);
  });

  it("picks every Era Sort era from native selects, refusing while one is missing", async () => {
    await render();
    await toPlay();
    await setUp("Era Sort", ["Ada", "Lin"], { "#option-eraSort-rounds": "1" });
    await click(button("Draw card"));
    await toAll();
    const selects = $$("select") as HTMLSelectElement[];
    expect(selects.map((item) => item.getAttribute("aria-label"))).toEqual(["Ada's era", "Lin's era"]);
    expect([...selects[0].options].map((item) => item.textContent)).toContain("Neon, 1980s");
    const choose = async (select: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await choose(selects[0], ERA_IDS[0]);
    await click(button("Lock in all"));
    expect($(".error")?.textContent).toBe("Lin: Pick an era.");
    expect(savedSession().actions.map((action: { type: string }) => action.type)).toEqual(["draw"]);
    await choose(selects[1], ERA_IDS[1]);
    await click(button("Lock in all"));
    expect(savedSession().actions.slice(1)).toMatchObject([
      { type: "pickEra", playerId: "p1", era: ERA_IDS[0] },
      { type: "pickEra", playerId: "p2", era: ERA_IDS[1] },
    ]);
  });
});

describe("Leader, recap and personal bests", () => {
  it("names the leader after each reveal and recaps the game card by card", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "3" });
    const years = order.slice(0, 3).map(yearOf);
    const round = async (ada: number, lin: number) => {
      await submit("#guess-p1", String(ada));
      await submit("#guess-p2", String(lin));
      await click(button("Reveal"));
    };
    await click(button("Draw card"));
    await round(years[0], years[0]);
    expect($(".reveal-then .song-title")).not.toBeNull();
    expect($(".reveal-last .leader-line")?.textContent).toBe("Ada and Lin share the lead with 10.");
    await click(button("Next card"));
    await round(years[1], years[1] + 60);
    expect($(".leader-line")?.textContent).toBe("Ada takes the lead with 20.");
    await click(button("Next card"));
    await round(years[2], years[2]);
    expect($(".leader-line")?.textContent).toBe("Ada leads with 30.");
    const recap = $("details.recap") as HTMLDetailsElement;
    expect(recap.open).toBe(false);
    expect(recap.querySelector("summary")?.textContent).toBe("Card by card");
    const lines = [...recap.querySelectorAll("li")].map((item) => item.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(new RegExp(`^${years[0]} · .*: Ada and Lin \\+10$`));
    expect(lines[1]).toMatch(new RegExp(`^${years[1]} · .*: Ada \\+10$`));
    // With the deck, each line names the song.
    const song = (id: string) => demo.cards.find((card) => card.id === id)!;
    expect(recapLines(parseSession(localStorage.getItem(SESSION_KEY)!), parseDeck(JSON.stringify(demo)))).toEqual([
      `${years[0]} · ${song(order[0]).title} — ${song(order[0]).artist}: Ada and Lin +10`,
      `${years[1]} · ${song(order[1]).title} — ${song(order[1]).artist}: Ada +10`,
      `${years[2]} · ${song(order[2]).title} — ${song(order[2]).artist}: Ada and Lin +10`,
    ]);
    // Two players: no personal best.
    expect($(".personal-best")).toBeNull();
    expect(localStorage.getItem(BESTS_KEY)).toBeNull();
  });

  it("records a solo personal best and says when a later game beats it", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    const first = yearOf(order[0]);
    await click(button("Draw card"));
    await submit("#guess-p1", String(first + 60));
    await click(button("Reveal"));
    expect($(".leader-line")).toBeNull();
    expect($(".personal-best")?.textContent).toBe("Best: 0");
    expect(JSON.parse(localStorage.getItem(BESTS_KEY)!)).toEqual({
      "demo-deck": { "solo-bullseye-1": { score: 0, sessionId: savedSession().id } },
    });
    expect($("details.recap li")?.textContent).toMatch(/: nobody scored$/);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 1000);
    await click(button("Play again"));
    await click(button("Draw card"));
    await submit("#guess-p1", String(first));
    await click(button("Reveal"));
    expect($(".personal-best")?.textContent).toBe("New best: 10!");
    expect(JSON.parse(localStorage.getItem(BESTS_KEY)!)["demo-deck"]["solo-bullseye-1"]).toEqual({
      score: 10,
      sessionId: savedSession().id,
    });
  });

  it("keeps Relay's best team score and recaps cards for the team and lost lives", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const anchor = pickAnchors(
      big.cards.map((card) => ({ id: card.id, year: card.gameYear.value })),
      "random",
      SEED,
      1,
    )[0];
    const card = bigOrder.find((id) => id !== anchor)!;
    await render();
    await toPlay();
    await setUp("Relay", ["Ada", "Lin"], { "#option-relay-target": "2", "#option-relay-lives": "1" });
    await click(button("Draw card"));
    await pick(slotFor([bigYear(anchor)], bigYear(card), true));
    await click(button("Reveal"));
    expect($(".leader-line")).toBeNull();
    expect($(".personal-best")?.textContent).toBe("Best: 12");
    expect($("details.recap li")?.textContent).toMatch(new RegExp(`^${bigYear(card)} · .*: \\+1 card for the team$`));
    const firstId = savedSession().id;
    await click(button("Play again"));
    await click(button("Draw card"));
    await pick(slotFor([bigYear(anchor)], bigYear(card), false));
    await click(button("Reveal"));
    expect($(".personal-best")?.textContent).toBe("Best: 12");
    expect($("details.recap li")?.textContent).toMatch(/: lost a life$/);
    expect(JSON.parse(localStorage.getItem(BESTS_KEY)!)["big-deck"]["relay-2-1"]).toEqual({ score: 12, sessionId: firstId });
  });
});

describe("Review fixes", () => {
  it("All at once sends nothing when the engine would reject the entries", async () => {
    await render();
    await toPlay();
    await setUp("Bullseye", ["Ada", "Lin"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await click(button("All at once"));
    await type("#guess-all-p1", "1990");
    await type("#guess-all-p2", "1991");
    const project = vi.spyOn(GameController.prototype, "project").mockReturnValue(undefined);
    await click(button("Lock in all"));
    expect(project).toHaveBeenCalled();
    expect($(".error")?.textContent).toContain("Couldn't lock everyone in:");
    expect(savedSession().actions.map((action: { type: string }) => action.type)).toEqual(["draw"]);
    project.mockRestore();
    await click(button("Lock in all"));
    expect(savedSession().actions).toHaveLength(3);
  });

  it("drops an open Timeline challenge picker when the placement is undone", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const anchors = pickAnchors(
      big.cards.map((card) => ({ id: card.id, year: card.gameYear.value })),
      "random",
      SEED,
      2,
    );
    const draws = bigOrder.filter((id) => !anchors.includes(id));
    await render();
    await toPlay();
    await setUp("Timeline", ["Ada", "Lin"], { "#option-timeline-target": "3" });
    await click(button("Draw card"));
    const slot = slotFor([bigYear(anchors[0])], bigYear(draws[0]), false);
    await pick(slot);
    await click(button("Challenge as Lin"));
    expect(text()).toContain("Lin, choose a free slot");
    await click(button("Undo Ada's entry"));
    expect(text()).toContain("where does this song go?");
    await pick(slot);
    expect(text()).not.toContain("choose a free slot");
    expect(hasButton("Challenge as Lin")).toBe(true);
  });

  it("shows the generic Reveal for a Higher or Lower turn saved with a call but no reveal", async () => {
    await render();
    await toPlay();
    await setUp("Higher or Lower", ["Ada"]);
    await click(button("Draw card"));
    const saved = savedSession();
    saved.actions.push({ type: "call", at: 5, playerId: "p1", call: "earlier" });
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
    await rerender();
    await toPlay();
    await click(button("Resume"));
    expect(text()).toContain("Ada called Earlier.");
    expect(hasButton("Reveal")).toBe(true);
    await click(button("Reveal"));
    expect(text()).toContain("Ada called Earlier: right, streak 1");
  });
});
