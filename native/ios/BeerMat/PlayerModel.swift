import Foundation
import SwiftUI
import UIKit

/// Round formats the app draws itself; any other opens the quiz's own player page in Safari (same team).
let nativeTypes: Set<String> = ["text", "picture", "audio", "choice", "vote", "multi", "letter", "number", "nearest", "sequence", "tiles", "sheet", "buzzer",
                                 "pinpoint", "wordsnake", "bingo", "musicbingo", "clips"]

enum Stage { case connect, join, play }

/// The player's side of a quiz. It shows the server's state and sends what the team does; the server times, checks
/// and scores everything (docs/CLIENT-PROTOCOL.md), so nothing here decides a score, a deadline or who may play.
@MainActor
final class PlayerModel: ObservableObject {
    @Published var stage: Stage = .connect
    @Published var hello: Hello?
    @Published var game: PlayerState?
    @Published var connected = false
    @Published var busy = false
    @Published var message = ""
    @Published var isError = false
    @Published var wifi: (ssid: String, password: String)?
    @Published var recent: [Identity.Recent] = []
    /// Server clock minus this phone's (ms), so countdowns run locally between updates.
    @Published var offset: Double = 0
    private(set) var secret = ""

    private let identity = Identity()
    private var server: QuizServer?
    private var live: Task<Void, Never>?
    private var seenQuestion: Int?
    private var buzzTurn: Int?

    var serverBase: String { server?.base ?? "" }
    var haptics: Bool { get { identity.haptics } set { identity.haptics = newValue; objectWillChange.send() } }

    init() { recent = identity.recent }

    func say(_ text: String, error: Bool = false) { message = text; isError = error }

    // ---- connecting ----
    func scanned(_ text: String) {
        switch Scanned.parse(text) {
        case .address(let url): connect(url)
        case .wifi(let ssid, let password): wifi = (ssid, password)
        case .unknown: say(t("That code isn’t a BeerMat quiz."), error: true)
        }
    }

    func connect(_ address: String) {
        guard let quiz = try? QuizServer(address) else { return say(t("That doesn’t look like a quiz address."), error: true) }
        work {
            let hello = try await quiz.hello()
            if hello.proto > supportedProtocol { throw QuizError(message: "This quiz needs a newer BeerMat app. You can still play in Safari.", status: 0) }
            self.server = quiz; self.hello = hello
            self.identity.remember(server: quiz.base, title: hello.title); self.recent = self.identity.recent
            if let saved = self.identity.secret(for: quiz.base), await self.resume(saved) { return }
            self.stage = .join
        }
    }

    private func resume(_ secret: String) async -> Bool {
        do { play(secret, try await server!.state(secret)); return true } catch let e as QuizError {
            if e.status == 401 { identity.forget(server: server!.base); say(t("A new quiz has started — pick your team name again.")) } else { say(e.message, error: true) }
            return false
        } catch { return false }
    }

    func join(_ name: String, table: Int? = nil) {
        work {
            let joined = try await self.server!.join(name.trimmingCharacters(in: .whitespaces), table: table)
            self.play(joined.secret, try await self.server!.state(joined.secret))
        }
    }

    func recover(_ code: String) {
        work {
            let c = code.trimmingCharacters(in: .whitespaces)
            let secret = c.count == 4 && c.allSatisfy(\.isNumber) ? try await self.server!.transfer(c) : c
            self.play(secret, try await self.server!.state(secret))
            self.say(t("Welcome back"))
        }
    }

    func leave() {
        live?.cancel(); live = nil; server = nil; seenQuestion = nil; secret = ""
        stage = .connect; game = nil; hello = nil; message = ""; recent = identity.recent
    }

    func switchTeam() {
        if let s = server { identity.forget(server: s.base) }
        live?.cancel(); live = nil; secret = ""; game = nil; stage = .join
    }

    // ---- playing ----
    private func play(_ secret: String, _ state: PlayerState) {
        self.secret = secret
        show(state)
        stage = .play
        live?.cancel()
        let quiz = server!
        live = Task { [weak self] in
            await withTaskGroup(of: Void.self) { group in
                group.addTask { for await on in quiz.updates(secret) { await MainActor.run { self?.connected = on }; if on { await self?.refresh() } } }
                // A slow poll covers missed updates, as the web page does.
                group.addTask { while !Task.isCancelled { try? await Task.sleep(nanoseconds: 15_000_000_000); await self?.refresh() } }
            }
        }
    }

    func refresh() async {
        guard let quiz = server, !secret.isEmpty else { return }
        do { show(try await quiz.state(secret)) } catch let e as QuizError {
            if e.status == 401 {
                identity.forget(server: quiz.base); live?.cancel(); game = nil; secret = ""; stage = .join
                say(t("A new quiz has started — pick your team name again."))
            } else { say(e.message, error: true) }
        } catch { connected = false }
    }

    private func show(_ state: PlayerState) {
        if let q = state.question {
            if q.open && !state.testDevice, let seen = seenQuestion, seen != q.id { nudge() }
            seenQuestion = q.id
            if q.buzz?.buzzed == "active" && buzzTurn != q.id { buzzTurn = q.id; nudge() }
        } else if seenQuestion == nil { seenQuestion = 0 }
        if let s = server { identity.save(secret: secret, server: s.base, team: state.team?.name ?? "", event: state.event) }
        offset = state.serverTime - Date().timeIntervalSince1970 * 1000
        game = state; connected = true
    }

    /// A short buzz in the pocket: a new question, or the team's buzzer turn.
    private func nudge() { if identity.haptics { UINotificationFeedbackGenerator().notificationOccurred(.warning) } }

    func submit(_ value: Any, wager: Int? = nil) {
        guard let q = game?.question else { return }
        work(quiet: true) { try await self.server!.answer(self.secret, question: q.id, value: value, wager: wager); self.say(t("Final answer received")); await self.refresh() }
    }

    func saveDraft(_ value: Any) {
        guard let q = game?.question, let quiz = server else { return }
        let secret = self.secret
        Task { try? await quiz.draft(secret, question: q.id, value: value) }
    }

    /// Bingo dabs stay on the phone, as on paper (the server checks the ticket against the calls).
    @Published var dabs: [Int: Set<String>] = [:]
    func dab(_ question: Int, _ cell: String) { var now = dabs[question] ?? []; if now.contains(cell) { now.remove(cell) } else { now.insert(cell) }; dabs[question] = now }

    func claimBingo() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.bingo(self.secret, question: q.id); self.say(t("BINGO called — the quizmaster is checking")); await self.refresh() } }
    /// Music bingo's reaction table: one go per song, so the songs tried are remembered.
    @Published var reacted: Set<String> = []
    func react(_ title: String?) {
        guard let q = game?.question, let song = q.reactionSong, song > 0, !reacted.contains("\(q.id):\(song)") else { return }
        reacted.insert("\(q.id):\(song)")
        Task {
            do { try await server?.react(secret, question: q.id, title: title); say(title == nil ? t("Passed on this song") : t("Dabbed: if it’s the song playing, your time is on the TV")) }
            catch { say(error.localizedDescription, error: true) }
        }
    }
    func tap() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.tap(self.secret, question: q.id); self.say(t("Tap recorded")); await self.refresh() } }
    func fifty() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.fifty(self.secret, question: q.id); await self.refresh() } }
    func goWide() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.goWide(self.secret, question: q.id); await self.refresh() } }
    func rename(_ name: String) { work(quiet: true) { try await self.server!.rename(self.secret, name: name.trimmingCharacters(in: .whitespaces)); self.say(t("Team name saved")); await self.refresh() } }
    /// VAR Check: ask the quizmaster to look at this team's marking of the question again.
    func askVar(_ question: Int) { work(quiet: true) { try await self.server!.varCheck(self.secret, question: question); self.say(t("VAR Check sent: the quizmaster is reviewing it")); await self.refresh() } }
    func setSound(_ index: Int) { work(quiet: true) { try await self.server!.sound(self.secret, index: index); self.say(t("Buzzer sound saved")); await self.refresh() } }

    /// A picture from the phone, cropped square to 360 px and sent as a JPEG (as the browser player does).
    func setPhoto(_ data: Data) {
        guard let image = UIImage(data: data) else { return say("That picture couldn't be read", error: true) }
        let side = min(image.size.width, image.size.height)
        let crop = CGRect(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2, width: side, height: side)
        let jpeg = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 360), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).jpegData(withCompressionQuality: 0.85) { _ in
            image.draw(in: CGRect(x: -crop.minX * 360 / side, y: -crop.minY * 360 / side, width: image.size.width * 360 / side, height: image.size.height * 360 / side))
        }
        work(quiet: true) { try await self.server!.photo(self.secret, jpeg: jpeg); self.say(t("Photo sent: the quizmaster approves it first")); await self.refresh() }
    }

    /// The signed result to keep (after the quiz ends).
    func result() async -> [String: Any]? {
        do { return try await server?.result(secret) } catch let e as QuizError { say(e.message, error: true); return nil } catch { say(t("Can’t reach the quiz"), error: true); return nil }
    }

    func buzz() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.buzz(self.secret, question: q.id); await self.refresh() } }
    func agree() { guard let q = game?.question else { return }; work(quiet: true) { try await self.server!.agree(self.secret, question: q.id); await self.refresh() } }

    /// The app went to the background (or came back) during an open question: the quizmaster sees it.
    func away(_ state: String) {
        guard let q = game?.question, q.live, game?.answer == nil, game?.testDevice == false, let quiz = server else { return }
        let secret = self.secret
        Task { try? await quiz.away(secret, question: q.id, state: state) }
        if state == "back" { Task { await refresh() } }
    }

    /// The quiz's own player page, already signed in as this team (for formats the app doesn't draw).
    var webPlayerURL: URL? { URL(string: "\(serverBase)/#team=\(secret)") }

    private func work(quiet: Bool = false, _ block: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        if !quiet { message = "" }
        Task {
            do { try await block() } catch let e as QuizError { say(e.message, error: true) } catch {
                say(t("Can’t reach the quiz. Check you’re on the quiz Wi-Fi, then try again."), error: true)
            }
            busy = false
        }
    }
}
