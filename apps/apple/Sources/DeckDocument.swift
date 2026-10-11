import SwiftUI
import UniformTypeIdentifiers
import EraticCore

struct DeckDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var deck: Deck

    init(deck: Deck) { self.deck = deck }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw DeckError("The selected file is not a JSON document.")
        }
        deck = try DeckCodec.decode(data)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: try DeckCodec.encode(deck))
    }
}
