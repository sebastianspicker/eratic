import Foundation
import XCTest
@testable import EraticCore

final class ScanTests: XCTestCase {
    private let spotifyID = "4uLU6hMCjMI75M1A2tKUQC"

    func testSpotifyTracks() {
        let expected = ProviderTrack(provider: .spotify, id: spotifyID)
        XCTAssertEqual(ScanRules.providerTrack("spotify:track:\(spotifyID)"), expected)
        XCTAssertEqual(ScanRules.providerTrack("https://open.spotify.com/track/\(spotifyID)"), expected)
        XCTAssertEqual(ScanRules.providerTrack("https://OPEN.Spotify.com/track/\(spotifyID)?si=abc#x"), expected)
        XCTAssertEqual(ScanRules.providerTrack("https://open.spotify.com/intl-de/track/\(spotifyID)"), expected)
        XCTAssertEqual(ScanRules.providerTrack("https://open.spotify.com:443/track/\(spotifyID)"), expected)
        XCTAssertNil(ScanRules.providerTrack("https://open.spotify.com/intl-/track/\(spotifyID)"))
        XCTAssertNil(ScanRules.providerTrack("https://open.spotify.com/intl-d3/track/\(spotifyID)"))
        XCTAssertNil(ScanRules.providerTrack("https://open.spotify.com/track/\(spotifyID)/"))
        XCTAssertNil(ScanRules.providerTrack("https://open.spotify.com/album/\(spotifyID)"))
        XCTAssertNil(ScanRules.providerTrack("https://open.spotify.com/track/\(spotifyID.dropLast())"))
        XCTAssertNil(ScanRules.providerTrack("http://open.spotify.com/track/\(spotifyID)"))
        XCTAssertNil(ScanRules.providerTrack("spotify:track:\(spotifyID)x"))
        XCTAssertNil(ScanRules.providerTrack("https://user@open.spotify.com/track/\(spotifyID)"))
    }

    func testAppleMusicTracks() {
        XCTAssertEqual(ScanRules.providerTrack("https://music.apple.com/US/album/some-album/1440857781?uo=4&i=1440857795"),
                       ProviderTrack(provider: .appleMusic, id: "1440857795", storefront: "us"))
        XCTAssertEqual(ScanRules.providerTrack("https://music.apple.com/de/song/a-song/123"), ProviderTrack(provider: .appleMusic, id: "123", storefront: "de"))
        XCTAssertEqual(ScanRules.providerTrack("https://music.apple.com/de/song/123?x=1"), ProviderTrack(provider: .appleMusic, id: "123", storefront: "de"))
        XCTAssertNil(ScanRules.providerTrack("https://music.apple.com/us/album/some-album/1440857781"))
        XCTAssertNil(ScanRules.providerTrack("https://music.apple.com/us/album/some-album/1440857781?i=12a"))
        XCTAssertNil(ScanRules.providerTrack("https://music.apple.com/us/album/some-album/1440857781?i=1234567890123456"))
        XCTAssertNil(ScanRules.providerTrack("https://music.apple.com/usa/song/123"))
        XCTAssertNil(ScanRules.providerTrack("https://music.apple.com/us/song/"))
        XCTAssertNil(ScanRules.providerTrack("https://www.youtube.com/watch?v=abc"))
    }

    func testLinkTracks() {
        XCTAssertEqual(ScanRules.linkTrack(ProviderLink(provider: .spotify, url: "https://example.com/x", id: spotifyID)), ProviderTrack(provider: .spotify, id: spotifyID))
        XCTAssertEqual(ScanRules.linkTrack(ProviderLink(provider: .appleMusic, url: "https://music.apple.com/us/song/9", id: "not-digits")),
                       ProviderTrack(provider: .appleMusic, id: "9", storefront: "us"))
        XCTAssertNil(ScanRules.linkTrack(ProviderLink(provider: .appleMusic, url: "https://open.spotify.com/track/\(spotifyID)")))
        XCTAssertNil(ScanRules.linkTrack(ProviderLink(provider: .other, url: "https://open.spotify.com/track/\(spotifyID)", id: spotifyID)))
    }

    private func deck() -> Deck {
        let year = GameYear(value: 1984, source: "Test")
        return Deck(id: "demo-deck", title: "Demo", cards: [
            SongCard(id: "c1", title: "One", artist: "A", gameYear: year, links: [ProviderLink(provider: .other, url: "https://example.com/one")]),
            SongCard(id: "c2", title: "Two", artist: "B", gameYear: year, links: [ProviderLink(provider: .spotify, url: "https://open.spotify.com/intl-de/track/\(spotifyID)")]),
            SongCard(id: "c3", title: "Three", artist: "C", gameYear: year, officialCard: OfficialCard(url: "https://uqr.to/abc")),
        ])
    }

    func testResolveScan() {
        let deck = deck()
        let hosts = ["Cards.Example.com"]
        func resolve(_ payload: String) -> ScanResult { ScanRules.resolveScan(payload: payload, deck: deck, hosts: hosts) }
        XCTAssertEqual(resolve("https://cards.EXAMPLE.com/c/demo-deck/c1"), .card(cardId: "c1", via: .eraticCard))
        XCTAssertEqual(resolve("https://cards.example.com/c/demo-deck/c9"), .unknownCard(cardId: "c9"))
        XCTAssertEqual(resolve("https://cards.example.com/c/other/c1"), .otherDeck(deckId: "other"))
        XCTAssertEqual(resolve("https://cards.example.com/c/demo-deck/c1?x"), .unrecognized)
        XCTAssertEqual(resolve("https://cards.example.com:443/c/demo-deck/c1"), .card(cardId: "c1", via: .eraticCard))
        XCTAssertEqual(resolve("https://cards.example.com:8443/c/demo-deck/c1"), .unrecognized)
        XCTAssertEqual(resolve("https://example.com/one"), .card(cardId: "c1", via: .providerLink))
        XCTAssertEqual(resolve("spotify:track:\(spotifyID)"), .card(cardId: "c2", via: .providerLink))
        XCTAssertEqual(resolve("spotify:track:0000000000000000000000"), .unmatchedProvider(provider: .spotify, trackId: "0000000000000000000000"))
        XCTAssertEqual(resolve("https://uqr.to/abc"), .card(cardId: "c3", via: .officialCard))
        XCTAssertEqual(resolve("https://uqr.to/abd"), .unmatchedOfficial)
        XCTAssertEqual(resolve("hello"), .unrecognized)
        XCTAssertEqual(resolve("https://cards.example.com/c/demo-deck/c1").jsonObject["via"] as? String, "eraticCard")
    }

    func testEraticCardRoute() {
        let card = deck().cards[0]
        XCTAssertEqual(QRRoute.payload(for: card, mode: .eraticCard, eratic: EraticCardRoute(host: "Cards.Example.com", deckId: "demo-deck")),
                       "https://Cards.Example.com/c/demo-deck/c1")
        XCTAssertNil(QRRoute.payload(for: card, mode: .eraticCard))
        for host in ["cards.example.com:443", "cards.example.com/x", "a?b", "a#b", "", "a b", "user@host"] {
            XCTAssertNil(QRRoute.payload(for: card, mode: .eraticCard, eratic: EraticCardRoute(host: host, deckId: "demo-deck")), host)
        }
        XCTAssertNil(QRRoute.payload(for: card, mode: .eraticCard, eratic: EraticCardRoute(host: "cards.example.com", deckId: "bad deck")))
    }
}
