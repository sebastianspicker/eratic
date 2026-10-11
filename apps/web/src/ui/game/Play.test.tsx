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
import { DAILY_KEY, PLAY_PREFS_KEY, SESSION_DECK_KEY, SESSION_KEY, SESSION_UNREADABLE_KEY } from "../../sessions";
import { friendlyError } from "./useGame";
import { STORAGE_KEY } from "../../storage";
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
    expect(tiles[0].textContent).toContain("Needs exact clips");
    expect(tiles[8].textContent).toContain("Needs exact clips");
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
    await click(button(year > reference ? "Earlier" : "Later"));
    expect(text()).toContain("Reveal when ready.");
    await click(button("Reveal"));
    expect(resultLines()[0]).toContain("missed");
    expect($(".round-text")?.textContent).toBe("Final results");
    expect($(".standings")?.textContent).toContain("0 streak");
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
    await click(button(slotFor([bigYear(anchors[0])], first, false)));
    expect($(".tl-marker")?.textContent).toContain("Your slot");
    await click(button("Challenge as Lin"));
    await click(button(slotFor([bigYear(anchors[0])], first, true)));
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
    await click(button(slotFor([bigYear(anchors[1]), first], second, true)));
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
    await click(button(slotFor([bigYear(anchor)], bigYear(card), true)));
    await click(button("Reveal"));
    expect(text()).toContain("Correct! The line now has 2 cards.");
    expect(text()).toContain("The line is complete. The team wins!");
    expect($(".relay-results")?.textContent).toContain("Team score 12");

    await click(button("Play again"));
    await click(button("Draw card"));
    await click(button(slotFor([bigYear(anchor)], bigYear(card), false)));
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
    // Sort the order list by year with the move buttons.
    const want = [...set].sort((a, b) => bigYear(a) - bigYear(b));
    for (let target = 0; target < want.length; target++) {
      for (;;) {
        const names = $$(".order-name").map((item) => item.textContent);
        const at = names.indexOf(bigTitle(want[target]));
        if (at === target) break;
        await click($$(".order-item")[at].querySelectorAll("button")[0]);
      }
    }
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
    await click(button("Lock in"));
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect($(".sudden-death-banner")?.textContent).toBe("Sudden death: Ada and Lin");
    await click(button("Next card"));
    expect(savedSession().actions.at(-1)).toMatchObject({
      type: "sdDraw",
      cards: sudden.map((id) => ({ cardId: id })),
    });
    expect(used.every((id) => !sudden.includes(id))).toBe(true);
    // Ada puts the cards in year order; Lin leaves them as drawn, reversed.
    const want = [...sudden].sort((a, b) => bigYear(a) - bigYear(b));
    for (let target = 0; target < want.length; target++)
      for (;;) {
        const names = $$(".order-name").map((item) => item.textContent);
        const at = names.indexOf(bigTitle(want[target]));
        if (at === target) break;
        await click($$(".order-item")[at].querySelectorAll("button")[0]);
      }
    await click(button("Lock in"));
    for (let i = 0; i < 2; i++) {
      const names = $$(".order-name").map((item) => item.textContent);
      const at = names.indexOf(bigTitle(want[2]));
      if (at > 0) await click($$(".order-item")[at].querySelectorAll("button")[0]);
    }
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
