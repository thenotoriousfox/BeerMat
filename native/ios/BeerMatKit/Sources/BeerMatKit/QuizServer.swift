import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A refusal from the quiz server: its own sentence for the player, and the HTTP status.
public struct QuizError: LocalizedError, Equatable {
    public let message: String, status: Int
    public var errorDescription: String? { message }
}

/// One quiz laptop (or an online quiz link), over plain HTTP with URLSession: no internet needed, no cloud service.
/// iOS asks the player once for local-network access (NSLocalNetworkUsageDescription) on the first call.
public final class QuizServer: @unchecked Sendable {
    public let base: String
    private let session: URLSession

    public init(_ address: String) throws {
        base = try QuizServer.normalise(address)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        #if !canImport(FoundationNetworking)  // read-only in Linux's FoundationNetworking; the Linux build is for the tests
        config.waitsForConnectivity = false
        #endif
        session = URLSession(configuration: config)
    }

    public func hello() async throws -> Hello {
        guard let hello = Hello.parse(try await request("GET", "/api/hello")) else { throw QuizError(message: "That address isn’t a BeerMat quiz.", status: 0) }
        return hello
    }

    public func join(_ name: String, table: Int? = nil) async throws -> Joined {
        var body: [String: Any] = ["name": name]
        if let table { body["table"] = table }
        let o = try await request("POST", "/api/join", body)
        return Joined(secret: o.str("secret"), waiting: o.bool("waiting"), rehearsal: o.bool("rehearsal"))
    }

    /// A 4-digit code from the quizmaster moves a team to this phone.
    public func transfer(_ code: String) async throws -> String { try await request("POST", "/api/transfer", ["code": code]).str("secret") }

    /// The team's state. Each call says how long the one before took, for the desk's signal monitor.
    public func state(_ secret: String) async throws -> PlayerState {
        let started = Date()
        let state = PlayerState.parse(try await request("POST", "/api/state", [:], secret, rtt: lastRtt))
        lastRtt = Int(Date().timeIntervalSince(started) * 1000)
        return state
    }
    private var lastRtt: Int?

    /// Music bingo's reaction table: the team dabbed `title` on its ticket, or passes on this song (nil): one go per song.
    public func react(_ secret: String, question: Int, title: String?) async throws {
        var body: [String: Any] = ["question": question]
        if let title { body["title"] = title } else { body["pass"] = true }
        _ = try await request("POST", "/api/react", body, secret)
    }

    public func answer(_ secret: String, question: Int, value: Any) async throws { _ = try await request("POST", "/api/answer", ["question": question, "value": value], secret) }
    public func draft(_ secret: String, question: Int, value: Any) async throws { _ = try await request("POST", "/api/draft", ["question": question, "value": value], secret) }
    public func buzz(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/buzz", ["question": question], secret) }
    /// Bingo: the team shouts; the quizmaster checks the ticket.
    public func bingo(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/bingo", ["question": question], secret) }
    /// Sound clips: a tap during the clip the team thinks is the one.
    public func tap(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/tap", ["question": question], secret) }
    /// Word trail (and pinpoint) help: the decoys go, for fewer points.
    public func fifty(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/fifty", ["question": question], secret) }
    public func goWide(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/gowide", ["question": question], secret) }
    public func rename(_ secret: String, name: String) async throws { _ = try await request("POST", "/api/team/name", ["name": name], secret) }
    public func varCheck(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/team/var", ["question": question], secret) }
    public func sound(_ secret: String, index: Int) async throws { _ = try await request("POST", "/api/team/sound", ["sound": index], secret) }
    /// The team's photo for the TV: a square JPEG; the quizmaster approves it first.
    public func photo(_ secret: String, jpeg: Data) async throws { _ = try await request("POST", "/api/team/photo", nil, secret, raw: jpeg) }
    /// The team's result after a live quiz, signed by the quiz laptop, for the player to keep in a profile.
    public func result(_ secret: String) async throws -> [String: Any] { (try await request("POST", "/api/team/result", [:], secret))["claim"] as? [String: Any] ?? [:] }

    public func agree(_ secret: String, question: Int) async throws { _ = try await request("POST", "/api/agree", ["question": question], secret) }
    /// Leaving the app during an open question is reported to the quizmaster, as the web page does.
    public func away(_ secret: String, question: Int, state: String) async throws { _ = try await request("POST", "/api/away", ["question": question, "state": state], secret) }

    #if !canImport(FoundationNetworking)  // URLSession.bytes is Apple-only; the Linux build is for the tests
    /// Live updates: the server's event stream sends a number whenever anything changes, meaning "fetch your state
    /// again". Yields true when connected and on every nudge, false when the stream drops; reconnects by itself.
    public func updates(_ secret: String) -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    do {
                        var request = URLRequest(url: URL(string: "\(base)/api/events?key=\(secret)")!)
                        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        request.timeoutInterval = 45  // the server pings every few seconds
                        let (bytes, response) = try await session.bytes(for: request)
                        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw QuizError(message: "stream", status: 0) }
                        continuation.yield(true)
                        for try await line in bytes.lines where line.hasPrefix("data:") { continuation.yield(true) }
                    } catch {}
                    continuation.yield(false)
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
    #endif

    func request(_ method: String, _ route: String, _ body: [String: Any]? = nil, _ secret: String = "", raw: Data? = nil, rtt: Int? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: base + route)!)
        request.httpMethod = method
        if !secret.isEmpty { request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization") }
        if let rtt { request.setValue(String(rtt), forHTTPHeaderField: "X-Beermat-Rtt") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if let raw {
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
            request.httpBody = raw
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else { throw QuizError(message: json.str("error").isEmpty ? "The quiz server said \(status)" : json.str("error"), status: status) }
        return json
    }

    /// What a player typed or scanned, as a server address: "10.42.0.1:3000" → "http://10.42.0.1:3000".
    public static func normalise(_ input: String) throws -> String {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if !s.hasPrefix("http://") && !s.hasPrefix("https://") { s = "http://" + s }
        guard let url = URLComponents(string: s), let scheme = url.scheme, let host = url.host, !host.isEmpty else { throw QuizError(message: "That doesn’t look like a quiz address.", status: 0) }
        return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }
}

/// What a QR code on the TV says: a quiz address, or the quiz Wi-Fi to join first.
public enum Scanned: Equatable {
    case address(String)
    case wifi(ssid: String, password: String)
    case unknown

    public static func parse(_ text: String) -> Scanned {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("WIFI:") {
            // WIFI:T:WPA;S:<ssid>;P:<password>;; with \ escaping ; , : " and \ (web/qr.js wifiCode).
            var fields: [String: String] = [:], key = "", value = "", inValue = false, escaped = false
            for c in t.dropFirst(5) {
                if escaped { if inValue { value.append(c) } else { key.append(c) }; escaped = false }
                else if c == "\\" { escaped = true }
                else if !inValue && c == ":" { inValue = true }
                else if c == ";" { if !key.isEmpty { fields[key] = value }; key = ""; value = ""; inValue = false }
                else if inValue { value.append(c) } else { key.append(c) }
            }
            guard let ssid = fields["S"] else { return .unknown }
            return .wifi(ssid: ssid, password: fields["P"] ?? "")
        }
        return (try? QuizServer.normalise(t)).map { .address($0) } ?? .unknown
    }
}
