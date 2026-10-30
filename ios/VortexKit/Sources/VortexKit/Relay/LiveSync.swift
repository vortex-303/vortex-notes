import Foundation

/// The `/ws` change channel (web app main.ts): subscribe with a signed frame,
/// get `{type:"changed", space, seq}` pokes (never ciphertext), then pull over
/// HTTP. Reconnects with backoff min(30s, 1s·2^n) + jitter, and pings every 30s
/// because Cloudflare's hibernatable sockets never ping from the server side.
public final class LiveSync: @unchecked Sendable {
    public enum Event: Sendable, Equatable {
        case subscribed([String])
        case changed(space: String, seq: Int64)
        case disconnected
    }

    private let client: RelayClient
    private let spaces: [String]
    private let session: URLSession
    private let onEvent: @Sendable (Event) -> Void
    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?
    private var runner: Task<Void, Never>?

    public init(client: RelayClient, spaces: [String], session: URLSession = .shared, onEvent: @escaping @Sendable (Event) -> Void) {
        self.client = client
        self.spaces = spaces
        self.session = session
        self.onEvent = onEvent
    }

    public func start() {
        lock.withLock {
            guard runner == nil else { return }
            runner = Task { [weak self] in await self?.run() }
        }
    }

    public func stop() {
        lock.withLock {
            runner?.cancel()
            runner = nil
            task?.cancel(with: .goingAway, reason: nil)
            task = nil
        }
    }

    private func run() async {
        var attempt = 0
        while !Task.isCancelled {
            if await connectOnce() { attempt = 0 }
            onEvent(.disconnected)
            if Task.isCancelled { break }
            let delay = min(30.0, pow(2.0, Double(attempt))) + Double.random(in: 0...0.5)
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }

    /// One connection's lifetime. True if it got as far as subscribing.
    private func connectOnce() async -> Bool {
        let ws = session.webSocketTask(with: client.webSocketURL)
        lock.withLock { task = ws }
        ws.resume()
        let pinger = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                ws.sendPing { _ in }
            }
        }
        defer { pinger.cancel(); ws.cancel(with: .goingAway, reason: nil) }
        var subscribed = false
        do {
            try await ws.send(.string(client.signer.wsSubFrame(spaces: spaces).stringify()))
            while !Task.isCancelled {
                let msg = try await ws.receive()
                let text: String
                switch msg {
                case .string(let s): text = s
                case .data(let d): text = String(decoding: d, as: UTF8.self)
                @unknown default: continue
                }
                guard let v = try? JSValue.parse(Data(text.utf8)) else { continue }
                switch v["type"]?.string {
                case "subscribed":
                    subscribed = true
                    if case .array(let s)? = v["spaces"] { onEvent(.subscribed(s.compactMap(\.string))) }
                case "changed":
                    if let space = v["space"]?.string, let seq = v["seq"]?.int { onEvent(.changed(space: space, seq: seq)) }
                case "error":
                    return subscribed // bad-auth / unknown-device: back off and retry
                default:
                    continue
                }
            }
        } catch {}
        return subscribed
    }
}
