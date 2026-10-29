import Foundation
import Security

/// What the phone remembers: each quiz's team recovery code (in the Keychain, this device only) and the recent quiz
/// addresses. Nothing here is sent anywhere but the quiz server it belongs to.
struct Identity {
    struct Saved: Codable { let server: String, team: String, event: String }
    struct Recent: Codable, Hashable { let server: String, title: String, at: Date }

    private let defaults = UserDefaults.standard

    func secret(for server: String) -> String? {
        var item: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.beermat.team", kSecAttrAccount as String: server,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(secret: String, server: String, team: String, event: String) {
        let match: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.beermat.team", kSecAttrAccount as String: server]
        SecItemDelete(match as CFDictionary)
        var add = match
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
        defaults.set(try? JSONEncoder().encode(Saved(server: server, team: team, event: event)), forKey: "team:\(server)")
    }

    func forget(server: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.beermat.team", kSecAttrAccount as String: server] as CFDictionary)
        defaults.removeObject(forKey: "team:\(server)")
    }

    var recent: [Recent] { (defaults.data(forKey: "recent").flatMap { try? JSONDecoder().decode([Recent].self, from: $0) }) ?? [] }

    func remember(server: String, title: String) {
        let list = [Recent(server: server, title: title, at: Date())] + recent.filter { $0.server != server }
        defaults.set(try? JSONEncoder().encode(Array(list.prefix(8))), forKey: "recent")
    }

    var haptics: Bool {
        get { defaults.object(forKey: "haptics") as? Bool ?? true }
        nonmutating set { defaults.set(newValue, forKey: "haptics") }
    }
}
