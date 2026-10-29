import CoreLocation
import Foundation
import Security
import UserNotifications

/// BeerMat Online's storage on the phone: settings in UserDefaults, the sign-in token in the Keychain.
final class PhoneStorage: OnlineStorage {
    private let defaults = UserDefaults.standard
    func get(_ name: String) -> String? { defaults.string(forKey: "online:" + name) }
    func set(_ name: String, _ value: String?) { defaults.set(value, forKey: "online:" + name) }
    func secret(_ name: String) -> String? {
        var item: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.beermat.online", kSecAttrAccount as String: name,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    func setSecret(_ name: String, _ value: String?) {
        let match: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.beermat.online", kSecAttrAccount as String: name]
        SecItemDelete(match as CFDictionary)
        if let value { var add = match; add[kSecValueData as String] = Data(value.utf8); add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; SecItemAdd(add as CFDictionary, nil) }
    }
}

/// Profile, Find a quiz and the map. None of it is needed to play; all of it is the player's choice.
@MainActor
final class OnlineModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let defaultService = "https://online.beermatquiz.co.uk"
    let client: OnlineClient
    @Published var profile: [String: Any]?
    @Published var stats: [String: Any]?
    @Published var events: [[String: Any]] = []
    @Published var eventsStale: Double?
    @Published var searched = false
    @Published var venues: [[String: Any]] = []
    @Published var venuesNote = ""
    @Published var venue: [String: Any]?
    @Published var favourites: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "favourites") ?? [])
    @Published var busy = false
    @Published var message = ""
    @Published var isError = false
    @Published var outbox = 0
    private let location = CLLocationManager()

    /// The badges the server can award (shared/achievements.js, bundled as badges.json).
    let badges: [[String: String]] = (Bundle.main.url(forResource: "badges", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: String]]) ?? []

    override init() {
        let storage = PhoneStorage()
        client = OnlineClient(baseUrl: storage.get("baseUrl") ?? OnlineModel.defaultService, venueListUrl: "https://raw.githubusercontent.com/DTJW92/BeerMat/main/venues.json", storage: storage)
        super.init()
        location.delegate = self
        profile = client.profile; outbox = client.outbox.count
        if client.signedIn { refresh() }
    }

    func say(_ text: String, error: Bool = false) { message = text; isError = error }
    private func work(_ block: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true; message = ""
        Task {
            do { try await block() } catch let e as OnlineError { say(e.message, error: true) } catch { say(error.localizedDescription, error: true) }
            profile = client.profile; outbox = client.outbox.count; busy = false
        }
    }

    func setService(_ url: String) { client.baseUrl = url.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")); PhoneStorage().set("baseUrl", client.baseUrl); say(t("Saved")) }
    func signIn(_ email: String, _ password: String) { work { _ = try await self.client.signIn(email: email, password: password); await self.load(); self.say(t("Signed in")) } }
    func signUp(_ email: String, _ password: String, _ name: String) { work { _ = try await self.client.signUp(email: email, password: password, displayName: name); await self.load(); self.say(t("Account created: check your email to confirm it")) } }
    func signOut() { work { await self.client.signOut(); self.stats = nil; self.say(t("Signed out")) } }
    func refresh() { work { await self.load() } }
    private func load() async {
        _ = try? await client.refreshProfile()
        if let flushed = try? await client.flush(), flushed.sent > 0 { say(t("{n} result(s) added to your profile", ["n": flushed.sent])) }
        stats = (try? await client.stats()) ?? stats
    }
    func privacy(_ key: String, _ on: Bool) { work { try await self.client.updateProfile(["privacy": [key: on]]); self.say(t("Privacy saved")) } }
    func resendVerify() { work { try await self.client.resendVerify(); self.say(t("We’ve sent the email again")) } }
    func deleteAccount() { work { try await self.client.deleteAccount(); self.stats = nil; self.say(t("Your account and everything in it are deleted")) } }
    func exportData() async -> String? {
        guard let data = try? await client.exportData(), let json = try? JSONSerialization.data(withJSONObject: data, options: .prettyPrinted) else { return nil }
        return String(decoding: json, as: UTF8.self)
    }

    /// The team's signed result from the quiz laptop, kept in the profile (or waiting until signed in and online).
    func keep(_ claim: [String: Any]) async {
        do {
            let r = try await client.saveResult(claim)
            say(r.sent > 0 ? t("Result kept in your profile") : !client.signedIn ? t("Result kept on this phone: sign in under Profile to add it") : t("Result kept on this phone; it’s added when BeerMat Online can be reached"))
        } catch { say(error.localizedDescription, error: true) }
        outbox = client.outbox.count
    }

    // ---- finding quizzes ----
    func search(_ q: String) { work { self.show(try await self.client.findEvents(q: q)) } }
    private func show(_ r: [String: Any]) {
        events = r["events"] as? [[String: Any]] ?? []; eventsStale = (r["stale"] as? Bool) == true ? (r["fetchedAt"] as? Double) : nil; searched = true
    }
    /// Location is asked for only when the player taps the button; only the position rounded to ~100 m is sent.
    func near() {
        switch location.authorizationStatus {
        case .notDetermined: location.requestWhenInUseAuthorization()
        case .denied, .restricted: say(t("Search by town or postcode instead."))
        default: location.requestLocation()
        }
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { manager.requestLocation() }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let at = locations.last?.coordinate else { return }
        Task { @MainActor in self.work { self.show(try await self.client.findEvents(lat: at.latitude, lon: at.longitude, radiusKm: 25)) } }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.say(t("This phone doesn’t know where it is yet. Search by town instead."), error: true) }
    }

    func loadVenues() {
        work {
            let r = try await self.client.venues()
            self.venues = r["venues"] as? [[String: Any]] ?? []
            self.venuesNote = r["source"] as? String == "cache" ? t("Offline: the venues as last seen.") : r["source"] as? String == "list" ? t("Offline: venues from BeerMat’s venue list.") : ""
        }
    }
    func open(_ id: String?) {
        guard let id else { venue = nil; return }
        work {
            var v = try await self.client.venue(id)
            let found = (try? await self.client.findEvents(q: v["name"] as? String ?? ""))?["events"] as? [[String: Any]] ?? []
            v["upcoming"] = found.filter { ($0["venue"] as? [String: Any])?["id"] as? String == id }
            self.venue = v
        }
    }
    /// Favourite venues are kept on the phone, and in the profile when signed in.
    func favourite(_ id: String, _ on: Bool) {
        if on { favourites.insert(id) } else { favourites.remove(id) }
        UserDefaults.standard.set(Array(favourites), forKey: "favourites")
        if client.signedIn { Task { try? await client.favourite(id, on: on) } }
    }

    /// A notification two hours before (asked the first time); nothing leaves the phone.
    func remind(_ e: [String: Any]) {
        let starts = (e["startsAt"] as? NSNumber)?.doubleValue ?? 0
        let at = Date(timeIntervalSince1970: starts / 1000 - 2 * 3600)
        guard at > Date() else { return say(t("It starts within two hours!")) }
        let center = UNUserNotificationCenter.current()
        Task {
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return say(t("Notifications are off: add it to your calendar instead.")) }
            let content = UNMutableNotificationContent()
            content.title = t("Quiz night in two hours")
            content.body = t("{title} at {venue}", ["title": e["title"] as? String ?? t("Quiz night"), "venue": (e["venue"] as? [String: Any])?["name"] as? String ?? ""])
            let trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "quiz-\(e["id"] ?? "")", content: content, trigger: trigger))
            say(t("We’ll remind you two hours before"))
        }
    }

    /// The quiz night as a calendar file, for the phone's calendar (shared, no permission needed).
    static func calendarFile(_ e: [String: Any]) -> URL {
        let v = e["venue"] as? [String: Any] ?? [:]
        let start = Date(timeIntervalSince1970: ((e["startsAt"] as? NSNumber)?.doubleValue ?? 0) / 1000)
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"; f.timeZone = TimeZone(identifier: "UTC")
        let ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BeerMat//EN", "BEGIN:VEVENT", "UID:\(e["id"] ?? UUID().uuidString)@beermat",
                   "DTSTAMP:\(f.string(from: Date()))", "DTSTART:\(f.string(from: start))", "DTEND:\(f.string(from: start.addingTimeInterval(7200)))",
                   "SUMMARY:\(e["title"] as? String ?? t("Quiz night")) — \(v["name"] as? String ?? "")",
                   "LOCATION:\([v["address"], v["town"], v["postcode"]].compactMap { $0 as? String }.filter { !$0.isEmpty }.joined(separator: "\\, "))",
                   "END:VEVENT", "END:VCALENDAR"].joined(separator: "\r\n")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("beermat.ics")
        try? ics.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
