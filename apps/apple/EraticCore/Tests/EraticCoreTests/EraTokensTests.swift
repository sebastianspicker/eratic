import Foundation
import XCTest
@testable import EraticCore

final class EraTokensTests: XCTestCase {
    /// The repository's `design/eras.json`, found by walking up from this source file.
    private func tokenFile() throws -> Data {
        var url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while url.path != "/" {
            let candidate = url.appendingPathComponent("design/eras.json")
            if FileManager.default.fileExists(atPath: candidate.path) { return try Data(contentsOf: candidate) }
            url.deleteLastPathComponent()
        }
        throw EraTokenError("design/eras.json not found above \(#filePath)")
    }

    func testRepositoryTokensDecodeAndCoverEveryContractYear() throws {
        let eras = try Era.decodeAll(from: tokenFile())
        XCTAssertEqual(eras.map(\.id), ["shellac", "jukebox", "mod", "disco", "neon", "zine", "chrome", "pastel", "now"])
        for year in 1850...2100 {
            XCTAssertNotNil(Era.era(for: year, in: eras), "\(year)")
        }
        for (year, id) in [(1850, "shellac"), (1949, "shellac"), (1950, "jukebox"), (1984, "neon"), (2019, "pastel"), (2020, "now"), (2100, "now")] {
            XCTAssertEqual(Era.era(for: year, in: eras)?.id, id, "\(year)")
        }
    }

    func testTokensTakeNamesAndBoundsFromTheContract() throws {
        let eras = try Era.decodeAll(from: tokenFile())
        XCTAssertEqual(eras.map(\.name), EraBoundaries.all.map(\.name))
        XCTAssertEqual(eras.map(\.from), EraBoundaries.all.map(\.from))
        XCTAssertEqual(eras.map(\.to), EraBoundaries.all.map(\.to))
        XCTAssertEqual(eras[4].label, "1980s")
    }

    func testInvalidTokensAreRejected() throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: tokenFile()) as? [String: Any])
        var eras = try XCTUnwrap(object["eras"] as? [[String: Any]])

        var badColour = eras
        badColour[0]["ink"] = "#fff"
        object["eras"] = badColour
        XCTAssertThrowsError(try Era.decodeAll(from: JSONSerialization.data(withJSONObject: object)))

        var swapped = eras
        swapped.swapAt(0, 1)
        object["eras"] = swapped
        XCTAssertThrowsError(try Era.decodeAll(from: JSONSerialization.data(withJSONObject: object)))

        object["eras"] = Array(eras.dropLast())
        XCTAssertThrowsError(try Era.decodeAll(from: JSONSerialization.data(withJSONObject: object)))

        var unknown = eras
        unknown[0]["id"] = "vinyl"
        object["eras"] = unknown
        XCTAssertThrowsError(try Era.decodeAll(from: JSONSerialization.data(withJSONObject: object)))

        eras[0]["type"] = ["width": 60, "weight": 500, "case": "upper", "tracking": 0, "tilt": 0, "glow": false]
        object["eras"] = eras
        XCTAssertThrowsError(try Era.decodeAll(from: JSONSerialization.data(withJSONObject: object)))
    }
}
