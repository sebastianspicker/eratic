import { useEffect, useState } from "react";
import type { Deck } from "../../core/deck";
import type { GameMode } from "../../core/session";
import type { PlaybackHub } from "../../playback/hub";
import { exactClips } from "../../playback/player";
import { Host } from "./Host";
import { calibrationWarning } from "./modes/Ladder";
import { useHub } from "./playback";
import { PlayHome } from "./PlayHome";
import { Setup } from "./Setup";
import { useGame, type GameController } from "./useGame";

const cameraAvailable = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
const REPLACE_SAVED = "Starting replaces the unfinished saved game.";

// The Play surface: home, setup, then the host screen while a game is open.
export function Play({
  controller,
  deck,
  hub,
  notice,
  onDismissNotice,
}: {
  controller: GameController;
  deck: Deck;
  hub: PlaybackHub;
  notice: string;
  onDismissNotice?: () => void;
}) {
  const view = useGame(controller);
  const hubState = useHub(hub);
  const [setup, setSetup] = useState<GameMode>();
  const hasCamera = cameraAvailable();
  // A game never runs unconnected: with no provider chosen it is Play it yourself.
  const inGame = Boolean(view.session);
  useEffect(() => {
    if (inGame && !hubState.provider && !hubState.connecting) void hub.connect("manual");
  }, [inGame, hub, hubState.provider, hubState.connecting]);
  // A game keeps playing the deck it started with; say so when the open deck was edited since.
  useEffect(() => {
    if (inGame) controller.noteDeckDifference(deck);
  }, [inGame, view.run, controller, deck]);
  if (view.session && view.state && view.summary)
    return (
      <Host
        key={`${view.session.id}:${view.run}`}
        controller={controller}
        view={view}
        deck={controller.deckFor(deck)}
        openDeck={deck}
        hub={hub}
        hasCamera={hasCamera}
      />
    );
  if (setup)
    return (
      <Setup
        key={setup}
        mode={setup}
        deck={deck}
        hasCamera={hasCamera}
        error={view.notice}
        previewMs={hubState.tier?.kind === "previewOnly" ? hubState.tier.maxMs : undefined}
        exact={Boolean(hubState.tier && exactClips(hubState.tier))}
        warning={
          setup === "ladder"
            ? calibrationWarning(hubState.provider, Boolean(hubState.tier && exactClips(hubState.tier)))
            : ""
        }
        onBack={() => {
          controller.setNotice("");
          setSetup(undefined);
        }}
        onStart={(chosen) => {
          if (view.saved && !window.confirm(REPLACE_SAVED)) return;
          if (controller.start(chosen, deck)) setSetup(undefined);
        }}
      />
    );
  return (
    <PlayHome
      controller={controller}
      view={view}
      deck={deck}
      hub={hub}
      notice={notice}
      onDismissNotice={onDismissNotice}
      onChoose={(mode) => {
        controller.setNotice("");
        setSetup(mode);
      }}
      onDaily={() => {
        if (view.saved && !window.confirm(REPLACE_SAVED)) return;
        controller.setNotice("");
        // Daily is one seat, so it starts at once as "You" (the native app does the same).
        controller.start(
          { mode: "daily", options: {}, players: [{ id: "p1", name: "You" }], source: "draw", easyOnly: false },
          deck,
        );
      }}
    />
  );
}
