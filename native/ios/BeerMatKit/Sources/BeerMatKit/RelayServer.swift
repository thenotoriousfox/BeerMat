import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A quiz laptop reached through BeerMat Online's relay, as a fallback when the laptop isn't directly reachable
/// (no LAN path, no quizmaster link). The relay token authenticates the phone: no deckLogin is needed.
public final class RelayServer: @unchecked Sendable {
    public let base: String
    public let keyId: String
    public let token: String
    private let session: URLSession

    public init(base: String, keyId: String, token: String) {
        self.base = base.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        self.keyId = keyId
        self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        session = URLSession(configuration: config)
    }

    /// The quiz state from the relay.
    public func state() async throws -> [String: Any] {
        try await request("GET", "/v1/relay/\(keyId)/state?token=\(token)", nil)
    }

    /// One of the desk's own routes (/api/host/<route>), forwarded through the relay.
    @discardableResult
    public func host(_ key: String, _ route: String, _ body: [String: Any] = [:]) async throws -> [String: Any] {
        try await request("POST", "/v1/relay/\(keyId)/command", ["token": token, "route": route, "body": body])
    }

    #if !canImport(FoundationNetworking)
    /// Live updates through the relay: polls every two seconds (the relay is HTTPS, so SSE would be held back the
    /// same way the quizmaster link's HTTPS path already is in QuizServer).
    public func updates(_ secret: String) -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    continuation.yield(true)
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
    #endif

    private func request(_ method: String, _ route: String, _ body: [String: Any]?) async throws -> [String: Any] {
        guard let url = URL(string: base + route) else { throw QuizError(message: "Bad relay URL", status: 0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: request) } catch { throw QuizError(message: "No connection to BeerMat Online", status: 0) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else { throw QuizError(message: json.str("error").isEmpty ? "BeerMat Online said \(status)" : json.str("error"), status: status) }
        return json
    }
}
