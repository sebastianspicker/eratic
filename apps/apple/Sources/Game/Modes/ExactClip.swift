import SwiftUI
import EraticCore

/// Plays an exactly timed clip of one card for the mode inputs (Snippet Ladder steps, Lineup tiles, Original or Imposter).
/// The `clip` action is recorded by the host screen once the clip is audible, not when it is requested.
@MainActor
enum ExactClip {
    /// Plays `lengthMs` from `fromMs`. With a preview, the clip keeps its length (up to the preview's) and starts
    /// earlier if it would run past the preview. Returns an error message, or nil once the clip is starting.
    /// The clip only starts if the same cards are still in play when the track is prepared and the calling task
    /// wasn't cancelled. `recordFirst` is dispatched before the `clip` record once the clip is audible.
    static func play(_ card: SongCard, fromMs: Int, lengthMs: Int, playback: PlaybackHub, clip: ClipController, game: GameController,
                     recordFirst: [GameAction] = []) async -> String? {
        guard playback.tier.exactClips else { return "Exact clips need Spotify Premium or Apple Music. Connect playback in Play home." }
        guard let track = playback.track(for: card) else { return "This card has no \(playback.provider.label) link to play." }
        let (from, length) = clamped(fromMs: fromMs, lengthMs: lengthMs, tier: playback.tier)
        let key = game.playKey
        let player = playback.player
        do {
            try await player.prepare(track)
        } catch {
            if Task.isCancelled || game.playKey != key { return nil }
            return (error as? PlaybackError)?.localizedDescription ?? error.localizedDescription
        }
        guard !Task.isCancelled, game.playKey == key else { return nil }
        clip.start(player: player, fromMs: from, lengthMs: length)
        game.pendingClipRecords = recordFirst + [.clip(fromMs: from, lengthMs: length)]
        return nil
    }

    /// A preview keeps the clip's length where it can (up to the preview's) and moves the start earlier.
    /// An untimed clip (`lengthMs == nil`) on a preview starts where a preview-long clip would.
    static func clamped(fromMs: Int, lengthMs: Int?, tier: PlaybackTier) -> (fromMs: Int, lengthMs: Int?) {
        guard case let .previewOnly(maxMs) = tier else { return (fromMs, lengthMs) }
        let length = lengthMs.map { min($0, maxMs) }
        return (max(0, min(fromMs, maxMs - (length ?? maxMs))), length)
    }

    static func clamped(fromMs: Int, lengthMs: Int, tier: PlaybackTier) -> (fromMs: Int, lengthMs: Int) {
        let result = clamped(fromMs: fromMs, lengthMs: Optional(lengthMs), tier: tier)
        return (result.fromMs, result.lengthMs ?? lengthMs)
    }

    /// The card's start, else the deck default, else 0.
    static func startMs(_ card: SongCard, deck: Deck) -> Int {
        deck.clipStartMs(for: card) ?? 0
    }

    /// "Playing, 7 s left", "Starting…", "Clip finished", or nil when idle.
    static func statusText(_ clip: ClipController) -> String? {
        switch clip.state {
        case .starting: return "Starting…"
        case .playing: return "Playing" + (clip.remainingMs.map { ", \(($0 + 999) / 1000) s left" } ?? "")
        case .finished: return "Clip finished"
        case .idle: return nil
        }
    }

    static func isPlaying(_ clip: ClipController) -> Bool {
        switch clip.state {
        case .starting, .playing: return true
        default: return false
        }
    }
}

/// "1 s", "500 ms", "1.5 s".
func secondsText(_ ms: Int) -> String {
    if ms < 1000 { return "\(ms) ms" }
    if ms % 1000 == 0 { return "\(ms / 1000) s" }
    return String(format: "%.1f s", Double(ms) / 1000)
}

/// "A" to "E" for Lineup tiles.
func tileLetter(_ index: Int) -> String {
    let letters = ["A", "B", "C", "D", "E"]
    return index < letters.count ? letters[index] : String(index + 1)
}
