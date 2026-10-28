import SwiftUI

@main
struct BeerMatApp: App {
    @StateObject private var model = PlayerModel()
    @StateObject private var online = OnlineModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model).environmentObject(online).preferredColorScheme(.dark)
                // Leaving the app during an open question is reported, as a browser tab going to the background is.
                .onChange(of: phase) { now in
                    if now == .background { model.away("away") } else if now == .active { model.away("back") }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: PlayerModel
    @EnvironmentObject var online: OnlineModel
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x241046), Brand.bg, Brand.bg2], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            Group {
                switch model.stage {
                // The app's own screens around the quiz, as tabs; a quiz in play has the whole screen.
                case .connect:
                    TabView {
                        ConnectView().tabItem { Label("Play", systemImage: "gamecontroller") }
                        FindView().tabItem { Label("Find a quiz", systemImage: "magnifyingglass") }
                        MapTab().tabItem { Label("Map", systemImage: "map") }
                        ProfileView().tabItem { Label("Profile", systemImage: "person.crop.circle") }
                    }
                case .join: JoinView()
                case .play: if model.game?.testDevice == true { RehearsalView() } else { PlayView() }
                }
            }.transition(.opacity)
        }
        .animation(.easeInOut(duration: 0.25), value: model.stage)
        .foregroundStyle(Brand.text)
        .tint(Brand.gold)
        .sheet(isPresented: Binding(get: { online.venue != nil }, set: { if !$0 { online.open(nil) } })) {
            if let v = online.venue { VenueSheet(v: v).presentationDetents([.medium, .large]) }
        }
        .sheet(isPresented: Binding(get: { model.wifi != nil }, set: { if !$0 { model.wifi = nil } })) {
            if let wifi = model.wifi { WifiSheet(ssid: wifi.ssid, password: wifi.password).presentationDetents([.medium]) }
        }
    }
}
