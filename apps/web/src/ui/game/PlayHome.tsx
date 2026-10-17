import { useMemo, useState } from "react";
import type { Deck } from "../../core/deck";
import { replay } from "../../core/game/engine";
import { dailySelection } from "../../core/random";
import { previousDay } from "../../core/scoring";
import type { DailyOptions, GameMode } from "../../core/session";
import {
  loadCalibration,
  runCalibration,
  saveCalibration,
  type CalibrationResult,
} from "../../playback/calibration";
import { systemClock } from "../../playback/clock";
import type { PlaybackHub } from "../../playback/hub";
import { exactClips, type PlaybackProvider } from "../../playback/player";
import { loadDaily } from "../../sessions";
import { saveText } from "../download";
import { listNames } from "./history";
import { ShareText } from "./modes/Daily";
import { MODE_INFO, MODE_ORDER, modeAvailability } from "./modes";
import { PROVIDER_NAMES, tierText, trackFor, useHub } from "./playback";
import { summaryOf, utcDate, type GameController, type GameView } from "./useGame";

const PROVIDERS: PlaybackProvider[] = ["spotify", "appleMusic", "manual"];
const playerRange = ([min, max]: [number, number]) =>
  min === max ? `${min} player${min === 1 ? "" : "s"}` : `${min}–${max} players`;

function PlaybackPanel({ hub, deck }: { hub: PlaybackHub; deck: Deck }) {
  const state = useHub(hub);
  const available = hub.availableProviders();
  const [choice, setChoice] = useState<PlaybackProvider>(
    state.provider ?? "manual",
  );
  const [fresh, setFresh] = useState<{ provider: PlaybackProvider; result: CalibrationResult }>();
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationError, setCalibrationError] = useState("");
  const provider = state.provider;
  const exact = Boolean(provider && state.tier && exactClips(state.tier));
  const calibration =
    provider && (fresh?.provider === provider ? fresh.result : loadCalibration(provider));
  async function calibrate() {
    const player = hub.player;
    if (!player || !provider) return;
    const track = deck.cards.map((card) => trackFor(card, provider)).find(Boolean);
    if (!track) {
      setCalibrationError(`No card in this deck has a ${PROVIDER_NAMES[provider]} link to calibrate with.`);
      return;
    }
    setCalibrationError("");
    setCalibrating(true);
    try {
      const result = await runCalibration(player, track, systemClock);
      saveCalibration(provider, result);
      setFresh({ provider, result });
    } catch (failure) {
      setCalibrationError(failure instanceof Error ? failure.message : "Calibration failed.");
    } finally {
      setCalibrating(false);
    }
  }
  return (
    <section className="panel play-panel" aria-labelledby="playback-title">
      <h2 id="playback-title">Playback</h2>
      <fieldset className="field">
        <legend>Play songs with</legend>
        {PROVIDERS.map((item) => {
          const usable = available.includes(item);
          return (
            <label key={item} className="checkbox-label">
              <input
                type="radio"
                name="provider"
                value={item}
                checked={choice === item}
                disabled={state.connecting || !usable}
                onChange={() => setChoice(item)}
              />
              <span>
                {PROVIDER_NAMES[item]}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="action-row">
        <button
          className="primary"
          disabled={state.connecting || !available.includes(choice)}
          onClick={() => void hub.connect(choice)}
        >
          {state.connecting ? "Connecting…" : "Use playback"}
        </button>
        {hub.canAuthorize(choice) && !(provider === choice && exact) ? (
          <button disabled={state.connecting} onClick={() => void hub.connect(choice, true)}>
            Enable timed clips
          </button>
        ) : null}
      </div>
      <p className="muted">
        Song links open in your music app or browser, using the account signed in there.
        Spotify Free works with manual playback. Timed clips need separate permission.
      </p>
      <p className="tier" role="status">
        {provider && state.tier ? tierText(provider, state.tier) : "Not connected yet."}
      </p>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {exact ? (
        <div className="calibration">
          <button disabled={calibrating} onClick={() => void calibrate()}>
            {calibrating ? "Calibrating…" : "Calibrate timing"}
          </button>
          <p className="muted" role="status">
            {calibration
              ? `Last calibration: starts after ${Math.round(calibration.medianLatencyMs)} ms (median), stops within ${Math.round(calibration.maxStopErrorMs)} ms: ${calibration.passed ? "passed" : "not accurate enough for Snippet Ladder"}.`
              : "Not calibrated yet."}
          </p>
          {calibrationError ? (
            <p className="error" role="alert">
              {calibrationError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DailyCard({ deck, onPlay, onResume }: { deck: Deck; onPlay: () => void; onResume?: () => void }) {
  const today = utcDate(Date.now());
  const record = loadDaily();
  const played = record?.lastDate === today && record.deckId === deck.id;
  // Daily can't skip a card (game-rules.md section 6.8), so a card without a link is guessed unheard.
  const unlinked = played
    ? 0
    : dailySelection(
        deck.cards.map((card) => card.id),
        today,
        deck.id,
      ).filter((id) => deck.cards.find((card) => card.id === id)?.links.length === 0).length;
  const streak =
    record && (record.lastDate === today || record.lastDate === previousDay(today)) ? record.streak : 0;
  return (
    <section className="panel play-panel" aria-labelledby="daily-title">
      <h2 id="daily-title">Daily Eratic</h2>
      {played ? (
        <>
          <p>
            Played today: {record.lastScore} points.
          </p>
          {record.shareText ? <ShareText text={record.shareText} /> : null}
        </>
      ) : (
        <>
          {onResume ? (
            <>
              <p>Today's round ({today}) is under way.</p>
              <div className="action-row">
                <button className="primary" onClick={onResume}>
                  Resume today's round
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Today's round ({today}) is ready: up to five cards from this deck.</p>
              <div className="action-row">
                <button className="primary" onClick={onPlay}>
                  Play today's round
                </button>
              </div>
            </>
          )}
        </>
      )}
      {unlinked > 0 ? (
        <p className="muted">
          {unlinked} of today's songs have no song link; you'll guess those without hearing them.
        </p>
      ) : null}
      <p className="muted">
        Streak: {streak} day{streak === 1 ? "" : "s"}
      </p>
    </section>
  );
}

export function PlayHome({
  controller,
  view,
  deck,
  hub,
  notice,
  onDismissNotice,
  onChoose,
  onDaily,
}: {
  controller: GameController;
  view: GameView;
  deck: Deck;
  hub: PlaybackHub;
  notice: string;
  onDismissNotice?: () => void;
  onChoose: (mode: GameMode) => void;
  // Play today's round; asks first when it would replace a saved game.
  onDaily: () => void;
}) {
  const hubState = useHub(hub);
  const exact = Boolean(hubState.tier && exactClips(hubState.tier));
  const saved = view.saved;
  const savedRound = useMemo(() => (saved ? summaryOf(replay(saved)).round : 0), [saved]);
  const today = utcDate(Date.now());
  const record = loadDaily();
  const playedToday = record?.lastDate === today && record.deckId === deck.id;
  // The saved game is today's Daily for this deck: offer Resume rather than a new round.
  const savedDaily =
    saved?.mode === "daily" && saved.deckId === deck.id && (saved.options as DailyOptions).date === today;
  const daily = savedDaily ? () => controller.resume() : onDaily;
  function downloadUnreadable() {
    const raw = controller.readUnreadable();
    if (raw !== null) saveText("eratic-unreadable-session.json", raw);
  }
  return (
    <div className="play-home">
      <div className="deck-heading">
        <h1>Play</h1>
        <p>
          {deck.title} · {deck.cards.length} cards
        </p>
      </div>
      {notice || view.notice || view.unreadable ? (
        <div className="notice" role="alert">
          {notice ? (
            <p>
              {notice}{" "}
              {onDismissNotice ? <button onClick={onDismissNotice}>Dismiss</button> : null}
            </p>
          ) : null}
          {view.notice ? <p>{view.notice}</p> : null}
          {view.unreadable ? (
            <p>
              <button onClick={downloadUnreadable}>Download unreadable saved game</button>{" "}
              <button
                onClick={() => {
                  if (window.confirm("Discard the unreadable saved game? It can't be recovered.")) controller.discardUnreadable();
                }}
              >
                Discard unreadable game
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <section className="resume panel" aria-labelledby="resume-title">
          <h2 id="resume-title">Unfinished game</h2>
          <p>
            {MODE_INFO[saved.mode].name} with {listNames(saved.players.map((player) => player.name))}, round{" "}
            {savedRound + 1} · {saved.deckTitle}
          </p>
          <div className="action-row">
            <button className="primary" onClick={() => controller.resume()}>
              Resume
            </button>
            <button
              onClick={() => {
                if (window.confirm("Discard the unfinished game? It can't be recovered.")) controller.discardSaved();
              }}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}
      {view.waiting ? (
        <section className="resume panel" aria-labelledby="results-waiting-title">
          <h2 id="results-waiting-title">Results waiting</h2>
          <p>
            {MODE_INFO[view.waiting.mode].name} with {listNames(view.waiting.players.map((player) => player.name))}, game
            over
          </p>
          <div className="action-row">
            <button className="primary" onClick={() => controller.showResults()}>
              Show results
            </button>
            <button onClick={() => controller.dismissResults()}>Dismiss</button>
          </div>
        </section>
      ) : null}
      <div className="play-grid">
        <PlaybackPanel hub={hub} deck={deck} />
        <DailyCard deck={deck} onPlay={onDaily} onResume={savedDaily ? daily : undefined} />
      </div>
      <section aria-labelledby="modes-title">
        <h2 id="modes-title" className="section-title">
          Games
        </h2>
        <ul className="mode-gallery">
          {MODE_ORDER.map((mode) => {
            const info = MODE_INFO[mode];
            const { reason, label } = modeAvailability(mode, deck, exact);
            const name = label ?? info.name;
            const dailyDone = mode === "daily" && playedToday;
            return (
              <li key={mode} className="mode-tile panel" data-mode={mode}>
                <h3>{name}</h3>
                <p>{info.pitch}</p>
                <p className="muted">{playerRange(info.players)}</p>
                {reason ? <p className="tile-reason">{reason}</p> : null}
                {dailyDone ? (
                  <p className="tile-reason">Played today; the result is above</p>
                ) : reason ? null : (
                  <button className="primary" onClick={() => (mode === "daily" ? daily() : onChoose(mode))}>
                    {mode === "daily" && savedDaily ? "Resume today's round" : `Play ${name}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
