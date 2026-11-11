import SwiftUI

/// What the big button does next: the Qt desk's words for the server's nextStep (desk.py STEP_LABELS).
func stepLabel(_ step: String?) -> String {
    switch step {
    case "reveal": return t("Reveal next position")
    case "revealFirst": return t("Reveal the leader")
    case "revealSecond": return t("Reveal second place")
    case "show": return t("Show leaderboard")
    case "recap": return t("Reveal the secret round")
    case "recapAnswer": return t("Reveal the next secret answer")
    case "recapResults": return t("Show the round’s results")
    case "finish": return t("Finish quiz & reveal leaderboard")
    case "round": return t("Start next round")
    case "question": return t("Start next question")
    default: return t("Quiz finished")
    }
}

/// Run the night: the quizmaster's phone hosting the quiz on the laptop (DeckModel). Small parts, so Xcode can
/// type-check each.
struct DeckView: View {
    @EnvironmentObject var deck: DeckModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("Run the night")).font(Brand.display(32, .largeTitle))
                stage
                DeckMessage()
            }.padding(20)
        }
    }

    @ViewBuilder private var stage: some View {
        switch deck.stage {
        case .find: DeckFindView()
        case .code: DeckCodeView()
        case .run:
            if let d = deck.deck { DeckRunView(d: d) } else { Text(t("Connecting…")).foregroundStyle(Brand.muted) }
        }
    }
}

struct DeckMessage: View {
    @EnvironmentObject var deck: DeckModel
    var body: some View {
        if !deck.message.isEmpty {
            Text(deck.message).fontWeight(.semibold).foregroundStyle(deck.isError ? Brand.bad : Brand.goldHi).padding(.vertical, 8)
        }
    }
}

struct DeckFindView: View {
    @EnvironmentObject var deck: DeckModel
    @State private var address = ""
    var body: some View {
        Text(t("Host the quiz on the laptop from this phone: the questions, the reveals and the leaderboard. The laptop keeps the TV and the sound.")).foregroundStyle(Brand.muted)
        BigButton(title: deck.searching ? t("Looking for the quiz…") : t("Find the quiz"), enabled: !deck.searching && !deck.busy) { deck.search() }
        DeckLaptopsView()
        Text(t("Or type the laptop’s address")).foregroundStyle(Brand.muted).padding(.top, 12)
        TextField("192.168.1.20:3000", text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
        Button(t("Connect")) { deck.connect(address) }.buttonStyle(.bordered).disabled(address.isEmpty || deck.busy)
    }
}

/// Several of the account's laptops are running a quiz: which one.
struct DeckLaptopsView: View {
    @EnvironmentObject var deck: DeckModel
    var body: some View {
        ForEach(deck.laptops.indices, id: \.self) { i in
            let laptop: [String: Any] = deck.laptops[i]
            let label: String = "\(laptop.str("title")) · \(laptop.str("name"))"
            Button(label) { deck.open(laptop) }.buttonStyle(.bordered).disabled(deck.busy)
        }
    }
}

struct DeckCodeView: View {
    @EnvironmentObject var deck: DeckModel
    @State private var code = ""
    var body: some View {
        Text(t("Found {title}.", ["title": deck.title])).fontWeight(.bold)
        Text(t("On the laptop: Settings → Phone deck → Show a code. Type it here.")).foregroundStyle(Brand.muted)
        TextField(t("Code"), text: Binding(get: { code }, set: { code = String($0.filter(\.isNumber).prefix(6)) })).keyboardType(.numberPad)
            .font(Brand.display(28)).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
        BigButton(title: t("Host this quiz"), enabled: code.count == 6 && !deck.busy) { deck.code(code) }
    }
}

/// The next round's intro, to read out before starting it (the TV doesn't show it).
struct DeckRoundIntro: View {
    let round: DeckRound
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("Read out before {round}", ["round": round.title])).font(.footnote.bold()).foregroundStyle(Brand.goldHi)
            Text(round.intro)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct DeckRunView: View {
    @EnvironmentObject var deck: DeckModel
    let d: DeckState
    @State private var confirmFinish = false
    @State private var confirmBack = false
    var body: some View {
        Text(d.title + (d.rehearsal ? " · " + t("Rehearsal") : "")).foregroundStyle(Brand.muted)
        if let q = d.question { DeckQuestionCard(d: d, q: q) }
        if let r = d.nextRound { DeckRoundIntro(round: r) }
        BigButton(title: stepLabel(d.nextStep), enabled: d.canNext && !deck.busy) { if d.nextStep == "finish" { confirmFinish = true } else { deck.next() } }
        if let back = d.back {
            Button(t("Back: {step}", ["step": back.prefix(1).lowercased() + back.dropFirst()])) { if d.backAnswers > 0 { confirmBack = true } else { deck.back() } }.disabled(deck.busy)
        }
        if !d.deskOpen { Text(t("The desk isn’t open on the laptop: clips, songs and sounds need it.")).font(.footnote).foregroundStyle(Brand.goldHi) }
        DeckLeaderboard(teams: d.teams)
        Text(t("Marking, rounds and settings stay on the laptop’s desk.")).font(.footnote).foregroundStyle(Brand.faint).padding(.top, 8)
        Button(t("Stop hosting from this phone")) { deck.leave() }.buttonStyle(.bordered).disabled(deck.busy)
            .alert(t("Finish quiz"), isPresented: $confirmFinish) {
                Button(t("Finish quiz & reveal leaderboard")) { deck.next() }; Button(t("Cancel"), role: .cancel) {}
            } message: { Text(t("Finish this quiz and close answers and registration? You can resume it later.")) }
            .alert(t("Go back"), isPresented: $confirmBack) {
                Button(t("Go back"), role: .destructive) { deck.back() }; Button(t("Cancel"), role: .cancel) {}
            } message: { Text(t("{n} team(s) have answered; those answers are thrown away.", ["n": d.backAnswers])) }
    }
}

struct DeckLeaderboard: View {
    let teams: [DeckTeam]
    var body: some View {
        Text(t("Leaderboard")).font(Brand.display(20, .headline)).padding(.top, 12)
        if teams.isEmpty { Text(t("No teams yet")).foregroundStyle(Brand.muted) }
        ForEach(Array(teams.enumerated()), id: \.offset) { _, team in
            HStack {
                Text(team.rank > 0 ? "\(team.rank)" : "–").foregroundStyle(Brand.faint).frame(width: 28, alignment: .leading)
                Text(team.name).foregroundStyle(team.connected ? Brand.text : Brand.faint)
                Spacer()
                Text(team.score.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(team.score))" : "\(team.score)").fontWeight(.bold).foregroundStyle(Brand.goldHi)
            }
        }
    }
}

struct DeckQuestionCard: View {
    @EnvironmentObject var deck: DeckModel
    let d: DeckState, q: DeckQuestion
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !q.round.isEmpty { Text(q.round).font(.footnote).foregroundStyle(Brand.faint) }
            Text(q.text).font(Brand.display(22, .title2))
            if q.hideText && !q.revealed {
                Text(t("Read it out: the TV and phones don’t show the wording until the answer is revealed.")).fontWeight(.semibold).foregroundStyle(Brand.goldHi)
            }
            DeckStatus(d: d, q: q).id("\(q.id)-\(q.remaining)-\(q.paused)")
            DeckVarChecks(checks: d.varChecks)
            DeckControls(d: d, q: q)
            DeckRoundControls(d: d, q: q)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Brand.panel, in: RoundedRectangle(cornerRadius: 18))
    }
}

/// Where the question is, with its countdown ticking here between the server's updates.
struct DeckStatus: View {
    let d: DeckState, q: DeckQuestion
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            Text(status).fontWeight(.semibold).foregroundStyle(q.open ? Brand.good : Brand.goldHi)
        }
        Text(t("{n} of {total} teams answered", ["n": d.answered, "total": d.teams.count])).font(.footnote).foregroundStyle(Brand.muted)
        if !q.revealed && !q.answer.isEmpty { Text(t("Answer: {answer}", ["answer": q.answer])).font(.footnote).foregroundStyle(Brand.faint) }
    }
    @State private var seen = Date()
    private var status: String {
        if q.held { return t("Waiting to be sent to the phones") }
        if q.paused { return t("Paused") }
        if q.open { return t("Open: {s}s left", ["s": max(0, Int(((q.remaining / 1000) - Date().timeIntervalSince(seen)).rounded(.up)))]) }
        if q.revealing { return t("Drum roll…") }
        if q.revealed { return t("Answer: {answer}", ["answer": q.answer]) }
        return t("Closed")
    }
}

struct DeckControls: View {
    @EnvironmentObject var deck: DeckModel
    let d: DeckState, q: DeckQuestion
    var body: some View {
        HStack {
            if d.canSend { Button(t("Send question")) { deck.send() } }
            if d.canPause { Button(t("Pause timer")) { deck.pause() } }
            if d.canResume { Button(t("Resume timer")) { deck.resume() } }
            if d.canClose { Button(t("Close answers")) { deck.close() } }
            if d.canReveal { Button(t("Reveal answer")) { deck.reveal() } }
        }.buttonStyle(.bordered).disabled(deck.busy)
    }
}

/// The round's own controls; what plays, plays from the laptop.
struct DeckRoundControls: View {
    @EnvironmentObject var deck: DeckModel
    let d: DeckState, q: DeckQuestion
    var body: some View {
        VStack(alignment: .leading) {
            if (q.type == "clips" || q.type == "sequence") && q.clips > 0 && q.live { clips }
            if q.type == "bingo" || q.type == "musicbingo" { Button(q.type == "bingo" ? t("Call next number") : t("Next song")) { deck.desk("callNumber") }.disabled(!d.deskOpen) }
            if q.type == "musicbingo" { Button(t("Play this song again")) { deck.desk("replaySong") }.disabled(!d.deskOpen) }
            if q.type == "buzzer", let name = q.buzzing { buzzer(name) }
            if q.audio {
                HStack {
                    Button(t("Play the sound again")) { deck.desk("playAudio") }
                    Button(t("Pause or carry on")) { deck.desk("pauseAudio") }
                }.disabled(!d.deskOpen)
            }
        }.buttonStyle(.bordered).disabled(deck.busy)
    }

    private var clips: some View {
        ScrollView(.horizontal) {
            HStack {
                Button(t("Play all clips")) { deck.desk("playClips") }
                ForEach(0..<q.clips, id: \.self) { i in Button(t("Clip {n}", ["n": i + 1])) { deck.desk("playClip", i) } }
                Button(t("Stop")) { deck.desk("stopClips") }
            }
        }.disabled(!d.deskOpen)
    }

    private func buzzer(_ name: String) -> some View {
        VStack(alignment: .leading) {
            Text(t("{team} buzzed", ["team": name])).fontWeight(.bold)
            HStack {
                Button(t("Correct")) { deck.buzz("correct") }
                Button(t("Wrong")) { deck.buzz("wrong") }
                Button(t("Pass")) { deck.buzz("pass") }
            }
        }
    }
}

/// VAR Check: teams' appeals waiting for a ruling (overturned gives the question's points; the TV shows the decision).
struct DeckVarChecks: View {
    @EnvironmentObject var deck: DeckModel
    let checks: [DeckVar]
    var body: some View {
        ForEach(checks, id: \.id) { v in
            VStack(alignment: .leading, spacing: 6) {
                Text(t("📺 VAR Check: {team} answered “{answer}”", ["team": v.team, "answer": v.answer.isEmpty ? "–" : v.answer])).foregroundStyle(Brand.goldHi)
                HStack {
                    Button(t("Overturn (+{n})", ["n": v.full])) { deck.ruleVar(v.id, "overturned") }.buttonStyle(.borderedProminent)
                    Button(t("Decision stands")) { deck.ruleVar(v.id, "stands") }.buttonStyle(.bordered)
                }
            }.padding(.top, 8)
        }
    }
}
