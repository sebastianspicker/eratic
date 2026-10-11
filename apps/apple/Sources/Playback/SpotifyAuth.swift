import AuthenticationServices
import CryptoKit
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Authorization Code + PKCE for the Spotify Web API; tokens live in the Keychain.
@MainActor
final class SpotifyAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let redirectURI = "eratic://spotify-callback"
    static let callbackScheme = "eratic"
    static let scopes = "user-read-playback-state user-modify-playback-state user-read-private"
    private static let service = "eratic.spotify"
    private static let account = "tokens"

    private struct Tokens: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String?
        let expires_in: Double
    }

    private var tokens: Tokens?
    private var session: ASWebAuthenticationSession?
    private var inFlight: Task<String, Error>?

    override init() {
        super.init()
        if let data = Keychain.read(service: Self.service, account: Self.account) {
            tokens = try? JSONDecoder().decode(Tokens.self, from: data)
        }
    }

    var isSignedIn: Bool { tokens != nil }

    func signOut() {
        tokens = nil
        Keychain.delete(service: Self.service, account: Self.account)
    }

    /// Reuse/refresh stored authorization. Only an explicit timed-playback request may sign in.
    func accessToken(allowSignIn: Bool = false) async throws -> String {
        guard let clientID = AppConfig.spotifyClientID else { throw PlaybackError.notConfigured }
        if let tokens, tokens.expiresAt > Date().addingTimeInterval(30) { return tokens.accessToken }
        if tokens != nil { return try await refresh() }
        guard allowSignIn else { throw PlaybackError.notAuthorised }
        return try await shared {
            try await self.signIn(clientID: clientID)
            guard let tokens = self.tokens else { throw PlaybackError.notAuthorised }
            return tokens.accessToken
        }
    }

    /// Forces a refresh, e.g. after a 401. Signs out if the refresh token is rejected.
    func refresh() async throws -> String {
        try await shared { try await self.performRefresh() }
    }

    /// Concurrent callers share one sign-in or refresh, so a rotated refresh token is never spent twice.
    private func shared(_ work: @escaping @MainActor () async throws -> String) async throws -> String {
        if let inFlight { return try await inFlight.value }
        let task = Task { try await work() }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }

    private func performRefresh() async throws -> String {
        guard let clientID = AppConfig.spotifyClientID else { throw PlaybackError.notConfigured }
        guard let current = tokens else { throw PlaybackError.notAuthorised }
        do {
            try await requestTokens(clientID: clientID, form: [
                "grant_type": "refresh_token", "refresh_token": current.refreshToken,
            ], fallbackRefresh: current.refreshToken)
        } catch PlaybackError.notAuthorised {
            signOut()
            throw PlaybackError.notAuthorised
        }
        guard let tokens else { throw PlaybackError.notAuthorised }
        return tokens.accessToken
    }

    private func signIn(clientID: String) async throws {
        let verifier = Self.randomString(64)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomString(16)
        var components = URLComponents(string: "https://accounts.spotify.com/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "scope", value: Self.scopes),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: Self.callbackScheme) { url, error in
                if let url { continuation.resume(returning: url) } else { continuation.resume(throwing: PlaybackError.notAuthorised) }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() { continuation.resume(throwing: PlaybackError.notAuthorised) }
        }
        session = nil
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw PlaybackError.notAuthorised }
        try await requestTokens(clientID: clientID, form: [
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": Self.redirectURI, "code_verifier": verifier,
        ], fallbackRefresh: nil)
    }

    private func requestTokens(clientID: String, form: [String: String], fallbackRefresh: String?) async throws {
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.httpBody = form.merging(["client_id": clientID]) { a, _ in a }
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw PlaybackError.network }
        guard let http = response as? HTTPURLResponse else { throw PlaybackError.network }
        guard http.statusCode == 200 else {
            throw http.statusCode >= 500 ? PlaybackError.network : PlaybackError.notAuthorised
        }
        guard let decoded = try? JSONDecoder().decode(TokenResponse.self, from: data), !decoded.access_token.isEmpty,
              let refreshToken = decoded.refresh_token ?? fallbackRefresh, !refreshToken.isEmpty else { throw PlaybackError.notAuthorised }
        let stored = Tokens(accessToken: decoded.access_token, refreshToken: refreshToken,
                            expiresAt: Date().addingTimeInterval(decoded.expires_in))
        tokens = stored
        if let encoded = try? JSONEncoder().encode(stored) {
            Keychain.write(encoded, service: Self.service, account: Self.account)
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(iOS)
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            return scene?.keyWindow ?? ASPresentationAnchor()
            #else
            return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
            #endif
        }
    }

    private static func randomString(_ length: Int) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in alphabet[Int(generator.next() % UInt64(alphabet.count))] })
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
