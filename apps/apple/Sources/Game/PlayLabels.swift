import Foundation
import EraticCore

extension GameMode {
    /// `allCases` is already in gallery order.
    var name: String {
        switch self {
        case .ladder: return "Snippet Ladder"
        case .timeline: return "Timeline"
        case .bullseye: return "Bullseye"
        case .eraSort: return "Era Sort"
        case .higherLower: return "Higher or Lower"
        case .relay: return "Relay"
        case .lineup: return "Lineup"
        case .daily: return "Daily Eratic"
        case .imposter: return "Original or Imposter"
        }
    }

    /// The mode gallery pitch (docs/game-modes.md).
    var pitch: String {
        switch self {
        case .ladder: return "Name the song from as little as one second. The fewer seconds you need, the more points you score."
        case .timeline: return "Build your own line of songs in release order; misplace one and it's gone."
        case .bullseye: return "Everyone guesses the year; the closest guess scores the most."
        case .eraSort: return "Which era does this song belong to? The fastest way into Eratic."
        case .higherLower: return "Earlier or later than the last song? Keep the streak alive."
        case .relay: return "One shared line, one team, a few lives. Debate every placement together."
        case .lineup: return "Hear four or five songs, then put them all in order."
        case .daily: return "One short round a day, played solo, with a result to share."
        case .imposter: return "Two versions of one song; spot the original."
        }
    }

    var playerRangeText: String {
        let range = playerRange
        if range.lowerBound == range.upperBound { return range.lowerBound == 1 ? "1 player" : "\(range.lowerBound) players" }
        return "\(range.lowerBound)–\(range.upperBound) players"
    }

}

/// The fewest cards a game can start with: Timeline personal one anchor per player plus a draw, shared Timeline and
/// Relay an anchor plus a draw, Higher or Lower a reference plus a draw, Lineup a full set. Original or Imposter
/// also needs a linked pair, which `ModeAvailability` checks.
func cardsNeeded(_ options: GameOptions, players: Int) -> Int {
    switch options {
    case let .timeline(timeline): return timeline.ownership == .personal ? players + 1 : 2
    case .relay, .higherLower, .imposter: return 2
    case let .lineup(lineup): return lineup.k
    case .bullseye, .eraSort, .ladder, .daily: return 1
    }
}

/// Whether a mode can start, and why not, in words.
struct ModeAvailability {
    let title: String
    let reasons: [String]
    var canStart: Bool { reasons.isEmpty }

    init(mode: GameMode, deck: Deck?, tier: PlaybackTier) {
        var reasons: [String] = []
        // Without exact clips, Snippet Ladder and Original or Imposter play by hand from the song backup.
        if let deck {
            if mode == .imposter, (try? GameRandom.imposterPairs(deck.cards.map { (id: $0.id, relatedTo: $0.relatedTo) }, seed: 0))?.isEmpty ?? true {
                reasons.append("Needs linked recordings")
            }
            if deck.cards.count < cardsNeeded(SetupView.defaults(mode), players: mode.playerRange.lowerBound) { reasons.append("Deck too small") }
        } else {
            reasons.append("Load a deck in the Deck tab first")
        }
        self.reasons = reasons
        title = mode == .lineup && !tier.exactClips ? "Lineup by name" : mode.name
    }
}

extension PlaybackProvider {
    /// Provider links remain usable even when timed playback isn't configured.
    var pickerLabel: String {
        return label
    }
}

/// The detected tier in words (DESIGN.md, Play home).
func tierDescription(provider: PlaybackProvider, tier: PlaybackTier, status: PlaybackHub.Status) -> String {
    if provider == .manual { return "Play it yourself: you start each song yourself" }
    switch tier {
    case .fullTrack: return provider == .spotify ? "Spotify Premium: exact clips" : "Apple Music: exact clips"
    case let .previewOnly(maxMs): return "\(provider.label) preview: \(maxMs / 1000)-second clips"
    case .noExactPlayback: return provider == .spotify ? "Spotify: manual playback (Free or Premium)" : "\(provider.label): you start each song yourself"
    case let .unavailable(reason):
        if reason == PlaybackError.notConfigured.localizedDescription { return "Not set up in this build" }
        return status == .idle ? "Not connected yet" : reason
    }
}

/// "1 year off", "exact".
func yearsOffText(_ distance: Int) -> String {
    switch distance {
    case 0: return "exact"
    case 1: return "1 year off"
    default: return "\(distance) years off"
    }
}

/// "+7", "0", "−2".
func signedPoints(_ value: Int) -> String {
    value > 0 ? "+\(value)" : value < 0 ? "−\(-value)" : "0"
}

/// The core score in words: "12 points"; Higher or Lower scores the streak ("streak 4"); with Stakes the score
/// already includes held chips, so it says so ("12 points (incl. chips)").
func scoreText(_ score: Int, mode: GameMode, stakes: Bool) -> String {
    let base = mode == .higherLower ? "streak \(score)" : "\(score) points"
    return stakes ? base + " (incl. chips)" : base
}

/// "Ada", "Ada and Lin", "Ada, Lin and Sam".
func namesList(_ names: [String]) -> String {
    guard names.count > 1 else { return names.first ?? "" }
    return names.dropLast().joined(separator: ", ") + " and " + names.last!
}

extension GameSession {
    func playerName(_ id: String) -> String {
        players.first { $0.id == id }?.name ?? id
    }
}
