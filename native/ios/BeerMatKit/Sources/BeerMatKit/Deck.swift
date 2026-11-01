import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The question in play, as the phone deck needs it (the host view of server.js's publicQuestion).
public struct DeckQuestion: Equatable {
    public let id: Int, text: String, type: String, round: String
    public let open: Bool, live: Bool, held: Bool, paused: Bool, revealed: Bool, revealing: Bool
    public let remaining: Double, answer: String, clips: Int, audio: Bool, buzzing: String?
}

public struct DeckTeam: Equatable {
    public let name: String, score: Double, rank: Int, connected: Bool
}

/// The quiz as the phone deck (Run the night) shows it, from /api/host/state: what the big button does next (the
/// server's nextStep, as the Qt desk's Next), the question and what can be done with it (desk.py's canSend, canClose…),
/// and the teams. As DeckState.kt in the Android app.
public struct DeckState: Equatable {
    public let title: String, nextStep: String?, question: DeckQuestion?, teams: [DeckTeam], answered: Int
    public let back: String?, backAnswers: Int, deskOpen: Bool, revealSound: String?, fastRehearsal: Bool, rehearsal: Bool

    public var canNext: Bool { nextStep != nil && question?.live != true }
    public var canSend: Bool { question.map { $0.held && $0.live } ?? false }
    public var canClose: Bool { question.map { ($0.open || $0.live) && !$0.revealed } ?? false }
    public var canReveal: Bool { question.map { !$0.open && !$0.live && !$0.revealed && !$0.revealing } ?? false }
    public var canPause: Bool { question.map { $0.open && !$0.paused } ?? false }
    public var canResume: Bool { question.map { $0.paused && !$0.held } ?? false }

    public static func parse(_ s: [String: Any]) -> DeckState {
        let q = (s["question"] as? [String: Any]).map { o -> DeckQuestion in
            let media = o.str("media")
            return DeckQuestion(id: o.int("id"), text: o.str("text"), type: o.str("type"), round: o.str("round"),
                                open: o.bool("open"), live: o.bool("live"), held: o.bool("held"), paused: o.bool("paused"), revealed: o.bool("revealed"), revealing: o.bool("revealing"),
                                remaining: o.num("remaining") ?? 0, answer: o.str("answer"), clips: (o["clips"] as? [Any])?.count ?? 0,
                                audio: [".mp3", ".ogg", ".wav"].contains { media.lowercased().hasSuffix($0) },
                                buzzing: ((o["buzz"] as? [String: Any])?["active"] as? [String: Any])?.str("name"))
        }
        let teams = (s["teams"] as? [[String: Any]] ?? []).filter { $0.bool("enabled", true) && !$0.bool("waiting") }
            .map { DeckTeam(name: $0.str("name"), score: $0.num("score") ?? 0, rank: $0.int("rank"), connected: $0.bool("connected")) }
            .sorted { ($0.rank > 0 ? $0.rank : 999, $0.name.lowercased()) < ($1.rank > 0 ? $1.rank : 999, $1.name.lowercased()) }
        let back = s["back"] as? [String: Any], rehearsal = (s["rehearsal"] as? [String: Any])?["options"] as? [String: Any]
        let title = (s["settings"] as? [String: Any])?.str("title") ?? ""
        let step = s.str("nextStep")
        return DeckState(title: title.isEmpty ? "BeerMat" : title, nextStep: step.isEmpty ? nil : step, question: q, teams: teams,
                         answered: (s["answers"] as? [Any])?.count ?? 0, back: back.map { $0.str("label") }.flatMap { $0.isEmpty ? nil : $0 }, backAnswers: back?.int("answers") ?? 0,
                         deskOpen: s.bool("deskConnected"), revealSound: (((s["sounds"] as? [String: Any])?["slots"] as? [String: Any])?.str("reveal")).flatMap { $0.isEmpty ? nil : $0 },
                         fastRehearsal: rehearsal?.str("speed") == "fast", rehearsal: rehearsal != nil)
    }
}

/// Where the quiz laptop is, for a phone about to host it (as TvFinder.kt in the Android app): the last address that
/// worked, BeerMat's hotspot, then every address on the phone's own network at the desk's port.
public enum DeckFinder {
    public static let hotspot = "10.42.0.1", deskPort = 3000

    public static func candidates(saved: String?, own: String?) -> [String] {
        var list = [saved, hotspot, "\(hotspot):\(deskPort)"].compactMap { $0 }.filter { !$0.isEmpty }.compactMap { try? QuizServer.normalise($0) }
        let parts = (own ?? "").split(separator: ".").compactMap { Int($0) }
        if parts.count == 4 { list += (1...254).filter { $0 != parts[3] }.map { "http://\(parts[0]).\(parts[1]).\(parts[2]).\($0):\(deskPort)" } }
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    /// The first place that answers as a BeerMat quiz, in order, a batch at a time.
    public static func find(_ places: [String], batch: Int = 48, probe: @escaping @Sendable (String) async -> String?) async -> (String, String)? {
        var start = 0
        while start < places.count {
            let chunk = Array(places[start..<min(start + batch, places.count)])
            let found = await withTaskGroup(of: (Int, String, String)?.self) { group -> (String, String)? in
                for (i, base) in chunk.enumerated() { group.addTask { await probe(base).map { (i, base, $0) } } }
                var hits: [(Int, String, String)] = []
                for await hit in group { if let hit { hits.append(hit) } }
                return hits.min { $0.0 < $1.0 }.map { ($0.1, $0.2) }
            }
            if let found { return found }
            start += batch
        }
        return nil
    }
}

extension QuizServer {
    /// The laptop's quiz, for a phone about to host it: its title and the laptop's venue key (for a ticket).
    public func deckHello() async throws -> [String: Any] {
        let o = try await request("GET", "/api/deck/hello")
        guard o.str("app") == "BeerMat" else { throw QuizError(message: "That address isn’t a BeerMat quiz.", status: 0) }
        return o
    }

    /// Signs this phone in as a host, with a ticket from BeerMat Online or the desk's code. Returns its key.
    public func deckLogin(name: String, ticket: [String: Any]? = nil, code: String? = nil) async throws -> String {
        var body: [String: Any] = ["name": name]
        if let ticket { body["ticket"] = ticket }
        if let code { body["code"] = code }
        return try await request("POST", "/api/deck/login", body).str("key")
    }

    /// One of the desk's own routes (/api/host/<route>), as the host.
    @discardableResult
    public func host(_ key: String, _ route: String, _ body: [String: Any] = [:]) async throws -> [String: Any] {
        try await request("POST", "/api/host/" + route, body, key)
    }
}
