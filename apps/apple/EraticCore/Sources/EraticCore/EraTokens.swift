import Foundation

/// Era design tokens from `design/eras.json`, the file the web app reads too, joined by ID
/// with the contract's names and year bounds (`EraBoundaries`), which the token file no longer holds.
/// Presentation only: a card's curated year picks its era; deck data never changes.
/// SwiftUI colours and fonts are mapped in the app target.
public struct Era: Decodable, Equatable, Sendable, Identifiable {
    public struct TypeMove: Decodable, Equatable, Sendable {
        public let width: Double
        public let weight: Int
        public let `case`: String
        public let tracking: Double
        public let tilt: Double
        public let glow: Bool
    }

    public let id: String
    public let name: String
    public let label: String
    public let from: Int?
    public let to: Int?
    public let ground: String
    public let ink: String
    public let accent: String
    public let onAccent: String
    public let glow: String
    public let type: TypeMove

    private enum CodingKeys: String, CodingKey {
        case id, label, ground, ink, accent, onAccent, glow, type
    }

    /// Decodes one token entry and takes its name and bounds from the contract era with the same ID.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        guard let boundary = EraBoundaries.all.first(where: { $0.id.utf8.elementsEqual(id.utf8) }) else { throw EraTokenError("Era \(id) is not a contract era.") }
        self.id = id
        name = boundary.name
        from = boundary.from
        to = boundary.to
        label = try container.decode(String.self, forKey: .label)
        ground = try container.decode(String.self, forKey: .ground)
        ink = try container.decode(String.self, forKey: .ink)
        accent = try container.decode(String.self, forKey: .accent)
        onAccent = try container.decode(String.self, forKey: .onAccent)
        glow = try container.decode(String.self, forKey: .glow)
        type = try container.decode(TypeMove.self, forKey: .type)
    }

    private struct TokenFile: Decodable { let eras: [Era] }

    /// Decodes the token file and checks what the apps rely on: the contract's era IDs in the
    /// contract's order, `#RRGGBB` colours and the font's axis ranges.
    public static func decodeAll(from data: Data) throws -> [Era] {
        let eras = try JSONDecoder().decode(TokenFile.self, from: data).eras
        guard eras.map(\.id) == EraBoundaries.all.map(\.id) else {
            throw EraTokenError("The token file must list the contract eras \(EraBoundaries.all.map(\.id).joined(separator: ", ")) in order.")
        }
        for era in eras {
            for colour in [era.ground, era.ink, era.accent, era.onAccent, era.glow] where !isHexColour(colour) {
                throw EraTokenError("Era \(era.id) has an invalid colour \(colour).")
            }
            guard (75...100).contains(era.type.width), (300...800).contains(era.type.weight),
                  ["upper", "lower", "none"].contains(era.type.case) else {
                throw EraTokenError("Era \(era.id) has an invalid type move.")
            }
        }
        return eras
    }

    /// The era whose inclusive range contains `year`, if any.
    public static func era(for year: Int, in eras: [Era]) -> Era? {
        eras.first { era in
            (era.from.map { year >= $0 } ?? true) && (era.to.map { year <= $0 } ?? true)
        }
    }

    static func isHexColour(_ value: String) -> Bool {
        value.count == 7 && value.hasPrefix("#") && value.dropFirst().allSatisfy(\.isHexDigit)
    }
}

public struct EraTokenError: Error, LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}
