import SwiftUI

@main
struct BeerMatApp: App {
    @StateObject private var model = PlayerModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model).preferredColorScheme(.dark)
                // Leaving the app during an open question is reported, as a browser tab going to the background is.
                .onChange(of: phase) { now in
                    if now == .background { model.away("away") } else if now == .active { model.away("back") }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: PlayerModel
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x241046), Brand.bg, Brand.bg2], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            Group {
                switch model.stage {
                case .connect: ConnectView()
                case .join: JoinView()
                case .play: if model.game?.testDevice == true { RehearsalView() } else { PlayView() }
                }
            }.transition(.opacity)
        }
        .animation(.easeInOut(duration: 0.25), value: model.stage)
        .foregroundStyle(Brand.text)
        .tint(Brand.gold)
        .sheet(isPresented: Binding(get: { model.wifi != nil }, set: { if !$0 { model.wifi = nil } })) {
            if let wifi = model.wifi { WifiSheet(ssid: wifi.ssid, password: wifi.password).presentationDetents([.medium]) }
        }
    }
}
