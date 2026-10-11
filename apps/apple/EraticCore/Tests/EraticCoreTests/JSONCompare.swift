import Foundation
import XCTest

/// Canonical JSON text of any JSON value (sorted keys), so `true` and `1` stay distinct.
func canonicalJSON(_ value: Any?) -> String {
    guard let value, let data = try? JSONSerialization.data(withJSONObject: [value], options: [.sortedKeys, .withoutEscapingSlashes]) else { return "null" }
    return String(decoding: data, as: UTF8.self)
}

/// Compares only the members `expected` lists.
func assertPartialEqual(_ actual: [String: Any], _ expected: [String: Any], _ name: String, file: StaticString = #filePath, line: UInt = #line) {
    for (key, value) in expected {
        XCTAssertEqual(canonicalJSON(actual[key]), canonicalJSON(value), "\(name): \(key)", file: file, line: line)
    }
}

/// A harness problem, as opposed to an error the rules expect.
struct CaseError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

extension ContractFixtures {
    /// The cases of a file that may not exist yet: skipped when absent.
    static func optionalCases(_ name: String) throws -> [[String: Any]] {
        let url = try directory.appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: url.path) else { throw XCTSkip("\(name) does not exist yet.") }
        return try cases(name)
    }
}
