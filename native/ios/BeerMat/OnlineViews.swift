import MapKit
import SwiftUI

private func when(_ ms: Any?) -> String {
    let d = Date(timeIntervalSince1970: ((ms as? NSNumber)?.doubleValue ?? 0) / 1000)
    return d.formatted(date: .complete, time: .shortened)
}

struct OnlineMessage: View {
    @EnvironmentObject var online: OnlineModel
    var body: some View { if !online.message.isEmpty { Text(t(online.message)).fontWeight(.semibold).foregroundStyle(online.isError ? Brand.bad : Brand.goldHi) } }
}

// ---- Profile ----
struct ProfileView: View {
    @EnvironmentObject var online: OnlineModel
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var service = ""
    @State private var advanced = false
    @State private var confirmDelete = false
    @State private var export: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("Profile")).font(Brand.display(32, .largeTitle))
                Text(t("Optional: keep your team’s results, see your statistics and badges. Playing never needs an account.")).foregroundStyle(Brand.muted)
                if let me = online.profile {
                    Text(t("Signed in as {name} ({email})", ["name": me["displayName"] as? String ?? "", "email": me["email"] as? String ?? ""])).fontWeight(.bold)
                    if (me["emailVerified"] as? Bool) != true { HStack { Text(t("Confirm your email to count results.")).foregroundStyle(Brand.goldHi); Button(t("Send again")) { online.resendVerify() } } }
                    if online.outbox > 0 { Text(t("{n} result(s) waiting to be sent.", ["n": online.outbox])).foregroundStyle(Brand.goldHi) }
                    StatsView()
                    Text(t("Privacy")).font(Brand.display(20, .headline)).padding(.top, 12)
                    let privacy = me["privacy"] as? [String: Any] ?? [:]
                    ForEach([("leaderboards", t("Show me on leaderboards")), ("photo", t("Show my photo")), ("history", t("Show my quiz history"))], id: \.0) { key, label in
                        Toggle(label, isOn: Binding(get: { privacy[key] as? Bool ?? false }, set: { online.privacy(key, $0) }))
                    }
                    Button(t("Download my data")) { Task { export = await online.exportData() } }.buttonStyle(.bordered)
                    if let export { ShareLink("Share my data", item: export) }
                    Button(t("Sign out")) { online.signOut() }.buttonStyle(.bordered)
                    if confirmDelete { HStack { Text(t("Delete everything, for good?")).foregroundStyle(Brand.bad); Button(t("Delete"), role: .destructive) { online.deleteAccount() } } }
                    else { Button(t("Delete my account"), role: .destructive) { confirmDelete = true } }
                } else {
                    TextField(t("Email"), text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    SecureField(t("Password"), text: $password).textContentType(.password).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    TextField(t("Your name (new account only)"), text: $name).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    BigButton(title: t("Sign in"), enabled: !email.isEmpty && !password.isEmpty && !online.busy) { online.signIn(email, password); password = "" }
                    Button(t("Create account")) { online.signUp(email, password, name); password = "" }.disabled(email.isEmpty || password.isEmpty || name.isEmpty).buttonStyle(.bordered)
                    if let reset = URL(string: online.client.resetUrl), !online.client.resetUrl.isEmpty { Link(t("Forgotten your password?"), destination: reset) }
                    if online.outbox > 0 { Text(t("{n} result(s) kept on this phone: sign in to add them.", ["n": online.outbox])).foregroundStyle(Brand.goldHi) }
                }
                OnlineMessage()
                Button(advanced ? t("Hide advanced") : t("Advanced")) { advanced.toggle(); service = online.client.baseUrl }.padding(.top, 12)
                if advanced {
                    TextField(t("BeerMat Online address"), text: $service).keyboardType(.URL).textInputAutocapitalization(.never).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                    Button(t("Use this address")) { online.setService(service) }.buttonStyle(.bordered)
                    Text(t("Default: {url}", ["url": OnlineModel.defaultService])).font(.footnote).foregroundStyle(Brand.faint)
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
            Text(t("Your statistics")).font(Brand.display(20, .headline)).padding(.top, 12)
            if (s["stale"] as? Bool) == true { Text(t("Offline: these are your statistics as last seen.")).foregroundStyle(Brand.faint) }
            HStack(spacing: 8) {
                ForEach([(t("Quizzes"), "quizzes"), (t("Wins"), "wins"), (t("Podiums"), "podiums"), (t("Correct"), "correct")], id: \.1) { label, key in
                    VStack { Text("\((st[key] as? NSNumber)?.intValue ?? 0)").font(Brand.display(24)).foregroundStyle(Brand.goldHi); Text(label).font(.caption).foregroundStyle(Brand.muted) }
                        .frame(maxWidth: .infinity).padding(10).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            let earned = Set((s["achievements"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
            Text(t("Badges")).font(Brand.display(20, .headline))
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
                Text(t("Find a quiz")).font(Brand.display(32, .largeTitle))
                TextField(t("Town or postcode"), text: $q).padding(12).background(Brand.panel, in: RoundedRectangle(cornerRadius: 12)).submitLabel(.search).onSubmit { online.search(q) }
                BigButton(title: t("Search"), enabled: !q.isEmpty && !online.busy) { online.search(q) }
                Button(t("Quizzes near me")) { online.near() }.buttonStyle(.bordered)
                OnlineMessage()
                if let stale = online.eventsStale { Text(t("Offline: these are the results from {date}; they may be out of date.", ["date": when(stale)])).foregroundStyle(Brand.faint) }
                if online.searched && online.events.isEmpty { Text(t("No quiz nights found there yet.")).foregroundStyle(Brand.muted) }
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
                Button(t("⏰ Remind me")) { online.remind(event) }
                ShareLink(t("📅 Calendar"), item: OnlineModel.calendarFile(event))
                if let d = (v["directions"] as? String).flatMap(URL.init(string:)) { Link(t("Directions"), destination: d) }
            }.font(.footnote)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Brand.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}

// ---- Map ----
private struct Pin: Identifiable { let id: String; let name: String; let coordinate: CLLocationCoordinate2D }

struct MapTab: View {
    @EnvironmentObject var online: OnlineModel
    @State private var day = ""
    /// The pin tapped: a small popup with the venue and its next quiz (the map's own venue data, nothing to fetch).
    @State private var picked: String?
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
                        Button(d.isEmpty ? t("All") : String(d.prefix(3)).capitalized) { day = d }
                            .font(.footnote.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                            .foregroundStyle(day == d ? Brand.onAccent : Brand.text).background(day == d ? Brand.gold : Brand.panel, in: Capsule())
                    }
                }.padding(8)
            }
            if !online.venuesNote.isEmpty { Text(online.venuesNote).font(.footnote).foregroundStyle(Brand.faint) }
            // Apple's map; the player's own location is never shown or sent.
            Map(coordinateRegion: $region, annotationItems: pins) { pin in
                MapAnnotation(coordinate: pin.coordinate) {
                    Button { picked = pin.id } label: { Image(systemName: "mappin.circle.fill").font(.title).foregroundStyle(Brand.gold) }.accessibilityLabel(pin.name)
                }
            }
            .overlay {
                if let id = picked, let venue = online.venues.first(where: { $0["id"] as? String == id }) {
                    MapVenuePopup(v: venue) { picked = nil }
                }
            }
        }.task { if online.venues.isEmpty { online.loadVenues() } }
    }
}

/// A map pin's popup: the venue's details and when its next quiz is (not the venue page's list of quizzes).
private struct MapVenuePopup: View {
    @EnvironmentObject var online: OnlineModel
    let v: [String: Any]
    let close: () -> Void
    private var id: String { v["id"] as? String ?? "" }
    private var address: String { [v["address"], v["town"], v["postcode"]].compactMap { $0 as? String }.filter { !$0.isEmpty }.joined(separator: ", ") }
    private var nights: String {
        (v["quizNights"] as? [[String: Any]] ?? []).map { "\(($0["day"] as? String ?? "").capitalized) \($0["time"] as? String ?? "")" }.joined(separator: ", ")
    }
    private var next: String {
        guard let n = v["next"] as? [String: Any] else { return t("No quiz nights published yet.") }
        return t("Next: {title}, {date}", ["title": n["title"] as? String ?? "", "date": when(n["startsAt"])])
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea().onTapGesture(perform: close)
            VStack(alignment: .leading, spacing: 8) {
                Text(v["name"] as? String ?? "").font(Brand.display(24))
                Text(address).foregroundStyle(Brand.muted)
                if !nights.isEmpty { Text(t("Quiz nights: {nights}", ["nights": nights])).foregroundStyle(Brand.muted) }
                Text(next).bold().foregroundStyle(Brand.goldHi)
                HStack {
                    Button(online.favourites.contains(id) ? t("★ Saved") : t("☆ Save venue")) { online.favourite(id, !online.favourites.contains(id)) }
                    if let d = (v["directions"] as? String).flatMap(URL.init(string:)) { Link(t("Directions"), destination: d) }
                    if let w = (v["website"] as? String).flatMap(URL.init(string:)), w.scheme == "https" { Link(t("Website"), destination: w) }
                }
                Button(t("Close"), action: close).frame(maxWidth: .infinity)
            }
            .padding(20).background(Brand.panel, in: RoundedRectangle(cornerRadius: 20)).foregroundStyle(Brand.text).padding(24)
        }
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
                    Button(online.favourites.contains(id) ? t("★ Saved") : t("☆ Save venue")) { online.favourite(id, !online.favourites.contains(id)) }
                    if let d = (v["directions"] as? String).flatMap(URL.init(string:)) { Link(t("Directions"), destination: d) }
                    if let w = (v["website"] as? String).flatMap(URL.init(string:)), w.scheme == "https" { Link(t("Website"), destination: w) }
                }
                let upcoming = v["upcoming"] as? [[String: Any]] ?? []
                if upcoming.isEmpty { Text(t("No quiz nights published yet.")).foregroundStyle(Brand.faint) }
                ForEach(upcoming.indices, id: \.self) { i in EventCard(event: upcoming[i]) }
            }.padding(24)
        }.background(Brand.panel).foregroundStyle(Brand.text)
    }
}
