import Foundation

/// One of the contract's nine eras (`contract/eras.json`, game-rules.md section 2).
/// Bounds are inclusive; `nil` means open below or above.
public struct EraBoundary: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let from: Int?
    public let to: Int?

    public init(id: String, name: String, from: Int?, to: Int?) {
        self.id = id
        self.name = name
        self.from = from
        self.to = to
    }

    public func contains(_ year: Int) -> Bool {
        (from.map { year >= $0 } ?? true) && (to.map { year <= $0 } ?? true)
    }
}

/// The only source of era boundaries in the Swift core: scores depend on them.
/// A test keeps these constants equal to `contract/eras.json`.
public enum EraBoundaries {
    public static let all: [EraBoundary] = [
        EraBoundary(id: "shellac", name: "Shellac", from: nil, to: 1949),
        EraBoundary(id: "jukebox", name: "Jukebox", from: 1950, to: 1959),
        EraBoundary(id: "mod", name: "Mod", from: 1960, to: 1969),
        EraBoundary(id: "disco", name: "Disco", from: 1970, to: 1979),
        EraBoundary(id: "neon", name: "Neon", from: 1980, to: 1989),
        EraBoundary(id: "zine", name: "Zine", from: 1990, to: 1999),
        EraBoundary(id: "chrome", name: "Chrome", from: 2000, to: 2009),
        EraBoundary(id: "pastel", name: "Pastel", from: 2010, to: 2019),
        EraBoundary(id: "now", name: "Now", from: 2020, to: nil),
    ]

    /// The ID of the era containing `year`; every integer year has exactly one.
    public static func eraOf(_ year: Int) -> String {
        all.first { $0.contains(year) }!.id
    }

    /// The era's position, 0 to 8, or `nil` for an unknown ID.
    public static func eraIndex(_ id: String) -> Int? {
        all.firstIndex { $0.id.utf8.elementsEqual(id.utf8) }
    }

    /// True when both IDs are known and their indexes differ by 1.
    public static func areAdjacent(_ first: String, _ second: String) -> Bool {
        guard let a = eraIndex(first), let b = eraIndex(second) else { return false }
        return abs(a - b) == 1
    }

    public static func name(of id: String) -> String? {
        all.first { $0.id.utf8.elementsEqual(id.utf8) }?.name
    }
}
