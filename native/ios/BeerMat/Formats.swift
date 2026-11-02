import SwiftUI

/// Pinpoint: tap the picture (a second tap with a second guess). Points are fractions of the picture, as the server
/// expects; the target appears once revealed.
struct PinpointView: View {
    let server: String
    let q: Question
    @Binding var taps: [[Double]]
    let enabled: Bool
    // In parts with their types spelled out: as one expression it was too much for the compiler to type-check.
    private var several: Int { (q.raw["targetCount"] as? NSNumber)?.intValue ?? 0 }
    private var most: Int { several > 0 ? several : (q.raw["goWide"] as? Bool) == true ? 2 : 1 }
    private var goWidePoints: Int { (q.raw["goWidePoints"] as? NSNumber)?.intValue ?? 0 }
    private var url: URL? { URL(string: q.media.hasPrefix("http") ? q.media : server + q.media) }

    var body: some View {
        Text(several > 0 ? t("Tap the picture once for each place: {n} to find", ["n": several]) : most == 2 ? t("Tap the picture. Second guess: a second tap scores {n} if your first misses.", ["n": goWidePoints]) : t("Tap the picture to place your answer"))
            .foregroundStyle(Brand.muted)
        AsyncImage(url: url) { image in
            image.resizable().scaledToFit()
                .overlay { GeometryReader { geo in PinpointMarks(q: q, taps: $taps, most: most, enabled: enabled, size: geo.size) } }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel(t("Quiz picture: tap to place your answer"))
        } placeholder: { ProgressView() }
        if enabled && !taps.isEmpty { Button(t("Undo tap")) { taps.removeLast() } }
    }
}

/// The taps on a pinpoint picture, and the target once revealed, in the picture's own size.
private struct PinpointMarks: View {
    let q: Question
    @Binding var taps: [[Double]]
    let most: Int, enabled: Bool, size: CGSize

    var body: some View {
        ZStack {
            Color.clear.contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { (at: CGPoint) in tap(at) }
            ForEach(Array(taps.enumerated()), id: \.offset) { (i: Int, point: [Double]) in
                Circle().fill(i == 0 || most > 2 ? Brand.pink : Brand.gold).overlay(Circle().stroke(Brand.text, lineWidth: 3))
                    .frame(width: 28, height: 28).position(x: point[0] * size.width, y: point[1] * size.height)
            }
            ForEach(Array(targets.enumerated()), id: \.offset) { (_: Int, target: (x: Double, y: Double, r: Double)) in
                Circle().stroke(Brand.good, lineWidth: 4).frame(width: target.r * 2 * size.width, height: target.r * 2 * size.width)
                    .position(x: target.x * size.width, y: target.y * size.height)
            }
        }
    }

    private func tap(_ at: CGPoint) {
        guard enabled else { return }
        let point: [Double] = [min(1, max(0, Double(at.x / size.width))), min(1, max(0, Double(at.y / size.height)))]
        taps = taps.count < most ? taps + [point] : Array(taps.dropLast()) + [point]
    }

    /// The target circles (several places to find, or the one), once the answer is revealed: centre and radius as
    /// fractions of the picture's width.
    private var targets: [(x: Double, y: Double, r: Double)] {
        guard q.revealed else { return [] }
        let all = (q.raw["targets"] as? [[String: Any]]) ?? [(q.raw["target"] as? [String: Any])].compactMap { $0 }
        return all.compactMap { t in
            guard let x = number(t["x"]), let y = number(t["y"]), let r = number(t["r"]) else { return nil }
            return (x, y, r)
        }
    }
}

/// Word trail: trace the answer, each letter touching the last (diagonals too); a letter that doesn't touch starts again.
struct WordSnakeView: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    @Binding var path: [Int]
    let enabled: Bool
    var body: some View {
        let grid = q.raw["grid"] as? [String: Any] ?? [:]
        let n = (grid["size"] as? NSNumber)?.intValue ?? 1
        let letters = grid["letters"] as? [String] ?? []
        let wide = (q.raw["wideCells"] as? [Any])?.compactMap { ($0 as? NSNumber)?.intValue }
        let adjacent = { (a: Int, b: Int) in a != b && abs(a / n - b / n) <= 1 && abs(a % n - b % n) <= 1 }
        Text(t("Tap the answer’s letters in order: each touches the last, diagonals too. Any route that spells it is right.")).foregroundStyle(Brand.muted)
        Text(path.map { letters[$0] }.joined().isEmpty ? t("Tap the first letter") : path.map { letters[$0] }.joined()).font(Brand.display(28))
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: n), spacing: 6) {
            ForEach(letters.indices, id: \.self) { i in
                let gone = wide.map { !$0.contains(i) } ?? false
                let on = path.contains(i)
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    if let last = path.last, !path.contains(i), adjacent(last, i) { path.append(i) } else if path.isEmpty { path = [i] } else { path = [i] }
                } label: {
                    Text(letters[i]).font(Brand.display(24)).frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                        .foregroundStyle(on ? Brand.onAccent : gone ? Brand.faint : Brand.text)
                        .background(on ? Brand.gold : gone ? Brand.raised.opacity(0.25) : Brand.raised, in: RoundedRectangle(cornerRadius: 10))
                }.disabled(!enabled || gone)
            }
        }
        HStack {
            if enabled && !path.isEmpty { Button(t("Start again")) { path = [] } }
            if enabled && (q.raw["goWide"] as? Bool) == true && wide == nil { HintButton(q: q) }
        }
    }
}

/// Bingo and music bingo: the team's ticket (dabbed on the phone, as on paper) and the BINGO shout.
struct BingoView: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    var body: some View {
        let b = q.raw["bingo"] as? [String: Any] ?? [:]
        let music = (b["music"] as? Bool) == true
        let card = b["card"] as? [[Any]] ?? []
        let mine = b["myShout"] as? [String: Any]
        let calls = ((music ? b["played"] : b["count"]) as? NSNumber)?.intValue ?? 0
        let checking = mine?["status"] as? String == "pending"
        let turnedDown = mine?["status"] as? String == "wrong" && (mine?["seq"] as? NSNumber)?.intValue == calls
        let claimed = (b["claimed"] as? Bool) == true
        let dabs = model.dabs[q.id] ?? []
        Text(music ? t("Music bingo · {n} played", ["n": calls]) : t("{n} called", ["n": calls])).foregroundStyle(Brand.muted)
        Text(music ? (calls > 0 ? t("Song {n}", ["n": calls]) : "–") : (b["last"] as? NSNumber).map { "\($0)" } ?? "–").font(Brand.display(64)).foregroundStyle(Brand.goldHi)
        VStack(spacing: 6) {
            ForEach(card.indices, id: \.self) { r in
                HStack(spacing: 6) {
                    ForEach(card[r].indices, id: \.self) { c in
                        let cell = card[r][c]
                        let label = cell is NSNull ? "" : "\(cell)"
                        Button {
                            // The reaction table: dabbing a song sends it (one go per song; the server times it against the song playing).
                            if music && !dabs.contains(label) && q.reactionSong != nil { model.react(label) }
                            model.dab(q.id, label)
                        } label: {
                            Text(label).font(.system(size: music ? 11 : 18, weight: .bold)).lineLimit(2).minimumScaleFactor(0.6)
                                .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(Brand.text)
                                .background(label.isEmpty ? Brand.bg2 : dabs.contains(label) ? Brand.pink : Brand.raised, in: RoundedRectangle(cornerRadius: 8))
                        }.disabled(label.isEmpty)
                    }
                }
            }
        }.padding(.vertical, 8)
        if let table = q.raw["reactionTable"] as? [String: Any] {
            let song = (table["song"] as? NSNumber)?.intValue ?? 0
            let now = table["now"] as? [[String: Any]] ?? []
            Text(t("Dab the song as soon as you know it: the quickest team on each song is on the TV.")).font(.footnote).foregroundStyle(Brand.muted)
            let canPass: Bool = model.connected && q.live && !q.paused && song > 0 && !model.reacted.contains("\(q.id):\(song)")
            Button(t("Not on my ticket")) { model.react(nil) }.buttonStyle(.bordered).frame(maxWidth: .infinity).disabled(!canPass)
            if !now.isEmpty {
                Text(t("Reactions · song {n}", ["n": song])).bold().foregroundStyle(Brand.teal)
                ForEach(Array(now.prefix(5).enumerated()), id: \.offset) { i, r in
                    let name: String = r["name"] as? String ?? ""
                    let seconds: Double = ((r["ms"] as? NSNumber)?.doubleValue ?? 0) / 1000
                    Text("\(i + 1). \(name)  \(String(format: "%.1f", seconds))s").foregroundStyle(i == 0 ? Brand.goldHi : Brand.text)
                }
            }
        }
        BigButton(title: t("BINGO!"), colour: Brand.pink, enabled: model.connected && q.live && !q.paused && !claimed && (b["over"] as? Bool) != true && !checking && !turnedDown && !model.busy) { model.claimBingo() }
        Text(claimed ? t("✓ Bingo! The quizmaster says yes.") : checking ? t("Your BINGO call is being checked…") : turnedDown ? t("Not a bingo this time — keep playing") : "")
            .foregroundStyle(Brand.goldHi)
    }
}

/// Sound clips: the clips play on the TV; tap while the one the question asks for is playing.
struct ClipsView: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    var body: some View {
        let c = q.raw["clipGame"] as? [String: Any] ?? [:]
        let playing = (c["playing"] as? NSNumber)?.intValue
        let tapped = c["tapped"].flatMap { $0 is NSNull ? nil : "\($0)" }
        let canTap = model.connected && q.live && !q.paused && playing != nil && tapped == nil
        Text(tapped.map { t("You tapped: {clip}", ["clip": $0]) } ?? playing.map { t("🎵 Clip {n} of {count}", ["n": $0, "count": (c["count"] as? NSNumber)?.intValue ?? 0]) } ?? (q.live ? t("Get ready — listen for the clips") : t("Clips finished")))
            .font(Brand.display(20, .headline))
        Button { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(); model.tap() } label: {
            Text(t("TAP")).font(Brand.display(52)).foregroundStyle(canTap ? Brand.onAccent : Brand.faint)
                .frame(width: 220, height: 220).background(canTap ? Brand.teal : Brand.raised, in: Circle())
        }.disabled(!canTap || model.busy).frame(maxWidth: .infinity).accessibilityLabel(t("Tap for this clip"))
    }
}

/// The answer's shape with the letters so far (tileWord in web/app.js): "BIG BEN" as "BIG B__".
func tileWord(_ letters: String, _ lengths: [Int]) -> String {
    guard !lengths.isEmpty else { return letters.isEmpty ? "…" : letters }
    let padded = Array(letters.padding(toLength: lengths.reduce(0, +), withPad: "_", startingAt: 0))
    var at = 0
    return lengths.map { n in defer { at += n }; return String(padded[at..<min(padded.count, at + n)]) }.joined(separator: " ")
}

/// Word trail's hint: asks first, then the decoy letters go.
struct HintButton: View {
    @EnvironmentObject var model: PlayerModel
    let q: Question
    @State private var asking = false
    private var points: Int { (q.raw["goWidePoints"] as? NSNumber)?.intValue ?? 0 }
    private var full: Int { (q.raw["points"] as? NSNumber)?.intValue ?? 0 }
    private var label: String { t("Hint (scores {n})", ["n": points]) }

    var body: some View {
        Button(label) { asking = true }
            .alert(label, isPresented: $asking) {
                Button(label) { model.goWide() }
                Button(t("Cancel"), role: .cancel) {}
            } message: {
                Text(t("Use the hint? The decoy letters disappear, but a right answer scores {wide} instead of {full}.", ["wide": points, "full": full]))
            }
    }
}
