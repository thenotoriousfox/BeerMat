import AVFoundation
import PhotosUI
import SwiftUI

private let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map(String.init)

struct PlayView: View {
    @EnvironmentObject var model: PlayerModel
    @State private var menu = false

    var body: some View {
        VStack(spacing: 0) {
            // Team bar: name, score, connection.
            HStack {
                Circle().fill(model.connected ? Brand.good : Brand.bad).frame(width: 10, height: 10)
                    .accessibilityLabel(model.connected ? t("Connected") : t("Reconnecting"))
                Text(model.game?.team?.name ?? "").fontWeight(.bold).lineLimit(1)
                Spacer()
                if let game = model.game, game.settings.leaderboardVisible, let mine = game.board.first(where: { $0.name == game.team?.name }), let score = mine.score {
                    Text(t("#{rank} · {score} pts", ["rank": mine.rank, "score": format(score)])).fontWeight(.bold).foregroundStyle(Brand.goldHi)
                }
                Button(menu ? t("Close") : t("Team")) { menu.toggle() }.foregroundStyle(Brand.muted)
            }.padding(.horizontal, 18).padding(.vertical, 12).background(Brand.panel)
            if !model.connected {
                Text(t("Connection lost — reconnecting…")).fontWeight(.bold).foregroundStyle(Brand.onAccent).frame(maxWidth: .infinity).padding(6).background(Brand.bad)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if menu { TeamMenu() } else if let game = model.game {
                        if game.team?.waiting == true { Lobby(title: t("You’re in the waiting room"), text: t("The quizmaster will let you in shortly.")) }
                        else if game.settings.ended { Lobby(title: t("That’s the quiz!"), text: t("Thanks for playing. Final scores are on the TV.")); KeepResult() }
                        else if let q = game.question {
                            if nativeTypes.contains(q.type) { QuestionView(q: q).id(q.id) } else { BrowserRound(q: q) }
                        } else { Lobby(title: t("You’re in!"), text: t("Waiting for the quiz to start. Keep this app open.")); TeamSetup() }
                        // Between questions the leaderboard, as on the browser player and the TV.
                        if let q = game.question, !q.live, !game.settings.ended, game.team?.waiting != true { Leaderboard(game: game) }
                    }
                    MessageText()
                }.padding(20)
            }
        }
    }
}

private func format(_ n: Double) -> String { n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n) }

/// The leaderboard between questions; during the TV's reveal, only the places it has shown.
private struct Leaderboard: View {
    let game: PlayerState
    var body: some View {
        Text(t("Leaderboard")).font(Brand.display(20, .headline)).padding(.top, 20)
        if !game.settings.leaderboardVisible { Text(t("The quizmaster has hidden scores for now.")).foregroundStyle(Brand.muted) }
        else if game.teams.isEmpty { Text(t("Waiting for teams")).foregroundStyle(Brand.muted) }
        else {
            if game.boardHidden > 0 { Text(t("Revealing the leaderboard on the TV…")).foregroundStyle(Brand.goldHi) }
            ForEach(Array(game.board.enumerated()), id: \.offset) { _, team in row(team) }
        }
    }

    private func row(_ team: Standing) -> some View {
        let mine = team.name == game.team?.name
        return HStack {
            Text("\(team.rank)").fontWeight(.bold).foregroundStyle(team.rank == 1 ? Brand.gold : Brand.faint).frame(width: 32, alignment: .leading)
            Text(team.name).fontWeight(mine ? .bold : .regular)
            Spacer()
            Text(team.score.map(format) ?? "").fontWeight(.bold).foregroundStyle(Brand.goldHi)
        }.padding(.horizontal, 14).padding(.vertical, 10).background(mine ? Brand.raised : Brand.panel, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct Lobby: View {
    let title: String, text: String
    var body: some View {
        VStack(spacing: 10) {
            Text("🍺").font(.system(size: 64))
            Text(title).font(Brand.display(30, .largeTitle)).multilineTextAlignment(.center)
            Text(text).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.top, 60)
    }
}

private struct TeamMenu: View {
    @EnvironmentObject var model: PlayerModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("Your team")).font(Brand.display(26))
            Text(t("Recovery code")).foregroundStyle(Brand.muted)
            Text(model.secret).font(.footnote.monospaced().bold()).textSelection(.enabled)
            Text(t("Keep it to rejoin from another phone. The quizmaster can also give you a 4-digit code to move your team.")).font(.footnote).foregroundStyle(Brand.faint)
            TeamSetup()
            Toggle(t("Vibrate for new questions"), isOn: Binding(get: { model.haptics }, set: { model.haptics = $0 }))
            if let url = model.webPlayerURL { Link("Open in Safari instead", destination: url).buttonStyle(.bordered) }
            Button(t("Switch team")) { model.switchTeam() }.buttonStyle(.bordered)
            Button(t("Other quizzes")) { model.leave() }.buttonStyle(.bordered)
        }
    }
}

/// The team's buzzer sound (heard on the TV when it buzzes first) and its photo for the big screen.
private struct TeamSetup: View {
    @EnvironmentObject var model: PlayerModel
    @State private var pick: PhotosPickerItem?
    var body: some View {
        if let game = model.game, let team = game.team {
            let names = builtInBuzzers + game.buzzerNames
            Text(t("Your buzzer sound")).font(Brand.display(20, .headline)).padding(.top, 8)
            Menu(team.sound.flatMap { names.indices.contains($0) ? names[$0] : nil } ?? t("Chosen for you: tap to pick one")) {
                ForEach(names.indices, id: \.self) { i in Button(names[i]) { model.setSound(i) } }
            }.buttonStyle(.bordered)
            if game.settings.teamPhotos {
                Text(t("Team photo")).font(Brand.display(20, .headline)).padding(.top, 8)
                Text(team.photo.isEmpty ? t("Add a team photo to appear on the big screen. The quizmaster approves it first.")
                     : team.photoStatus == "approved" ? t("✓ Approved — showing on the TV") : t("Waiting for the quizmaster to approve it")).foregroundStyle(Brand.muted)
                // The system photo picker: no photo-library permission needed.
                PhotosPicker(team.photo.isEmpty ? t("Choose a photo") : t("Change the photo"), selection: $pick, matching: .images).buttonStyle(.bordered)
                    .onChange(of: pick) { item in Task { if let data = try? await item?.loadTransferable(type: Data.self) { model.setPhoto(data) } } }
            }
        }
    }
}

/// At the end of a live quiz: the team's result, signed by the quiz laptop, kept in a BeerMat Online profile.
private struct KeepResult: View {
    @EnvironmentObject var model: PlayerModel
    @EnvironmentObject var online: OnlineModel
    var body: some View {
        if !online.client.baseUrl.isEmpty {
            BigButton(title: t("Keep this result"), enabled: !model.busy) { Task { if let claim = await model.result() { await online.keep(claim) } } }
            if !online.message.isEmpty { Text(online.message).foregroundStyle(online.isError ? Brand.bad : Brand.goldHi) }
        }
    }
}

/// A round format this app doesn't draw: the quiz's own player page plays it, already signed in as this team.
private struct BrowserRound: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    var body: some View {
        QuestionHead(q: q)
        Text("This round plays in Safari.").font(Brand.display(20, .headline)).padding(.top, 12)
        Text(t("It opens as your team, and you can come back here after.")).foregroundStyle(Brand.muted)
        if let url = model.webPlayerURL { BigButton(title: t("Open this round")) { UIApplication.shared.open(url) } }
    }
}

private struct QuestionHead: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    private var heading: String { q.held ? t("Listen to the quizmaster…") : q.text.isEmpty ? t("Listen to the quizmaster") : q.text }
    var body: some View {
        Text(q.round.uppercased()).font(.footnote.bold()).tracking(2).foregroundStyle(Brand.gold)
        // Waiting for the quizmaster's Send, or wording kept off phones: the team listens.
        Text(heading).font(Brand.display(26, .title2)).padding(.bottom, 6)
        if q.isTimed { Countdown(q: q, offset: model.offset) }
    }
}

/// Time left, from the server's deadline; only a display, as the server decides lateness.
private struct Countdown: View {
    let q: Question, offset: Double
    private func status(left: Double) -> String {
        if q.held { return t("Listen: the question comes to your phone when it’s been read out") }
        if q.paused { return t("Paused · {n}s remaining", ["n": Int(ceil(q.remaining / 1000))]) }
        if !q.open || left <= 0 { return q.revealed ? t("Answer revealed") : t("Answers closed") }
        return t("{n}s remaining", ["n": Int(ceil(left / 1000))])
    }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            let left = q.paused ? q.remaining : max(0, q.deadline - now - offset)
            let low = q.open && !q.paused && left > 0 && left <= 10000
            VStack(alignment: .leading) {
                Text(status(left: left))
                    .font(Brand.display(22, .headline)).foregroundStyle(q.open ? (low ? Brand.bad : Brand.goldHi) : Brand.muted)
                    .animation(.easeInOut, value: low)
                if q.open && q.seconds > 0 {
                    ProgressView(value: min(1, max(0, left / (Double(q.seconds) * 1000)))).tint(low ? Brand.bad : Brand.gold)
                }
            }
        }
    }
}

private struct QuestionView: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    @State private var text = ""
    @State private var picks: [String] = []
    @State private var order: [Int] = []
    @State private var sheet: [String] = []
    @State private var points: [[Double]] = []
    @State private var loaded = false
    /// The choices this team's 50/50 took away (none until it takes one).
    private var fiftyRemoved: [String] { q.raw["fiftyRemoved"] as? [String] ?? [] }

    var body: some View {
        let game = model.game!
        let submitted = game.answer
        let locked = submitted != nil || !q.open
        let teamId = game.team?.id ?? ""
        let shuffle: (Int) -> [Int] = { n in game.settings.scrambleKeypads ? seededOrder(n, "\(teamId):\(q.id)") : Array(0..<n) }

        QuestionHead(q: q)
        if q.held { EmptyView() }
        else if q.type != "pinpoint" { MediaView(server: model.serverBase, q: q, offset: model.offset) }
        if q.held { EmptyView() }
        else if q.type == "buzzer" { BuzzerView(q: q) }
        else if q.type == "bingo" || q.type == "musicbingo" { BingoView(q: q) }
        else if q.type == "clips" { ClipsView(q: q) }
        else {
            Group {
                switch q.type {
                // Letters only: six fixed A–F buttons (a letter past the last option is a wrong answer, sent as "#E"),
                // or the options of a question asked on the fly.
                case "choice" where q.fixedSix || q.onTheFly:
                    let valueOf = { (i: Int) in i < q.options.count ? q.options[i] : "#" + letters[i] }
                    Keys(keys: (0..<(q.fixedSix ? 6 : q.options.count)).filter { !fiftyRemoved.contains(valueOf($0)) }.map { ($0, letters[$0]) }, colours: true, picked: { valueOf($0) == text }, enabled: !locked) { text = valueOf($0) }
                    FiftyFifty(q: q, locked: locked, text: $text)
                case "choice", "vote":
                    Keys(keys: shuffle(q.options.count).filter { !fiftyRemoved.contains(q.options[$0]) }.map { ($0, "\(letters[$0]). \(q.options[$0])") }, colours: true, picked: { q.options[$0] == text }, enabled: !locked) { text = q.options[$0] }
                    if q.type == "choice" { FiftyFifty(q: q, locked: locked, text: $text) }
                case "letter":
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                        ForEach(shuffle(26), id: \.self) { i in
                            Button { text = letters[i] } label: {
                                Text(letters[i]).font(Brand.display(24)).frame(maxWidth: .infinity, minHeight: 52)
                                    .foregroundStyle(text == letters[i] ? Brand.onAccent : Brand.text)
                                    .background(text == letters[i] ? Brand.gold : Brand.raised, in: RoundedRectangle(cornerRadius: 12))
                            }.disabled(locked)
                        }
                    }
                case "multi":
                    Text(t("Tick every right answer — wrong ticks cost points")).foregroundStyle(Brand.muted)
                    Keys(keys: shuffle(q.options.count).map { ($0, "\(letters[$0]). \(q.options[$0])") }, colours: true, picked: { picks.contains(q.options[$0]) }, enabled: !locked) {
                        let o = q.options[$0]; if let at = picks.firstIndex(of: o) { picks.remove(at: at) } else { picks.append(o) }
                    }
                case "sequence":
                    Text(t("Tap the items in order")).foregroundStyle(Brand.muted)
                    Keys(keys: shuffle(q.order.count).map { q.order[$0] }.map { ($0, q.items[$0]) }, colours: false, picked: { order.contains($0) }, enabled: !locked) { if !order.contains($0) { order.append($0) } }
                    ForEach(Array(order.enumerated()), id: \.offset) { n, i in Text("\(n + 1). \(q.items[i])").fontWeight(.semibold) }
                    if !locked && !order.isEmpty { Button(t("Undo last")) { order.removeLast() } }
                case "tiles":
                    Text(t("Tap the tiles in order to build the answer")).foregroundStyle(Brand.muted)
                    Text(tileWord(order.map { q.pieces[$0] }.joined(), q.wordLengths)).font(Brand.display(30))
                    // Tiles are always in a different order on each team's phone.
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                        ForEach(seededOrder(q.pieces.count, "\(teamId):\(q.id)"), id: \.self) { i in
                            let used = order.contains(i)
                            Button { order.append(i) } label: {
                                Text(q.pieces[i]).font(Brand.display(24)).frame(maxWidth: .infinity, minHeight: 56)
                                    .foregroundStyle(used ? Brand.faint : Brand.onAccent).background(used ? Brand.raised.opacity(0.4) : Brand.goldHi, in: RoundedRectangle(cornerRadius: 12))
                            }.disabled(locked || used)
                        }
                    }
                    if !locked && !order.isEmpty { Button(t("Undo last")) { order.removeLast() } }
                case "pinpoint":
                    PinpointView(server: model.serverBase, q: q, taps: $points, enabled: !locked)
                case "wordsnake":
                    WordSnakeView(q: q, path: $order, enabled: !locked)
                case "sheet":
                    ForEach(q.items.indices, id: \.self) { i in
                        TextField("\(i + 1). \(q.items[i])", text: Binding(get: { sheet.indices.contains(i) ? sheet[i] : "" }, set: { if sheet.indices.contains(i) { sheet[i] = String($0.prefix(300)) } }))
                            .padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12)).disabled(locked)
                    }
                default:
                    TextField(q.type == "nearest" ? t("Your number (closest wins)") : q.type == "number" ? t("Your number") : t("Your answer"), text: $text)
                        .keyboardType(q.type == "number" || q.type == "nearest" ? .numbersAndPunctuation : .default)
                        .padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14)).disabled(locked)
                        .onChange(of: text) { text = String($0.prefix(300)) }
                }
            }
            Spacer(minLength: 12)
            if let submitted { ResultView(points: submitted.points) }
            else if !q.open { Text(q.revealed ? t("Answer revealed") : t("Answers closed")).foregroundStyle(Brand.muted) }
            else { BigButton(title: t("Lock in answer"), enabled: !model.busy && ready) { model.submit(value) } }
            if q.revealed, let answer = q.answer { Text(t("Answer: {answer}", ["answer": answer])).font(.title3.bold()).foregroundStyle(Brand.good) }
            if q.revealed && !q.answerNote.isEmpty { Text(q.answerNote).foregroundStyle(Brand.muted) }
        }
        Color.clear.frame(height: 0)
            .onAppear { restore(submitted?.value ?? game.draft) }
            .task(id: draftKey) { if loaded && !locked { try? await Task.sleep(nanoseconds: 500_000_000); if !Task.isCancelled { model.saveDraft(value) } } }
    }

    /// What the team put, in the shape the server expects (docs/CLIENT-PROTOCOL.md).
    private var value: Any {
        switch q.type {
        case "multi": return picks
        case "sequence", "tiles", "wordsnake": return order
        case "pinpoint": return points
        case "sheet": return sheet
        default: return text
        }
    }
    private var draftKey: String { "\(text)|\(picks)|\(order)|\(sheet)|\(points)" }
    private var ready: Bool {
        switch q.type {
        case "sequence": return order.count == q.items.count
        case "multi": return !picks.isEmpty
        case "tiles", "wordsnake": return !order.isEmpty
        case "pinpoint": return !points.isEmpty
        case "sheet": return sheet.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        default: return !text.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }
    private func restore(_ saved: Any?) {
        sheet = Array(repeating: "", count: q.items.count)
        switch saved {
        case let s as String: text = s
        case let a as [Any] where q.type == "multi": picks = a.map { "\($0)" }
        case let a as [Any] where q.type == "sheet": for (i, v) in a.enumerated() where i < sheet.count { sheet[i] = "\(v)" }
        case let a as [Any] where q.type == "pinpoint": points = a.compactMap { ($0 as? [Any])?.compactMap { number($0) } }
        case let a as [Any]: order = a.compactMap { ($0 as? NSNumber)?.intValue ?? ($0 as? Int) }
        default: break
        }
        loaded = true
    }
}

private struct Keys: View {
    let keys: [(Int, String)]
    let colours: Bool
    let picked: (Int) -> Bool
    let enabled: Bool
    let tap: (Int) -> Void
    var body: some View {
        // As the browser player (style.css .keypad): answers are solid colour blocks with a darker bottom edge; the picked
        // one gets a white ring and the rest step back. Other lists are plain keys that turn gold when picked.
        let anyPicked = keys.contains { picked($0.0) }
        VStack(spacing: 10) {
            ForEach(keys, id: \.0) { i, label in
                key(i, label, on: picked(i), anyPicked: anyPicked)
            }
        }
    }

    private func key(_ i: Int, _ label: String, on: Bool, anyPicked: Bool) -> some View {
        let (light, dark) = colours ? Brand.options[i % Brand.options.count] : on ? (Brand.goldHi, Brand.gold) : (Brand.raised, Brand.raised)
        let shape = RoundedRectangle(cornerRadius: 16)
        let ink: Color = colours && i % 8 == 3 && !on ? Brand.onYellow : !colours && on ? Brand.onAccent : .white
        return Button { UISelectionFeedbackGenerator().selectionChanged(); tap(i) } label: {
            Text(label).font(.title3.weight(.heavy)).foregroundStyle(ink)
                .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading).padding(.horizontal, 18)
                .background(LinearGradient(colors: [light, dark], startPoint: .topLeading, endPoint: .bottomTrailing), in: shape)
                .padding(.bottom, colours ? 4 : 0)
                .background(colours ? dark.opacity(0.75) : .clear, in: shape)
                .overlay(shape.stroke(on && colours ? Color.white : colours ? .clear : Brand.faint.opacity(0.4), lineWidth: on && colours ? 4 : 1))
                .opacity(!enabled ? 0.55 : colours && anyPicked && !on ? 0.4 : 1)
        }.disabled(!enabled).accessibilityAddTraits(on ? .isSelected : [])
        .animation(.easeOut(duration: 0.15), value: on)
    }
}

/// Scoring feedback: what the server marked, once marking is final.
private struct ResultView: View {
    let points: Double?
    var body: some View {
        let (text, colour): (String, Color) = {
            guard let p = points else { return (t("Final answer received"), Brand.goldHi) }
            if p > 0 { return (p == 1 ? t("+1 point") : t("+{n} points", ["n": format(p)]), Brand.good) }
            if p < 0 { return (t("{n} points", ["n": format(p)]), Brand.bad) }
            return (t("No points this time"), Brand.muted)
        }()
        Text(text).font(Brand.display(28)).foregroundStyle(colour).frame(maxWidth: .infinity)
            .scaleEffect(points ?? 0 > 0 ? 1.06 : 1).animation(.spring(response: 0.35, dampingFraction: 0.5), value: points)
    }
}

private struct BuzzerView: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    var body: some View {
        if let b = q.buzz {
            let mine = b.buzzed
            let teamId = model.game?.team?.id
            let position = (b.queue.filter { $0.status == "active" || $0.status == "queued" }.firstIndex { $0.team == teamId } ?? -1) + 1
            let canBuzz = model.connected && q.open && !q.paused && mine == nil && !b.lockedOut && model.game?.settings.ended != true
            let status: String = {
                if b.lockedOut { return t("Locked out — wrong answer on the last buzzer question") }
                switch mine {
                case "active": return t("You buzzed first — give your answer!")
                case "queued": return t("Buzzed · you are #{n} in the queue", ["n": position])
                case "wrong": return t("Ruled wrong")
                case "passed": return t("Passed")
                case "correct": return t("Correct!")
                default: return b.activeName.map { t("{name} is answering", ["name": $0]) } ?? (q.open ? t("Buzz when you know it!") : t("Buzzing closed"))
                }
            }()
            VStack(spacing: 16) {
                Button { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(); model.buzz() } label: {
                    Text(t("BUZZ")).font(Brand.display(52)).foregroundStyle(canBuzz ? Brand.text : Brand.faint)
                        .frame(width: 240, height: 240).background(canBuzz ? Brand.pink : Brand.raised, in: Circle())
                        .overlay(Circle().stroke(mine == "active" ? Brand.goldHi : Color.white.opacity(0.15), lineWidth: 6))
                        .scaleEffect(canBuzz ? 1 : 0.94).animation(.spring(), value: canBuzz)
                }.disabled(!canBuzz || model.busy).accessibilityLabel(t("Buzz"))
                Text(status).font(Brand.display(20, .headline)).multilineTextAlignment(.center)
                if b.agreeOpen {
                    Text(t("{name} answered “{answer}”. Do you agree?", ["name": b.activeName ?? "", "answer": b.announced.isEmpty ? "…" : b.announced])).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
                    BigButton(title: b.agreed ? t("✓ You agreed") : t("I agree"), colour: Brand.teal, enabled: !["active", "passed", "wrong"].contains(mine ?? "") && !b.agreed && !model.busy) { model.agree() }
                }
            }.frame(maxWidth: .infinity).padding(.vertical, 20)
        }
    }
}

/// A picture from the quiz laptop, or a sound to play on the phone. A picture with a reveal shows itself over the
/// question's time: blurred then sharp, or under twelve tiles going in the web pages' order.
private struct MediaView: View {
    let server: String, q: Question, offset: Double
    var media: String { q.media }
    @State private var player: AVPlayer?
    @State private var playing = false
    var body: some View {
        if !media.isEmpty, let url = URL(string: media.hasPrefix("http") ? media : server + media) {
            if media.range(of: #"\.(mp3|ogg|wav)$"#, options: [.regularExpression, .caseInsensitive]) != nil {
                Button(playing ? t("❚❚  Pause the clip") : t("▶  Play the clip")) {
                    if player == nil { player = AVPlayer(url: url) }
                    if playing { player?.pause() } else { player?.play() }
                    playing.toggle()
                }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                .onDisappear { player?.pause() }
            } else {
                TimelineView(.periodic(from: .now, by: 0.2)) { context in
                    let shown = revealShare(q, now: context.date.timeIntervalSince1970 * 1000, offset: offset)
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                            .blur(radius: q.reveal == "blur" ? (1 - shown) * 28 : 0, opaque: true)
                            .overlay { if q.reveal == "tiles" { RevealTiles(question: q.id, gone: Int(shown * 12)) } }
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    } placeholder: { ProgressView() }
                    .accessibilityLabel(t("Quiz picture"))
                }
            }
        }
    }
}

/// How much of a revealing picture shows (0–1): all of it once answers close or without a reveal.
private func revealShare(_ q: Question, now: Double, offset: Double) -> Double {
    if q.reveal.isEmpty || !q.live || q.revealed { return 1 }
    if q.held { return 0 }
    let left = q.paused ? q.remaining : max(0, q.deadline - now - offset)
    // Over the first revealSeconds when set (then whole for the rest of the time), else the whole time.
    let over = Double(q.revealSeconds > 0 ? q.revealSeconds : q.seconds) * 1000
    return min(1, max(0, (Double(q.seconds) * 1000 - left) / over))
}

/// Twelve tiles over a picture, going one by one in the order every screen uses (seededOrder(12, "tiles:<id>")).
private struct RevealTiles: View {
    let question: Int, gone: Int
    var body: some View {
        let order = seededOrder(12, "tiles:\(question)")
        VStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { r in
                HStack(spacing: 3) {
                    ForEach(0..<4, id: \.self) { c in
                        RoundedRectangle(cornerRadius: 6).fill(Brand.violet).opacity(order[r * 4 + c] < gone ? 0 : 1)
                            .animation(.easeOut(duration: 0.5), value: gone)
                    }
                }
            }
        }
    }
}

/// 50/50 on a multiple choice question: asks first, then half the wrong choices go (a pick of one of them is cleared).
struct FiftyFifty: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    let locked: Bool
    @Binding var text: String
    @State private var asking = false
    private var removed: [String] { q.raw["fiftyRemoved"] as? [String] ?? [] }
    private var points: Int { (q.raw["fiftyPoints"] as? NSNumber)?.intValue ?? 0 }
    private var full: Int { (q.raw["points"] as? NSNumber)?.intValue ?? 0 }
    private var offered: Bool { !locked && (q.raw["fiftyFifty"] as? Bool) == true && removed.isEmpty }
    private var label: String { t("50/50 (scores {n})", ["n": points]) }

    var body: some View {
        Group {
            if offered { Button(label) { asking = true } }
        }
        .onChange(of: removed) { now in if now.contains(text) { text = "" } }
        .alert(label, isPresented: $asking) {
            Button(label) { model.fifty() }
            Button(t("Cancel"), role: .cancel) {}
        } message: {
            Text(t("50/50? Half the wrong answers disappear, but a right answer scores {fifty} instead of {full}.", ["fifty": points, "full": full]))
        }
    }
}
