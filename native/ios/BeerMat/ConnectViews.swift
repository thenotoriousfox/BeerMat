import SwiftUI
import VisionKit

struct Header: View {
    let title: String
    var subtitle = ""
    var body: some View {
        HStack(spacing: 10) {
            Image("Mark").resizable().frame(width: 56, height: 56).accessibilityHidden(true)
            VStack(alignment: .leading) {
                Text(title).font(Brand.display(26))
                if !subtitle.isEmpty { Text(subtitle).foregroundStyle(Brand.muted) }
            }
        }.padding(.bottom, 16)
    }
}

struct ConnectView: View {
    @EnvironmentObject var model: PlayerModel
    @State private var address = ""
    @State private var scanning = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Header(title: "BeerMat", subtitle: "Play the quiz")
                Text("Scan the code on the TV").font(Brand.display(32, .largeTitle))
                Text("No account, no internet: the quiz runs on the quizmaster's laptop.").foregroundStyle(Brand.muted)
                BigButton(title: "Scan the TV's code", enabled: !model.busy && ScannerView.isAvailable) { scanning = true }.padding(.top, 8)
                if !ScannerView.isAvailable { Text("This iPhone can't scan codes here: type the address on the TV instead.").font(.footnote).foregroundStyle(Brand.faint) }
                Text("Or type the address on the TV").foregroundStyle(Brand.muted).padding(.top, 16)
                TextField("10.42.0.1", text: $address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14)).submitLabel(.go).onSubmit { model.connect(address) }
                Button("Connect") { model.connect(address) }.disabled(address.isEmpty || model.busy).buttonStyle(.bordered)
                MessageText()
                if !model.recent.isEmpty {
                    Text("Recent quizzes").font(Brand.display(20, .headline)).padding(.top, 20)
                    ForEach(model.recent, id: \.self) { r in
                        Button { model.connect(r.server) } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(r.title.isEmpty ? "Quiz" : r.title).fontWeight(.bold)
                                    Text(r.server.replacingOccurrences(of: "http://", with: "")).font(.footnote).foregroundStyle(Brand.faint)
                                }
                                Spacer(); Image(systemName: "chevron.right").foregroundStyle(Brand.gold)
                            }.padding(16).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
                        }.disabled(model.busy)
                    }
                }
            }.padding(24)
        }
        .fullScreenCover(isPresented: $scanning) {
            ScannerView { text in scanning = false; model.scanned(text) }.ignoresSafeArea()
                .overlay(alignment: .topTrailing) { Button("Cancel") { scanning = false }.padding().buttonStyle(.borderedProminent) }
        }
    }
}

/// VisionKit's live scanner (iOS 16+). Asks for the camera once (NSCameraUsageDescription).
struct ScannerView: UIViewControllerRepresentable {
    static var isAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }
    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        private var done = false
        init(found: @escaping (String) -> Void) { self.found = found }
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let code) in items { if let text = code.payloadStringValue, !done { done = true; scanner.stopScanning(); found(text) } }
        }
    }
}

struct JoinView: View {
    @EnvironmentObject var model: PlayerModel
    @State private var name = ""
    @State private var code = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Header(title: model.hello?.title ?? "BeerMat", subtitle: model.serverBase.replacingOccurrences(of: "http://", with: ""))
                if model.hello?.rehearsal == true { Pill(text: "REHEARSAL", colour: Brand.teal) }
                Text("Pick a team name").font(Brand.display(32, .largeTitle))
                TextField("Team name", text: $name).padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: name) { name = String($0.prefix(40)) }.submitLabel(.join).onSubmit { if valid { model.join(name) } }
                BigButton(title: "Join the quiz", enabled: valid && !model.busy && model.hello?.registrationOpen != false) { model.join(name) }
                if model.hello?.registrationOpen == false { Text("Registration is closed. Ask the quizmaster.").foregroundStyle(Brand.muted) }
                MessageText()
                Text("Already playing?").font(Brand.display(20, .headline)).padding(.top, 20)
                Text("Type your recovery code, or the 4-digit code the quizmaster gives you to move your team to this phone.").foregroundStyle(Brand.muted)
                TextField("Recovery code", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
                Button("Continue as my team") { model.recover(code) }.disabled(code.isEmpty || model.busy).buttonStyle(.bordered)
                Button("‹ Other quizzes") { model.leave() }.padding(.top, 16)
            }.padding(24)
        }
    }
    private var valid: Bool { name.trimmingCharacters(in: .whitespaces).count >= 2 }
}

/// A real phone in a rehearsal: the connection works, and playing is off (the server enforces it).
struct RehearsalView: View {
    @EnvironmentObject var model: PlayerModel
    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().fill(Brand.good.opacity(0.18)).overlay(Circle().stroke(Brand.good, lineWidth: 3))
                Image(systemName: "checkmark").font(.system(size: 54, weight: .bold)).foregroundStyle(Brand.good)
            }.frame(width: 120, height: 120).accessibilityHidden(true)
            Text("You're connected").font(Brand.display(32, .largeTitle))
            Text(model.game?.settings.title ?? "").font(Brand.display(20, .headline)).foregroundStyle(Brand.goldHi)
            Text("This is a rehearsal. Your phone reached the quiz, so it'll work on the night, but playing is switched off: the quizmaster is testing with simulated teams.")
                .multilineTextAlignment(.center).foregroundStyle(Brand.muted)
            Pill(text: model.connected ? "● CONNECTED" : "○ RECONNECTING…", colour: model.connected ? Brand.good : Brand.bad)
            Button("‹ Other quizzes") { model.leave() }.padding(.top, 16)
        }.padding(24)
    }
}

/// The TV's code was the quiz Wi-Fi: join it in Settings (iOS doesn't let apps switch networks silently), then scan.
struct WifiSheet: View {
    let ssid: String, password: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Join the quiz Wi-Fi").font(Brand.display(26))
            Text("Network: \(ssid)").font(.title3.bold())
            if !password.isEmpty { Text("Password: \(password)").font(.title3.bold()).textSelection(.enabled) }
            Text("If your iPhone says “No Internet Connection”, stay on it anyway. Then come back and scan the quiz code.").foregroundStyle(Brand.muted)
            BigButton(title: "Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
        }.padding(24).frame(maxHeight: .infinity, alignment: .top).background(Brand.panel).foregroundStyle(Brand.text)
    }
}
