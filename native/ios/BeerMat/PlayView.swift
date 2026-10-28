import AVFoundation
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
                    .accessibilityLabel(model.connected ? "Connected" : "Reconnecting")
                Text(model.game?.team?.name ?? "").fontWeight(.bold).lineLimit(1)
                Spacer()
                if let game = model.game, game.settings.leaderboardVisible, let mine = game.teams.first(where: { $0.name == game.team?.name }), let score = mine.score {
                    Text("\(format(score)) pts · #\(mine.rank)").fontWeight(.bold).foregroundStyle(Brand.goldHi)
                }
                Button(menu ? "Close" : "Team") { menu.toggle() }.foregroundStyle(Brand.muted)
            }.padding(.horizontal, 18).padding(.vertical, 12).background(Brand.panel)
            if !model.connected {
                Text("Connection lost — reconnecting…").fontWeight(.bold).foregroundStyle(Brand.onAccent).frame(maxWidth: .infinity).padding(6).background(Brand.bad)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if menu { TeamMenu() } else if let game = model.game {
                        if game.team?.waiting == true { Lobby(title: "You're in the waiting room", text: "The quizmaster will let you in shortly.") }
                        else if game.settings.ended { Lobby(title: "That's the quiz!", text: "Thanks for playing. Final scores are on the TV.") }
                        else if let q = game.question {
                            if nativeTypes.contains(q.type) { QuestionView(q: q).id(q.id) } else { BrowserRound(q: q) }
                        } else { Lobby(title: "You're in!", text: "Waiting for the quiz to start. Keep this app open.") }
                    }
                    MessageText()
                }.padding(20)
            }
        }
    }
}

private func format(_ n: Double) -> String { n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n) }

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
            Text("Your team").font(Brand.display(26))
            Text("Recovery code").foregroundStyle(Brand.muted)
            Text(model.secret).font(.footnote.monospaced().bold()).textSelection(.enabled)
            Text("Keep it to rejoin from another phone. The quizmaster can also give you a 4-digit code to move your team.").font(.footnote).foregroundStyle(Brand.faint)
            Toggle("Vibrate for new questions", isOn: Binding(get: { model.haptics }, set: { model.haptics = $0 }))
            if let url = model.webPlayerURL { Link("Open in Safari instead", destination: url).buttonStyle(.bordered) }
            Button("Switch team") { model.switchTeam() }.buttonStyle(.bordered)
            Button("Other quizzes") { model.leave() }.buttonStyle(.bordered)
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
        Text("It opens as your team, and you can come back here after.").foregroundStyle(Brand.muted)
        if let url = model.webPlayerURL { BigButton(title: "Open this round") { UIApplication.shared.open(url) } }
    }
}

private struct QuestionHead: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    var body: some View {
        Text(q.round.uppercased()).font(.footnote.bold()).tracking(2).foregroundStyle(Brand.gold)
        Text(q.text).font(Brand.display(26, .title2)).padding(.bottom, 6)
        if q.isTimed { Countdown(q: q, offset: model.offset) }
    }
}

/// Time left, from the server's deadline; only a display, as the server decides lateness.
private struct Countdown: View {
    let q: Question, offset: Double
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            let left = q.paused ? q.remaining : max(0, q.deadline - now - offset)
            let low = q.open && !q.paused && left > 0 && left <= 10000
            VStack(alignment: .leading) {
                Text(q.paused ? "Paused · \(Int(ceil(q.remaining / 1000)))s left" : !q.open || left <= 0 ? (q.revealed ? "Answer revealed" : "Answers closed") : "\(Int(ceil(left / 1000)))s left")
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
    @State private var loaded = false

    var body: some View {
        let game = model.game!
        let submitted = game.answer
        let locked = submitted != nil || !q.open
        let teamId = game.team?.id ?? ""
        let shuffle: (Int) -> [Int] = { n in game.settings.scrambleKeypads ? seededOrder(n, "\(teamId):\(q.id)") : Array(0..<n) }

        QuestionHead(q: q)
        MediaView(server: model.serverBase, media: q.media)
        if q.type == "buzzer" { BuzzerView(q: q) } else {
            Group {
                switch q.type {
                case "choice", "vote":
                    Keys(keys: shuffle(q.options.count).map { ($0, "\(letters[$0]). \(q.options[$0])") }, colours: true, picked: { q.options[$0] == text }, enabled: !locked) { text = q.options[$0] }
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
                    Text("Tick every right answer — wrong ticks cost points").foregroundStyle(Brand.muted)
                    Keys(keys: shuffle(q.options.count).map { ($0, "\(letters[$0]). \(q.options[$0])") }, colours: true, picked: { picks.contains(q.options[$0]) }, enabled: !locked) {
                        let o = q.options[$0]; if let at = picks.firstIndex(of: o) { picks.remove(at: at) } else { picks.append(o) }
                    }
                case "sequence":
                    Text("Tap the items in order").foregroundStyle(Brand.muted)
                    Keys(keys: shuffle(q.order.count).map { q.order[$0] }.map { ($0, q.items[$0]) }, colours: false, picked: { order.contains($0) }, enabled: !locked) { if !order.contains($0) { order.append($0) } }
                    ForEach(Array(order.enumerated()), id: \.offset) { n, i in Text("\(n + 1). \(q.items[i])").fontWeight(.semibold) }
                    if !locked && !order.isEmpty { Button("Undo last") { order.removeLast() } }
                case "tiles":
                    Text("Tap the tiles in order to build the answer").foregroundStyle(Brand.muted)
                    Text(order.map { q.pieces[$0] }.joined().isEmpty ? "…" : order.map { q.pieces[$0] }.joined()).font(Brand.display(30))
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
                    if !locked && !order.isEmpty { Button("Undo last") { order.removeLast() } }
                case "sheet":
                    ForEach(q.items.indices, id: \.self) { i in
                        TextField("\(i + 1). \(q.items[i])", text: Binding(get: { sheet.indices.contains(i) ? sheet[i] : "" }, set: { if sheet.indices.contains(i) { sheet[i] = String($0.prefix(300)) } }))
                            .padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12)).disabled(locked)
                    }
                default:
                    TextField(q.type == "nearest" ? "Your number (closest wins)" : q.type == "number" ? "Your number" : "Your answer", text: $text)
                        .keyboardType(q.type == "number" || q.type == "nearest" ? .numbersAndPunctuation : .default)
                        .padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14)).disabled(locked)
                        .onChange(of: text) { text = String($0.prefix(300)) }
                }
            }
            Spacer(minLength: 12)
            if let submitted { ResultView(points: submitted.points) }
            else if !q.open { Text(q.revealed ? "Answer revealed" : "Answers closed").foregroundStyle(Brand.muted) }
            else { BigButton(title: "Lock in answer", enabled: !model.busy && ready) { model.submit(value) } }
            if q.revealed, let answer = q.answer { Text("Answer: \(answer)").font(.title3.bold()).foregroundStyle(Brand.good) }
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
        case "sequence", "tiles": return order
        case "sheet": return sheet
        default: return text
        }
    }
    private var draftKey: String { "\(text)|\(picks)|\(order)|\(sheet)" }
    private var ready: Bool {
        switch q.type {
        case "sequence": return order.count == q.items.count
        case "multi": return !picks.isEmpty
        case "tiles": return !order.isEmpty
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
        VStack(spacing: 10) {
            ForEach(keys, id: \.0) { i, label in
                let tone = colours ? Brand.options[i % Brand.options.count] : Brand.violet
                let on = picked(i)
                Button { UISelectionFeedbackGenerator().selectionChanged(); tap(i) } label: {
                    Text(label).font(.title3.bold()).frame(maxWidth: .infinity, minHeight: 60, alignment: .leading).padding(.horizontal, 18)
                        .background(tone.opacity(on ? 0.55 : 0.18), in: RoundedRectangle(cornerRadius: 18))
                        .overlay(RoundedRectangle(cornerRadius: 18).stroke(on ? Brand.text : tone.opacity(0.7), lineWidth: on ? 3 : 1))
                }.disabled(!enabled).accessibilityAddTraits(on ? .isSelected : [])
                .animation(.easeOut(duration: 0.15), value: on)
            }
        }
    }
}

/// Scoring feedback: what the server marked, once marking is final.
private struct ResultView: View {
    let points: Double?
    var body: some View {
        let (text, colour): (String, Color) = {
            guard let p = points else { return ("Final answer received", Brand.goldHi) }
            if p > 0 { return ("+\(format(p)) \(p == 1 ? "point" : "points")", Brand.good) }
            if p < 0 { return ("\(format(p)) points", Brand.bad) }
            return ("No points this time", Brand.muted)
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
                if b.lockedOut { return "Locked out — wrong answer on the last buzzer question" }
                switch mine {
                case "active": return "You buzzed first — give your answer!"
                case "queued": return "Buzzed · you are #\(position) in the queue"
                case "wrong": return "Ruled wrong"
                case "passed": return "Passed"
                case "correct": return "Correct!"
                default: return b.activeName.map { "\($0) is answering" } ?? (q.open ? "Buzz when you know it!" : "Buzzing closed")
                }
            }()
            VStack(spacing: 16) {
                Button { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(); model.buzz() } label: {
                    Text("BUZZ").font(Brand.display(52)).foregroundStyle(canBuzz ? Brand.text : Brand.faint)
                        .frame(width: 240, height: 240).background(canBuzz ? Brand.pink : Brand.raised, in: Circle())
                        .overlay(Circle().stroke(mine == "active" ? Brand.goldHi : Color.white.opacity(0.15), lineWidth: 6))
                        .scaleEffect(canBuzz ? 1 : 0.94).animation(.spring(), value: canBuzz)
                }.disabled(!canBuzz || model.busy).accessibilityLabel("Buzz")
                Text(status).font(Brand.display(20, .headline)).multilineTextAlignment(.center)
                if b.agreeOpen {
                    Text("\(b.activeName ?? "") answered “\(b.announced.isEmpty ? "…" : b.announced)”. Do you agree?").foregroundStyle(Brand.muted).multilineTextAlignment(.center)
                    BigButton(title: b.agreed ? "✓ You agreed" : "I agree", colour: Brand.teal, enabled: !["active", "passed", "wrong"].contains(mine ?? "") && !b.agreed && !model.busy) { model.agree() }
                }
            }.frame(maxWidth: .infinity).padding(.vertical, 20)
        }
    }
}

/// A picture from the quiz laptop, or a sound to play on the phone.
private struct MediaView: View {
    let server: String, media: String
    @State private var player: AVPlayer?
    @State private var playing = false
    var body: some View {
        if !media.isEmpty, let url = URL(string: media.hasPrefix("http") ? media : server + media) {
            if media.range(of: #"\.(mp3|ogg|wav)$"#, options: [.regularExpression, .caseInsensitive]) != nil {
                Button(playing ? "❚❚  Pause the clip" : "▶  Play the clip") {
                    if player == nil { player = AVPlayer(url: url) }
                    if playing { player?.pause() } else { player?.play() }
                    playing.toggle()
                }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                .onDisappear { player?.pause() }
            } else {
                AsyncImage(url: url) { image in image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 14)) } placeholder: { ProgressView() }
                    .accessibilityLabel("Quiz picture")
            }
        }
    }
}
