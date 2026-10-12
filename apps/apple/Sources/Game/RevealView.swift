import SwiftUI
import EraticCore

/// The reveal: the card's era takes over the stage, the year drops in, then the song and each player's result,
/// with a line about the lead. Reduce Motion shows everything at once.
struct RevealView: View {
    let reveal: RevealSnapshot
    let session: GameSession
    let deck: Deck
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// What has appeared so far: the year (0), then the song (1, ~0.35 s later), then the results (2, ~0.7 s).
    @State private var shown = 0

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
        content
            .task(id: reveal.after.actionCount) {
                guard !reduceMotion else { shown = 2; return }
                shown = 0
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.25)) { shown = 1 }
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.25)) { shown = 2 }
            }
    }

    /// Fades in once its stage has come; kept in the layout so nothing jumps.
    private func staged(_ stage: Int) -> Double { reduceMotion || shown >= stage ? 1 : 0 }

    @ViewBuilder
    private var content: some View {
        let leader = Self.leaderLine(reveal, session)
        if let pair = reveal.before.currentPair {
            ImposterReveal(pair: pair, reveal: reveal, session: session, deck: deck, shown: shown, leader: leader)
                .transition(reduceMotion ? .identity : .opacity)
        } else if !lineupCards.isEmpty {
            LineupReveal(cards: lineupCards, reveal: reveal, session: session, deck: deck, shown: shown, leader: leader)
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
                Group {
                    Text(song?.title ?? card.cardId).font(.largeTitle.bold())
                    if let song { Text(song.artist).font(.title3) }
                }
                .opacity(staged(1))
                Group {
                    Divider().overlay(era?.inkColor.opacity(0.4) ?? .secondary)
                    ForEach(resultLines(card), id: \.self) { line in
                        Text(line).font(.body.weight(.medium))
                    }
                    if let leader { Text(leader).font(.headline) }
                    revealExtra(card)
                    if session.mode == .bullseye, reveal.before.phase == .open {
                        BullseyeRuler(answer: card.year, guesses: session.players.enumerated().compactMap { index, player in
                            reveal.before.guesses[player.id].map { (number: index + 1, name: player.name, year: $0) }
                        })
                        .padding(12)
                        .background(.background, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(Color.primary)
                    }
                }
                .opacity(staged(2))
            }
            .foregroundStyle(era?.inkColor ?? .primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
            .background(era?.groundColor ?? Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .transition(reduceMotion ? .identity : .opacity)
        }
    }

    /// Who leads after the reveal, from the engine's scores before and after: "Ada takes the lead with 23." when the
    /// sole leader changed, "Ada leads with 23.", or "Ada and Lin share the lead with 20.". None for Relay, Daily,
    /// one-player games, sudden death, or while nobody has scored.
    static func leaderLine(_ reveal: RevealSnapshot, _ session: GameSession) -> String? {
        guard session.mode != .relay, session.mode != .daily, session.players.count > 1,
              reveal.before.phase != .suddenDeathOpen, reveal.before.phase != .suddenDeath else { return nil }
        func leaders(_ state: GameState) -> (ids: [String], score: Int)? {
            let scores = GameEngine.scores(of: state)
            guard let top = session.players.compactMap({ scores[$0.id] }).max(), top > 0 else { return nil }
            return (session.players.map(\.id).filter { scores[$0] == top }, top)
        }
        guard let now = leaders(reveal.after) else { return nil }
        if now.ids.count > 1 { return "\(namesList(now.ids.map(session.playerName))) share the lead with \(now.score)." }
        let name = session.playerName(now.ids[0])
        let previous = leaders(reveal.before)
        if previous?.ids == now.ids { return "\(name) leads with \(now.score)." }
        return "\(name) takes the lead with \(now.score)."
    }

    /// One line per player, in words, with the points read from the engine's state before and after the reveal:
    /// "Ada: +7, 1 year off (guessed 1985)".
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
        func points(_ player: String) -> Int { RevealDeltas.points(reveal, player) }
        func chips(_ player: String) -> String { RevealDeltas.chipsText(RevealDeltas.chips(reveal, player)) }
        switch session.mode {
        case .bullseye, .daily, .eraSort:
            return session.players.compactMap { player in
                let name = player.name
                if let guess = before.guesses[player.id] {
                    return "\(name): \(signedPoints(points(player.id))), \(yearsOffText(Scoring.distance(guess, card.year))) (guessed \(String(guess)))\(chips(player.id))"
                }
                if let era = before.picks[player.id] {
                    let how = era == card.era ? "right era" : points(player.id) > 0 ? "neighbouring era" : "missed"
                    return "\(name): \(signedPoints(points(player.id))), \(how) (picked \(EraBoundaries.name(of: era) ?? era))\(chips(player.id))"
                }
                return nil
            }
        case .higherLower where before.isEveryonePlay:
            let scoresBefore = GameEngine.scores(of: before)
            let scoresAfter = GameEngine.scores(of: after)
            return session.players.compactMap { player in
                guard let call = before.calls[player.id] else { return nil }
                let name = "\(player.name): called \(call == .earlier ? "Earlier" : "Later")"
                let streak = scoresAfter[player.id] ?? 0
                if streak > (scoresBefore[player.id] ?? 0) { return "\(name): right, streak \(streak)" }
                let lives = after.higherLowerLives(for: player.id) ?? 0
                if lives == 0 { return "\(name): missed, out" }
                return "\(name): missed, \(lives) li\(lives == 1 ? "fe" : "ves") left"
            }
        case .higherLower:
            guard let active = before.activePlayerID, let call = before.call else { return [] }
            let scoresBefore = GameEngine.scores(of: before)
            let scoresAfter = GameEngine.scores(of: after)
            let streak = scoresAfter[active] ?? 0
            let right = streak > (scoresBefore[active] ?? 0)
            let out = after.eliminated.contains(active) && !before.eliminated.contains(active)
            let result = right ? "right, streak \(streak)" : out ? "missed, out" : "missed"
            return ["\(session.playerName(active)): called \(call == .earlier ? "Earlier" : "Later"): \(result)"]
        case .timeline:
            guard let active = before.activePlayerID else { return [] }
            let tokenGain = (after.tokens(for: active) ?? 0) - (before.tokens(for: active) ?? 0)
            var lines = ["\(session.playerName(active)): " + (points(active) > 0 ? "\(signedPoints(points(active))) card" : "no card") + chips(active) + (tokenGain > 0 ? ", +1 token" : "")]
            let years = timelineBefore(active).map(\.year)
            for challenge in before.challenges {
                let text: String
                if points(challenge.playerId) > 0 {
                    text = "+1 card from the challenge"
                } else if (try? Scoring.placementCorrect(years: years, slot: challenge.slot, year: card.year)) == true,
                          let winner = session.players.first(where: { points($0.id) > 0 }) {
                    text = "right, but \(winner.name) claimed it first"
                } else {
                    text = "challenge missed, token spent"
                }
                lines.append("\(session.playerName(challenge.playerId)): \(text)")
            }
            return lines
        case .relay:
            // The line belongs to the team: nothing per player.
            guard let marks = before.nameItMarks, let active = before.activePlayerID else { return [] }
            let name = session.playerName(active)
            return [Scoring.nameItAward(titleOK: marks.titleOK, artistOK: marks.artistOK)
                    ? "\(name) named it: the team wins back a life if it lost one." : "\(name) didn't fully name it."]
        case .ladder:
            guard case let .ladder(options) = session.options else { return [] }
            return session.players.map { player in
                let head = "\(player.name): \(signedPoints(points(player.id)))"
                guard let lock = before.locks[player.id] else { return "\(head), didn't lock in\(chips(player.id))" }
                var parts = ["\(head), locked at \(secondsText(options.steps[lock.step]))"]
                if let mark = before.marks[player.id] { parts.append(Self.markText(mark)) }
                if let year = lock.year { parts.append("guessed \(String(year))") }
                if (after.buzzers(for: player.id) ?? 0) > (before.buzzers(for: player.id) ?? 0) { parts.append("+2 buzzer") }
                return parts.joined(separator: ", ") + chips(player.id)
            }
        default:
            return session.players.map { "\($0.name): \(signedPoints(points($0.id)))\(chips($0.id))" }
        }
    }

    private static func markText(_ mark: MarksInPlay) -> String {
        if mark.titleOK && mark.artistOK { return "title and artist right" }
        if mark.titleOK { return "title right" }
        if mark.artistOK { return "artist right" }
        return "neither right"
    }

    private func timelineBefore(_ active: String) -> [CardRef] {
        reveal.before.timeline(for: personalTimeline ? active : nil)
    }

    private var personalTimeline: Bool {
        if case let .timeline(options) = session.options { return options.ownership == .personal }
        return false
    }

    /// Below the result lines: Timeline's and Relay's outcome and the line after the reveal, Higher or Lower's reference.
    @ViewBuilder
    private func revealExtra(_ card: CardRef) -> some View {
        let before = reveal.before
        let after = reveal.after
        switch session.mode {
        case .timeline:
            if let active = before.activePlayerID {
                let name = session.playerName(active)
                let activeGained = RevealDeltas.points(reveal, active) > 0
                let taker = session.players.first { $0.id != active && RevealDeltas.points(reveal, $0.id) > 0 }
                Text(activeGained ? "Correct! \(name) keeps it." : taker.map { "\($0.name) takes the card." } ?? "Discarded.")
                    .font(.callout.weight(.semibold))
                Text(personalTimeline ? "\(name)'s timeline" : "Shared timeline").font(.caption).foregroundStyle(.secondary)
                TimelineStrip(cards: after.timeline(for: personalTimeline ? active : nil), deck: deck, compact: true)
            }
        case .relay:
            let line = after.timeline(for: nil)
            let grew = line.count > before.timeline(for: nil).count
            Text(grew ? "Correct! The line now has \(line.count) cards." : "Wrong. The card is discarded and the team loses a life.")
                .font(.callout.weight(.semibold))
            if case let .relay(options) = session.options {
                let team = (GameEngine.summary(of: after)["teamScore"] as? Int) ?? 0
                Text("Lives \(after.lives) of \(options.lives) · Team score \(team)").font(.callout)
            }
            if after.outcome == "won" {
                Text("The line is complete. The team wins!").font(.callout.weight(.semibold))
            } else if after.outcome == "lost" {
                Text("Out of lives. The team loses.").font(.callout.weight(.semibold))
            }
            Text("The team's line").font(.caption).foregroundStyle(.secondary)
            TimelineStrip(cards: line, deck: deck, compact: true)
        case .higherLower:
            if let reference = before.referenceCard {
                Text("Compared with \(deck.card(reference.cardId)?.title ?? reference.cardId) (\(String(reference.year)))").font(.callout)
            }
        default:
            EmptyView()
        }
    }
}

/// Points and chips a player gained at the reveal, read from the engine's scores before and after (never re-scored).
enum RevealDeltas {
    /// Chips won or lost; 0 without Stakes.
    static func chips(_ reveal: RevealSnapshot, _ player: String) -> Int {
        (reveal.after.chips(for: player) ?? 0) - (reveal.before.chips(for: player) ?? 0)
    }

    /// The score change without chips.
    static func points(_ reveal: RevealSnapshot, _ player: String) -> Int {
        let after = GameEngine.scores(of: reveal.after)[player] ?? 0
        let before = GameEngine.scores(of: reveal.before)[player] ?? 0
        return after - before - chips(reveal, player)
    }

    /// ", won 2 chips", ", lost 1 chip", or nothing.
    static func chipsText(_ chips: Int) -> String {
        if chips == 0 { return "" }
        let count = abs(chips)
        return ", \(chips > 0 ? "won" : "lost") \(count) chip\(count == 1 ? "" : "s")"
    }
}
