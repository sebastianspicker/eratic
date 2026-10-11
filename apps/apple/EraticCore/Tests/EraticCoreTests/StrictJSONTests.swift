import Foundation
import XCTest
@testable import EraticCore

/// Expectations follow RFC 8259 and the contract's duplicate-name rule.
final class StrictJSONTests: XCTestCase {
    private func accepts(_ text: String, line: UInt = #line) {
        XCTAssertNoThrow(try StrictJSON.validate(Data(text.utf8)), text, line: line)
    }

    private func rejects(_ data: Data, line: UInt = #line) {
        XCTAssertThrowsError(try StrictJSON.validate(data), line: line)
    }

    private func rejects(_ text: String, line: UInt = #line) {
        rejects(Data(text.utf8), line: line)
    }

    func testDepthLimit() {
        let limit = StrictJSON.maximumDepth
        accepts(String(repeating: "[", count: limit) + String(repeating: "]", count: limit))
        rejects(String(repeating: "[", count: limit + 1) + String(repeating: "]", count: limit + 1))
        rejects(String(repeating: "[", count: 100_000))
    }

    func testNestedDocumentIsAccepted() {
        accepts(#"{"a":[{"b":[1,2.5e-3,-0,true,false,null,"x"]},[],{}],"c":{"d":{"e":[[[]]]}}}"#)
    }

    func testTopLevelValueFollowedByGarbage() {
        accepts(" \t\r\n{} \n")
        rejects("{} x")
        rejects("{}{}")
        rejects("1 2")
        rejects("")
        rejects("  ")
    }

    func testNumberGrammar() {
        for number in ["0", "-0", "10", "1.5", "1e5", "1E+5", "1e-5", "-12.50e3"] { accepts(number) }
        for number in ["01", "+1", "-", "1.", ".5", "1e", "1e+", "-01", "0x1", "1.e1", "NaN", "Infinity"] { rejects(number) }
    }

    func testLiteralsAndWhitespace() {
        for literal in ["true", "false", "null"] { accepts(literal) }
        for literal in ["True", "nul", "truex", "undefined"] { rejects(literal) }
        rejects("\u{0B}1")
        rejects("\u{A0}1")
        rejects("\u{FEFF}\u{FEFF}1")
    }

    func testControlCharactersInStrings() {
        rejects("\"a\nb\"")
        rejects("\"a\tb\"")
        rejects("\"a\u{1F}b\"")
        accepts(#""a\nb\tc""#)
        accepts("\"a\u{7F}b\"")
    }

    func testEscapes() {
        accepts(#""\" \\ \/ \b \f \n \r \t A 😀""#)
        rejects(#""\x""#)
        rejects(#""\'""#)
        rejects(#""\u12""#)
        rejects(#""\u12G4""#)
        rejects(#""\uD83D""#)
        rejects(#""\uDE00""#)
        rejects(#""\uD83Dx""#)
        rejects("\"\\")
        rejects("\"abc")
    }

    func testTrailingCommasAndComments() {
        rejects("[1,]")
        rejects(#"{"a":1,}"#)
        rejects("[,1]")
        rejects("[1 2]")
        rejects(#"{"a" 1}"#)
        rejects(#"{a:1}"#)
        rejects(#"{"a":1} // c"#)
        rejects("/* c */ [1]")
        rejects("'a'")
    }

    func testDuplicateNames() {
        rejects(#"{"a":1,"a":2}"#)
        rejects(#"{"title":1,"title":2}"#)
        rejects(#"{"😀":1,"😀":2}"#)
        rejects(#"{"x":[{"k":1,"y":{"n":1,"n":2}}]}"#)
        accepts(#"{"a":{"a":1},"b":{"a":2},"c":[{"a":1},{"a":2}]}"#)
        accepts(#"{"a":1,"A":2}"#)
        // Canonically equivalent but different scalars are different names.
        accepts("{\"\u{E9}\":1,\"e\u{301}\":2}")
    }

    func testEncodingsAndBOM() throws {
        let json = #"{"a":"é"}"#
        XCTAssertEqual(try StrictJSON.validate(Data(json.utf8)), Data(json.utf8))
        XCTAssertEqual(try StrictJSON.validate(Data([0xEF, 0xBB, 0xBF] + Array(json.utf8))), Data(json.utf8))
        rejects(Data([0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF] + Array("1".utf8)))
        rejects(try XCTUnwrap(json.data(using: .utf16)))
        rejects(try XCTUnwrap(json.data(using: .utf16LittleEndian)))
        rejects(try XCTUnwrap(json.data(using: .utf16BigEndian)))
        rejects(try XCTUnwrap(json.data(using: .utf32)))
        rejects(try XCTUnwrap(json.data(using: .utf32LittleEndian)))
        rejects(Data([0x22, 0xFF, 0x22]))
        rejects(Data([0x22, 0xC3, 0x28, 0x22]))
        rejects(Data([0x22, 0xED, 0xA0, 0x80, 0x22]))
        rejects(Data([0x22, 0xC0, 0x80, 0x22]))
    }
}
