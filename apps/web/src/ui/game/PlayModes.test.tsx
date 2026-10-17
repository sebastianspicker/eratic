// @vitest-environment jsdom
// The modes that need exact clips (Snippet Ladder, Lineup with clips, Original or
// Imposter), through the real app with a fake Spotify player that plays at once.
// Scores come from the core engine; expectations restate contract/game-rules.md.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawOrder, pickAnchors } from "../../core/random";
import { imposterPairs } from "../../core/scoring";
import { renderQR } from "../../qrSvg";
import type { PlaybackTier } from "../../playback/player";
import { SESSION_KEY } from "../../sessions";
import { STORAGE_KEY } from "../../storage";
import App from "../App";

const fake = vi.hoisted(() => ({
  prepared: [] as string[],
  plays: [] as number[],
  tier: { kind: "fullTrack" } as PlaybackTier,
  connectError: "",
  playError: "",
  // When set, prepare() waits for it, so a test can hold a song in "Preparing…".
  gate: undefined as Promise<void> | undefined,
  player() {
    return {
      provider: "spotify" as const,
      tier: () => fake.tier,
      connect: async () => {
        if (fake.connectError) {
          fake.tier = { kind: "unavailable", reason: fake.connectError };
          throw new Error(fake.connectError);
        }
      },
      prepare: async (track: { id: string }) => {
        await fake.gate;
        fake.prepared.push(track.id);
      },
      play: async (fromMs: number) => {
        if (fake.playError) throw new Error(fake.playError);
        fake.plays.push(fromMs);
        const now = performance.now();
        return { requestedAt: now, audibleAt: now, positionMs: fromMs };
      },
      stop: async () => {},
      positionMs: async () => performance.now(),
    };
  },
}));
// A hidden preview that records snippet requests; the test plays them by calling onAudible.
const preview = vi.hoisted(() => ({
  state: "ready",
  // States for the next sessions, before falling back to state.
  queue: [] as string[],
  // Every session's notify, so a test can end a snippet or finish loading.
  sessions: [] as ((state: string) => void)[],
  snippets: [] as [number, number][],
  audible: [] as (() => void)[],
  pauses: 0,
  disposals: 0,
}));
vi.mock("../../playback/embeddedPreview", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../playback/embeddedPreview")>();
  class FakeSession {
    notify: (state: string) => void;
    constructor(...args: unknown[]) {
      const notify = args.find((arg) => typeof arg === "function") as (state: string) => void;
      this.notify = notify;
      preview.sessions.push(notify);
      notify(preview.queue.shift() ?? preview.state);
    }
    play() {}
    pause() { preview.pauses++; this.notify("paused"); }
    seek() {}
    restart() {}
    dispose() { preview.disposals++; }
    snippet(from: number, length: number, onAudible: () => void) {
      preview.snippets.push([from, length]);
      this.notify("starting");
      preview.audible.push(() => { this.notify("playing"); onAudible(); });
    }
  }
  return { ...mod, SpotifyPreviewSession: FakeSession, ApplePreviewSession: FakeSession };
});
vi.mock("../../playback/hub", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../playback/hub")>();
  class TestHub extends mod.PlaybackHub {
    constructor() {
      super(undefined, { spotify: () => fake.player() }, { spotify: true, appleMusic: false, manual: true });
    }
  }
  return { ...mod, PlaybackHub: TestHub };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 42;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const YEARS = [1962, 1979, 1984, 1990, 1997, 2003];
const trackId = (i: number) => `track${String(i).padStart(17, "0")}`;
function deck(extra: Record<string, unknown> = {}, cards: Record<number, Record<string, unknown>> = {}) {
  return {
    schemaVersion: 2,
    id: "clip-deck",
    title: "Clip deck",
    ...extra,
    cards: YEARS.map((year, i) => ({
      id: `clip-${i}`,
      title: `Tune ${i}`,
      artist: `Band ${i}`,
      gameYear: { value: year, source: "Fictional sample for software testing" },
      links: [{ provider: "spotify", url: `https://open.spotify.com/track/${trackId(i)}` }],
      ...cards[i],
    })),
  };
}
const year = (id: string) => YEARS[Number(id.split("-")[1])];
const title = (id: string) => `Tune ${id.split("-")[1]}`;

let root: Root;
let container: HTMLDivElement;
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
}
const $ = (selector: string) => container.querySelector(selector);
const $$ = (selector: string) => [...container.querySelectorAll(selector)];
const text = () => container.textContent ?? "";
function button(name: string) {
  const found = $$("button").find((item) => item.textContent === name);
  if (!found) throw new Error(`No button "${name}"`);
  return found as HTMLButtonElement;
}
async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 50 && !ready(); i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(ready()).toBe(true);
}
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
async function check(label: string) {
  const input = $$("input[type=checkbox]").find((item) => item.getAttribute("aria-label") === label);
  if (!input) throw new Error(`No checkbox "${label}"`);
  await click(input);
}
async function openPlay(stored: object, tier = "Spotify Premium: exact clips") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  await render();
  await act(async () => {
    await import("./Play");
  });
  await click(button("Play"));
  await click($('input[value="spotify"]')!);
  await click(button("Use playback"));
  expect($(".tier")?.textContent).toBe(tier);
}
async function setUp(mode: string, names: string[], options: Record<string, string> = {}) {
  await click(button(`Play ${mode}`));
  while ($$(".player-row").length > names.length) await click($$(".player-row button").at(-1)!);
  for (const [i, name] of names.entries()) await type(`#player-${i}`, name);
  for (const [selector, value] of Object.entries(options)) await type(selector, value);
  await click(button("Start"));
}
const session = () => JSON.parse(localStorage.getItem(SESSION_KEY)!);
const actions = () => session().actions.map(({ at: _at, ...rest }: { at: number }) => rest);
const resultLines = () => $$(".result-lines li").map((item) => item.textContent);

beforeEach(() => {
  localStorage.clear();
  fake.prepared = [];
  fake.plays = [];
  fake.tier = { kind: "fullTrack" };
  fake.connectError = "";
  fake.playError = "";
  fake.gate = undefined;
  preview.state = "ready";
  preview.queue = [];
  preview.sessions = [];
  preview.snippets = [];
  preview.audible = [];
  preview.pauses = 0;
  preview.disposals = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as unknown as Uint32Array)[0] = SEED;
    return array;
  });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Snippet Ladder", () => {
  it("plays exact steps from the clip start, locks players, marks them and scores the card", async () => {
    const stored = deck({ defaultClipStartMs: 20000 });
    const card = drawOrder(stored.cards.map((item) => item.id), SEED)[0];
    await openPlay(stored);
    expect($('[data-mode="ladder"] button')?.textContent).toBe("Play Snippet Ladder");
    await click(button("Play Snippet Ladder"));
    expect($(".warning")?.textContent).toContain("Spotify timing isn't calibrated yet");
    await click(button("Back"));
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    expect($(".stage .warning")?.textContent).toContain("isn't calibrated");
    expect($$(".step-bar li").map((item) => item.textContent)).toEqual(["1 s", "5 s", "10 s", "20 s", "30 s"]);
    expect(button("Lock in Ada").disabled).toBe(true);
    expect(button("Show answer").disabled).toBe(true);

    await click(button("Play 1 s"));
    expect(fake.prepared).toEqual([trackId(Number(card.split("-")[1]))]);
    expect(fake.plays).toEqual([20000]);
    expect($(".step-bar li.current")?.textContent).toContain("1 s");
    expect($(".clip-status")?.textContent).toMatch(/Playing, 1 s left/);
    await click(button("Lock in Ada"));
    expect(text()).toContain("Locked at 1 s");
    // Space plays the next step when focus is not in a field.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect($(".step-bar li.current")?.textContent).toContain("5 s");
    expect($$(".step-bar li.played")).toHaveLength(2);
    await click(button("Replay 5 s"));
    await click(button("Lock in Lin"));
    expect(actions()).toEqual([
      { type: "draw", card: { cardId: card, year: year(card), era: expect.any(String) } },
      { type: "step", index: 0 },
      { type: "clip", fromMs: 20000, lengthMs: 1000 },
      { type: "lock", playerId: "p1" },
      { type: "step", index: 1 },
      { type: "clip", fromMs: 20000, lengthMs: 5000 },
      { type: "step", index: 1 },
      { type: "clip", fromMs: 20000, lengthMs: 5000 },
      { type: "lock", playerId: "p2" },
    ]);

    await click(button("Show answer"));
    expect($(".answer-box")?.textContent).toContain(`${title(card)} · Band ${card.split("-")[1]} · ${year(card)}`);
    await check("Ada: Title right");
    await check("Ada: Artist right");
    await check("Lin: Title right");
    expect(hasNoReveal()).toBe(true);
    await click(button("Score card"));
    expect(resultLines()).toEqual([
      "Ada +10, locked at 1 s, title and artist right",
      "Lin +4, locked at 5 s, title right",
    ]);
    expect(actions().slice(-3)).toEqual([
      { type: "mark", playerId: "p1", titleOK: true, artistOK: true },
      { type: "mark", playerId: "p2", titleOK: true, artistOK: false },
      { type: "reveal" },
    ]);
    const standings = $$(".standings li");
    expect(standings[0].textContent).toContain("1Ada10 points");
    expect(standings[0].textContent).toContain("1 s used");
    expect(standings[1].textContent).toContain("5 s used");
  });

  it("marks steps by hand when the tier is exact but the card has no link for the provider", async () => {
    const other = { links: [{ provider: "other", url: "https://example.com/song" }] };
    await openPlay(deck({}, Object.fromEntries(YEARS.map((_, i) => [i, other]))));
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    expect(text()).toContain("Without exact clips, play each step by hand");
    expect(text()).not.toContain("This card has no Spotify link.");
    await click(button("Mark 1 s played"));
    expect(actions().at(-1)).toEqual({ type: "step", index: 0 });
    expect(fake.plays).toEqual([]);
    expect(button("Lock in Ada").disabled).toBe(false);
    await click(button("Lock in Ada"));
    expect(button("Show answer").disabled).toBe(false);
  });

  it("moves focus to the next step after a lock, so Space plays it instead of locking the next player", async () => {
    await openPlay(deck());
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Ada"));
    expect(document.activeElement).toBe(button("More time: 5 s"));
    expect(button("Lock in Lin").disabled).toBe(false);
  });

  it("hides Undo while a step is preparing, until it has been heard", async () => {
    await openPlay(deck());
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Stop"));
    await click(button("Lock in Ada"));
    expect(hasButtonNamed("Undo Ada's entry")).toBe(true);
    let release = () => {};
    fake.gate = new Promise<void>((resolve) => (release = resolve));
    await click(button("More time: 5 s"));
    expect(hasButtonNamed("Undo Ada's entry")).toBe(false);
    await act(async () => release());
    await waitFor(() => !hasButtonNamed("Undo Ada's entry"));
    expect(actions().at(-1)).toEqual({ type: "clip", fromMs: 0, lengthMs: 5000 });
  });

  it("adds the buzzer bonus for the first right lock-in, and shows buzzers only when the option is on", async () => {
    await openPlay(deck());
    await click(button("Play Snippet Ladder"));
    expect($("#option-ladder-buzzer")).not.toBeNull();
    await type("#player-0", "Ada");
    await type("#player-1", "Lin");
    await type("#option-ladder-rounds", "1");
    await click($("#option-ladder-buzzer")!);
    await click(button("Start"));
    expect(session().options.buzzer).toBe(true);
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Ada"));
    await click(button("More time: 5 s"));
    await click(button("Lock in Lin"));
    await click(button("Show answer"));
    await check("Ada: Title right");
    await check("Ada: Artist right");
    await check("Lin: Title right");
    await click(button("Score card"));
    expect(resultLines()).toEqual([
      "Ada +12, locked at 1 s, title and artist right, +2 buzzer",
      "Lin +4, locked at 5 s, title right",
    ]);
    expect($$(".standings li").every((item) => !item.textContent?.includes("buzzer"))).toBe(true);
    expect(text()).toContain("Buzzer bonuses: Ada 1 · Lin 0");
  });

  it("sends no buzzer option by default, and no buzzers in the results", async () => {
    await openPlay(deck());
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    expect(session().options).not.toHaveProperty("buzzer");
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Ada"));
    await click(button("Show answer"));
    await check("Ada: Title right");
    await click(button("Score card"));
    expect(text()).not.toContain("buzzer");
  });

  it("breaks a tie with a 5 s first-to-name sudden death", async () => {
    await openPlay(deck());
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Ada"));
    await click(button("Lock in Lin"));
    await click(button("Show answer"));
    await click(button("Score card"));
    expect($(".sudden-death-banner")?.textContent).toBe(
      "Sudden death: Ada and Lin. One 5-second clip. The first to name the song wins.",
    );
    await click(button("Next card"));
    await click($(".stage .clip-controls button.primary")!); // the stage's Play, not the navigation or the preview
    expect(actions().at(-1)).toEqual({ type: "clip", fromMs: 0, lengthMs: 5000 });
    await click(button("Nobody named it"));
    await click(button("Reveal"));
    expect(text()).toContain("Nobody named it. Still tied: Ada and Lin.");
    await click(button("Next card"));
    await click(button("Lin named it first"));
    expect(text()).toContain("Lin named it first. Reveal when ready.");
    await click(button("Reveal"));
    expect(text()).toContain("Lin wins the sudden death.");
    expect($$(".standings li")[0].textContent).toContain("1Lin");
  });
});

describe("Snippet Ladder year entry", () => {
  async function choose(selector: string, value: string) {
    const select = $(selector) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function start(guess: string) {
    await openPlay(deck());
    await click(button("Play Snippet Ladder"));
    await choose("#option-ladder-guess", guess);
    await type("#option-ladder-rounds", "1");
    await type("#player-0", "Ada");
    await type("#player-1", "Lin");
    await click(button("Start"));
    await click(button("Draw card"));
    await click(button("Play 1 s"));
  }

  it("keeps each player's year private: one entry panel at a time, Cancel to leave it", async () => {
    await start("both");
    expect($("#ladder-year-p1")).toBeNull();
    expect($("#ladder-year-p2")).toBeNull();
    expect(text()).toContain("When you lock in, whisper your answer to the host or write it down.");
    await click(button("Lock in Ada"));
    expect($(".inputs h3")?.textContent).toBe("Ada's year");
    expect($("#ladder-year-p1")).not.toBeNull();
    expect($("#ladder-year-p2")).toBeNull();
    expect(document.activeElement).toBe($("#ladder-year-p1"));
    expect($$("button").some((item) => item.textContent === "Lock in Lin")).toBe(false);
    await click(button("Cancel"));
    expect($("#ladder-year-p1")).toBeNull();
    expect(actions().some((action: { type: string }) => action.type === "lock")).toBe(false);
    await click(button("Lock in Ada"));
    await type("#ladder-year-p1", "1984");
    await act(async () => (($("#ladder-year-p1") as HTMLInputElement).form as HTMLFormElement).requestSubmit());
    expect(actions().at(-1)).toEqual({ type: "lock", playerId: "p1", year: 1984 });
    expect(text()).toContain("Locked at 1 s");
    expect($("#ladder-year-p2")).toBeNull();
  });

  it("locks name-only guesses at once, and shows no hint in year-only mode", async () => {
    await start("name");
    await click(button("Lock in Ada"));
    expect(actions().at(-1)).toEqual({ type: "lock", playerId: "p1" });
    expect(text()).toContain("whisper your answer");
  });

  it("year-only mode has the private panel but no whisper hint", async () => {
    await start("year");
    expect(text()).not.toContain("whisper your answer");
    await click(button("Lock in Lin"));
    expect($(".inputs h3")?.textContent).toBe("Lin's year");
  });
});

describe("Snippet Ladder with Stakes", () => {
  it("asks for every wager before the answer, so the card can always be scored", async () => {
    await openPlay(deck());
    await click(button("Play Snippet Ladder"));
    await type("#option-ladder-rounds", "1");
    await click($("#option-ladder-stakes")!);
    await click(button("Start"));
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Player 1"));
    await click(button("Lock in Player 2"));
    // Everyone locked, but the wagers are still missing: no answer yet.
    expect(button("Show answer").disabled).toBe(true);
    expect(text()).toContain("Waiting for Player 1 and Player 2.");
    await click($$("button").filter((item) => item.textContent === "Place wager")[0]);
    expect(button("Show answer").disabled).toBe(true);
    expect(text()).toContain("Waiting for Player 2.");
    await click(button("Place wager"));
    expect(button("Show answer").disabled).toBe(false);
    await click(button("Show answer"));
    expect(button("Score card").disabled).toBe(false);
    await check("Player 1: Title right");
    await check("Player 1: Artist right");
    await click(button("Score card"));
    expect(resultLines()).toEqual([
      "Player 1 +10, locked at 1 s, title and artist right, won 1 chip",
      "Player 2 +0, locked at 1 s, neither right, lost 1 chip",
    ]);
    expect(actions().slice(-6).map((action: { type: string }) => action.type)).toEqual([
      "lock",
      "wager",
      "wager",
      "mark",
      "mark",
      "reveal",
    ]);
  });

  it("records a step only once its clip is audible, and not at all when it fails", async () => {
    await openPlay(deck());
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    // A clip that never becomes audible: the step stays unplayed and the error shows.
    fake.playError = "Spotify did not start playing in time.";
    await click(button("Play 1 s"));
    expect(actions().map((action: { type: string }) => action.type)).toEqual(["draw"]);
    expect($(".step-bar li.current")).toBeNull();
    expect($(".stage .error")?.textContent).toBe("Spotify did not start playing in time.");
    expect(button("Lock in Ada").disabled).toBe(true);
    fake.playError = "";
    await click(button("Play 1 s"));
    expect(actions().map((action: { type: string }) => action.type)).toEqual(["draw", "step", "clip"]);
    expect($(".step-bar li.current")?.textContent).toContain("1 s");
  });
});

describe("Playback without exact clips", () => {
  const links = (i: number) => [
    { provider: "other", url: `https://example.com/music/clip-${i}` },
    { provider: "spotify", url: `https://open.spotify.com/track/${trackId(i)}` },
  ];
  let opened: string[];
  beforeEach(() => {
    opened = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });
  });

  it("opens the card's Spotify link on Spotify Free and never asks the player to play", async () => {
    fake.tier = { kind: "noExactPlayback" };
    const stored = deck({}, Object.fromEntries(YEARS.map((_, i) => [i, { links: links(i) }])));
    const card = drawOrder(stored.cards.map((item) => item.id), SEED)[0];
    await openPlay(stored, "Spotify: manual playback (Free or Premium)");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play on Spotify"));
    expect(opened).toEqual([`https://open.spotify.com/track/${trackId(Number(card.split("-")[1]))}`]);
    expect(fake.plays).toEqual([]);
    expect(fake.prepared).toEqual([]);
    expect(actions().at(-1)).toEqual({ type: "clip", fromMs: 0 });
  });

  it("shows the song's link as a QR to scan", async () => {
    fake.tier = { kind: "noExactPlayback" };
    const stored = deck({}, Object.fromEntries(YEARS.map((_, i) => [i, { links: links(i) }])));
    const card = drawOrder(stored.cards.map((item) => item.id), SEED)[0];
    await openPlay(stored, "Spotify: manual playback (Free or Premium)");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    await waitFor(() => !!$(".song-qr .qr-image svg"));
    const url = `https://open.spotify.com/track/${trackId(Number(card.split("-")[1]))}`;
    // The same modules as the QR for the card's Spotify link.
    const modules = (svg: string) => svg.match(/stroke="#000000" d="([^"]+)"/)?.[1];
    const expected = modules(await renderQR(url));
    expect(expected).toBeTruthy();
    expect(modules($(".song-qr .qr-image")!.innerHTML)).toBe(expected);
    expect($(".song-qr .qr-image")?.getAttribute("aria-label")).toBe("QR code for this song");
    expect($(".song-qr")?.textContent).toContain("Scan with a phone to play the song there.");
    expect(text()).not.toContain(title(card));
    expect(opened).toEqual([]);
    expect(fake.plays).toEqual([]);
  });

  it("opens the backup when exact clips can't play the card (no link for the provider)", async () => {
    const [first] = drawOrder(deck().cards.map((item) => item.id), SEED).map((id) => Number(id.split("-")[1]));
    const apple = `https://music.apple.com/us/album/x/1?i=${first + 100}`;
    await openPlay(deck({}, { [first]: { links: [{ provider: "appleMusic", url: apple }] } }), "Spotify Premium: exact clips");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect(text()).toContain("This card has no Spotify link.");
    expect($("details.song-backup")).toBeNull();
    expect($("div.song-backup")?.textContent).toContain("Play preview");
  });
  it("keeps the QR and preview collapsed behind a closed disclosure when clips are exact", async () => {
    await openPlay(deck(), "Spotify Premium: exact clips");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect($(".stage .clip-controls button.primary")?.textContent).toBe("Play");
    await waitFor(() => !!$(".song-qr .qr-image svg"));
    const backup = $("details.song-backup") as HTMLDetailsElement;
    expect(backup.open).toBe(false);
    expect(backup.querySelector(".song-qr")).not.toBeNull();
    expect(backup.textContent).toContain("Play preview");
  });

  it("falls back to the first link, or says the card has none", async () => {
    fake.tier = { kind: "noExactPlayback" };
    // The first card drawn has only a non-Spotify link; the second has none.
    const [first, second] = drawOrder(deck().cards.map((item) => item.id), SEED).map((id) => Number(id.split("-")[1]));
    const stored = deck(
      {},
      {
        [first]: { links: [{ provider: "other", url: `https://example.com/music/clip-${first}` }] },
        [second]: { links: [] },
      },
    );
    await openPlay(stored, "Spotify: manual playback (Free or Premium)");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "2" });
    await click(button("Draw card"));
    await click(button("Open song link"));
    expect(opened).toEqual([`https://example.com/music/clip-${first}`]);
    await type("#guess-p1", "1990");
    await act(async () => (($("#guess-p1") as HTMLInputElement).form as HTMLFormElement).requestSubmit());
    await click(button("Reveal"));
    await click(button("Next card"));
    expect(text()).toContain("This card has no song link.");
    expect($$(".stage button.primary")).toHaveLength(0);
    expect(fake.plays).toEqual([]);
  });

  it("offers Play it yourself after a failed connect", async () => {
    fake.connectError = "Spotify's player did not start.";
    const stored = deck();
    const card = drawOrder(stored.cards.map((item) => item.id), SEED)[0];
    await openPlay(stored, "Spotify: manual playback (Free or Premium)");
    expect(text()).toContain("Could not connect. Try again.");
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect($(".song-qr")).not.toBeNull();
    await click(button("Play on Spotify"));
    expect(opened).toEqual([`https://open.spotify.com/track/${trackId(Number(card.split("-")[1]))}`]);
    expect(fake.plays).toEqual([]);
  });
});

describe("Preview-only accounts", () => {
  it("leave out Snippet Ladder steps longer than the preview", async () => {
    fake.tier = { kind: "previewOnly", maxMs: 10000 };
    await openPlay(deck(), "Spotify preview: 10-second clips");
    await click(button("Play Snippet Ladder"));
    expect(text()).toContain("Previews play up to 10 s, so the 20 s and 30 s steps are left out.");
    await type("#option-ladder-rounds", "1");
    await click(button("Start"));
    expect(session().sessionVersion).toBe(2);
    expect(session().options.steps).toEqual([1000, 5000, 10000]);
    await click(button("Draw card"));
    expect($$(".step-bar li").map((item) => item.textContent)).toEqual(["1 s", "5 s", "10 s"]);
  });
});

function hasNoReveal(): boolean {
  return !$$("button").some((item) => item.textContent === "Reveal");
}

describe("Preparing a song", () => {
  it("disables Play with Preparing… until the clip starts, on the stage and on Lineup tiles", async () => {
    await openPlay(deck());
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    let release = () => {};
    fake.gate = new Promise<void>((resolve) => (release = resolve));
    await click($(".stage .clip-controls button.primary")!); // the stage's Play, not the navigation
    expect(button("Preparing…").getAttribute("aria-disabled")).toBe("true");
    await act(async () => release());
    await waitFor(() => $$("button").every((item) => item.textContent !== "Preparing…"));
    expect(button("Replay").disabled).toBe(false);
  });

  it("does the same for a Lineup tile", async () => {
    await openPlay(deck());
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    let release = () => {};
    fake.gate = new Promise<void>((resolve) => (release = resolve));
    await click(button("Play B"));
    expect(button("Preparing…").getAttribute("aria-disabled")).toBe("true");
    expect(button("Play A").disabled).toBe(false);
    await act(async () => release());
    await waitFor(() => $$("button").every((item) => item.textContent !== "Preparing…"));
    expect(button("Stop B")).toBeTruthy();
  });
});

describe("Lineup with clips", () => {
  it("plays each tile on its own and scores the order", async () => {
    const stored = deck({}, { 0: { clip: { startMs: 7000 } } });
    const set = drawOrder(stored.cards.map((item) => item.id), SEED).slice(0, 3);
    await openPlay(stored);
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1", "#option-lineup-clipMs": "4" });
    await click(button("Draw lineup"));
    expect($$(".lineup-tile .tile-name")).toHaveLength(0);
    await click(button("Play B"));
    expect(fake.prepared).toEqual([trackId(Number(set[1].split("-")[1]))]);
    expect($$(".lineup-tile")[1].textContent).toContain("Playing");
    expect(button("Stop B")).toBeTruthy();
    const start = set[1] === "clip-0" ? 7000 : 0;
    expect(actions().at(-1)).toEqual({ type: "clip", fromMs: start, lengthMs: 4000 });
    // Tap the songs in the drawn order: the engine scores it.
    for (const letter of ["A", "B", "C"]) {
      const tile = $$('[aria-label$="songs left to place"] button').find((item) => item.textContent === letter);
      await click(tile!);
    }
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect(resultLines()[0]).toMatch(/^Ada \+\d+.*\(ordered A, B, C\)$/);
    expect($$(".right-order .tl-year").map((item) => item.textContent)).toEqual(
      [...set].sort((a, b) => year(a) - year(b)).map((id) => String(year(id))),
    );
  });
});

describe("Original or Imposter", () => {
  it("plays a linked pair and names the original and the relation", async () => {
    const stored = deck({}, { 4: { relatedTo: { cardId: "clip-1", relation: "coverOf" } } });
    const [pair] = imposterPairs(stored.cards, SEED);
    expect(pair.original).toBe("clip-1");
    const originalSide = pair.a === pair.original ? "A" : "B";
    const otherSide = originalSide === "A" ? "B" : "A";
    await openPlay(stored);
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "1" });
    await click(button("Draw pair"));
    expect(session().actions[0]).toMatchObject({
      type: "drawPair",
      a: { cardId: pair.a },
      b: { cardId: pair.b },
      original: originalSide.toLowerCase(),
    });
    await click(button("Play A"));
    await click(button("Play B"));
    expect(fake.prepared).toEqual([pair.a, pair.b].map((id) => trackId(Number(id.split("-")[1]))));
    expect(actions().filter((action: { type: string }) => action.type === "clip")).toHaveLength(2);
    const pick = (side: string) =>
      click($$('[aria-label="Which is the original?"] button').find((item) => item.textContent === side)!);
    await pick(originalSide);
    await type("#imposter-year-p1", "1979");
    await click(button("Lock in"));
    await pick(otherSide);
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect($(".reveal .era-year")?.textContent).toBe("1979");
    expect(text()).toContain(`${originalSide} is the original: Tune 1 by Band 1 (1979).`);
    expect(text()).toContain(`${otherSide} is a cover of it: Tune 4 by Band 4 (1997).`);
    expect(resultLines()).toEqual([
      `Ada +8, picked ${originalSide} (the original), guessed 1979, year bonus`,
      `Lin +0, picked ${otherSide}`,
    ]);
    expect($$(".standings li")[0].textContent).toContain("1Ada8 points");
    expect($$(".standings li")[0].textContent).toContain("1 year bonuses");
  });
});

// Every card in play offers the song's QR and the hidden preview, with or without a provider.
describe("Song backup in every mode", () => {
  const modules = (svg: string) => svg.match(/stroke="#000000" d="([^"]+)"/)?.[1];
  const url = (id: string) => `https://open.spotify.com/track/${trackId(Number(id.split("-")[1]))}`;
  const backupDeck = () => deck({}, { 4: { relatedTo: { cardId: "clip-1", relation: "coverOf" } } });
  async function toPlayHome(stored: object) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    await render();
    await act(async () => {
      await import("./Play");
    });
    await click(button("Play"));
  }
  async function reload() {
    await act(async () => root.unmount());
    container.remove();
    await render();
    await click(button("Play"));
    await click(button("Resume"));
  }
  async function expectBackup(expectedUrl?: string) {
    await waitFor(() => !!$(".song-backup .qr-image svg"));
    expect($(".song-backup .qr-image")?.getAttribute("aria-label")).toBe("QR code for this song");
    expect(button("Play preview")).toBeTruthy();
    if (expectedUrl) expect(modules($(".song-backup .qr-image")!.innerHTML)).toBe(modules(await renderQR(expectedUrl)));
  }

  it.each([
    ["Bullseye", "Draw card", { "#option-bullseye-rounds": "1" }],
    ["Era Sort", "Draw card", { "#option-eraSort-rounds": "1" }],
    ["Higher or Lower", "Draw card", {}],
    ["Timeline", "Draw card", { "#option-timeline-target": "3" }],
    ["Relay", "Draw card", { "#option-relay-target": "2", "#option-relay-lives": "1" }],
  ])("%s shows the QR and preview without a connected provider", async (mode, draw, options) => {
    await toPlayHome(backupDeck());
    await setUp(mode, ["Ada", "Lin"], options);
    await click(button(draw));
    await expectBackup();
    expect($("details.song-backup")).toBeNull();
  });

  it("Daily shows the QR and preview without a connected provider", async () => {
    await toPlayHome(backupDeck());
    await click(button("Play today's round"));
    await click(button("Draw card"));
    await expectBackup();
  });

  it("Snippet Ladder: starts, marks steps by hand and scores when the preview is unavailable", async () => {
    preview.state = "unavailable";
    await toPlayHome(backupDeck());
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await expectBackup();
    expect($("details.song-backup")).toBeNull();
    expect(text()).toContain("No hidden preview is available for this song.");
    expect(text()).toContain("Without exact clips, play each step by hand with the preview or QR, then mark it played.");
    expect(hasButtonNamed("Replay 1 s")).toBe(false);
    // Space never marks a step by hand.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(actions().at(-1)).toMatchObject({ type: "draw" });
    await click(button("Mark 1 s played"));
    expect(actions().at(-1)).toEqual({ type: "step", index: 0 });
    expect($(".step-bar li.current")?.textContent).toContain("1 s");
    expect(fake.plays).toEqual([]);
    await click(button("Lock in Ada"));
    expect(button("Next: mark 5 s played")).toBeTruthy();
    await click(button("Show answer"));
    expect(hasButtonNamed("Score card")).toBe(true);
  });

  it("Snippet Ladder without exact clips plays each step from the hidden preview and records it once audible", async () => {
    await toPlayHome(backupDeck());
    await click($('[data-mode="ladder"] button')!);
    expect(text()).not.toContain("Previews play up to");
    await click(button("Back"));
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    expect(session().options.steps).toEqual([1000, 5000, 10000, 20000, 30000]);
    await click(button("Draw card"));
    const backup = $("details.song-backup") as HTMLDetailsElement;
    expect(backup.open).toBe(false);
    expect(text()).toContain("Snippets play from the song's preview and stop by themselves.");
    expect(text()).toContain("Preview ready");
    expect($('.embed-frame.concealed[aria-hidden="true"]')).not.toBeNull();
    expect(hasButtonNamed("Mark 1 s played")).toBe(false);
    const audible = () => act(async () => preview.audible.at(-1)!());
    // The step is recorded only once the snippet is audible.
    await click(button("Play 1 s"));
    expect(preview.snippets).toEqual([[0, 1000]]);
    expect(actions().at(-1)).toMatchObject({ type: "draw" });
    expect(button("Play 1 s").disabled).toBe(true);
    expect(text()).toContain("Starting preview…");
    await click(button("Play 1 s"));
    await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    expect(preview.snippets).toHaveLength(1);
    await audible();
    expect(actions().at(-1)).toEqual({ type: "step", index: 0 });
    expect(fake.plays).toEqual([]);
    await click(button("Replay 1 s"));
    expect(preview.snippets.at(-1)).toEqual([0, 1000]);
    await audible();
    await click(button("More time: 5 s"));
    expect(preview.snippets.at(-1)).toEqual([0, 5000]);
    await audible();
    expect($(".step-bar li.current")?.textContent).toContain("5 s");
    // Space plays the next step.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(preview.snippets.at(-1)).toEqual([0, 10000]);
    await audible();
    expect(actions().at(-1)).toEqual({ type: "step", index: 2 });
    await click(button("Lock in Ada"));
    await click(button("More time: 20 s"));
    await audible();
    await click(button("More time: 30 s"));
    await audible();
    expect(hasButtonNamed("More time: 60 s")).toBe(false);
    expect(hasButtonNamed("Show answer")).toBe(true);
    const disposals = preview.disposals;
    await click(button("Show answer"));
    expect(preview.disposals).toBeGreaterThan(disposals);
    expect(text()).toContain("Playback stopped. Score the card to continue.");
    expect(hasButtonNamed("Replay 30 s")).toBe(false);
  });

  it("Snippet Ladder's first-to-name sudden death plays a 5 s preview snippet without exact clips", async () => {
    await toPlayHome(backupDeck());
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await act(async () => preview.audible.at(-1)!());
    await click(button("Lock in Ada"));
    await click(button("Lock in Lin"));
    await click(button("Show answer"));
    await click(button("Score card"));
    await click(button("Next card"));
    await click(button("Play 5 s"));
    expect(preview.snippets.at(-1)).toEqual([0, 5000]);
    await act(async () => preview.audible.at(-1)!());
    expect(actions().at(-1)).toMatchObject({ type: "clip", fromMs: 0, lengthMs: 5000 });
    expect(button("Replay 5 s")).toBeTruthy();
    await click(button("Lin named it first"));
    expect(text()).toContain("Lin named it first. Reveal when ready.");
  });

  it("Snippet Ladder cancels a starting snippet without recording a step, then can replay", async () => {
    await toPlayHome(backupDeck());
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    const cancelled = preview.audible.at(-1)!;
    await click(button("Stop snippet"));
    expect(preview.pauses).toBe(1);
    expect(text()).toContain("Snippet stopped");
    expect(button("Play 1 s").disabled).toBe(false);
    await act(async () => cancelled());
    expect(actions().at(-1)).toMatchObject({ type: "draw" });
    await click(button("Play 1 s"));
    await act(async () => preview.audible.at(-1)!());
    expect(actions().at(-1)).toEqual({ type: "step", index: 0 });
    await click(button("Stop snippet"));
    expect(actions().filter((action: { type: string }) => action.type === "step")).toHaveLength(1);
    expect(button("Replay 1 s").disabled).toBe(false);
  });

  it("Snippet Ladder hides Undo while a snippet starts, and offers it again once stopped", async () => {
    await toPlayHome(backupDeck());
    await setUp("Snippet Ladder", ["Ada", "Lin"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await act(async () => preview.audible.at(-1)!());
    await click(button("Stop snippet"));
    await click(button("Lock in Ada"));
    expect(hasButtonNamed("Undo Ada's entry")).toBe(true);
    await click(button("More time: 5 s"));
    expect(hasButtonNamed("Undo Ada's entry")).toBe(false);
    await click(button("Stop snippet"));
    expect(actions().at(-1)).toMatchObject({ type: "lock" });
    expect(hasButtonNamed("Undo Ada's entry")).toBe(true);
  });

  it("Snippet Ladder explains a failed preview alongside manual fallback", async () => {
    preview.state = "error";
    await toPlayHome(backupDeck());
    await setUp("Snippet Ladder", ["Ada"], { "#option-ladder-rounds": "1" });
    await click(button("Draw card"));
    expect(text()).toContain("The preview could not play.");
    expect(button("Mark 1 s played").disabled).toBe(false);
    await expectBackup();
  });

  it("Original or Imposter is played by hand from the backup when neither side has a preview", async () => {
    preview.state = "unavailable";
    await toPlayHome(backupDeck());
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "1" });
    await click(button("Draw pair"));
    await expectBackup();
    expect($("details.song-backup")).toBeNull();
    // No Play A/B that would open the song page.
    expect(hasButtonNamed("Play A")).toBe(false);
    expect($$(".lineup-tile").map((item) => item.textContent)).toEqual([
      "APlay it by hand with the preview or QR below.",
      "BPlay it by hand with the preview or QR below.",
    ]);
  });

  it("Original or Imposter without exact clips plays A and B as 10 s preview snippets", async () => {
    const stored = backupDeck();
    const [pair] = imposterPairs(stored.cards, SEED);
    await toPlayHome(stored);
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "1" });
    await click(button("Draw pair"));
    expect(preview.sessions).toHaveLength(1);
    expect(($("details.song-backup") as HTMLDetailsElement).open).toBe(false);
    expect(text()).toContain("A: Preview ready");
    await click(button("Play A"));
    expect(preview.snippets).toEqual([[0, 10000]]);
    expect($$(".lineup-tile")[0].textContent).toContain("Starting…");
    await act(async () => preview.audible.at(-1)!());
    expect($$(".lineup-tile")[0].textContent).toContain("Playing");
    expect(actions().filter((action: { type: string }) => action.type === "clip")).toHaveLength(0);
    // The snippet ends by itself: B preloads.
    await act(async () => preview.sessions[0]("paused"));
    expect(preview.sessions).toHaveLength(2);
    expect(text()).toContain("B: Preview ready");
    await click(button("Play B"));
    expect(preview.snippets).toEqual([[0, 10000], [0, 10000]]);
    await act(async () => preview.audible.at(-1)!());
    expect(text()).not.toMatch(/Tune \d|Band \d/);
    await click(button("Stop B"));
    expect(preview.pauses).toBe(1);
    const pick = (side: string) =>
      click($$('[aria-label="Which is the original?"] button').find((item) => item.textContent === side)!);
    await pick("A");
    await click(button("Lock in"));
    await pick("B");
    await click(button("Lock in"));
    const disposals = preview.disposals;
    await click(button("Reveal"));
    expect(preview.disposals).toBeGreaterThan(disposals);
    expect(text()).toContain(`is the original: Tune 1 by Band 1 (1979).`);
    expect(pair.original).toBe("clip-1");
  });

  it("Lineup without exact clips plays each tile as a snippet, keeping one preview loaded", async () => {
    const stored = backupDeck();
    const set = drawOrder(stored.cards.map((item) => item.id), SEED).slice(0, 3);
    await toPlayHome(stored);
    await setUp("Lineup", ["Ada"], {
      "#option-lineup-k": "3",
      "#option-lineup-rounds": "1",
      "#option-lineup-clipMs": "45",
    });
    await click(button("Draw lineup"));
    // Titles stay hidden until the reveal; the backup is collapsed.
    expect($$(".lineup-tile .tile-name")).toHaveLength(0);
    expect($$(".order-name")).toHaveLength(0);
    expect(text()).not.toMatch(/Tune \d|Band \d/);
    expect(text()).not.toContain("Lineup by name:");
    expect(($("details.song-backup") as HTMLDetailsElement).open).toBe(false);
    expect($('.embed-frame.concealed[aria-hidden="true"]')).not.toBeNull();
    // Tile A's preview loads with the draw, without playing.
    expect(preview.sessions).toHaveLength(1);
    expect(preview.snippets).toEqual([]);
    expect(text()).toContain("A: Preview ready");
    await click(button("Play A"));
    // Snippets are capped at 30 s, the length of a provider preview.
    expect(preview.snippets).toEqual([[0, 30000]]);
    expect(button("Stop A")).toBeTruthy();
    await act(async () => preview.audible.at(-1)!());
    expect($$(".lineup-tile")[0].className).toBe("lineup-tile playing");
    expect($$(".lineup-tile")[0].textContent).toContain("Playing");
    await click(button("Stop A"));
    expect(preview.pauses).toBe(1);
    // Stopped by hand: A stays loaded and replays at once.
    expect(preview.sessions).toHaveLength(1);
    await click(button("Play A"));
    expect(preview.snippets).toHaveLength(2);
    await act(async () => preview.audible.at(-1)!());
    await act(async () => preview.sessions[0]("paused"));
    // Finished: the next unplayed tile (B) preloads, disposing A's.
    expect(preview.sessions).toHaveLength(2);
    expect(preview.disposals).toBe(1);
    // Switching to C while B is loaded: "Loading C…" until C's preview is ready.
    preview.state = "loading";
    await click(button("Play C"));
    expect(preview.sessions).toHaveLength(3);
    expect(preview.disposals).toBe(2);
    expect(button("Loading C…").getAttribute("aria-disabled")).toBe("true");
    await act(async () => preview.sessions[2]("ready"));
    expect(preview.snippets).toHaveLength(3);
    // The provider refused the late start: back to a ready Play C, not stuck.
    await act(async () => preview.sessions[2]("ready"));
    expect(button("Play C").disabled).toBe(false);
    await click(button("Play C"));
    expect(preview.snippets).toHaveLength(4);
    await act(async () => preview.audible.at(-1)!());
    expect($$(".lineup-tile")[2].textContent).toContain("Playing");
    expect(text()).not.toMatch(/Tune \d|Band \d/);
    for (const letter of ["A", "B", "C"])
      await click($$('[aria-label$="songs left to place"] button').find((item) => item.textContent === letter)!);
    await click(button("Lock in"));
    const disposals = preview.disposals;
    await click(button("Reveal"));
    expect(preview.disposals).toBe(disposals + 1);
    expect($('.embed-frame.concealed')).toBeNull();
    expect($$(".right-order .tl-year").map((item) => item.textContent)).toEqual(
      [...set].sort((a, b) => year(a) - year(b)).map((id) => String(year(id))),
    );
  });

  it("Lineup shows the title of a tile whose preview fails, and the others still play", async () => {
    const stored = backupDeck();
    const set = drawOrder(stored.cards.map((item) => item.id), SEED).slice(0, 3);
    preview.queue = ["error"];
    await toPlayHome(stored);
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    const tiles = $$(".lineup-tile");
    expect(tiles[0].querySelector(".tile-name strong")?.textContent).toBe(title(set[0]));
    expect(tiles[1].querySelector(".tile-name")).toBeNull();
    expect(tiles[2].querySelector(".tile-name")).toBeNull();
    // B's preview loaded in A's place.
    expect(preview.sessions).toHaveLength(2);
    expect(text()).toContain("B: Preview ready");
    await click(button("Play B"));
    expect(preview.snippets).toEqual([[0, 10000]]);
  });

  it("Lineup is by name when no tile can play a snippet", async () => {
    preview.state = "unavailable";
    const stored = backupDeck();
    const set = drawOrder(stored.cards.map((item) => item.id), SEED).slice(0, 3);
    await toPlayHome(stored);
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    expect($$(".lineup-tile .tile-name strong").map((item) => item.textContent)).toEqual(set.map(title));
    expect(text()).toContain("Lineup by name: read the titles out, then order them by year.");
    expect(hasButtonNamed("Play A")).toBe(false);
    await expectBackup();
    expect($("details.song-backup")).toBeNull();
  });

  it("keeps the backup in a closed disclosure when clips are exact (Ladder, Lineup, Imposter)", async () => {
    const stored = backupDeck();
    await openPlay(stored);
    for (const [mode, draw, options] of [
      ["Snippet Ladder", "Draw card", { "#option-ladder-rounds": "1" }],
      ["Lineup", "Draw lineup", { "#option-lineup-k": "3", "#option-lineup-rounds": "1" }],
      ["Original or Imposter", "Draw pair", { "#option-imposter-rounds": "1" }],
    ] as const) {
      await setUp(mode, ["Ada", "Lin"], options);
      await click(button(draw));
      const backup = $("details.song-backup") as HTMLDetailsElement;
      expect(backup.open).toBe(false);
      expect(backup.querySelector(".song-qr")).not.toBeNull();
      await click(button("End game"));
      await click(button("New game"));
    }
  });

  it("Lineup's selector switches the QR to the selected card", async () => {
    const stored = backupDeck();
    const set = drawOrder(stored.cards.map((item) => item.id), SEED).slice(0, 3);
    await toPlayHome(stored);
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "1" });
    await click(button("Draw lineup"));
    const picker = () => $$('[role=group][aria-label="Backup for song"] button');
    expect(picker().map((item) => item.textContent)).toEqual(["A", "B", "C"]);
    expect(picker()[0].getAttribute("aria-pressed")).toBe("true");
    await expectBackup(url(set[0]));
    await click(picker()[2]);
    expect(picker()[2].getAttribute("aria-pressed")).toBe("true");
    await expectBackup(url(set[2]));
  });

  it("Imposter's selector switches the QR between the two versions", async () => {
    const stored = backupDeck();
    const [pair] = imposterPairs(stored.cards, SEED);
    await openPlay(stored);
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "1" });
    await click(button("Draw pair"));
    fake.tier = { kind: "noExactPlayback" };
    await reload();
    const picker = () => $$('[role=group][aria-label="Backup for song"] button');
    expect(picker().map((item) => item.textContent)).toEqual(["A", "B"]);
    await expectBackup(url(pair.a));
    await click(picker()[1]);
    await expectBackup(url(pair.b));
  });

  it("connects Play it yourself for a game started without Use playback", async () => {
    await toPlayHome(backupDeck());
    await setUp("Bullseye", ["Ada"], { "#option-bullseye-rounds": "1" });
    await click(button("Draw card"));
    expect(hasButtonNamed("Open song link") || hasButtonNamed("Play on Spotify")).toBe(true);
    await click(button("End game"));
    await click(button("New game"));
    expect($(".tier")?.textContent).toBe("Play it yourself: you start each song yourself");
  });
});
function hasButtonNamed(name: string): boolean {
  return $$("button").some((item) => item.textContent === name);
}

describe("Setup copy and reveal wording", () => {
  it("words Snippet Ladder's Stakes rule, Buzzer and Clip start, hiding Clip start without exact clips", async () => {
    await openPlay(deck());
    await click(button("Play Snippet Ladder"));
    expect($("label[for=option-ladder-buzzer]")?.textContent).toBe("Buzzer: +2 for the first lock-in that scores");
    expect($("label[for=option-ladder-clipStart]")?.textContent).toBe("Clip start for cards without their own");
    await type("#option-ladder-rounds", "1");
    await click($("#option-ladder-stakes")!);
    await click(button("Start"));
    await click(button("Draw card"));
    await click(button("Play 1 s"));
    await click(button("Lock in Player 1"));
    expect($(".wager-rule")?.textContent).toBe(
      "Win the wager if you lock in and score on this card; not locking in loses it.",
    );
  });

  it("hides Clip start when the connected tier has no exact clips", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck()));
    await render();
    await act(async () => {
      await import("./Play");
    });
    await click(button("Play"));
    await click(button("Play Snippet Ladder"));
    expect($("#option-ladder-clipStart")).toBeNull();
  });

  it("calls Original or Imposter rounds one pair each and advances by pair", async () => {
    const stored = deck(
      {},
      { 4: { relatedTo: { cardId: "clip-1", relation: "coverOf" } }, 5: { relatedTo: { cardId: "clip-2", relation: "coverOf" } } },
    );
    await openPlay(stored);
    await click(button("Play Original or Imposter"));
    expect($("label[for=option-imposter-rounds]")?.textContent).toBe("Rounds (one pair each) (1–50)");
    await click(button("Back"));
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "2" });
    await click(button("Draw pair"));
    const pick = (side: string) =>
      click($$('[aria-label="Which is the original?"] button').find((item) => item.textContent === side)!);
    await pick("A");
    await click(button("Lock in"));
    await pick("A");
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect(button("Next pair")).toBeTruthy();
  });

  it("doesn't draw a card shared by several pairs in consecutive rounds while another pair is left", async () => {
    // clip-1 is the original of two covers (a hub); clip-2 and clip-3 are an unrelated pair.
    const stored = deck(
      {},
      {
        4: { relatedTo: { cardId: "clip-1", relation: "coverOf" } },
        5: { relatedTo: { cardId: "clip-1", relation: "coverOf" } },
        3: { relatedTo: { cardId: "clip-2", relation: "coverOf" } },
      },
    );
    const pairs = imposterPairs(stored.cards, SEED);
    expect(pairs).toHaveLength(3);
    await openPlay(stored);
    await setUp("Original or Imposter", ["Ada", "Lin"], { "#option-imposter-rounds": "2" });
    await click(button("Draw pair"));
    const pick = (side: string) =>
      click($$('[aria-label="Which is the original?"] button').find((item) => item.textContent === side)!);
    await pick("A");
    await click(button("Lock in"));
    await pick("A");
    await click(button("Lock in"));
    await click(button("Reveal"));
    await click(button("Next pair"));
    const drawn = session().actions.filter((action: { type: string }) => action.type === "drawPair");
    expect(drawn).toHaveLength(2);
    const ids = (action: { a: { cardId: string }; b: { cardId: string } }) => [action.a.cardId, action.b.cardId];
    expect(ids(drawn[1]).filter((id) => ids(drawn[0]).includes(id))).toEqual([]);
  });

  it("advances Lineup by lineup", async () => {
    await openPlay(deck());
    await setUp("Lineup", ["Ada"], { "#option-lineup-k": "3", "#option-lineup-rounds": "2" });
    await click(button("Draw lineup"));
    for (const letter of ["A", "B", "C"]) {
      const tile = $$('[aria-label$="songs left to place"] button').find((item) => item.textContent === letter);
      await click(tile!);
    }
    await click(button("Lock in"));
    await click(button("Reveal"));
    expect(button("Next lineup")).toBeTruthy();
  });
});

describe("Relay's Name It", () => {
  // The slot label for placing a year into a line of years, right or wrong.
  function slotFor(years: number[], target: number, right: boolean): string {
    const sorted = [...years].sort((a, b) => a - b);
    const index = sorted.filter((value) => value <= target).length;
    const slot = right ? index : index === 0 ? 1 : index - 1;
    if (slot === 0) return `Before ${sorted[0]}`;
    if (slot === sorted.length) return `After ${sorted[sorted.length - 1]}`;
    return `Between ${sorted[slot - 1]} and ${sorted[slot]}`;
  }

  it("says a life came back before the placement, or that lives were already full", async () => {
    const stored = deck();
    const anchor = pickAnchors(
      stored.cards.map((card) => ({ id: card.id, year: year(card.id) })),
      "random",
      SEED,
      1,
    )[0];
    const draws = drawOrder(stored.cards.map((card) => card.id), SEED).filter((id) => id !== anchor);
    const place = async (line: number[], id: string, right: boolean) => {
      const label = slotFor(line, year(id), right);
      await click(button(label));
      await click(button(`Place: ${label}`));
    };
    const nameBoth = async () => {
      for (const name of ["Title right", "Artist right"])
        await click($$("label").find((item) => item.textContent?.trim() === name)!.querySelector("input")!);
      await click(button("Record Name It"));
    };
    await openPlay(stored);
    await click(button("Play Relay"));
    expect($("label[for=option-relay-nameIt]")?.textContent).toBe(
      "Name It: title and artist right gives back a life (up to the start)",
    );
    await type("#player-0", "Ada");
    await type("#player-1", "Lin");
    await type("#option-relay-target", "4");
    await click($("#option-relay-nameIt")!);
    await click(button("Start"));
    await click(button("Draw card"));
    await place([year(anchor)], draws[0], false);
    await click(button("Reveal"));
    expect(text()).toContain("Lives 2 of 3");
    await click(button("Next card"));
    await place([year(anchor)], draws[1], true);
    await nameBoth();
    await click(button("Reveal"));
    expect(resultLines()).toEqual(["Lin Named it: a life back before the placement."]);
    expect(text()).toContain("Lives 3 of 3");
    await click(button("Next card"));
    await place([year(anchor), year(draws[1])], draws[2], true);
    await nameBoth();
    await click(button("Reveal"));
    expect(resultLines()).toEqual(["Ada Named it, but lives were already full."]);
  });
});
