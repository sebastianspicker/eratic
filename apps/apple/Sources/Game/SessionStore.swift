import SwiftUI
import UniformTypeIdentifiers
import EraticCore

/// The current game in `Application Support/Eratic/Sessions/current.json`, written after every action,
/// and a snapshot of its deck in `current-deck.json`, written when the game starts, so it resumes without a re-import.
/// A file that can't be read is kept aside as `<name>.unreadable-<timestamp>.json`, never deleted.
final class SessionStore {
    enum Loaded {
        case none
        case session(GameSession)
        /// The unreadable file's new name and why it couldn't be read.
        case quarantined(fileName: String, reason: String)
    }

    private let directory: URL?
    /// Set when an unreadable file couldn't be moved aside; saving would overwrite it.
    private var blocked: String?

    init(directory: URL? = nil) {
        self.directory = directory ?? (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            .map { $0.appendingPathComponent("Eratic/Sessions", isDirectory: true) }
    }

    enum LoadedDeck {
        case none
        case deck(Deck)
        case quarantined(fileName: String, reason: String)
    }

    /// Set when an unreadable deck snapshot couldn't be moved aside; saving a new one would overwrite it.
    private var deckBlocked: String?

    private var currentURL: URL? { directory?.appendingPathComponent("current.json") }
    private var deckURL: URL? { directory?.appendingPathComponent("current-deck.json") }

    func load() -> Loaded {
        guard let url = currentURL, FileManager.default.fileExists(atPath: url.path) else { return .none }
        do {
            return .session(try SessionCodec.decode(Data(contentsOf: url)))
        } catch {
            let reason = error.localizedDescription
            if let name = Self.quarantine(url, base: "current") { return .quarantined(fileName: name, reason: reason) }
            blocked = "The saved game couldn't be read or moved aside, so Eratic won't overwrite it."
            return .quarantined(fileName: "current.json", reason: reason)
        }
    }

    /// Moves a session that decoded but couldn't be replayed aside like an unreadable one; returns its new name,
    /// or nil when it couldn't be moved (then saving is blocked so it isn't overwritten).
    func quarantineCurrent() -> String? {
        guard let url = currentURL, FileManager.default.fileExists(atPath: url.path) else { return nil }
        if let name = Self.quarantine(url, base: "current") {
            blocked = nil
            // Keep the game's deck copy with it, so the next game can't overwrite it.
            if let deckURL, FileManager.default.fileExists(atPath: deckURL.path), Self.quarantine(deckURL, base: "current-deck") == nil {
                deckBlocked = "The saved deck copy couldn't be moved aside, so Eratic won't overwrite it."
            }
            return name
        }
        blocked = "The saved game couldn't be replayed or moved aside, so Eratic won't overwrite it."
        return nil
    }

    /// The deck snapshot saved with the current game.
    func loadDeck() -> LoadedDeck {
        guard let url = deckURL, FileManager.default.fileExists(atPath: url.path) else { return .none }
        do {
            return .deck(try DeckCodec.decode(Data(contentsOf: url)))
        } catch {
            let reason = error.localizedDescription
            if let name = Self.quarantine(url, base: "current-deck") { return .quarantined(fileName: name, reason: reason) }
            deckBlocked = "The saved deck copy couldn't be read or moved aside, so Eratic won't overwrite it."
            return .quarantined(fileName: "current-deck.json", reason: reason)
        }
    }

    /// Moves an unreadable file aside; returns its new name, or nil when it couldn't be moved.
    private static func quarantine(_ url: URL, base: String) -> String? {
        let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: TimeZone(identifier: "UTC")!, formatOptions: [.withYear, .withMonth, .withDay, .withTime])
        let name = "\(base).unreadable-\(stamp).json"
        do {
            try FileManager.default.moveItem(at: url, to: url.deletingLastPathComponent().appendingPathComponent(name))
            return name
        } catch {
            return nil
        }
    }

    /// Writes the deck snapshot atomically next to the session.
    func saveDeck(_ deck: Deck) throws {
        if deckBlocked != nil, let url = deckURL, !FileManager.default.fileExists(atPath: url.path) { deckBlocked = nil }
        if let deckBlocked { throw DeckError(deckBlocked) }
        guard let directory, let url = deckURL else { throw DeckError("The Application Support folder is unavailable.") }
        let data = try DeckCodec.encode(deck)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    func save(_ session: GameSession) throws {
        // The unreadable file is no longer there (moved aside or discarded), so nothing would be overwritten.
        if blocked != nil, let url = currentURL, !FileManager.default.fileExists(atPath: url.path) { blocked = nil }
        if let blocked { throw DeckError(blocked) }
        guard let directory, let url = currentURL else { throw DeckError("The Application Support folder is unavailable.") }
        let data = try SessionCodec.encode(session)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    /// Removes `current.json` only; the UI asks first. Call `discardDeck()` afterwards.
    func discardSession() throws {
        if let url = currentURL, FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        blocked = nil
    }

    /// Removes `current-deck.json` only.
    func discardDeck() throws {
        if let url = deckURL, FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        deckBlocked = nil
    }
}

/// A session file for *Export session*.
struct SessionDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var session: GameSession

    init(session: GameSession) { self.session = session }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw DeckError("The selected file is not a JSON document.")
        }
        session = try SessionCodec.decode(data)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: try SessionCodec.encode(session))
    }
}
