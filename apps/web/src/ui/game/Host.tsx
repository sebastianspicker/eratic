import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Deck } from "../../core/deck";
import { canReveal, currentCards, pendingInputs, type GameState } from "../../core/game/engine";
import { exportSession, type DailyOptions, type RelayOptions, type Session, type TimelineOptions } from "../../core/session";
import type { PlaybackHub } from "../../playback/hub";
import { exactClips } from "../../playback/player";
import { saveText } from "../download";
import { lastReveal, listNames, playerName } from "./history";
import { YearEntry } from "./modes/Bullseye";
import { LineupTiles, lineupByName, OrderEntry } from "./modes/Lineup";
import { LockedEntry, send } from "./modes/LockedEntry";
import { MODE_UI } from "./modes/registry";
import type { ModeInputProps } from "./modes/types";
import { MODE_INFO } from "./modes";
import { openLink, PROVIDER_NAMES, usePlayback, type PlaybackProps } from "./playback";
import { Results } from "./Results";
import { Reveal } from "./Reveal";
import { CardStage } from "./Stage";
import type { GameController, GameView, ScanOutcome, Summary } from "./useGame";

// The scanner (and jsQR with it) loads only when the host opens the camera.
const ScannerView = lazy(() => import("../ScannerView").then((module) => ({ default: module.ScannerView })));

// Ladder's sudden death plays one 5 s clip (game-rules.md section 6.4).
const FIRST_TO_NAME_MS = 5000;

function roundText(session: Session, state: GameState, summary: Summary): string {
  if (state.phase === "finished") return "Final results";
  if (state.phase === "suddenDeath" || state.phase === "suddenDeathOpen") return "Sudden death";
  const options = state.options as unknown as Record<string, number>;
  const of = (total: number) => `${Math.min(summary.round + 1, total)} of ${total}`;
  switch (session.mode) {
    case "daily":
      return `Round ${of((state.options as DailyOptions).cards.length)}`;
    case "higherLower":
      return state.players.length === 1 ? `Card ${summary.round + 1}` : `Card ${of(options.cards)}`;
    case "timeline":
    case "relay":
      return `First to ${options.target} cards`;
    case "lineup":
      return `Lineup ${of(options.rounds)}`;
    default:
      return `Round ${of(options.rounds)}`;
  }
}

function Scoreboard({ session, state, summary }: { session: Session; state: GameState; summary: Summary }) {
  if (session.mode === "relay") {
    const options = state.options as RelayOptions;
    return (
      <ul className="scoreboard" aria-label="Team">
        <li className="team">
          <span className="score-name">Team</span>
          <span className="score-value">{summary.teamScore ?? 0}</span>
          <span className="score-extra">
            Lives {summary.lives} of {options.lives}
          </span>
          <span className="score-extra">
            Line {summary.timeline?.length ?? 0} of {options.target}
          </span>
        </li>
        {session.players.map((player) => (
          <li key={player.id} className={summary.active === player.id ? "active" : ""}>
            <span className="score-name">{player.name}</span>
            {summary.active === player.id ? <span className="turn">Voice: {player.name}</span> : null}
          </li>
        ))}
      </ul>
    );
  }
  const tokens = session.mode === "timeline" && (state.options as TimelineOptions).challenges;
  return (
    <ul className="scoreboard" aria-label="Scores">
      {session.players.map((player) => {
        const active = summary.active === player.id;
        return (
          <li key={player.id} className={active ? "active" : ""}>
            <span className="score-name">{player.name}</span>
            <span className="score-value">{summary.scores[player.id] ?? 0}</span>
            {summary.chips ? <span className="score-extra">incl. {summary.chips[player.id]} chips</span> : null}
            {tokens && summary.tokens ? <span className="score-extra">Tokens {summary.tokens[player.id]}</span> : null}
            {summary.streaks && session.mode === "higherLower" ? (
              <span className="score-extra">Streak</span>
            ) : null}
            {summary.eliminated?.includes(player.id) ? <span className="score-extra">Out</span> : null}
            {active ? <span className="turn">{player.name}'s turn</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// Sudden death's stage: one card (a 5 s clip for "first to name"), or the lineup tiles.
function SuddenDeathStage(props: ModeInputProps) {
  const { state, deck, session, playback, controller } = props;
  const sd = state.sd!;
  if (sd.kind === "lineup")
    return (
      <LineupTiles
        cards={sd.cards}
        deck={deck}
        session={session}
        playback={playback}
        controller={controller}
      />
    );
  const card = deck.cards.find((item) => item.id === sd.cards[0]?.cardId);
  return (
    <CardStage
      card={card}
      deck={deck}
      session={session}
      playback={playback}
      controller={controller}
      lengthMs={sd.kind === "firstToName" ? FIRST_TO_NAME_MS : undefined}
    />
  );
}

function SuddenDeathInput({ controller, state, session, deck, playback }: ModeInputProps) {
  const sd = state.sd!;
  const players = session.players.filter((player) => sd.players.includes(player.id));
  if (sd.kind === "firstToName") {
    if (sd.named)
      return (
        <p role="status">
          {sd.namedPlayer === undefined
            ? "Nobody named it."
            : `${playerName(session, sd.namedPlayer)} named it first.`}{" "}
          Reveal when ready.
        </p>
      );
    return (
      <div className="first-to-name">
        <h3>Who named it first?</h3>
        <div className="action-row">
          {players.map((player) => (
            <button
              key={player.id}
              className="primary"
              onClick={() => send(controller, { type: "sdName", playerId: player.id })}
            >
              {player.name} named it first
            </button>
          ))}
          <button onClick={() => send(controller, { type: "sdName" })}>Nobody named it</button>
        </div>
      </div>
    );
  }
  if (sd.kind === "lineup")
    return (
      <LockedEntry players={players} pending={pendingInputs(state)}>
        {(player) => (
          <OrderEntry
            heading={`${player.name}'s order`}
            cards={sd.cards}
            deck={deck}
            byName={lineupByName(playback)}
            onLock={(order) => send(controller, { type: "sdOrder", playerId: player.id, order })}
          />
        )}
      </LockedEntry>
    );
  return (
    <LockedEntry players={players} pending={pendingInputs(state)}>
      {(player) => (
        <YearEntry
          id={`sd-${player.id}`}
          heading={`${player.name}'s year`}
          onLock={(year) => send(controller, { type: "sdGuess", playerId: player.id, year })}
        />
      )}
    </LockedEntry>
  );
}

export function Host({
  controller,
  view,
  deck,
  hub,
  hasCamera,
}: {
  controller: GameController;
  view: GameView;
  deck: Deck;
  hub: PlaybackHub;
  hasCamera: boolean;
}) {
  const session = view.session!;
  const state = view.state!;
  const summary = view.summary!;
  const ui = MODE_UI[session.mode];
  const { hubState, clip, clipState } = usePlayback(hub);
  const playback: PlaybackProps = { hub, hubState, clip, clipState };
  const [dismissedAt, setDismissedAt] = useState(-1);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<Extract<ScanOutcome, { kind: "message" }>>();
  const reveal = useMemo(() => lastReveal(session, summary), [session, summary]);
  const showReveal = reveal !== undefined && dismissedAt !== session.actions.length;
  const finished = state.phase === "finished";
  const cards = currentCards(state);
  const canScan =
    hasCamera && !["daily", "higherLower", "lineup", "imposter"].includes(session.mode);
  const suddenDeathNames = summary.suddenDeath
    ? listNames(summary.suddenDeath.players.map((id) => playerName(session, id)))
    : "";
  const outOfCards = !controller.canDraw(deck);
  // Sudden deaths that draw several cards at once (a lineup of four) draw from the deck.
  const drawCount = state.phase === "suddenDeath" ? controller.suddenDeathCount() : 1;
  const scanHere = canScan && drawCount <= 1;
  const hostRef = useRef<HTMLElement>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  // Focus follows the game: after each input, reveal or draw it moves to the new
  // panel's heading or primary control. Clips and ladder steps leave it alone.
  const focusKey = `${session.actions.filter((action) => action.type !== "clip" && action.type !== "step").length}:${showReveal}`;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const target =
      host.querySelector<HTMLElement>(".reveal h2") ??
      host.querySelector<HTMLElement>(".results h2") ??
      host.querySelector<HTMLElement>(".inputs h3") ??
      host.querySelector<HTMLElement>(".inputs button:not(:disabled)") ??
      host.querySelector<HTMLElement>(".stage-empty button.primary");
    if (!target) return;
    if (target.tagName.startsWith("H") && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus();
  }, [focusKey]);
  useEffect(() => {
    if (scanning) scannerRef.current?.focus();
  }, [scanning]);

  function stopClip() {
    void clip.cancel(hub.player);
  }
  function endGame() {
    if (!window.confirm("End this game now? The standings so far become final.")) return;
    stopClip();
    controller.dispatch({ type: "end" });
  }
  function next() {
    setScanMessage(undefined);
    setDismissedAt(session.actions.length);
    if (view.source === "draw" || !scanHere) controller.draw(deck);
  }
  function draw() {
    setScanMessage(undefined);
    controller.draw(deck);
  }
  function onScan(payload: string) {
    const outcome = controller.scan(payload, deck);
    if (outcome.kind === "drawn") {
      setScanning(false);
      setScanMessage(undefined);
    } else setScanMessage(outcome);
  }
  async function playAudioOnly(audio: NonNullable<Extract<ScanOutcome, { kind: "message" }>["audio"]>) {
    const player = hub.player;
    // Without exact clips the link opens in a new tab; the provider's player is never asked.
    if (!player || !hubState.tier || !exactClips(hubState.tier)) {
      try {
        await openLink({ provider: "manual", id: audio.trackId, url: audio.url });
      } catch (failure) {
        setScanMessage({
          kind: "message",
          text: failure instanceof Error ? failure.message : "Could not open the song.",
        });
      }
      return;
    }
    if (player.provider !== audio.provider) {
      setScanMessage({
        kind: "message",
        text: `This link is for ${PROVIDER_NAMES[audio.provider]}. Connect it, or choose Play it yourself on Play home.`,
      });
      return;
    }
    try {
      await player.prepare({ provider: player.provider, id: audio.trackId, url: audio.url });
      await clip.start(player, 0, 30_000);
    } catch (failure) {
      setScanMessage({
        kind: "message",
        text: failure instanceof Error ? failure.message : "Could not play the song.",
      });
    }
  }
  function revealCard() {
    stopClip();
    controller.dispatch({ type: "reveal" });
  }
  function skip() {
    stopClip();
    controller.dispatch({ type: "skip" });
  }

  const card = cards[0] && deck.cards.find((item) => item.id === cards[0].cardId);
  const inputProps: ModeInputProps = { controller, session, state, summary, deck, playback, reveal: revealCard };
  const suddenDeath = state.phase === "suddenDeathOpen";
  const Stage = suddenDeath ? SuddenDeathStage : ui.Stage;
  const cardsKey = `${state.phase}:${cards.map((item) => item.cardId).join(",")}`;
  let body = null;
  if (finished)
    body = (
      <Results
        session={session}
        summary={summary}
        ui={ui}
        onPlayAgain={() => controller.playAgain(deck)}
        onNewGame={() => controller.close()}
        onDownload={() => {
          try {
            saveText(`${session.id}.json`, exportSession(session));
          } catch (failure) {
            controller.setNotice(failure instanceof Error ? failure.message : "Could not export the session.");
          }
        }}
      />
    );
  else if (!showReveal && (state.phase === "open" || suddenDeath))
    body = (
      <>
        <div className="stage panel" key={`stage-${cardsKey}`}>
          {Stage ? (
            <Stage {...inputProps} />
          ) : (
            <CardStage card={card} deck={deck} session={session} playback={playback} controller={controller} />
          )}
        </div>
        <div className="inputs panel" key={`inputs-${cardsKey}`}>
          {suddenDeath ? <SuddenDeathInput {...inputProps} /> : <ui.Input {...inputProps} />}
          <div className="action-row">
            {!suddenDeath && ui.ownReveal ? null : (
              <button className="primary" disabled={!canReveal(state)} onClick={revealCard}>
                Reveal
              </button>
            )}
            {session.mode === "daily" ? null : (
              <button className="quiet" onClick={skip}>
                Skip card
              </button>
            )}
          </div>
        </div>
      </>
    );
  else if (!showReveal)
    body = (
      <div className="stage panel">
        <div className="stage-empty">
          {outOfCards ? (
            <>
              <p>
                {session.mode === "daily"
                  ? "This round's card was skipped. End the game to finish today's round."
                  : session.mode === "imposter"
                    ? "No pairs left to play."
                    : "No cards left in the deck."}
              </p>
              <button className="primary" onClick={endGame}>
                End game
              </button>
            </>
          ) : (
            <div className="action-row">
              <button className={view.source === "draw" || !scanHere ? "primary" : ""} onClick={draw}>
                {drawCount > 1
                  ? `Draw ${drawCount} cards`
                  : session.mode === "lineup"
                    ? "Draw lineup"
                    : session.mode === "imposter"
                      ? "Draw pair"
                      : "Draw card"}
              </button>
              {scanHere ? (
                <button
                  className={view.source === "scan" ? "primary" : ""}
                  onClick={() => {
                    setScanMessage(undefined);
                    setScanning(true);
                  }}
                >
                  Scan card
                </button>
              ) : null}
            </div>
          )}
          {scanning ? (
            <div
              className="scanner-panel"
              role="dialog"
              aria-label="Scan a card"
              tabIndex={-1}
              ref={scannerRef}
              onKeyDown={(event) => {
                if (event.key === "Escape") setScanning(false);
              }}
            >
              <Suspense fallback={<p role="status">Starting the camera…</p>}>
                <ScannerView onPayload={onScan} onClose={() => setScanning(false)} />
              </Suspense>
            </div>
          ) : null}
          {scanMessage ? (
            <div className="scan-message" role="status">
              <p>{scanMessage.text}</p>
              {scanMessage.audio ? (
                <button onClick={() => void playAudioOnly(scanMessage.audio!)}>
                  Play audio only (not scored)
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );

  return (
    <section className="host" aria-labelledby="host-title" ref={hostRef}>
      <div className="host-bar">
        <div>
          <h1 id="host-title">{MODE_INFO[session.mode].name}</h1>
          <p className="round-text">{roundText(session, state, showReveal ? reveal.before : summary)}</p>
        </div>
        {finished ? null : <button onClick={endGame}>End game</button>}
      </div>
      <Scoreboard session={session} state={state} summary={summary} />
      {view.notice || view.storageNotice ? (
        <div className="notice" role="alert">
          {view.notice ? <p>{view.notice}</p> : null}
          {view.storageNotice ? <p>{view.storageNotice}</p> : null}
        </div>
      ) : null}
      {view.announcement ? (
        <p className="announcement" role="status">
          {view.announcement}
        </p>
      ) : null}
      {summary.suddenDeath && !finished ? (
        <p className="sudden-death-banner" role="status">
          Sudden death: {suddenDeathNames}
        </p>
      ) : null}
      {showReveal ? (
        <Reveal info={reveal} session={session} deck={deck} ui={ui} finished={finished} onNext={next} />
      ) : null}
      {body}
    </section>
  );
}
