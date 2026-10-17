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

/// The most the deck allows for a mode's length option. Setup warns about it and starts the field there; the engine
/// accepts the full range, and the game ends when the cards run out.
struct DeckCapacity {
    enum Option { case rounds, cards, target }
    let option: Option
    let max: Int
    let mode: GameMode

    /// The smallest value the option's control accepts.
    private var minimum: Int { option == .rounds ? 1 : 2 }

    /// The chosen value of the length option.
    func value(in options: GameOptions) -> Int? {
        switch options {
        case let .bullseye(o): return o.rounds
        case let .eraSort(o): return o.rounds
        case let .ladder(o): return o.rounds
        case let .lineup(o): return o.rounds
        case let .imposter(o): return o.rounds
        case let .higherLower(o): return o.cards
        case let .timeline(o): return o.target
        case let .relay(o): return o.target
        case .daily: return nil
        }
    }

    /// The options with the length option brought down to the capacity, unless the deck can't hold the smallest game.
    func clamped(_ options: GameOptions) -> GameOptions {
        guard max >= minimum, let chosen = value(in: options), chosen > max else { return options }
        switch options {
        case var .bullseye(o): o.rounds = max; return .bullseye(o)
        case var .eraSort(o): o.rounds = max; return .eraSort(o)
        case var .ladder(o): o.rounds = max; return .ladder(o)
        case var .lineup(o): o.rounds = max; return .lineup(o)
        case var .imposter(o): o.rounds = max; return .imposter(o)
        case var .higherLower(o): o.cards = max; return .higherLower(o)
        case var .timeline(o): o.target = max; return .timeline(o)
        case var .relay(o): o.target = max; return .relay(o)
        case .daily: return options
        }
    }

    /// "This deck has 3 cards: enough for 3 rounds." when the chosen value is more than the deck holds.
    func note(for options: GameOptions, deckCards: Int) -> String? {
        guard let chosen = value(in: options), chosen > max else { return nil }
        func count(_ one: String, _ many: String) -> String { "\(max) " + (max == 1 ? one : many) }
        let enough: String
        switch mode {
        case .lineup: enough = count("lineup", "lineups")
        case .imposter: enough = count("pair", "pairs")
        case .higherLower: enough = count("card", "cards")
        case .timeline, .relay: enough = "a line of " + count("card", "cards")
        default: enough = count("round", "rounds")
        }
        return "This deck has \(deckCards) card\(deckCards == 1 ? "" : "s"): enough for \(enough)."
    }
}

/// The capacity of `pool` (the easy cards when that is ticked) for the mode's length option, nil when the deck never limits it.
func deckCapacity(_ options: GameOptions, players: Int, pool: [SongCard]) -> DeckCapacity? {
    let n = pool.count
    switch options {
    case .bullseye: return DeckCapacity(option: .rounds, max: n, mode: .bullseye)
    case .eraSort: return DeckCapacity(option: .rounds, max: n, mode: .eraSort)
    case .ladder: return DeckCapacity(option: .rounds, max: n, mode: .ladder)
    case let .lineup(o): return DeckCapacity(option: .rounds, max: n / o.k, mode: .lineup)
    case .higherLower: return players > 1 ? DeckCapacity(option: .cards, max: n - 1, mode: .higherLower) : nil
    case .imposter:
        let pairs = (try? GameRandom.imposterPairs(pool.map { (id: $0.id, relatedTo: $0.relatedTo) }, seed: 0))?.count ?? 0
        return DeckCapacity(option: .rounds, max: pairs, mode: .imposter)
    case let .timeline(o): return DeckCapacity(option: .target, max: o.ownership == .personal ? 1 + n - players : n, mode: .timeline)
    case .relay: return DeckCapacity(option: .target, max: n, mode: .relay)
    case .daily: return nil
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
            // The smallest game the mode allows: Lineup with three songs.
            var smallest = SetupView.defaults(mode)
            if case var .lineup(lineup) = smallest {
                lineup.k = 3
                smallest = .lineup(lineup)
            }
            if deck.cards.count < cardsNeeded(smallest, players: mode.playerRange.lowerBound) { reasons.append("Deck too small") }
        } else {
            reasons.append("Load a deck in the Deck tab first")
        }
        self.reasons = reasons
        title = mode == .lineup && LineupPlayMode.byName(deck: deck, tier: tier) ? "Lineup by name" : mode.name
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

/// The core score in words: "12 points"; Higher or Lower scores the streak ("streak 4"); Timeline counts cards
/// ("7 cards"). With Stakes the score already includes held chips, so it says so ("12 points (incl. chips)",
/// "7 (cards + chips)").
func scoreText(_ score: Int, mode: GameMode, stakes: Bool) -> String {
    switch mode {
    case .higherLower: return stakes ? "streak \(score) (incl. chips)" : "streak \(score)"
    case .timeline: return stakes ? "\(score) (cards + chips)" : "\(score) card\(score == 1 ? "" : "s")"
    default: return stakes ? "\(score) points (incl. chips)" : "\(score) points"
    }
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
