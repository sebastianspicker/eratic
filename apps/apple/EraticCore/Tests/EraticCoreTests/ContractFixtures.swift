import Foundation
@testable import EraticCore

/// Locates the repository's `contract/` directory and reads its files.
enum ContractFixtures {
    /// Found by walking up from this source file.
    static var directory: URL {
        get throws {
            var url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            while url.path != "/" {
                let candidate = url.appendingPathComponent("contract")
                if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("deck-v1.schema.json").path) { return candidate }
                url.deleteLastPathComponent()
            }
            throw DeckError("contract/ directory not found above \(#filePath)")
        }
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name))
    }

    static func cases(_ name: String) throws -> [[String: Any]] {
        guard let root = try JSONSerialization.jsonObject(with: data(name)) as? [String: Any],
              let cases = root["cases"] as? [[String: Any]] else { throw DeckError("\(name) has no cases array.") }
        return cases
    }
}
