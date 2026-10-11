import Foundation

struct CalibrationTrial: Equatable {
    let startLatencyMs: Int
    /// Position after stopping minus the expected end of the clip.
    let stopErrorMs: Int
}

struct CalibrationResult: Codable, Equatable {
    let date: Date
    let medianLatencyMs: Int
    let maxStopErrorMs: Int
    let passed: Bool
}

/// Ledger Q4: five 1000 ms clips from 30 s; passes when every stop lands within 150 ms.
@MainActor
final class CalibrationRun: ObservableObject {
    static let trialCount = 5
    static let clipMs = 1000
    static let fromMs = 30_000
    static let toleranceMs = 150

    @Published private(set) var trials: [CalibrationTrial] = []
    @Published private(set) var isRunning = false
    @Published private(set) var error: PlaybackError?
    @Published private(set) var result: CalibrationResult?

    private var task: Task<Void, Never>?

    var medianLatencyMs: Int? { Self.median(trials.map(\.startLatencyMs)) }
    var maxStopErrorMs: Int? { trials.map { abs($0.stopErrorMs) }.max() }
    var passed: Bool? { result?.passed }

    static func key(_ provider: PlaybackProvider) -> String { "eratic.calibration.v1.\(provider.rawValue)" }

    static func latest(for provider: PlaybackProvider, defaults: UserDefaults = .standard) -> CalibrationResult? {
        guard let data = defaults.data(forKey: key(provider)) else { return nil }
        return try? JSONDecoder().decode(CalibrationResult.self, from: data)
    }

    func start(player: Player, track: PlayableTrack) {
        guard !isRunning else { return }
        isRunning = true
        trials = []
        result = nil
        error = nil
        task = Task { [weak self] in await self?.run(player: player, track: track) }
    }

    func cancel() {
        task?.cancel()
        task = nil
        isRunning = false
    }

    private func run(player: Player, track: PlayableTrack) async {
        defer { isRunning = false }
        do {
            try await player.prepare(track)
            // Previews are about 30 s long, so their clips start near the beginning.
            let fromMs = player.tier == .fullTrack ? Self.fromMs : 5_000
            for _ in 0..<Self.trialCount {
                try Task.checkCancellation()
                let start = try await player.play(fromMs: fromMs)
                try await ContinuousClock().sleep(until: start.audibleAt.advanced(by: .milliseconds(Self.clipMs)))
                await player.stop()
                let position = await player.positionMs()
                let latency = start.requestedAt.duration(to: start.audibleAt).components
                trials.append(CalibrationTrial(
                    startLatencyMs: Int(latency.seconds) * 1000 + Int(latency.attoseconds / 1_000_000_000_000_000),
                    // An unknown position can't prove the stop, so it fails the trial.
                    stopErrorMs: position.map { $0 - (fromMs + Self.clipMs) } ?? Int.max))
                try await Task.sleep(for: .milliseconds(500))
            }
            let result = CalibrationResult(
                date: Date(),
                medianLatencyMs: medianLatencyMs ?? 0,
                maxStopErrorMs: maxStopErrorMs ?? 0,
                passed: trials.allSatisfy { abs($0.stopErrorMs) <= Self.toleranceMs })
            self.result = result
            if let data = try? JSONEncoder().encode(result) {
                UserDefaults.standard.set(data, forKey: Self.key(player.provider))
            }
        } catch is CancellationError {
            await player.stop()
        } catch {
            await player.stop()
            self.error = error as? PlaybackError ?? .network
        }
    }

    private static func median(_ values: [Int]) -> Int? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        return sorted[sorted.count / 2]
    }
}
