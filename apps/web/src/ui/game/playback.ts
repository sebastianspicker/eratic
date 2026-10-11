import { useEffect, useState, useSyncExternalStore } from "react";
import type { Card, Deck, ProviderLink } from "../../core/deck";
import { linkTrack } from "../../core/scan";
import { currentCards, type GameState } from "../../core/game/engine";
import type { Session, TimelineOptions } from "../../core/session";
import { ClipController, type ClipState } from "../../playback/clip";
import type { HubState, PlaybackHub } from "../../playback/hub";
import { ManualPlayer } from "../../playback/manualPlayer";
import {
  exactClips,
  type PlayableTrack,
  type PlaybackProvider,
  type PlaybackTier,
  type Player,
} from "../../playback/player";
import type { GameController } from "./useGame";

// Glue between the host screen and the playback services; no game rules here.
export const PROVIDER_NAMES: Record<PlaybackProvider, string> = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  manual: "Play it yourself",
};

// The track a provider plays for a card: its first link of that provider; the
// manual player opens the first link of any provider.
export function trackFor(
  card: Card,
  provider: PlaybackProvider,
): (PlayableTrack & { link: ProviderLink }) | undefined {
  if (provider === "manual") {
    const link = card.links[0];
    if (!link) return undefined;
    return { provider, id: linkTrack(link)?.id ?? link.id ?? card.id, url: link.url, link };
  }
  const link = card.links.find((item) => item.provider === provider);
  const track = link && linkTrack(link);
  if (!link || !track) return undefined;
  return {
    provider,
    id: track.id,
    ...(track.storefront && { storefront: track.storefront }),
    url: link.url,
    link,
  };
}
// The button names where the song opens.
export function openLabel(link: ProviderLink): string {
  if (link.provider === "spotify") return "Play on Spotify";
  if (link.provider === "appleMusic") return "Play on Apple Music";
  if (link.provider === "youtube") return "Play on YouTube";
  return "Open song link";
}
// How a card plays: an exact clip through the provider's player, or a link opened
// in a new tab. Without exact clips (Spotify Free, a failed connect, Play it
// yourself) the provider's player is never asked to play: the card's link for that
// provider opens, else its first link.
export type CardRoute =
  | { kind: "exact"; track: PlayableTrack }
  | { kind: "open"; track: PlayableTrack; label: string }
  | { kind: "none"; message: string };
export function cardRoute(card: Card, provider: PlaybackProvider, tier: PlaybackTier): CardRoute {
  if (exactClips(tier)) {
    const track = trackFor(card, provider);
    return track
      ? { kind: "exact", track }
      : { kind: "none", message: `This card has no ${PROVIDER_NAMES[provider]} link.` };
  }
  const own = provider === "manual" ? undefined : trackFor(card, provider);
  if (own) return { kind: "open", track: { ...own, provider: "manual" }, label: openLabel(own.link) };
  const first = trackFor(card, "manual");
  if (!first) return { kind: "none", message: "This card has no song link." };
  return {
    kind: "open",
    track: first,
    label: provider === "manual" ? openLabel(first.link) : "Open song link",
  };
}
// Opens a link in a new tab, the way Play it yourself does.
export async function openLink(track: PlayableTrack, fromMs = 0): Promise<void> {
  const player = new ManualPlayer();
  await player.prepare(track);
  await player.play(fromMs);
}

// Clip start: the card's value, else the deck default, else the session choice.
export function clipStartFor(card: Card, deck: Deck, sessionChoice: number): number {
  return card.clip?.startMs ?? deck.defaultClipStartMs ?? sessionChoice;
}
// Clip length for modes without steps: Timeline's clip option, Lineup's clipMs,
// otherwise 30 s so players can follow a countdown.
export function clipLengthFor(session: Session): number | undefined {
  if (session.mode === "timeline") {
    const clip = (session.options.clip ?? "full") as TimelineOptions["clip"];
    return clip === "full" ? undefined : clip === "30s" ? 30_000 : 10_000;
  }
  if (session.mode === "lineup") return (session.options.clipMs as number | undefined) ?? 10_000;
  return 30_000;
}
// A preview holds only maxMs: start at 0 if the clip would run past it.
export function fitClip(
  fromMs: number,
  lengthMs: number | undefined,
  tier: PlaybackTier,
): { fromMs: number; lengthMs: number | undefined } {
  if (tier.kind !== "previewOnly") return { fromMs, lengthMs };
  const length = Math.min(lengthMs ?? tier.maxMs, tier.maxMs);
  return { fromMs: fromMs > tier.maxMs - length ? 0 : fromMs, lengthMs: length };
}

// The detected tier in words (DESIGN.md, Play home).
export function tierText(provider: PlaybackProvider, tier: PlaybackTier): string {
  if (tier.kind === "unavailable") return tier.reason;
  if (provider === "manual") return "Play it yourself: you start each song yourself";
  if (tier.kind === "previewOnly")
    return `${PROVIDER_NAMES[provider]} preview: ${Math.round(tier.maxMs / 1000)}-second clips`;
  if (tier.kind === "noExactPlayback")
    return provider === "spotify"
      ? "Spotify Free: you start each song yourself"
      : `${PROVIDER_NAMES[provider]}: you start each song yourself`;
  return provider === "spotify" ? "Spotify Premium: exact clips" : `${PROVIDER_NAMES[provider]}: exact clips`;
}

export function useHub(hub: PlaybackHub): HubState {
  return useSyncExternalStore(
    (listener) => hub.subscribe(listener),
    () => hub.state,
  );
}
// One clip controller per host screen; a running clip stops when it unmounts.
export function usePlayback(hub: PlaybackHub): {
  hubState: HubState;
  clip: ClipController;
  clipState: ClipState;
} {
  const hubState = useHub(hub);
  const [clip] = useState(() => new ClipController());
  const clipState = useSyncExternalStore(
    (listener) => clip.subscribe(listener),
    () => clip.state,
  );
  useEffect(() => () => void clip.cancel(hub.player), [clip, hub]);
  return { hubState, clip, clipState };
}

// The host screen's playback, handed to the stage and a mode's inputs.
export interface PlaybackProps {
  hub: PlaybackHub;
  hubState: HubState;
  clip: ClipController;
  clipState: ClipState;
}
const cardsKey = (state: GameState | undefined): string =>
  state ? `${state.phase}:${currentCards(state).map((card) => card.cardId).join(",")}` : "";

// Plays one card: an exact clip through the clip controller, or the song opened
// by hand. The clip action is recorded once the audio is audible (or the song
// opened), and only while the same cards are still in play. onAudible runs just
// before that record; returning false skips the record.
export function useCardPlayer(
  playback: PlaybackProps,
  controller: GameController,
): {
  player: Player | undefined;
  exact: boolean;
  error: string;
  status: string;
  playingKey: string | undefined;
  route: (card: Card) => CardRoute | undefined;
  play: (
    card: Card,
    fromMs: number,
    lengthMs: number | undefined,
    key?: string,
    onAudible?: () => boolean,
  ) => Promise<void>;
  stop: () => void;
} {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [playingKey, setPlayingKey] = useState<string>();
  const player = playback.hub.player;
  const tier = playback.hubState.tier;
  const exact = Boolean(player && tier && exactClips(tier));
  const route = (card: Card): CardRoute | undefined =>
    player && tier ? cardRoute(card, player.provider, tier) : undefined;
  async function play(
    card: Card,
    fromMs: number,
    lengthMs: number | undefined,
    key = card.id,
    onAudible: () => boolean = () => true,
  ) {
    const how = route(card);
    if (!player || !tier || !how) {
      setError("Choose how to play songs on Play home first.");
      return;
    }
    if (how.kind === "none") {
      setError(how.message);
      return;
    }
    setError("");
    setPlayingKey(key);
    const expected = cardsKey(controller.getSnapshot().state);
    const record = (from: number, length: number | undefined) => {
      if (cardsKey(controller.getSnapshot().state) !== expected) return;
      if (!onAudible()) return;
      controller.dispatch({ type: "clip", fromMs: from, ...(length !== undefined && { lengthMs: length }) });
    };
    try {
      if (how.kind === "exact") {
        await player.prepare(how.track);
        const fitted = fitClip(fromMs, lengthMs, tier);
        setStatus("");
        await playback.clip.start(player, fitted.fromMs, fitted.lengthMs, () =>
          record(fitted.fromMs, fitted.lengthMs),
        );
      } else {
        await openLink(how.track, fromMs);
        record(fromMs, undefined);
        setStatus("The song opened in a new tab. Start it there.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not play the song.");
    }
  }
  return {
    player,
    exact,
    error,
    status,
    playingKey,
    route,
    play,
    stop: () => void playback.clip.cancel(player),
  };
}
// The clip indicator in words, so players who can't hear well can follow.
export function clipText(clipState: ClipState, status = ""): string {
  if (clipState.state === "starting") return "Starting the clip…";
  if (clipState.state === "playing")
    return clipState.remainingMs === undefined
      ? "Playing"
      : `Playing, ${Math.ceil(clipState.remainingMs / 1000)} s left`;
  if (clipState.state === "finished") return "Clip finished";
  return status;
}
export const clipPlaying = (clipState: ClipState): boolean =>
  clipState.state === "starting" || clipState.state === "playing";
// Ladder's session choice; other modes start at the card's value or 0.
export function sessionClipStart(session: Session): number {
  return session.mode === "ladder" && session.options.clipStart === "skipIntro" ? 15_000 : 0;
}
