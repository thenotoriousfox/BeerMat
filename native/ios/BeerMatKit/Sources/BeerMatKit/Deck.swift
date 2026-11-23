import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The question in play, as the phone deck needs it (the host view of server.js's publicQuestion).
public struct DeckQuestion: Equatable {
    public let id: Int, text: String, type: String, round: String
    public let open: Bool, live: Bool, held: Bool, paused: Bool, revealed: Bool, revealing: Bool
    public let remaining: Double, answer: String, clips: Int, audio: Bool, buzzing: String?
    /// Wording only the desk shows until the reveal (hideText): the quizmaster reads it out.
    public var hideText = false
}

public struct DeckTeam: Equatable {
    public let name: String, score: Double, rank: Int, connected: Bool
}

/// A team's VAR Check waiting for a ruling: its answer and the question's full points (what Overturn gives).
public struct DeckVar: Equatable {
    public let id: Int, team: String, answer: String, full: Int
}

/// What a team answered to the question in play, its points, and whether its mark can be changed yet: as soon as the
/// team locks its answer in (server.js deckAnswers).
public struct DeckAnswer: Equatable {
    public let team: String, name: String, answer: String, points: Int, canMark: Bool
    /// Whether the team has answered yet (every team is listed), and a mark the quizmaster gave without one.
    public var answered = true, byHand = false
}

/// Every team's answer to the question in play: `full` is the question's points (Right); every mark can be changed
/// once answers close (`canMark`).
public struct DeckMarking: Equatable {
    public let question: Int, full: Int, canMark: Bool, rows: [DeckAnswer]
}

/// The current recap question being shown on the TV after a secret round.
public struct DeckRecap: Equatable {
    public let round: String, n: Int, count: Int, text: String, answer: String
}

/// The quiz as the phone deck (Run the night) shows it, from /api/host/state: what the big button does next (the
/// server's nextStep, as the Qt desk's Next), the question and what can be done with it (desk.py's canSend, canClose…),
/// and the teams. As DeckState.kt in the Android app.
/// A round about to start and how it works, as the quizmaster wrote it.
public struct DeckRound: Equatable {
    public let title: String, intro: String
}

public struct DeckState: Equatable {
    public let title: String, nextStep: String?, question: DeckQuestion?, teams: [DeckTeam], answered: Int
    public let back: String?, backAnswers: Int, deskOpen: Bool, revealSound: String?, fastRehearsal: Bool, rehearsal: Bool
    public var varChecks: [DeckVar] = []
    /// The next round's intro, for the quizmaster to read out before starting it (server.js nextRound).
    public var nextRound: DeckRound?
    /// What each team answered, to overrule the automatic marking.
    public var marking: DeckMarking?
    /// The current question being shown on the TV during a secret round recap (server.js recapState).
    public var recap: DeckRecap?

    public var canNext: Bool { nextStep != nil && question?.live != true }
    public var canSend: Bool { question.map { $0.held && $0.live } ?? false }
    public var canClose: Bool { question.map { ($0.open || $0.live) && !$0.revealed } ?? false }
    public var canReveal: Bool { question.map { !$0.open && !$0.live && !$0.revealed && !$0.revealing } ?? false }
    public var canPause: Bool { question.map { $0.open && !$0.paused } ?? false }
    public var canResume: Bool { question.map { $0.paused && !$0.held } ?? false }

    /// The answer to read: an answer sheet's lines (a music round's artist and title) when it has no single answer, and
    /// its note after it (a first letter's whole answer: "S · Scoville").
    static func answerText(_ o: [String: Any]) -> String {
        let answer = o.str("answer"), items = o.strings("items")
        let main = !answer.isEmpty ? withTolerance(answer, o.num("tolerance") ?? 0, percent: o.bool("tolerancePercent"))
            : o.strings("itemAnswers").enumerated().compactMap { i, a in a.isEmpty ? nil : i < items.count && !items[i].isEmpty ? "\(items[i]): \(a)" : a }.joined(separator: " · ")
        return [main, o.str("answerNote")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    public static func parse(_ s: [String: Any]) -> DeckState {
        let q = (s["question"] as? [String: Any]).map { o -> DeckQuestion in
            let media = o.str("media")
            var q = DeckQuestion(id: o.int("id"), text: o.str("text"), type: o.str("type"), round: o.str("round"),
                                open: o.bool("open"), live: o.bool("live"), held: o.bool("held"), paused: o.bool("paused"), revealed: o.bool("revealed"), revealing: o.bool("revealing"),
                                remaining: o.num("remaining") ?? 0, answer: answerText(o), clips: (o["clips"] as? [Any])?.count ?? 0,
                                audio: [".mp3", ".ogg", ".wav", ".mp4", ".webm"].contains { media.lowercased().hasSuffix($0) } || !((o["clip"] as? [String: Any])?.str("spotify") ?? "").isEmpty,
                                buzzing: ((o["buzz"] as? [String: Any])?["active"] as? [String: Any])?.str("name"))
            q.hideText = o.bool("hideText")
            return q
        }
        let teams = (s["teams"] as? [[String: Any]] ?? []).filter { $0.bool("enabled", true) && !$0.bool("waiting") }
            .map { DeckTeam(name: $0.str("name"), score: $0.num("score") ?? 0, rank: $0.int("rank"), connected: $0.bool("connected")) }
            .sorted { ($0.rank > 0 ? $0.rank : 999, $0.name.lowercased()) < ($1.rank > 0 ? $1.rank : 999, $1.name.lowercased()) }
        let back = s["back"] as? [String: Any], rehearsal = (s["rehearsal"] as? [String: Any])?["options"] as? [String: Any]
        let title = (s["settings"] as? [String: Any])?.str("title") ?? ""
        let step = s.str("nextStep")
        var state = DeckState(title: title.isEmpty ? "BeerMat" : title, nextStep: step.isEmpty ? nil : step, question: q, teams: teams,
                         answered: (s["answers"] as? [Any])?.count ?? 0, back: back.map { $0.str("label") }.flatMap { $0.isEmpty ? nil : $0 }, backAnswers: back?.int("answers") ?? 0,
                         deskOpen: s.bool("deskConnected"), revealSound: (((s["sounds"] as? [String: Any])?["slots"] as? [String: Any])?.str("reveal")).flatMap { $0.isEmpty ? nil : $0 },
                         fastRehearsal: rehearsal?.str("speed") == "fast", rehearsal: rehearsal != nil)
        state.varChecks = (s["varChecks"] as? [[String: Any]] ?? []).map { DeckVar(id: $0.int("id"), team: $0.str("name"), answer: $0.str("answer"), full: number($0["full"]).map { Int($0) } ?? 1) }
        state.nextRound = (s["nextRound"] as? [String: Any]).map { DeckRound(title: $0.str("title"), intro: $0.str("intro")) }.flatMap { $0.intro.isEmpty ? nil : $0 }
        state.marking = (s["deckAnswers"] as? [String: Any]).map { m in
            DeckMarking(question: m.int("question"), full: number(m["full"]).map { Int($0) } ?? 1, canMark: m.bool("canMark"),
                        rows: (m["rows"] as? [[String: Any]] ?? []).map { DeckAnswer(team: $0.str("team"), name: $0.str("name"), answer: $0.str("answer"), points: $0.int("points"),
                                                                              canMark: $0["canMark"] == nil ? m.bool("canMark") : $0.bool("canMark"),
                                                                              answered: $0.bool("answered", true), byHand: $0.bool("byHand")) })
        }.flatMap { $0.question == q?.id ? $0 : nil }
        state.recap = (s["recap"] as? [String: Any]).flatMap { r in
            guard r.bool("active"), let rq = r["question"] as? [String: Any] else { return nil }
            return DeckRecap(round: r.str("round"), n: r.int("shown") + 1, count: r.int("count"),
                             text: rq.str("text"), answer: answerText(rq))
        }
        return state
    }
}

/// Where the quiz laptop is, for a phone about to host it without the account (as TvFinder.kt in the Android app): the
/// last address that worked and BeerMat's hotspot. Signed in to BeerMat Online, the phone finds it through the account
/// instead (OnlineClient.desks): venue Wi-Fi often keeps devices apart, so searching its network finds nothing.
public enum DeckFinder {
    public static let hotspot = "10.42.0.1", deskPort = 3000

    public static func candidates(saved: String?) -> [String] {
        let list = [saved, hotspot, "\(hotspot):\(deskPort)"].compactMap { $0 }.filter { !$0.isEmpty }.compactMap { try? QuizServer.normalise($0) }
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
