import Foundation

/// Plays one clip and stops it `lengthMs` after the audible start.
@MainActor
final class ClipController: ObservableObject {
    enum State: Equatable {
        case idle
        case starting
        case playing(startedAt: ContinuousClock.Instant, lengthMs: Int?)
        case finished
    }

    @Published private(set) var state = State.idle
    /// Milliseconds left in a timed clip, updated about ten times a second.
    @Published private(set) var remainingMs: Int?
    @Published private(set) var error: PlaybackError?

    private var task: Task<Void, Never>?
    private var player: Player?
    /// Bumped by every `start` and `cancel`; a run that is no longer current never touches state or the player.
    private var generation = 0
    /// The latest stop request; a new clip waits for it so a slow stop (Spotify's pause) can't stop the new clip.
    private var stopTask: Task<Void, Never>?

    /// Starts `fromMs` of the prepared track. `lengthMs == nil` plays until `cancel()`.
    func start(player: Player, fromMs: Int, lengthMs: Int?) {
        cancel()
        let run = generation
        self.player = player
        error = nil
        state = .starting
        remainingMs = lengthMs
        let pendingStop = stopTask
        task = Task { [weak self] in
            await pendingStop?.value
            await self?.run(run, player: player, fromMs: fromMs, lengthMs: lengthMs)
        }
    }

    /// Stops playback and returns to idle.
    func cancel() {
        generation += 1
        task?.cancel()
        task = nil
        let player = self.player
        self.player = nil
        if state != .idle { state = .idle }
        remainingMs = nil
        if let player { stop(player) }
    }

    /// Queues a stop after any earlier one.
    private func stop(_ player: Player) {
        let previous = stopTask
        stopTask = Task {
            await previous?.value
            await player.stop()
        }
    }

    private func isCurrent(_ run: Int) -> Bool { run == generation && !Task.isCancelled }

    private func run(_ run: Int, player: Player, fromMs: Int, lengthMs: Int?) async {
        guard isCurrent(run) else { return }
        let clock = ContinuousClock()
        do {
            let start = try await player.play(fromMs: fromMs)
            guard isCurrent(run) else { return }
            state = .playing(startedAt: start.audibleAt, lengthMs: lengthMs)
            let end = lengthMs.map { start.audibleAt.advanced(by: .milliseconds($0)) }
            var lastPosition = start.positionMs
            var stalls = 0
            var tick = 0
            while isCurrent(run) {
                let now = clock.now
                if let end {
                    if now >= end { break }
                    remainingMs = max(0, Self.ms(now.duration(to: end)))
                }
                try await clock.sleep(until: min(now.advanced(by: .milliseconds(100)), end ?? .now.advanced(by: .milliseconds(100))))
                tick += 1
                // About once a second, finish early if the track ended and the position stopped advancing.
                if tick % 10 == 0, let position = await player.positionMs() {
                    stalls = position <= lastPosition ? stalls + 1 : 0
                    lastPosition = position
                    if stalls >= 2 { break }
                }
            }
            guard isCurrent(run) else { return }
            stop(player)
            self.player = nil
            task = nil
            remainingMs = lengthMs == nil ? nil : 0
            state = .finished
        } catch {
            // Cancelled or superseded: `cancel()` already stopped this run's player, and a newer clip may be playing.
            guard isCurrent(run) else { return }
            self.error = error as? PlaybackError ?? .network
            stop(player)
            self.player = nil
            task = nil
            remainingMs = nil
            state = .idle
        }
    }

    private static func ms(_ d: Duration) -> Int {
        let c = d.components
        return Int(c.seconds) * 1000 + Int(c.attoseconds / 1_000_000_000_000_000)
    }
}
