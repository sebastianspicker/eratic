import Foundation

// The mode rules of game-rules.md section 6: draws, inputs and reveals.
extension GameState {
    private func requireMode(_ modes: GameMode..., action: String) throws {
        try require(modes.contains(mode), "\(action) is not part of \(mode.rawValue).")
    }

    private func requireOpen(_ action: String) throws {
        try require(phase == .open, "\(action) needs a card in play.")
    }

    private func requireYear(_ year: Int) throws {
        try require((1850...2100).contains(year), "year must be 1850–2100.")
    }

    /// The Daily round being played, from 1.
    private var dailyRound: Int { round + 1 }

    /// The timeline a placement goes into: the active player's (personal) or the shared line.
    private var placementYears: [Int] {
        if case let .timeline(timeline) = options, timeline.ownership == .personal {
            return timelines[activePlayer]!.map(\.year)
        }
        return line.map(\.year)
    }

    mutating func handleModeAction(_ action: GameAction) throws {
        switch action {
        case let .anchor(playerId, card):
            try requireMode(.timeline, .relay, action: "anchor")
            try require(phase == .setup, "anchor is only allowed in setup.")
            if case let .timeline(timeline) = options, timeline.ownership == .personal {
                let next = playerIDs[anchorsPlaced]
                if let playerId { try checkPlayer(playerId) }
                try require(playerId.map { $0.utf8.elementsEqual(next.utf8) } ?? false, "The next anchor belongs to \(next).")
                try enter([card])
                timelines[playerIDs[anchorsPlaced]] = [card]
                anchorsPlaced += 1
                if anchorsPlaced == players.count { phase = .awaitingDraw }
            } else {
                try require(playerId == nil, "A shared anchor has no playerId.")
                try enter([card])
                line = [card]
                phase = .awaitingDraw
            }

        case let .reference(card):
            try requireMode(.higherLower, action: "reference")
            try require(phase == .setup, "reference is only allowed in setup.")
            try enter([card])
            reference = card
            phase = .awaitingDraw

        case let .draw(card):
            try requireMode(.bullseye, .eraSort, .timeline, .ladder, .higherLower, .relay, .daily, action: "draw")
            try require(phase == .awaitingDraw, "draw is not allowed now.")
            if case let .daily(daily) = options {
                try require(round < daily.cards.count && card.cardId.utf8.elementsEqual(daily.cards[round].utf8), "Daily round \(dailyRound) must draw its selected card.")
            }
            try enter([card])
            self.card = card
            step = -1
            phase = .open

        case let .drawSet(cards):
            guard case let .lineup(lineup) = options else { throw Rejection("drawSet is not part of \(mode.rawValue).") }
            try require(phase == .awaitingDraw, "drawSet is not allowed now.")
            try require(cards.count == lineup.k, "drawSet needs exactly \(lineup.k) cards.")
            try enter(cards)
            cardSet = cards
            phase = .open

        case let .drawPair(a, b, original):
            try requireMode(.imposter, action: "drawPair")
            try require(phase == .awaitingDraw, "drawPair is not allowed now.")
            try checkCard(a)
            try checkCard(b)
            try require(!a.cardId.utf8.elementsEqual(b.cardId.utf8), "A pair needs two different cards.")
            // The same two cards in either order; a skipped pair stays used.
            let key = [Array(a.cardId.utf8), Array(b.cardId.utf8)].sorted { $0.lexicographicallyPrecedes($1) }
            try require(usedPairs.insert(key).inserted, "These two cards were already paired.")
            pair = DrawnPair(a: a, b: b, original: original)
            phase = .open

        case let .guess(playerId, year):
            try requireMode(.bullseye, .daily, action: "guess")
            try requireOpen("guess")
            if mode == .daily { try require(dailyRound > 3, "Daily rounds 1–3 take pickEra.") }
            try checkPlayer(playerId)
            try require(inputs.guesses[playerId] == nil, "One guess per player.")
            try requireYear(year)
            inputs.guesses[playerId] = year

        case let .pickEra(playerId, era):
            try requireMode(.eraSort, .daily, action: "pickEra")
            try requireOpen("pickEra")
            if mode == .daily { try require(dailyRound <= 3, "Daily rounds after 3 take guess.") }
            try checkPlayer(playerId)
            try require(inputs.eras[playerId] == nil, "One pickEra per player.")
            try require(EraBoundaries.eraIndex(era) != nil, "Unknown era: \(era).")
            inputs.eras[playerId] = era

        case let .place(playerId, slot):
            try requireMode(.timeline, .relay, action: "place")
            try requireOpen("place")
            try checkPlayer(playerId)
            try require(playerId == activePlayer, "Only the active player places.")
            try require(inputs.placement == nil, "One place per turn.")
            try require((0...placementYears.count).contains(slot), "slot must be 0–\(placementYears.count).")
            inputs.placement = slot

        case let .challenge(playerId, slot):
            guard case let .timeline(timeline) = options else { throw Rejection("challenge is not part of \(mode.rawValue).") }
            try require(timeline.challenges, "Challenges are off.")
            try requireOpen("challenge")
            try checkPlayer(playerId)
            try require(inputs.placement != nil, "challenge follows place.")
            try require(playerId != activePlayer, "The active player can't challenge.")
            try require(stat("tokens", playerId) >= 1, "\(playerId) holds no token.")
            try require(!inputs.challenges.contains { $0.player == playerId }, "One challenge per player per turn.")
            try require((0...placementYears.count).contains(slot), "slot must be 0–\(placementYears.count).")
            try require(slot != inputs.placement && !inputs.challenges.contains { $0.slot == slot }, "The slot is already taken this turn.")
            bump("tokens", playerId, by: -1)
            inputs.challenges.append(Challenge(player: playerId, slot: slot))

        case let .nameIt(playerId, titleOK, artistOK):
            let enabled: Bool
            switch options {
            case let .timeline(timeline): enabled = timeline.nameIt
            case let .relay(relay): enabled = relay.nameIt
            default: throw Rejection("nameIt is not part of \(mode.rawValue).")
            }
            try require(enabled, "Name It is off.")
            try requireOpen("nameIt")
            try checkPlayer(playerId)
            try require(playerId == activePlayer, "Only the active player names the song.")
            try require(inputs.placement != nil, "nameIt follows place.")
            try require(inputs.nameIt == nil, "One nameIt per turn.")
            inputs.nameIt = Marks(titleOK: titleOK, artistOK: artistOK)

        case let .step(index):
            guard case let .ladder(ladder) = options else { throw Rejection("step is not part of \(mode.rawValue).") }
            try requireOpen("step")
            try require((step >= 0 && index == step) || index == step + 1, "step must replay the current step or play the next.")
            try require(index < ladder.steps.count, "There is no step \(index).")
            step = index

        case let .lock(playerId, year):
            guard case let .ladder(ladder) = options else { throw Rejection("lock is not part of \(mode.rawValue).") }
            try requireOpen("lock")
            try require(step >= 0, "lock follows the first step.")
            try checkPlayer(playerId)
            try require(inputs.locks[playerId] == nil, "One lock per player.")
            if ladder.guess == .name {
                try require(year == nil, "year is not allowed in name mode.")
            } else {
                guard let year else { throw Rejection("lock needs a year in \(ladder.guess.rawValue) mode.") }
                try requireYear(year)
            }
            inputs.locks[playerId] = LadderLock(step: step, year: year)

        case let .mark(playerId, titleOK, artistOK):
            guard case let .ladder(ladder) = options else { throw Rejection("mark is not part of \(mode.rawValue).") }
            try require(ladder.guess != .year, "Year mode has no marks.")
            try requireOpen("mark")
            try checkPlayer(playerId)
            try require(inputs.locks[playerId] != nil, "Only locked players are marked.")
            try require(inputs.marks[playerId] == nil, "One mark per player.")
            inputs.marks[playerId] = Marks(titleOK: titleOK, artistOK: artistOK)

        case let .call(playerId, call):
            try requireMode(.higherLower, action: "call")
            try requireOpen("call")
            try checkPlayer(playerId)
            try require(playerId == activePlayer, "Only the active player calls.")
            try require(inputs.call == nil, "One call per turn.")
            inputs.call = call

        case let .order(playerId, order):
            try requireMode(.lineup, action: "order")
            try requireOpen("order")
            try checkPlayer(playerId)
            try require(inputs.orders[playerId] == nil, "One order per player.")
            try requirePermutation(order, of: cardSet)
            inputs.orders[playerId] = order

        case let .choose(playerId, pick, year):
            try requireMode(.imposter, action: "choose")
            try requireOpen("choose")
            try checkPlayer(playerId)
            try require(inputs.choices[playerId] == nil, "One choose per player.")
            if let year { try requireYear(year) }
            inputs.choices[playerId] = ImposterChoice(pick: pick, year: year)

        default:
            throw Rejection("\(action.type) is not allowed now.")
        }
    }

    /// `reveal` in `open`: scores the card in play, counts the round and checks the end condition.
    mutating func reveal() throws {
        let everyone = playerIDs
        switch options {
        case let .bullseye(bullseye):
            try require(everyone.allSatisfy { inputs.guesses[$0] != nil }, "reveal needs every guess.")
            try requireWagers()
            let year = card!.year
            for player in everyone {
                let distance = Scoring.distance(inputs.guesses[player]!, year)
                points[player, default: 0] += Scoring.bullseyePoints(guess: inputs.guesses[player]!, answer: year)
                if distance == 0 { bump("exact", player) }
                bump("distance", player, by: distance)
                settleWager(player, right: distance <= 3)
            }
            finishRound(endsGame: round + 1 == bullseye.rounds)

        case let .eraSort(eraSort):
            try require(everyone.allSatisfy { inputs.eras[$0] != nil }, "reveal needs every pickEra.")
            for player in everyone {
                let earned = try Scoring.eraSortPoints(guessEra: inputs.eras[player]!, answerYear: card!.year, kids: eraSort.kids)
                points[player, default: 0] += earned
                if earned == 3 { bump("rightEras", player) }
            }
            finishRound(endsGame: round + 1 == eraSort.rounds)

        case let .timeline(timeline):
            guard let slot = inputs.placement else { throw Rejection("reveal needs a placement.") }
            try requireWagers()
            let active = activePlayer
            let drawn = card!
            let years = placementYears
            let correct = try Scoring.placementCorrect(years: years, slot: slot, year: drawn.year)
            if correct {
                if timeline.ownership == .personal { timelines[active]!.insert(drawn, at: slot) } else { line.insert(drawn, at: slot); bump("added", active) }
            } else if let winner = try inputs.challenges.first(where: { try Scoring.placementCorrect(years: years, slot: $0.slot, year: drawn.year) }) {
                if timeline.ownership == .personal {
                    let own = timelines[winner.player]!
                    timelines[winner.player]!.insert(drawn, at: Scoring.insertionIndex(years: own.map(\.year), year: drawn.year))
                } else {
                    line.insert(drawn, at: winner.slot)
                    bump("added", winner.player)
                }
            } else {
                bump("wrong", active)
            }
            settleWager(active, right: correct)
            if let marks = inputs.nameIt, Scoring.nameItAward(titleOK: marks.titleOK, artistOK: marks.artistOK) {
                stats["tokens", default: [:]][active] = min(5, stat("tokens", active) + 1)
            }
            let reached = timeline.ownership == .personal ? timelines.values.contains { $0.count >= timeline.target } : line.count >= timeline.target
            let lastInTurnOrder = activeIndex == players.count - 1
            activeIndex = (activeIndex + 1) % players.count
            finishRound(endsGame: reached && lastInTurnOrder)

        case let .ladder(ladder):
            try require(step >= 0, "reveal needs a step played.")
            let last = ladder.steps.count - 1
            try require(everyone.allSatisfy { inputs.locks[$0] != nil } || step == last, "reveal needs every lock or the last step.")
            if ladder.guess != .year {
                try require(inputs.locks.keys.allSatisfy { inputs.marks[$0] != nil }, "reveal needs a mark for every locked player.")
            }
            try requireWagers()
            let year = card!.year
            for player in everyone {
                var earned = 0
                if let lock = inputs.locks[player] {
                    let marks = inputs.marks[player]
                    switch ladder.guess {
                    case .name:
                        earned = try Scoring.ladderPoints(stepIndex: lock.step, titleOK: marks!.titleOK, artistOK: marks!.artistOK)
                    case .year:
                        earned = Scoring.ladderYearPoints(guess: lock.year!, answer: year)
                    case .both:
                        earned = try Scoring.ladderPoints(stepIndex: lock.step, titleOK: marks!.titleOK, artistOK: marks!.artistOK)
                            + Scoring.ladderYearBonus(guess: lock.year!, answer: year)
                    }
                    if ladder.guess != .name, lock.year == year { bump("exactYears", player) }
                    bump("usedMs", player, by: ladder.steps[lock.step])
                } else {
                    bump("usedMs", player, by: ladder.steps[last])
                }
                points[player, default: 0] += earned
                settleWager(player, right: earned > 0)
            }
            finishRound(endsGame: round + 1 == ladder.rounds)

        case let .higherLower(higherLower):
            guard let call = inputs.call else { throw Rejection("reveal needs a call.") }
            let active = activePlayer
            let drawn = card!
            let correct = Scoring.higherLowerCorrect(refYear: reference!.year, year: drawn.year, call: call)
            let solo = players.count == 1
            if correct { bump("streaks", active) } else if !solo { eliminated.append(active) }
            reference = drawn
            if !solo {
                // The turn passes to the next player still in.
                for offset in 1...players.count {
                    let index = (activeIndex + offset) % players.count
                    if !eliminated.contains(playerIDs[index]) { activeIndex = index; break }
                }
            }
            let ends = solo ? !correct : players.count - eliminated.count <= 1 || round + 1 >= higherLower.cards
            finishRound(endsGame: ends)

        case let .relay(relay):
            guard let slot = inputs.placement else { throw Rejection("reveal needs a placement.") }
            if let marks = inputs.nameIt, Scoring.nameItAward(titleOK: marks.titleOK, artistOK: marks.artistOK) {
                lives = min(lives + 1, relay.lives)
            }
            let drawn = card!
            if try Scoring.placementCorrect(years: line.map(\.year), slot: slot, year: drawn.year) {
                line.insert(drawn, at: slot)
            } else {
                lives -= 1
            }
            activeIndex = (activeIndex + 1) % players.count
            if lives <= 0 {
                outcome = "lost"
            } else if line.count >= relay.target {
                outcome = "won"
            }
            finishRound(endsGame: outcome != "playing")

        case let .lineup(lineup):
            try require(everyone.allSatisfy { inputs.orders[$0] != nil }, "reveal needs every order.")
            let years = Dictionary(uniqueKeysWithValues: cardSet.map { ($0.cardId, $0.year) })
            for player in everyone {
                let earned = try Scoring.lineupPoints(order: inputs.orders[player]!, years: years)
                points[player, default: 0] += earned
                if earned == Scoring.lineupPairs(lineup.k) + 2 { bump("perfect", player) }
            }
            finishRound(endsGame: round + 1 == lineup.rounds)

        case let .daily(daily):
            let player = everyone[0]
            let drawn = card!
            if dailyRound <= 3 {
                guard let era = inputs.eras[player] else { throw Rejection("reveal needs a pickEra.") }
                points[player, default: 0] += try Scoring.eraSortPoints(guessEra: era, answerYear: drawn.year, kids: false)
            } else {
                guard let guess = inputs.guesses[player] else { throw Rejection("reveal needs a guess.") }
                points[player, default: 0] += Scoring.bullseyePoints(guess: guess, answer: drawn.year)
            }
            dailyEras.append(drawn.era)
            finishRound(endsGame: round + 1 == daily.cards.count)

        case let .imposter(imposter):
            try require(everyone.allSatisfy { inputs.choices[$0] != nil }, "reveal needs every choose.")
            let original = pair!.originalCard
            for player in everyone {
                let choice = inputs.choices[player]!
                points[player, default: 0] += Scoring.imposterPoints(pickedOriginal: choice.pick == pair!.original, yearGuess: choice.year, originalYear: original.year)
                if let year = choice.year, Scoring.distance(year, original.year) <= 2 { bump("bonuses", player) }
            }
            finishRound(endsGame: round + 1 == imposter.rounds)
        }
    }

    /// Counts the reveal, clears the card in play and runs the end evaluation when the mode's end is met.
    private mutating func finishRound(endsGame: Bool) {
        round += 1
        clearCard()
        if endsGame { endEvaluation() }
    }
}
