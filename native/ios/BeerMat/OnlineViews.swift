import MapKit
import SwiftUI

private func when(_ ms: Any?) -> String {
    let d = Date(timeIntervalSince1970: ((ms as? NSNumber)?.doubleValue ?? 0) / 1000)
    return d.formatted(date: .complete, time: .shortened)
}

struct OnlineMessage: View {
    @EnvironmentObject var online: OnlineModel
    var body: some View { if !online.message.isEmpty { Text(online.message).fontWeight(.semibold).foregroundStyle(online.isError ? Brand.bad : Brand.goldHi) } }
}

// ---- Profile ----
struct ProfileView: View {
    @EnvironmentObject var online: OnlineModel
    @State private var email = "", password = "", name = "", service = ""
    @State private var advanced = false, confirmDelete = false
    @State private var export: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Profile").font(Brand.display(32, .largeTitle))
                Text("Optional: keep your team's results, see your statistics and badges. Playing never needs an account.").foregroundStyle(Brand.muted)
                if let me = online.profile {
                    Text("Signed in as \(me["displayName"] as? String ?? "") (\(me["email"] as? String ?? ""))").fontWeight(.bold)
                    if (me["emailVerified"] as? Bool) != true { HStack { Text("Confirm your email to count results.").foregroundStyle(Brand.goldHi); Button("Send again") { online.resendVerify() } } }
                    if online.outbox > 0 { Text("\(online.outbox) result(s) waiting to be sent.").foregroundStyle(Brand.goldHi) }
                    StatsView()
                    Text("Privacy").font(Brand.display(20, .headline)).padding(.top, 12)
                    let privacy = me["privacy"] as? [String: Any] ?? [:]
                    ForEach([("leaderboards", "Show me on leaderboards"), ("photo", "Show my photo"), ("history", "Show my quiz history")], id: \.0) { key, label in
                        Toggle(label, isOn: Binding(get: { privacy[key] as? Bool ?? false }, set: { online.privacy(key, $0) }))
                    }
                    Button("Download my data") { Task { export = await online.exportData() } }.buttonStyle(.bordered)
                    if let export { ShareLink("Share my data", item: export) }
                    Button("Sign out") { online.signOut() }.buttonStyle(.bordered)
                    if confirmDelete { HStack { Text("Delete everything, for good?").foregroundStyle(Brand.bad); Button("Delete", role: .destructive) { online.deleteAccount() } } }
                    else { Button("Delete my account", role: .destructive) { confirmDelete = true } }
                } else {
                    TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    SecureField("Password", text: $password).textContentType(.password).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    TextField("Your name (new account only)", text: $name).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    BigButton(title: "Sign in", enabled: !email.isEmpty && !password.isEmpty && !online.busy) { online.signIn(email, password); password = "" }
                    Button("Create account") { online.signUp(email, password, name); password = "" }.disabled(email.isEmpty || password.isEmpty || name.isEmpty).buttonStyle(.bordered)
                    if let reset = URL(string: online.client.resetUrl), !online.client.resetUrl.isEmpty { Link("Forgotten your password?", destination: reset) }
                    if online.outbox > 0 { Text("\(online.outbox) result(s) kept on this phone: sign in to add them.").foregroundStyle(Brand.goldHi) }
                }
                OnlineMessage()
                Button(advanced ? "Hide advanced" : "Advanced") { advanced.toggle(); service = online.client.baseUrl }.padding(.top, 12)
                if advanced {
                    TextField("BeerMat Online address", text: $service).keyboardType(.URL).textInputAutocapitalization(.never).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    Button("Use this address") { online.setService(service) }.buttonStyle(.bordered)
                    Text("Default: \(OnlineModel.defaultService)").font(.footnote).foregroundStyle(Brand.faint)
                }
            }.padding(24)
        }
    }
}

struct StatsView: View {
    @EnvironmentObject var online: OnlineModel
    var body: some View {
        if let s = online.stats {
            let st = s["stats"] as? [String: Any] ?? [:]
            Text("Your statistics").font(Brand.display(20, .headline)).padding(.top, 12)
            if (s["stale"] as? Bool) == true { Text("Offline: these are your statistics as last seen.").foregroundStyle(Brand.faint) }
            HStack(spacing: 8) {
                ForEach([("Quizzes", "quizzes"), ("Wins", "wins"), ("Podiums", "podiums"), ("Correct", "correct")], id: \.1) { label, key in
                    VStack { Text("\((st[key] as? NSNumber)?.intValue ?? 0)").font(Brand.display(24)).foregroundStyle(Brand.goldHi); Text(label).font(.caption).foregroundStyle(Brand.muted) }
                        .frame(maxWidth: .infinity).padding(10).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            let earned = Set((s["achievements"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
            Text("Badges").font(Brand.display(20, .headline))
            ForEach(online.badges, id: \.self) { b in
                Text("\(earned.contains(b["id"] ?? "") ? "🏅" : "🔒") \(b["name"] ?? "") — \(b["description"] ?? "")").foregroundStyle(earned.contains(b["id"] ?? "") ? Brand.text : Brand.faint)
            }
        }
    }
}

// ---- Find a quiz ----
struct FindView: View {
    @EnvironmentObject var online: OnlineModel
    @State private var q = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Find a quiz").font(Brand.display(32, .largeTitle))
                TextField("Town or postcode", text: $q).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12)).submitLabel(.search).onSubmit { online.search(q) }
                BigButton(title: "Search", enabled: !q.isEmpty && !online.busy) { online.search(q) }
                Button("Quizzes near me") { online.near() }.buttonStyle(.bordered)
                OnlineMessage()
                if let stale = online.eventsStale { Text("Offline: these are the results from \(when(stale)); they may be out of date.").foregroundStyle(Brand.faint) }
                if online.searched && online.events.isEmpty { Text("No quiz nights found there yet.").foregroundStyle(Brand.muted) }
                ForEach(online.events.indices, id: \.self) { i in EventCard(event: online.events[i]) }
            }.padding(24)
        }.task { if online.venues.isEmpty { online.loadVenues() } }
    }
}

struct EventCard: View {
    @EnvironmentObject var online: OnlineModel
    let event: [String: Any]
    var body: some View {
        let v = event["venue"] as? [String: Any] ?? [:]
        VStack(alignment: .leading, spacing: 4) {
            Text(event["title"] as? String ?? "").fontWeight(.bold)
            Button("\(v["name"] as? String ?? ""), \(v["town"] as? String ?? "")" + ((event["distanceKm"] as? NSNumber).map { " · \($0) km" } ?? "")) { online.open(v["id"] as? String) }
                .foregroundStyle(Brand.muted)
            Text(when(event["startsAt"]) + ((event["entry"] as? String).flatMap { $0.isEmpty ? nil : " · \($0)" } ?? "")).foregroundStyle(Brand.goldHi)
            HStack {
                Button("⏰ Remind me") { online.remind(event) }
                ShareLink("📅 Calendar", item: OnlineModel.calendarFile(event))
                if let d = (v["directions"] as? String).flatMap(URL.init(string:)) { Link("Directions", destination: d) }
            }.font(.footnote)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}

// ---- Map ----
private struct Pin: Identifiable { let id: String; let name: String; let coordinate: CLLocationCoordinate2D }

struct MapTab: View {
    @EnvironmentObject var online: OnlineModel
    @State private var day = ""
    @State private var region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 54, longitude: -2.5), span: MKCoordinateSpan(latitudeDelta: 10, longitudeDelta: 10))
    private let days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    var body: some View {
        let pins = online.venues.compactMap { v -> Pin? in
            guard let lat = (v["lat"] as? NSNumber)?.doubleValue, let lon = (v["lon"] as? NSNumber)?.doubleValue else { return nil }
            let nights = (v["quizNights"] as? [[String: Any]] ?? []).compactMap { $0["day"] as? String }
            guard day.isEmpty || nights.contains(day) else { return nil }
            return Pin(id: v["id"] as? String ?? "", name: v["name"] as? String ?? "", coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon))
        }
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach([""] + days, id: \.self) { d in
                        Button(d.isEmpty ? "All" : String(d.prefix(3)).capitalized) { day = d }
                            .font(.footnote.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                            .foregroundStyle(day == d ? Brand.onAccent : Brand.text).background(day == d ? Brand.gold : Brand.panel, in: Capsule())
                    }
                }.padding(8)
            }
            if !online.venuesNote.isEmpty { Text(online.venuesNote).font(.footnote).foregroundStyle(Brand.faint) }
            // Apple's map; the player's own location is never shown or sent.
            Map(coordinateRegion: $region, annotationItems: pins) { pin in
                MapAnnotation(coordinate: pin.coordinate) {
                    Button { online.open(pin.id) } label: { Image(systemName: "mappin.circle.fill").font(.title).foregroundStyle(Brand.gold) }.accessibilityLabel(pin.name)
                }
            }
        }.task { if online.venues.isEmpty { online.loadVenues() } }
    }
}

// ---- A venue's page ----
struct VenueSheet: View {
    @EnvironmentObject var online: OnlineModel
    let v: [String: Any]
    var body: some View {
        let id = v["id"] as? String ?? ""
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(v["name"] as? String ?? "").font(Brand.display(28))
                Text([v["address"], v["town"], v["postcode"]].compactMap { $0 as? String }.filter { !$0.isEmpty }.joined(separator: ", ")).foregroundStyle(Brand.muted)
                let nights = (v["quizNights"] as? [[String: Any]] ?? []).map { "\(($0["day"] as? String ?? "").capitalized) \($0["time"] as? String ?? "")" }
                if !nights.isEmpty { Text("Quiz nights: " + nights.joined(separator: ", ")).foregroundStyle(Brand.goldHi) }
                HStack {
                    Button(online.favourites.contains(id) ? "★ Saved" : "☆ Save venue") { online.favourite(id, !online.favourites.contains(id)) }
                    if let d = (v["directions"] as? String).flatMap(URL.init(string:)) { Link("Directions", destination: d) }
                    if let w = (v["website"] as? String).flatMap(URL.init(string:)), w.scheme == "https" { Link("Website", destination: w) }
                }
                let upcoming = v["upcoming"] as? [[String: Any]] ?? []
                if upcoming.isEmpty { Text("No quiz nights published yet.").foregroundStyle(Brand.faint) }
                ForEach(upcoming.indices, id: \.self) { i in EventCard(event: upcoming[i]) }
            }.padding(24)
        }.background(Brand.panel).foregroundStyle(Brand.text)
    }
}
