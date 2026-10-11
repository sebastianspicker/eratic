import Foundation

/// The contract's explicit URL rules, written without `URL` or `URLComponents`
/// so that every platform and OS release accepts exactly the same inputs.
public enum CardURLPolicy {
    private static let hostExcluded: Set<Unicode.Scalar> = ["[", "]", "<", ">", "^", "|", "%", "\"", "`", "{", "}", "@", ":"]

    public static func isSafeHTTPS(_ value: String) -> Bool {
        let scalars = value.unicodeScalars
        // Compare scalars, not Characters: a combining mark must not hide the prefix.
        guard scalars.count <= 2048, scalars.starts(with: "https://".unicodeScalars), !scalars.contains("\\") else { return false }
        for scalar in scalars {
            switch scalar.properties.generalCategory {
            case .control, .format, .spaceSeparator, .lineSeparator, .paragraphSeparator: return false
            default: break
            }
        }
        return isValidAuthority(authority(of: value))
    }

    public static func isOfficialCardURL(_ value: String) -> Bool {
        guard isSafeHTTPS(value), !value.unicodeScalars.contains("?"), !value.unicodeScalars.contains("#") else { return false }
        let host = authority(of: value)
        guard !host.contains(":") else { return false }
        let path = String(String.UnicodeScalarView(value.unicodeScalars.dropFirst(8 + host.count)))
        // Strict subset of shipped card formats; preserve original spelling.
        // SongSeeker inspired the mapping boundary; no source code copied.
        switch String(String.UnicodeScalarView(host)).lowercased() {
        case "hitstergame.com", "www.hitstergame.com":
            return matches(path, "^/[A-Za-z]{2}/(?:[A-Za-z]{4}[0-9]{4}/)?[0-9]{5}$")
        case "uqr.to": return matches(path, "^/[A-Za-z0-9]{1,5}$")
        case "app.hitsternordics.com": return matches(path, "^/resources/songs/[0-9]{1,5}$")
        default: return false
        }
    }

    /// The scalars after `https://` up to the first `/`, `?` or `#`.
    private static func authority(of value: String) -> [Unicode.Scalar] {
        Array(value.unicodeScalars.dropFirst(8).prefix { $0 != "/" && $0 != "?" && $0 != "#" })
    }

    private static func isValidAuthority(_ authority: [Unicode.Scalar]) -> Bool {
        let host = authority.prefix { $0 != ":" }
        guard !host.isEmpty, !host.contains(where: { hostExcluded.contains($0) }) else { return false }
        let rest = authority.dropFirst(host.count)
        if rest.isEmpty { return true }
        guard rest.first == ":" else { return false }
        return isDefaultPort(rest.dropFirst())
    }

    /// An empty port, or ASCII digits whose numeric value is 443 (`0443` counts; long digit strings cannot overflow).
    private static func isDefaultPort(_ port: ArraySlice<Unicode.Scalar>) -> Bool {
        guard port.allSatisfy({ ("0"..."9").contains($0) }) else { return false }
        return port.isEmpty || Array(port.drop { $0 == "0" }) == ["4", "4", "3"]
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }
}

public enum QRMode: String, CaseIterable, Identifiable, Sendable {
    case official, directLink, eraticCard
    public var id: Self { self }
}

/// The per-build configuration of the Eratic card route: the host and the deck's ID.
public struct EraticCardRoute: Equatable, Sendable {
    public var host: String
    public var deckId: String
    public init(host: String, deckId: String) {
        self.host = host
        self.deckId = deckId
    }
}

public enum QRRoute {
    /// Supplied mappings are preserved, never fabricated or certified.
    /// `eraticCard` needs a configured route and yields nothing without one.
    public static func payload(for card: SongCard, mode: QRMode = .official, linkIndex: Int = 0, eratic: EraticCardRoute? = nil) -> String? {
        switch mode {
        case .official:
            guard let url = card.officialCard?.url, CardURLPolicy.isOfficialCardURL(url) else { return nil }
            return url
        case .directLink:
            guard card.links.indices.contains(linkIndex), CardURLPolicy.isSafeHTTPS(card.links[linkIndex].url) else { return nil }
            return card.links[linkIndex].url
        case .eraticCard:
            guard let eratic else { return nil }
            return ScanRules.eraticCardURL(host: eratic.host, deckId: eratic.deckId, cardId: card.id)
        }
    }
}
