import Foundation

/// The quiz server's player protocol (docs/CLIENT-PROTOCOL.md), version 1. Only what the app draws is read; unknown
/// fields are ignored, as the protocol requires. The server decides everything: these are views of its state.
public let supportedProtocol = 1

/// The eight synthesised buzzer sounds every quiz has (web/app.js `sounds`), before any the quizmaster adds.
public let builtInBuzzers = ["Classic buzz", "Doorbell", "Siren", "Beep beep", "Low horn", "Chime", "Laser", "Boing"]

public struct Hello: Equatable {
    public let proto: Int, title: String, rehearsal: Bool, registrationOpen: Bool
    public static func parse(_ o: [String: Any]) -> Hello? {
        guard o["app"] as? String == "BeerMat" else { return nil }
        return Hello(proto: o.int("protocol"), title: o.str("title", "BeerMat"), rehearsal: o.bool("rehearsal"), registrationOpen: o.bool("registrationOpen", true))
    }
}

public struct Joined: Equatable { public let secret: String, waiting: Bool, rehearsal: Bool }
public struct Team: Equatable { public let id: String, name: String, waiting: Bool; public var sound: Int? = nil; public var photo = ""; public var photoStatus = "" }
public struct Standing: Equatable { public let name: String, score: Double?, rank: Int }
public struct BuzzEntry: Equatable { public let team: String, name: String, status: String }
public struct Buzz: Equatable {
    public let buzzed: String?, activeName: String?, queue: [BuzzEntry], lockedOut: Bool, agreeOpen: Bool, agreed: Bool, announced: String
}

public struct Question: Equatable {
    public let id: Int, type: String, round: String, text: String
    public let options: [String], items: [String], order: [Int], pieces: [String]
    public let media: String, points: Double, seconds: Int
    public let deadline: Double, remaining: Double, open: Bool, live: Bool, paused: Bool, revealed: Bool
    public let answer: String?, answerNote: String, buzz: Buzz?
    public var wordLengths: [Int] = []
    /// The whole question as the server sent it, for the formats with more to draw (bingo, word snake, clips…).
    public var raw: [String: Any] = [:]
    public var isTimed: Bool { type != "bingo" && type != "musicbingo" }
    public static func == (a: Question, b: Question) -> Bool { a.id == b.id && a.open == b.open && a.revealed == b.revealed && a.paused == b.paused }
}

public struct Answer { public let value: Any?, points: Double? }
public struct Settings: Equatable { public let title: String, ended: Bool, registrationOpen: Bool, scrambleKeypads: Bool, leaderboardVisible: Bool; public var teamPhotos = false }

public struct PlayerState {
    public let proto: Int, serverTime: Double, build: String, event: String
    public let settings: Settings, team: Team?, question: Question?, answer: Answer?, draft: Any?
    public let teams: [Standing]
    /// The extra buzzer sounds the quizmaster added (after the eight built-in ones).
    public var buzzerNames: [String] = []
    /// A real phone in a rehearsal: connected, never playing.
    public let testDevice: Bool

    public static func parse(_ o: [String: Any]) -> PlayerState {
        let s = o["settings"] as? [String: Any] ?? [:]
        let team = (o["team"] as? [String: Any]).map { t in Team(id: t.str("id"), name: t.str("name"), waiting: t.bool("waiting"), sound: number(t["sound"]).map { Int($0) }, photo: t.str("photo"), photoStatus: t.str("photoStatus")) }
        var settings = Settings(title: s.str("title", "BeerMat"), ended: s.bool("ended"), registrationOpen: s.bool("registrationOpen", true),
                                scrambleKeypads: s.bool("scrambleKeypads"), leaderboardVisible: s.bool("leaderboardVisible", true))
        settings.teamPhotos = s.bool("teamPhotos")
        var state = PlayerState(
            proto: o.int("protocol"), serverTime: o.num("serverTime") ?? Date().timeIntervalSince1970 * 1000, build: o.str("build"), event: o.str("event"),
            settings: settings,
            team: team, question: (o["question"] as? [String: Any]).map(Question.parse),
            answer: (o["answer"] as? [String: Any]).map { Answer(value: $0["value"], points: $0.num("points")) },
            draft: (o["draft"] as? [String: Any])?["value"],
            teams: (o["teams"] as? [[String: Any]] ?? []).map { Standing(name: $0.str("name"), score: $0.num("score"), rank: $0.int("rank")) },
            testDevice: (o["rehearsal"] as? [String: Any])?.bool("device") == true)
        state.buzzerNames = ((o["sounds"] as? [String: Any])?["buzzers"] as? [[String: Any]] ?? []).map { $0.str("name") }
        return state
    }
}

extension Question {
    public static func parse(_ q: [String: Any]) -> Question {
        let answer: String? = {
            switch q["answer"] {
            case let s as String: return s
            case let a as [Any]: return a.map { "\($0)" }.joined(separator: ", ")
            case let v? where number(v) != nil: let n = number(v)!; return n == n.rounded() ? String(Int(n)) : String(n)
            default: return nil
            }
        }()
        let buzz = (q["buzz"] as? [String: Any]).map { b in
            Buzz(buzzed: b["buzzed"] as? String, activeName: (b["active"] as? [String: Any])?.str("name"),
                 queue: (b["queue"] as? [[String: Any]] ?? []).map { BuzzEntry(team: $0.str("team"), name: $0.str("name"), status: $0.str("status")) },
                 lockedOut: b.bool("lockedOut"), agreeOpen: b.bool("agreeOpen"), agreed: b.bool("agreed"), announced: b.str("announced"))
        }
        var question = Question(id: q.int("id"), type: q.str("type"), round: q.str("round"), text: q.str("text"),
                        options: q.strings("options"), items: q.strings("items"), order: (q["order"] as? [Any] ?? []).compactMap { number($0).map { Int($0) } },
                        pieces: q.strings("pieces"), media: q.str("media"), points: q.num("points") ?? 0, seconds: q.int("seconds"),
                        deadline: q.num("deadline") ?? 0, remaining: q.num("remaining") ?? 0, open: q.bool("open"), live: q.bool("live"),
                        paused: q.bool("paused"), revealed: q.bool("revealed"), answer: answer, answerNote: q.str("answerNote"), buzz: buzz)
        question.wordLengths = (q["wordLengths"] as? [Any] ?? []).compactMap { number($0).map { Int($0) } }
        question.raw = q
        return question
    }
}

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String, _ fallback: String = "") -> String { self[k] as? String ?? fallback }
    // JSONSerialization gives NSNumber on Apple platforms and Swift numbers on Linux: accept both.
    func bool(_ k: String, _ fallback: Bool = false) -> Bool { (self[k] as? Bool) ?? (self[k] as? NSNumber)?.boolValue ?? fallback }
    func num(_ k: String) -> Double? { number(self[k]) }
    func int(_ k: String) -> Int { number(self[k]).map { Int($0) } ?? 0 }
    func strings(_ k: String) -> [String] { (self[k] as? [Any] ?? []).map { $0 as? String ?? "\($0)" } }
}

func number(_ v: Any?) -> Double? {
    switch v {
    case let d as Double: return d
    case let i as Int: return Double(i)
    case let n as NSNumber: return n.doubleValue
    default: return nil
    }
}
