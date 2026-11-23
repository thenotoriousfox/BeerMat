import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Where the client keeps its state: UserDefaults in the app (the token in the Keychain), a dictionary in tests.
public protocol OnlineStorage: AnyObject {
    func get(_ name: String) -> String?
    func set(_ name: String, _ value: String?)
    /// Secrets (the sign-in token): the Keychain in the app.
    func secret(_ name: String) -> String?
    func setSecret(_ name: String, _ value: String?)
}

public final class MemoryStorage: OnlineStorage {
    public var values: [String: String] = [:]
    public init() {}
    public func get(_ name: String) -> String? { values[name] }
    public func set(_ name: String, _ value: String?) { values[name] = value }
    public func secret(_ name: String) -> String? { values["secret:" + name] }
    public func setSecret(_ name: String, _ value: String?) { values["secret:" + name] = value }
}

public struct OnlineError: LocalizedError {
    public let message: String, status: Int, offline: Bool
    public var errorDescription: String? { message }
}

/// The player side of BeerMat Online, as online/client.js is for the Capacitor and web apps (and OnlineClient.kt for
/// Android): signing in, the profile, keeping quiz results and finding quizzes. Offline, kept results wait in an
/// outbox (sending one twice never counts it twice) and listings come from the last search, marked out of date.
public final class OnlineClient: @unchecked Sendable {
    public var baseUrl: String
    public let venueListUrl: String
    private let storage: OnlineStorage
    private let session: URLSession

    public init(baseUrl: String, venueListUrl: String = "", storage: OnlineStorage) {
        self.baseUrl = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        self.venueListUrl = venueListUrl
        self.storage = storage
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        session = URLSession(configuration: config)
    }

    private func json(_ name: String) -> Any? { storage.get(name).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } }
    private func save(_ name: String, _ value: Any?) {
        storage.set(name, value.flatMap { try? JSONSerialization.data(withJSONObject: $0) }.map { String(decoding: $0, as: UTF8.self) })
    }
    private var token: String? { get { storage.secret("online-token") } set { storage.setSecret("online-token", newValue) } }

    public var signedIn: Bool { token != nil }
    public var profile: [String: Any]? { json("profile") as? [String: Any] }
    public var resetUrl: String { baseUrl.isEmpty ? "" : baseUrl + "/reset" }

    @discardableResult
    private func api(_ method: String, _ route: String, _ body: Any? = nil, headers: [String: String] = [:]) async throws -> [String: Any] {
        guard !baseUrl.isEmpty, let url = URL(string: baseUrl + route) else { throw OnlineError(message: "BeerMat Online is not set up in this app", status: 0, offline: true) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: request) } catch { throw OnlineError(message: "No connection to BeerMat Online", status: 0, offline: true) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let out = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if status == 401 && route != "/v1/sessions" { token = nil }
        guard (200..<300).contains(status) else { throw OnlineError(message: (out["error"] as? String) ?? "BeerMat Online said \(status)", status: status, offline: false) }
        return out
    }

    private func keep(_ data: [String: Any]) -> [String: Any] {
        token = data["token"] as? String
        save("profile", data["account"])
        return data["account"] as? [String: Any] ?? [:]
    }

    public func signUp(email: String, password: String, displayName: String) async throws -> [String: Any] {
        keep(try await api("POST", "/v1/accounts", ["email": email, "password": password, "displayName": displayName]))
    }
    public func signIn(email: String, password: String) async throws -> [String: Any] {
        let account = keep(try await api("POST", "/v1/sessions", ["email": email, "password": password]))
        _ = try? await flush()
        return account
    }
    public func signOut() async { _ = try? await api("DELETE", "/v1/sessions"); token = nil; save("profile", nil) }
    @discardableResult public func refreshProfile() async throws -> [String: Any] { let p = try await api("GET", "/v1/me"); save("profile", p); return p }
    @discardableResult public func updateProfile(_ changes: [String: Any]) async throws -> [String: Any] { let p = try await api("PATCH", "/v1/me", changes); save("profile", p); return p }
    public func exportData() async throws -> [String: Any] { try await api("GET", "/v1/me/export") }
    public func resendVerify() async throws { try await api("POST", "/v1/me/verify") }
    public func deleteAccount() async throws { try await api("DELETE", "/v1/me"); token = nil; for n in ["profile", "outbox", "stats"] { save(n, nil) } }

    // ---- results: an outbox of signed claims ----
    public var outbox: [[String: Any]] { json("outbox") as? [[String: Any]] ?? [] }
    public struct Flushed { public let sent: Int, waiting: Int, problem: String? }

    @discardableResult
    public func flush() async throws -> Flushed {
        var left: [[String: Any]] = [], sent = 0, problem: String?
        for item in outbox {
            guard signedIn else { left.append(item); continue }
            do { try await api("POST", "/v1/me/results", ["claim": item["claim"] ?? [:]], headers: ["Idempotency-Key": item["key"] as? String ?? ""]); sent += 1 }
            catch let e as OnlineError {
                // A result the service will never accept (changed, or not from a quiz laptop) is dropped.
                if e.status == 422 || e.status == 400 { problem = e.message } else { left.append(item); problem = problem ?? e.message }
            }
        }
        save("outbox", left)
        return Flushed(sent: sent, waiting: left.count, problem: problem)
    }

    /// Keeps a team's signed result (from the quiz laptop at the end of the quiz) and sends it when it can.
    public func saveResult(_ claim: [String: Any]) async throws -> Flushed {
        let key = "\(claim["event"] ?? ""):\(claim["team"] ?? "")"
        var box = outbox
        if !box.contains(where: { $0["key"] as? String == key }) { box.append(["key": key, "claim": claim, "added": Date().timeIntervalSince1970 * 1000]); save("outbox", box) }
        return try await flush()
    }

    public func stats() async throws -> [String: Any] {
        do { var s = try await api("GET", "/v1/me/stats"); s["fetchedAt"] = Date().timeIntervalSince1970 * 1000; save("stats", s); s["stale"] = false; return s }
        catch let e as OnlineError { if e.offline, var cached = json("stats") as? [String: Any] { cached["stale"] = true; return cached }; throw e }
    }

    // ---- finding quizzes ----
    public func findEvents(q: String = "", lat: Double? = nil, lon: Double? = nil, radiusKm: Int? = nil) async throws -> [String: Any] {
        var items: [URLQueryItem] = []
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        // Locations are rounded to about 100 m before they leave the phone.
        if let lat, let lon { items += [URLQueryItem(name: "lat", value: String(format: "%.3f", lat)), URLQueryItem(name: "lon", value: String(format: "%.3f", lon))]
            if let radiusKm { items.append(URLQueryItem(name: "radiusKm", value: String(radiusKm))) } }
        var components = URLComponents(); components.queryItems = items
        let key = q.isEmpty ? "near" : "q:" + q.lowercased()
        var cache = json("events") as? [String: Any] ?? [:]
        do {
            let r = try await api("GET", "/v1/events" + (components.percentEncodedQuery.map { "?" + $0 } ?? ""))
            let now = Date().timeIntervalSince1970 * 1000
            cache[key] = ["events": r["events"] ?? [], "fetchedAt": now]
            save("events", cache)
            return ["events": r["events"] ?? [], "fetchedAt": now, "stale": false]
        } catch let e as OnlineError {
            if e.offline, var cached = cache[key] as? [String: Any] { cached["stale"] = true; return cached }
            throw e
        }
    }

    /// Every venue for the map. Offline: the last list seen, else the venue list on GitHub (only those on the map).
    public func venues() async throws -> [String: Any] {
        do {
            let r = try await api("GET", "/v1/venues")
            save("venues", ["venues": r["venues"] ?? []])
            return ["venues": r["venues"] ?? [], "stale": false, "source": "service"]
        } catch let e as OnlineError {
            if var cached = json("venues") as? [String: Any] { cached["stale"] = true; cached["source"] = "cache"; return cached }
            guard let url = URL(string: venueListUrl), let (data, _) = try? await session.data(from: url),
                  let list = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw e }
            let onMap = (list["venues"] as? [[String: Any]] ?? []).filter { $0["onMap"] as? Bool == true }
            return ["venues": onMap, "stale": true, "source": "list"]
        }
    }

    /// The venues this account runs (a phone signed in with one, or an admin's, can host that venue's quiz).
    public func myVenues() async throws -> [[String: Any]] { try await api("GET", "/v1/me/venues")["venues"] as? [[String: Any]] ?? [] }
    /// The account's open quiz laptops: where each can be reached (`addresses`, its quizmaster `link`) and its `role`.
    public func desks() async throws -> [[String: Any]] { try await api("GET", "/v1/me/desks")["desks"] as? [[String: Any]] ?? [] }
    /// A ticket for this phone to host the quiz on the laptop with `venueKey`: signed in to this account, the venue's own, or an admin.
    public func deckTicket(venueKey: String) async throws -> [String: Any] { try await api("POST", "/v1/deck-tickets", ["venueKey": venueKey])["ticket"] as? [String: Any] ?? [:] }
    /// Relay: a fallback connection to a laptop through BeerMat Online when it isn't directly reachable.
    public func relayConnect(venueKey: String) async throws -> [String: Any] { try await api("POST", "/v1/relay/connect", ["venueKey": venueKey]) }
    public func venue(_ id: String) async throws -> [String: Any] { try await api("GET", "/v1/venues/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)) }
    public func favourites() async throws -> [String: Any] { try await api("GET", "/v1/me/favourites") }
    public func favourite(_ id: String, on: Bool) async throws { try await api(on ? "PUT" : "DELETE", "/v1/me/favourites/" + id) }
}
