import Foundation

/// Strict `session-v1` files (game-rules.md section 4): the deck file's JSON text rules, no nulls
/// or unknown members, at most 2 MiB, and valid only when the engine replays every action.
public enum SessionCodec {
    public static let maximumBytes = 2 * 1024 * 1024

    public static func decode(_ data: Data) throws -> GameSession {
        guard data.count <= maximumBytes else { throw DeckError("Session exceeds the 2 MiB limit.") }
        let json = try StrictJSON.validate(data)
        let session = try parse(JSONSerialization.jsonObject(with: json))
        _ = try GameEngine.replay(session)
        return session
    }

    /// Replays the session, then writes it with sorted keys and fully normalised options.
    public static func encode(_ session: GameSession) throws -> Data {
        try validateHeader(session)
        _ = try GameEngine.replay(session)
        let data = try JSONSerialization.data(withJSONObject: jsonObject(session), options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= maximumBytes else { throw DeckError("Session exceeds the 2 MiB limit.") }
        return data
    }

    // MARK: Structure

    /// Checks the structure and the schema's value rules without replaying. Option errors are
    /// `GameError`s at index −1 and malformed actions `GameError`s at their index; anything
    /// else is a `DeckError`.
    public static func parse(_ raw: Any) throws -> GameSession {
        let root = try object(raw, required: ["format", "sessionVersion", "id", "createdAt", "deckId", "deckTitle", "mode", "options", "seed", "players", "actions"],
                              optional: [], path: "session")
        guard try string(root, "format", "session").utf8.elementsEqual(GameSession.format.utf8) else { throw DeckError("format must be \(GameSession.format).") }
        let version = try integer(root, "sessionVersion", "session")
        guard GameSession.supportedVersions.contains(version) else { throw DeckError("Unsupported sessionVersion; expected 1 or 2.") }
        let modeName = try string(root, "mode", "session")
        guard let mode = GameMode(rawValue: modeName), mode.rawValue.utf8.elementsEqual(modeName.utf8) else { throw DeckError("Unknown mode: \(modeName).") }
        let seed = try integer(root, "seed", "session")
        guard (0...Int(UInt32.max)).contains(seed) else { throw DeckError("seed must be 0–4294967295.") }
        guard let rawPlayers = root["players"] as? [Any] else { throw DeckError("players must be an array.") }
        let players = try rawPlayers.enumerated().map { index, value in try player(value, path: "players[\(index)]") }
        guard let rawActions = root["actions"] as? [Any] else { throw DeckError("actions must be an array.") }
        guard rawActions.count <= 10_000 else { throw DeckError("actions exceeds 10000 actions.") }
        let options: GameOptions
        do {
            options = try parseOptions(mode, root["options"]!, version: version)
        } catch let error as DeckError {
            throw GameError(actionIndex: -1, message: error.message)
        }
        let actions = try rawActions.enumerated().map { index, value -> SessionAction in
            do {
                return try action(value, path: "actions[\(index)]")
            } catch let error as DeckError {
                throw GameError(actionIndex: index, message: error.message)
            }
        }
        let session = GameSession(id: try string(root, "id", "session"), createdAt: try string(root, "createdAt", "session"),
                                  deckId: try string(root, "deckId", "session"), deckTitle: try string(root, "deckTitle", "session"),
                                  options: options, seed: UInt32(seed), players: players, actions: actions, sessionVersion: version)
        try validateHeader(session)
        return session
    }

    /// The schema rules for everything but options and actions.
    static func validateHeader(_ session: GameSession) throws {
        guard GameSession.supportedVersions.contains(session.sessionVersion) else { throw DeckError("Unsupported sessionVersion; expected 1 or 2.") }
        guard DeckCodec.isIdentifier(session.id) else { throw DeckError("session.id must be a stable 1–64 character ID.") }
        guard DeckCodec.isIdentifier(session.deckId) else { throw DeckError("session.deckId must be a stable 1–64 character ID.") }
        guard isTimestamp(session.createdAt) else { throw DeckError("createdAt must be YYYY-MM-DDTHH:MM:SSZ.") }
        guard DeckCodec.isVisibleText(session.deckTitle, maximum: 500) else { throw DeckError("deckTitle must contain 1–500 characters, not only whitespace.") }
        guard (1...10).contains(session.players.count) else { throw DeckError("players must list 1–10 players.") }
        // Duplicate player IDs are a setup error (index −1), reported by the engine.
        for (index, player) in session.players.enumerated() {
            guard DeckCodec.isIdentifier(player.id, maximumLength: 32) else { throw DeckError("players[\(index)].id must be a 1–32 character ID.") }
            guard DeckCodec.isVisibleText(player.name, maximum: 40) else { throw DeckError("players[\(index)].name must contain 1–40 characters, not only whitespace.") }
            if let members = player.members {
                guard members.count <= 8, members.allSatisfy({ DeckCodec.isVisibleText($0, maximum: 40) }) else {
                    throw DeckError("players[\(index)].members must list 0–8 names of 1–40 characters.")
                }
            }
        }
        guard session.actions.count <= 10_000 else { throw DeckError("actions exceeds 10000 actions.") }
    }

    /// `YYYY-MM-DDTHH:MM:SSZ`, pattern only.
    static func isTimestamp(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        let shape = Array("dddd-dd-ddTdd:dd:ddZ".utf8)
        guard bytes.count == shape.count else { return false }
        return zip(bytes, shape).allSatisfy { byte, expected in
            expected == UInt8(ascii: "d") ? (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) : byte == expected
        }
    }

    private static func player(_ raw: Any, path: String) throws -> SessionPlayer {
        let values = try object(raw, required: ["id", "name"], optional: ["members"], path: path)
        var members: [String]?
        if let rawMembers = values["members"] {
            guard let list = rawMembers as? [Any] else { throw DeckError("\(path).members must be an array.") }
            members = try list.map { value in
                guard let name = value as? String else { throw DeckError("\(path).members must hold strings.") }
                return name
            }
        }
        return SessionPlayer(id: try string(values, "id", path), name: try string(values, "name", path), members: members)
    }

    // MARK: Options

    private static func parseOptions(_ mode: GameMode, _ raw: Any, version: Int) throws -> GameOptions {
        let path = "options"
        switch mode {
        case .bullseye:
            let values = try object(raw, required: [], optional: ["rounds", "stakes"], path: path)
            var options = BullseyeOptions()
            if values["rounds"] != nil { options.rounds = try integer(values, "rounds", path) }
            if values["stakes"] != nil { options.stakes = try bool(values, "stakes", path) }
            return .bullseye(options)
        case .eraSort:
            let values = try object(raw, required: [], optional: ["rounds", "kids"], path: path)
            var options = EraSortOptions()
            if values["rounds"] != nil { options.rounds = try integer(values, "rounds", path) }
            if values["kids"] != nil { options.kids = try bool(values, "kids", path) }
            return .eraSort(options)
        case .timeline:
            let values = try object(raw, required: [], optional: ["ownership", "anchor", "anchorYear", "target", "challenges", "tokens", "nameIt", "stakes", "clip"], path: path)
            var options = TimelineOptions()
            if values["ownership"] != nil { options.ownership = try choice(values, "ownership", path) }
            if values["anchor"] != nil { options.anchor = try choice(values, "anchor", path) }
            if values["anchorYear"] != nil { options.anchorYear = try integer(values, "anchorYear", path) }
            if values["target"] != nil { options.target = try integer(values, "target", path) }
            if values["challenges"] != nil { options.challenges = try bool(values, "challenges", path) }
            if values["tokens"] != nil { options.tokens = try integer(values, "tokens", path) }
            if values["nameIt"] != nil { options.nameIt = try bool(values, "nameIt", path) }
            if values["stakes"] != nil { options.stakes = try bool(values, "stakes", path) }
            if values["clip"] != nil { options.clip = try choice(values, "clip", path) }
            return .timeline(options)
        case .ladder:
            let values = try object(raw, required: [], optional: ["rounds", "steps", "guess", "clipStart", "stakes"], path: path)
            var options = LadderOptions()
            options.steps = LadderOptions.defaultSteps(version: version)
            if values["rounds"] != nil { options.rounds = try integer(values, "rounds", path) }
            if let steps = values["steps"] {
                guard let list = steps as? [Any] else { throw DeckError("options.steps must be an array.") }
                options.steps = try list.map { value in
                    guard let step = integerValue(value) else { throw DeckError("options.steps must hold integers.") }
                    return step
                }
            }
            if values["guess"] != nil { options.guess = try choice(values, "guess", path) }
            if values["clipStart"] != nil { options.clipStart = try choice(values, "clipStart", path) }
            if values["stakes"] != nil { options.stakes = try bool(values, "stakes", path) }
            return .ladder(options)
        case .higherLower:
            let values = try object(raw, required: [], optional: ["cards"], path: path)
            var options = HigherLowerOptions()
            if values["cards"] != nil { options.cards = try integer(values, "cards", path) }
            return .higherLower(options)
        case .relay:
            let values = try object(raw, required: [], optional: ["target", "lives", "anchor", "anchorYear", "nameIt"], path: path)
            var options = RelayOptions()
            if values["target"] != nil { options.target = try integer(values, "target", path) }
            if values["lives"] != nil { options.lives = try integer(values, "lives", path) }
            if values["anchor"] != nil { options.anchor = try choice(values, "anchor", path) }
            if values["anchorYear"] != nil { options.anchorYear = try integer(values, "anchorYear", path) }
            if values["nameIt"] != nil { options.nameIt = try bool(values, "nameIt", path) }
            return .relay(options)
        case .lineup:
            let values = try object(raw, required: [], optional: ["k", "rounds", "clipMs"], path: path)
            var options = LineupOptions()
            if values["k"] != nil { options.k = try integer(values, "k", path) }
            if values["rounds"] != nil { options.rounds = try integer(values, "rounds", path) }
            if values["clipMs"] != nil { options.clipMs = try integer(values, "clipMs", path) }
            return .lineup(options)
        case .daily:
            let values = try object(raw, required: ["date", "cards"], optional: [], path: path)
            guard let list = values["cards"] as? [Any] else { throw DeckError("options.cards must be an array.") }
            let cards = try list.map { value in
                guard let id = value as? String else { throw DeckError("options.cards must hold card IDs.") }
                return id
            }
            return .daily(DailyOptions(date: try string(values, "date", path), cards: cards))
        case .imposter:
            let values = try object(raw, required: [], optional: ["rounds"], path: path)
            var options = ImposterOptions()
            if values["rounds"] != nil { options.rounds = try integer(values, "rounds", path) }
            return .imposter(options)
        }
    }

    // MARK: Actions

    private static let actionMembers: [String: (required: Set<String>, optional: Set<String>)] = [
        "anchor": (["card"], ["playerId"]),
        "reference": (["card"], []),
        "draw": (["card"], []),
        "drawSet": (["cards"], []),
        "drawPair": (["a", "b", "original"], []),
        "sdDraw": (["cards"], []),
        "guess": (["playerId", "year"], []),
        "pickEra": (["playerId", "era"], []),
        "place": (["playerId", "slot"], []),
        "challenge": (["playerId", "slot"], []),
        "nameIt": (["playerId", "titleOK", "artistOK"], []),
        "wager": (["playerId", "chips"], []),
        "step": (["index"], []),
        "lock": (["playerId"], ["year"]),
        "mark": (["playerId", "titleOK", "artistOK"], []),
        "call": (["playerId", "call"], []),
        "order": (["playerId", "order"], []),
        "choose": (["playerId", "pick"], ["year"]),
        "sdGuess": (["playerId", "year"], []),
        "sdOrder": (["playerId", "order"], []),
        "sdName": ([], ["playerId"]),
        "reveal": ([], []),
        "clip": (["fromMs"], ["lengthMs"]),
        "skip": ([], []),
        "end": ([], []),
    ]

    private static func action(_ raw: Any, path: String) throws -> SessionAction {
        guard let given = StrictJSON.members(raw) else { throw DeckError("\(path) must be an object.") }
        guard let type = given.first(where: { $0.name.utf8.elementsEqual("type".utf8) })?.value as? String else { throw DeckError("\(path).type must be a string.") }
        guard let name = StrictJSON.exactName(type, in: actionMembers.keys), let members = actionMembers[name] else { throw DeckError("Unknown action type: \(type).") }
        let values = try object(raw, required: members.required.union(["type", "at"]), optional: members.optional, path: path)
        let at = try integer(values, "at", path)
        guard at >= 0 else { throw DeckError("\(path).at must be ≥ 0.") }
        func player() throws -> String { try string(values, "playerId", path) }
        func int(_ key: String) throws -> Int { try integer(values, key, path) }
        func optionalInt(_ key: String) throws -> Int? { values[key] == nil ? nil : try integer(values, key, path) }
        func card(_ key: String) throws -> CardRef { try cardRef(values[key]!, path: "\(path).\(key)") }
        func cards() throws -> [CardRef] {
            guard let list = values["cards"] as? [Any] else { throw DeckError("\(path).cards must be an array.") }
            return try list.enumerated().map { index, value in try cardRef(value, path: "\(path).cards[\(index)]") }
        }
        func order() throws -> [String] {
            guard let list = values["order"] as? [Any] else { throw DeckError("\(path).order must be an array.") }
            return try list.map { value in
                guard let id = value as? String else { throw DeckError("\(path).order must hold card IDs.") }
                return id
            }
        }
        let action: GameAction
        switch type {
        case "anchor": action = .anchor(playerId: values["playerId"] == nil ? nil : try player(), card: try card("card"))
        case "reference": action = .reference(card: try card("card"))
        case "draw": action = .draw(card: try card("card"))
        case "drawSet": action = .drawSet(cards: try cards())
        case "drawPair": action = .drawPair(a: try card("a"), b: try card("b"), original: try choice(values, "original", path))
        case "sdDraw": action = .sdDraw(cards: try cards())
        case "guess": action = .guess(playerId: try player(), year: try int("year"))
        case "pickEra": action = .pickEra(playerId: try player(), era: try string(values, "era", path))
        case "place": action = .place(playerId: try player(), slot: try int("slot"))
        case "challenge": action = .challenge(playerId: try player(), slot: try int("slot"))
        case "nameIt": action = .nameIt(playerId: try player(), titleOK: try bool(values, "titleOK", path), artistOK: try bool(values, "artistOK", path))
        case "wager": action = .wager(playerId: try player(), chips: try int("chips"))
        case "step": action = .step(index: try int("index"))
        case "lock": action = .lock(playerId: try player(), year: try optionalInt("year"))
        case "mark": action = .mark(playerId: try player(), titleOK: try bool(values, "titleOK", path), artistOK: try bool(values, "artistOK", path))
        case "call": action = .call(playerId: try player(), call: try choice(values, "call", path))
        case "order": action = .order(playerId: try player(), order: try order())
        case "choose": action = .choose(playerId: try player(), pick: try choice(values, "pick", path), year: try optionalInt("year"))
        case "sdGuess": action = .sdGuess(playerId: try player(), year: try int("year"))
        case "sdOrder": action = .sdOrder(playerId: try player(), order: try order())
        case "sdName": action = .sdName(playerId: values["playerId"] == nil ? nil : try player())
        case "reveal": action = .reveal
        case "clip": action = .clip(fromMs: try int("fromMs"), lengthMs: try optionalInt("lengthMs"))
        case "skip": action = .skip
        default: action = .end
        }
        return SessionAction(at: at, action)
    }

    private static func cardRef(_ raw: Any, path: String) throws -> CardRef {
        let values = try object(raw, required: ["cardId", "year", "era"], optional: [], path: path)
        return CardRef(cardId: try string(values, "cardId", path), year: try integer(values, "year", path), era: try string(values, "era", path))
    }

    // MARK: Encoding

    static func jsonObject(_ session: GameSession) -> [String: Any] {
        [
            "format": GameSession.format,
            "sessionVersion": session.sessionVersion,
            "id": session.id,
            "createdAt": session.createdAt,
            "deckId": session.deckId,
            "deckTitle": session.deckTitle,
            "mode": session.mode.rawValue,
            "options": optionsObject(session.options),
            "seed": Int(session.seed),
            "players": session.players.map { player -> [String: Any] in
                var object: [String: Any] = ["id": player.id, "name": player.name]
                if let members = player.members { object["members"] = members }
                return object
            },
            "actions": session.actions.map(actionObject),
        ]
    }

    static func optionsObject(_ options: GameOptions) -> [String: Any] {
        switch options {
        case let .bullseye(o): return ["rounds": o.rounds, "stakes": o.stakes]
        case let .eraSort(o): return ["rounds": o.rounds, "kids": o.kids]
        case let .timeline(o):
            var object: [String: Any] = ["ownership": o.ownership.rawValue, "anchor": o.anchor.rawValue, "target": o.target, "challenges": o.challenges,
                                         "tokens": o.tokens, "nameIt": o.nameIt, "stakes": o.stakes, "clip": o.clip.rawValue]
            if let year = o.anchorYear { object["anchorYear"] = year }
            return object
        case let .ladder(o): return ["rounds": o.rounds, "steps": o.steps, "guess": o.guess.rawValue, "clipStart": o.clipStart.rawValue, "stakes": o.stakes]
        case let .higherLower(o): return ["cards": o.cards]
        case let .relay(o):
            var object: [String: Any] = ["target": o.target, "lives": o.lives, "anchor": o.anchor.rawValue, "nameIt": o.nameIt]
            if let year = o.anchorYear { object["anchorYear"] = year }
            return object
        case let .lineup(o): return ["k": o.k, "rounds": o.rounds, "clipMs": o.clipMs]
        case let .daily(o): return ["date": o.date, "cards": o.cards]
        case let .imposter(o): return ["rounds": o.rounds]
        }
    }

    static func actionObject(_ timed: SessionAction) -> [String: Any] {
        func ref(_ card: CardRef) -> [String: Any] { ["cardId": card.cardId, "year": card.year, "era": card.era] }
        var object: [String: Any] = ["type": timed.action.type, "at": timed.at]
        switch timed.action {
        case let .anchor(playerId, card):
            object["card"] = ref(card)
            if let playerId { object["playerId"] = playerId }
        case let .reference(card), let .draw(card): object["card"] = ref(card)
        case let .drawSet(cards), let .sdDraw(cards): object["cards"] = cards.map(ref)
        case let .drawPair(a, b, original):
            object["a"] = ref(a)
            object["b"] = ref(b)
            object["original"] = original.rawValue
        case let .guess(playerId, year), let .sdGuess(playerId, year):
            object["playerId"] = playerId
            object["year"] = year
        case let .pickEra(playerId, era):
            object["playerId"] = playerId
            object["era"] = era
        case let .place(playerId, slot), let .challenge(playerId, slot):
            object["playerId"] = playerId
            object["slot"] = slot
        case let .nameIt(playerId, titleOK, artistOK), let .mark(playerId, titleOK, artistOK):
            object["playerId"] = playerId
            object["titleOK"] = titleOK
            object["artistOK"] = artistOK
        case let .wager(playerId, chips):
            object["playerId"] = playerId
            object["chips"] = chips
        case let .step(index): object["index"] = index
        case let .lock(playerId, year):
            object["playerId"] = playerId
            if let year { object["year"] = year }
        case let .call(playerId, call):
            object["playerId"] = playerId
            object["call"] = call.rawValue
        case let .order(playerId, order), let .sdOrder(playerId, order):
            object["playerId"] = playerId
            object["order"] = order
        case let .choose(playerId, pick, year):
            object["playerId"] = playerId
            object["pick"] = pick.rawValue
            if let year { object["year"] = year }
        case let .sdName(playerId):
            if let playerId { object["playerId"] = playerId }
        case let .clip(fromMs, lengthMs):
            object["fromMs"] = fromMs
            if let lengthMs { object["lengthMs"] = lengthMs }
        case .reveal, .skip, .end: break
        }
        return object
    }

    // MARK: Value helpers

    /// An object with exactly the allowed members, the required ones present, and no nulls.
    /// Member names must match exactly (code points, not canonical equivalence); the result is
    /// keyed by the allowed spelling, so later lookups by name are exact too.
    private static func object(_ raw: Any, required: Set<String>, optional: Set<String>, path: String) throws -> [String: Any] {
        guard let members = StrictJSON.members(raw) else { throw DeckError("\(path) must be an object.") }
        var values = [String: Any]()
        for (key, value) in members {
            guard let name = StrictJSON.exactName(key, in: required.union(optional)) else { throw DeckError("Unknown field: \(path).\(key).") }
            guard !(value is NSNull) else { throw DeckError("Null is not allowed: \(path).\(key).") }
            values[name] = value
        }
        for key in required where values[key] == nil { throw DeckError("\(path).\(key) is required.") }
        return values
    }

    private static func string(_ values: [String: Any], _ key: String, _ path: String) throws -> String {
        guard let value = values[key] as? String else { throw DeckError("\(path).\(key) must be a string.") }
        return value
    }

    /// JSON integers, including integral spellings such as `1.0`; never booleans.
    static func integerValue(_ raw: Any) -> Int? {
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let value = number.doubleValue
        guard value.isFinite, value == value.rounded(), abs(value) <= 9_007_199_254_740_991 else { return nil }
        return Int(exactly: value)
    }

    private static func integer(_ values: [String: Any], _ key: String, _ path: String) throws -> Int {
        guard let raw = values[key], let value = integerValue(raw) else { throw DeckError("\(path).\(key) must be an integer.") }
        return value
    }

    private static func bool(_ values: [String: Any], _ key: String, _ path: String) throws -> Bool {
        guard let number = values[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw DeckError("\(path).\(key) must be a boolean.") }
        return number.boolValue
    }

    private static func choice<Value: RawRepresentable>(_ values: [String: Any], _ key: String, _ path: String) throws -> Value where Value.RawValue == String {
        let raw = try string(values, key, path)
        guard let value = Value(rawValue: raw), value.rawValue.utf8.elementsEqual(raw.utf8) else { throw DeckError("\(path).\(key) has an unknown value: \(raw).") }
        return value
    }
}
