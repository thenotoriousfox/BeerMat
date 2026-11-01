import SwiftUI

@main
struct BeerMatApp: App {
    @StateObject private var model = PlayerModel()
    @StateObject private var online = OnlineModel()
    @StateObject private var deck = DeckModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model).environmentObject(online).environmentObject(deck)
                .onAppear { deck.online = online }.preferredColorScheme(.dark)
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
    @EnvironmentObject var deck: DeckModel
    // Run the night (the phone deck): a tab for a venue's account or an admin's, and for a phone hosting now.
    @AppStorage("deck:asked") private var deckAsked = false
    var body: some View {
        // In a quiz, the quiz's language (as for the TV and browsers); elsewhere the phone's.
        let _ = { I18n.lang = model.game?.settings.language ?? I18n.phone }()
        ZStack {
            LinearGradient(colors: [Color(hex: 0x241046), Brand.bg, Brand.bg2], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            Group {
                switch model.stage {
                // The app's own screens around the quiz, as tabs; a quiz in play has the whole screen.
                case .connect:
                    TabView {
                        ConnectView().tabItem { Label(t("Play"), systemImage: "gamecontroller") }
                        FindView().tabItem { Label(t("Find a quiz"), systemImage: "magnifyingglass") }
                        MapTab().tabItem { Label(t("Map"), systemImage: "map") }
                        ProfileView(runTheNight: { deckAsked = true }).tabItem { Label(t("Profile"), systemImage: "person.crop.circle") }
                        if online.hosts || deckAsked || deck.stage == .run { DeckView().tabItem { Label(t("Run the night"), systemImage: "mic") } }
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
