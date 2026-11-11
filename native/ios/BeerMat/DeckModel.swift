import AVFoundation
import Foundation
import UIKit

enum DeckStage { case find, code, run }

/// Run the night: this phone hosting the quiz on the laptop, beside the Qt desk (the deck routes in server.js), as
/// DeckViewModel.kt in the Android app. Signed in to BeerMat Online, it finds the laptop through the account (venue
/// Wi-Fi often keeps devices apart): its address on this network if it answers, else its quizmaster link, with a
/// ticket for it. Without the account, on BeerMat's quiz Wi-Fi, with the code the desk shows. Then it does what the
/// desk's Next, Close and Reveal do. Clips, songs and audio play from the laptop: the phone asks the desk.
@MainActor
final class DeckModel: ObservableObject {
    @Published var stage: DeckStage = .find
    @Published var searching = false
    /// The account's laptops running a quiz, to choose from.
    @Published var laptops: [[String: Any]] = []
    @Published var address = UserDefaults.standard.string(forKey: "deck:address") ?? ""
    @Published var title = ""
    @Published var deck: DeckState?
    @Published var busy = false
    @Published var message = ""
    @Published var isError = false
    private var server: QuizServer?
    private var key: String? = UserDefaults.standard.string(forKey: "deck:key")
    private var following: Task<Void, Never>?
    weak var online: OnlineModel?

    init() { if !address.isEmpty && key != nil { connect(address) } }

    private var name: String {
        let me = online?.profile?["displayName"] as? String ?? ""
        return me.isEmpty ? UIDevice.current.name : t("{name}’s phone", ["name": me])
    }

    func say(_ text: String, error: Bool = false) { message = text; isError = error }

    private func work(_ block: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true; message = ""; isError = false
        Task {
            do { try await block() } catch { say(error.localizedDescription, error: true) }
            busy = false
        }
    }

    /// The first of `places` answering as a BeerMat quiz, each given two and a half seconds.
    private static func firstQuiz(_ places: [String]) async -> (String, String)? {
        await DeckFinder.find(places) { base in
                guard let s = try? QuizServer(base) else { return nil }
                return try? await withThrowingTaskGroup(of: String?.self) { group in
                    group.addTask { (try? await s.deckHello())?.str("title") }
                    group.addTask { try await Task.sleep(nanoseconds: 2_500_000_000); return nil }
                    let first = try await group.next() ?? nil
                    group.cancelAll()
                    return first
                }
            }
    }

    /// Where the laptop is: through the account when signed in; otherwise the last address and the quiz Wi-Fi.
    func search() {
        guard !searching else { return }
        searching = true; message = ""; laptops = []
        Task {
            defer { searching = false }
            if let client = online?.client, client.signedIn {
                do {
                    let open = try await client.desks().filter { $0.str("role") != "remote" }
                    if open.isEmpty { say(t("No quiz laptop is open on your account. Open BeerMat on the laptop, signed in to BeerMat Online."), error: true) }
                    else if open.count == 1 { self.open(open[0]) } else { laptops = open }
                    return
                } catch { say(error.localizedDescription, error: true) }
            }
            let found = await Self.firstQuiz(DeckFinder.candidates(saved: UserDefaults.standard.string(forKey: "deck:address")))
            if let found { connect(found.0) } else { say(t("No quiz found. Sign in to BeerMat Online (Profile) with the laptop’s account, or join the quiz Wi-Fi, or type the laptop’s address."), error: true) }
        }
    }

    /// One of the account's laptops: its address on this network if it answers, else its quizmaster link.
    func open(_ laptop: [String: Any]) {
        laptops = []
        work {
            let addresses = laptop["addresses"] as? [String] ?? []
            let link = laptop.str("link")
            guard let base = await Self.firstQuiz(addresses)?.0 ?? (link.hasPrefix("https://") ? link : nil) else {
                throw QuizError(message: t("{name} can’t be reached: it has no quizmaster link yet. Check it’s on the internet.", ["name": laptop.str("name")]), status: 0)
            }
            guard let client = self.online?.client else { return }
            let s = try QuizServer(base)
            self.server = s; self.address = s.base; self.title = laptop.str("title")
            let ticket = try await client.deckTicket(venueKey: laptop.str("venueKey"))
            self.signedIn(try await s.deckLogin(name: self.name, ticket: ticket))
        }
    }

    /// The laptop at `address`: a ticket from BeerMat Online if this account may host there, else the desk's code.
    func connect(_ address: String) {
        work {
            let s = try QuizServer(address)
            let hello = try await s.deckHello()
            self.server = s
            UserDefaults.standard.set(s.base, forKey: "deck:address")
            self.address = s.base; self.title = hello.str("title")
            // Back to a laptop this phone already hosts: its key still works until the desk takes it off.
            if let key = self.key, UserDefaults.standard.string(forKey: "deck:keyFor") == s.base, (try? await s.host(key, "state")) != nil { return self.run() }
            var ticket: [String: Any]?
            if let client = self.online?.client, client.signedIn {
                do { ticket = try await client.deckTicket(venueKey: hello.str("venueKey")) } catch { self.say(error.localizedDescription, error: true) }
            }
            guard let ticket else { self.stage = .code; return }
            self.signedIn(try await s.deckLogin(name: self.name, ticket: ticket))
        }
    }

    func code(_ code: String) { work { guard let s = self.server else { return }; self.signedIn(try await s.deckLogin(name: self.name, code: code)) } }

    private func signedIn(_ newKey: String) {
        key = newKey
        UserDefaults.standard.set(newKey, forKey: "deck:key"); UserDefaults.standard.set(server?.base, forKey: "deck:keyFor")
        run()
    }

    private func run() {
        stage = .run
        following?.cancel()
        guard let s = server, let k = key else { return }
        following = Task { [weak self] in
            await self?.refresh()
            for await on in s.updates(k) where on { await self?.refresh() }
        }
    }

    private func refresh() async {
        guard let s = server, let k = key else { return }
        do {
            let d = DeckState.parse(try await s.host(k, "state"))
            deck = d
            // The answer appears when the TV's drum roll ends, which nothing announces: look again until it has.
            if d.question?.revealing == true { Task { try? await Task.sleep(nanoseconds: 1_000_000_000); await self.refresh() } }
        }
        catch let e as QuizError where e.status == 401 || e.status == 403 { signedOut(t("The desk has taken this phone off. Sign in again to host."), error: true) }
        catch {}
    }

    private func signedOut(_ why: String, error: Bool) {
        following?.cancel(); key = nil
        UserDefaults.standard.removeObject(forKey: "deck:key"); UserDefaults.standard.removeObject(forKey: "deck:keyFor")
        stage = .find; deck = nil
        say(why, error: error)
    }

    func leave() {
        work {
            if let s = self.server, let k = self.key { _ = try? await s.host(k, "logout") }
            self.signedOut(t("This phone no longer hosts the quiz"), error: false)
        }
    }

    /// One of the desk's routes; `done` is said when it works.
    private func act(_ route: String, _ body: [String: Any] = [:], _ done: String) {
        work {
            guard let s = self.server, let k = self.key else { return }
            try await s.host(k, route, body)
            self.say(done); await self.refresh()
        }
    }

    private var current: Any { deck?.question?.id ?? NSNull() }

    // ---- as the Qt desk's Next, Back, Send, Close, Reveal, Pause (desk.py) ----
    func next() {
        guard let d = deck, d.canNext, let step = d.nextStep else { return }
        switch step {
        case "finish":
            work {
                guard let s = self.server, let k = self.key else { return }
                try await s.host(k, "settings", ["ended": true, "leaderboardVisible": true])
                if d.question != nil { try await s.host(k, "board", ["action": "show"]) }
                self.say(t("Quiz finished: the final standings are on the TV")); await self.refresh()
            }
        case "show": act("board", ["action": "show"], t("Leaderboard on the TV"))
        case "recap": act("recap", ["action": "start"], t("The secret round’s first answer is on the TV"))
        case "recapAnswer", "recapResults": act("recap", ["action": "next"], step == "recapResults" ? t("The round’s results are on the TV") : t("Next secret answer revealed"))
        case "reveal", "revealFirst", "revealSecond":
            act("board", ["action": "next"], step == "revealFirst" ? t("The leader revealed") : step == "revealSecond" ? t("Second place revealed: the full board") : t("Next position revealed"))
        default: act("next", ["expectedQuestion": current], t("Next question opened"))
        }
    }

    func back() {
        guard let label = deck?.back else { return }
        work {
            guard let s = self.server, let k = self.key, let step = try await s.host(k, "state")["back"] as? [String: Any] else { return }
            var body: [String: Any] = ["kind": step.str("kind")]
            if step.int("answers") > 0 { body["discard"] = true }
            try await s.host(k, "back", body)
            self.say(t("Back: {step}", ["step": label.prefix(1).lowercased() + label.dropFirst()])); await self.refresh()
        }
    }

    func send() { if deck?.canSend == true { act("send", [:], t("Question sent to the phones")) } }
    /// VAR Check ruling: overturned gives the question's points; either way the TV shows the decision.
    /// Overrule the automatic marking: this team's points for the question in play.
    func mark(_ team: DeckAnswer, _ points: Int) { act("mark", ["team": team.team, "question": current, "points": points], t("{team}: {points} points", ["team": team.name, "points": points])) }
    func ruleVar(_ check: Int, _ decision: String) { act("var", ["id": check, "decision": decision], decision == "overturned" ? t("VAR Check: overturned") : t("VAR Check: the decision stands")) }
    func close() { if deck?.canClose == true { act("close", ["expectedQuestion": current], t("Answers closed")) } }
    func pause() { if deck?.canPause == true { act("pause", ["expectedQuestion": current], t("Timer paused")) } }
    func resume() { if deck?.canResume == true { act("resume", ["expectedQuestion": current], t("Timer resumed")) } }

    /// The TV plays the drum roll and the answer appears as it ends (up to 10 s), as on the desk.
    func reveal() {
        guard let d = deck, d.canReveal, let q = d.question else { return }
        work {
            guard let s = self.server, let k = self.key else { return }
            var delay = 0
            if !d.fastRehearsal, let sound = d.revealSound, let url = URL(string: sound.hasPrefix("http") ? sound : s.base + sound),
               let length = try? await AVURLAsset(url: url).load(.duration) { delay = min(10000, Int(length.seconds * 1000)) }
            try await s.host(k, "reveal", ["question": q.id, "revealed": true, "delay": delay])
            self.say(delay > 0 ? t("Drum roll… the answer appears in {n}s", ["n": (delay + 999) / 1000]) : t("Answer revealed on the TV")); await self.refresh()
        }
    }

    func buzz(_ action: String) {
        guard let q = deck?.question else { return }
        act("buzz", ["question": q.id, "action": action, "announced": ""], action == "correct" ? t("Marked correct") : action == "wrong" ? t("Marked wrong") : t("Passed to the next buzzer"))
    }

    /// Clips, songs, bingo calls and audio play from the laptop: the desk does them.
    func desk(_ action: String, _ value: Int? = nil) {
        var body: [String: Any] = ["action": action]
        if let value { body["value"] = value }
        act("deck-command", body, t("Asked the desk"))
    }
}
