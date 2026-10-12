import Foundation

/// A proposed `relatedTo` link for the host to review (game-rules.md section 8.3); never a curated fact.
public struct RelationSuggestion: Equatable, Sendable {
    public var cardId: String
    public var relatedTo: String
    public var relation: Relation

    public init(cardId: String, relatedTo: String, relation: Relation) {
        self.cardId = cardId
        self.relatedTo = relatedTo
        self.relation = relation
    }
}

/// Linked-recording suggestions of section 8.3.
public enum RelationSuggestions {
    /// Words that mark a trailing group or ` - …` part as a version note.
    static let versionWords: Set<String> = ["remaster", "remastered", "live", "version", "edit", "mix", "remix", "mono", "stereo",
                                            "demo", "acoustic", "single", "radio", "feat", "ft"]

    /// Lowercase, NFD without combining marks, version suffixes stripped repeatedly, and runs of
    /// characters other than letters and digits collapsed to one space.
    public static func songKey(_ text: String) -> String {
        // Each code point lowercased on its own (no context, so Σ is always σ), then NFD without combining marks.
        let lowered = text.unicodeScalars.map { String($0).lowercased() }.joined()
        let folded = String(String.UnicodeScalarView(lowered.decomposedStringWithCanonicalMapping.unicodeScalars.filter { !isMark($0) }))
        var scalars = Array(folded.unicodeScalars)
        while let stripped = strippingVersionSuffix(scalars) { scalars = stripped }
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in scalars {
            if isLetterOrDigit(scalar) {
                if pendingSpace, !out.isEmpty { out.append(" ") }
                pendingSpace = false
                out.append(scalar)
            } else {
                pendingSpace = true
            }
        }
        return String(out)
    }

    /// Suggestions sorted by original ID, then card ID, in code-point order.
    public static func suggestRelations(_ cards: [SongCard]) -> [RelationSuggestion] {
        // Every card with a non-empty title key is grouped; a linked card can be a group's original but is never suggested.
        var groups = [[UInt8]: [SongCard]]()
        var order = [[UInt8]]()
        for card in cards {
            let key = Array(songKey(card.title).utf8)
            guard !key.isEmpty else { continue }
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(card)
        }
        var suggestions = [RelationSuggestion]()
        for key in order {
            let group = groups[key]!
            guard group.count > 1 else { continue }
            let original = group.min { lhs, rhs in
                lhs.gameYear.value != rhs.gameYear.value ? lhs.gameYear.value < rhs.gameYear.value : GameRandom.codePointPrecedes(lhs.id, rhs.id)
            }!
            let originalArtist = Array(songKey(original.artist).utf8)
            for card in group where card.relatedTo == nil && !card.id.utf8.elementsEqual(original.id.utf8) {
                let sameArtist = Array(songKey(card.artist).utf8) == originalArtist
                suggestions.append(RelationSuggestion(cardId: card.id, relatedTo: original.id, relation: sameArtist ? .remasterOf : .coverOf))
            }
        }
        return suggestions.sorted { lhs, rhs in
            lhs.relatedTo.utf8.elementsEqual(rhs.relatedTo.utf8)
                ? GameRandom.codePointPrecedes(lhs.cardId, rhs.cardId)
                : GameRandom.codePointPrecedes(lhs.relatedTo, rhs.relatedTo)
        }
    }

    private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func isLetterOrDigit(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: return true
        default: return false
        }
    }

    /// One stripping step of section 8.3: after trailing U+0020 spaces, a trailing `( … )` / `[ … ]` group that names a
    /// version, else the part after the last ` - ` when it names one; nil when neither does.
    private static func strippingVersionSuffix(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar]? {
        var end = scalars.count
        while end > 0, scalars[end - 1] == " " { end -= 1 }
        guard end > 0 else { return nil }
        let text = scalars[..<end]
        let last = text[end - 1]
        if last == ")" || last == "]" {
            let open: Unicode.Scalar = last == ")" ? "(" : "["
            if let start = text[..<(end - 1)].lastIndex(of: open), namesVersion(text[start..<end]) {
                return Array(text[..<start])
            }
        }
        let dash: [Unicode.Scalar] = [" ", "-", " "]
        var index = end - dash.count
        while index >= 0 {
            if Array(text[index..<(index + dash.count)]) == dash {
                return namesVersion(text[(index + dash.count)..<end]) ? Array(text[..<index]) : nil
            }
            index -= 1
        }
        return nil
    }

    /// Whether the part contains a version word as a whole word of ASCII letters.
    private static func namesVersion(_ part: ArraySlice<Unicode.Scalar>) -> Bool {
        var word = ""
        for scalar in part + [" "] {
            if ("a"..."z").contains(scalar) {
                word.unicodeScalars.append(scalar)
            } else {
                if versionWords.contains(word) { return true }
                word = ""
            }
        }
        return false
    }
}
