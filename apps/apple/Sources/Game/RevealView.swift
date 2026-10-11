import SwiftUI
import EraticCore

/// The reveal: the card's era takes over the stage, the year drops in, then the song and each player's result.
struct RevealView: View {
    let reveal: RevealSnapshot
    let session: GameSession
    let deck: Deck
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The revealed card: the card in play, or the sudden-death card.
    private var card: CardRef? {
        reveal.before.currentCard ?? reveal.before.suddenDeathInfo?.cards.first
    }

    /// The Lineup set, or a sudden-death lineup.
    private var lineupCards: [CardRef] {
        if !reveal.before.currentSet.isEmpty { return reveal.before.currentSet }
        if reveal.before.phase == .suddenDeathOpen, let cards = reveal.before.suddenDeathInfo?.cards, cards.count > 1 { return cards }
        return []
    }

    var body: some View {
        if let pair = reveal.before.currentPair {
            ImposterReveal(pair: pair, reveal: reveal, session: session, deck: deck)
                .transition(reduceMotion ? .identity : .opacity)
        } else if !lineupCards.isEmpty {
            LineupReveal(cards: lineupCards, reveal: reveal, session: session, deck: deck)
                .transition(reduceMotion ? .identity : .opacity)
        } else if let card {
            let era = Eras.for(card.year)
            let song = deck.card(card.cardId)
            VStack(alignment: .leading, spacing: 10) {
                if let era {
                    Text("\(era.label) · \(era.name)")
                        .font(.footnote.weight(.semibold))
                        .textCase(.uppercase)
                        .tracking(1.6)
                }
                EraYear(year: card.year, era: era)
                    .id(card.cardId)
                Text(song?.title ?? card.cardId).font(.largeTitle.bold())
                if let song { Text(song.artist).font(.title3) }
                Divider().overlay(era?.inkColor.opacity(0.4) ?? .secondary)
                ForEach(resultLines(card), id: \.self) { line in
                    Text(line).font(.body.weight(.medium))
                }
                if session.mode == .bullseye, reveal.before.phase == .open {
                    BullseyeRuler(answer: card.year, guesses: session.players.compactMap { player in
                        reveal.before.guesses[player.id].map { (name: player.name, year: $0) }
                    })
                    .padding(12)
                    .background(.background, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(Color.primary)
                }
            }
            .foregroundStyle(era?.inkColor ?? .primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
            .background(era?.groundColor ?? Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .transition(reduceMotion ? .identity : .opacity)
        }
    }

    /// One line per player: what they entered and what it earned ("Ada: 1986, 2 years off · +5").
    private func resultLines(_ card: CardRef) -> [String] {
        let before = reveal.before
        let after = reveal.after
        if before.phase == .suddenDeathOpen, let info = before.suddenDeathInfo {
            var lines: [String]
            if info.kind == .firstToName {
                lines = [info.named.map { "\(session.playerName($0)) named it first." } ?? "Nobody named it."]
            } else {
                lines = info.players.map { player in
                    info.guesses[player].map { "\(session.playerName(player)): \(String($0)), \(yearsOffText(Scoring.distance($0, card.year)))" } ?? session.playerName(player)
                }
            }
            lines.append(suddenDeathOutcome(after, session))
            return lines
        }
        let scoresBefore = GameEngine.scores(of: before)
        let scoresAfter = GameEngine.scores(of: after)
        func delta(_ player: String) -> String { signedPoints((scoresAfter[player] ?? 0) - (scoresBefore[player] ?? 0)) }
        func wagerText(_ player: String) -> String { before.wagers[player].map { ", wagered \($0)" } ?? "" }
        switch session.mode {
        case .bullseye, .daily, .eraSort:
            return session.players.map { player in
                let name = player.name
                if let guess = before.guesses[player.id] {
                    return "\(name): \(String(guess)), \(yearsOffText(Scoring.distance(guess, card.year)))\(wagerText(player.id)) · \(delta(player.id))"
                }
                if let era = before.picks[player.id] {
                    return "\(name): \(EraBoundaries.name(of: era) ?? era) · \(delta(player.id))"
                }
                return "\(name) · \(delta(player.id))"
            }
        case .higherLower:
            guard let active = before.activePlayerID, let call = before.call, let reference = before.referenceCard else { return [] }
            let right = Scoring.higherLowerCorrect(refYear: reference.year, year: card.year, call: call)
            let name = session.playerName(active)
            let callText = call == .earlier ? "Earlier" : "Later"
            if right { return ["\(name) called \(callText) than \(String(reference.year)): right."] }
            return ["\(name) called \(callText) than \(String(reference.year)): wrong" + (after.eliminated.contains(active) ? ", and is out." : ". The streak ends.")]
        case .timeline, .relay:
            return placementLines(card, before, after) + (session.mode == .timeline ? session.players.map { "\($0.name) · \(delta($0.id))" } : [])
        default:
            return session.players.map { "\($0.name) · \(delta($0.id))" }
        }
    }

    /// Timeline and Relay, read from the state delta: who got the card, Name It, the wager and Relay's lives.
    private func placementLines(_ card: CardRef, _ before: GameState, _ after: GameState) -> [String] {
        guard let active = before.activePlayerID else { return [] }
        let name = session.playerName(active)
        var lines: [String] = []
        let personal: Bool
        if case let .timeline(options) = session.options { personal = options.ownership == .personal } else { personal = false }
        if personal {
            let gainer = session.players.first { after.timeline(for: $0.id).count > before.timeline(for: $0.id).count }
            if let gainer {
                lines.append(gainer.id == active ? "Correct! \(name) keeps it." : "\(gainer.name) takes the card.")
            } else {
                lines.append("Discarded.")
            }
        } else if after.timeline(for: nil).count > before.timeline(for: nil).count {
            // Shared Timeline: whoever's `added` count grew got the card (score without chips, game-rules.md 6.3).
            // Relay's line belongs to the team.
            func added(_ state: GameState, _ player: String) -> Int {
                (GameEngine.scores(of: state)[player] ?? 0) - (state.chips(for: player) ?? 0)
            }
            let gainer = session.mode == .timeline ? session.players.first { added(after, $0.id) > added(before, $0.id) } : nil
            if let gainer, gainer.id != active {
                lines.append("\(gainer.name) takes the card.")
            } else {
                lines.append("Correct! \(name) keeps it.")
            }
        } else {
            lines.append("Discarded.")
        }
        if let marks = before.nameItMarks {
            let award = Scoring.nameItAward(titleOK: marks.titleOK, artistOK: marks.artistOK)
            if session.mode == .relay {
                lines.append(award ? "\(name) named it: the team wins back a life if it lost one." : "\(name) didn't fully name it.")
            } else {
                lines.append(award ? "\(name) named it: +1 token (up to 5)." : "\(name) didn't fully name it.")
            }
        }
        if let wager = before.wagers[active], let held = after.chips(for: active), let had = before.chips(for: active) {
            lines.append("\(name) wagered \(wager): \(signedPoints(held - had)) chips.")
        }
        if case let .relay(options) = session.options {
            lines.append("Lives \(after.lives) of \(options.lives).")
        }
        return lines
    }
}
