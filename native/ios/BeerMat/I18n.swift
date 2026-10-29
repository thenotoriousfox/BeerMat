import Foundation

/// The phone's words in English, French or Spanish, from the same dictionary as the browser player and the TV
/// (web/i18n.js, exported by scripts/export-i18n.mjs). In a quiz the app follows the quiz's language, as the player
/// page does; elsewhere the phone's own. {name} marks a value.
enum I18n {
    static var lang = "en"
    private static let table: [String: [String]] = (Bundle.main.url(forResource: "i18n", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: [String]]) ?? [:]
    /// The phone's own language when it's one BeerMat speaks.
    static var phone: String { let code = Locale.current.language.languageCode?.identifier ?? "en"; return ["fr", "es"].contains(code) ? code : "en" }

    static func t(_ text: String, _ values: [String: Any] = [:]) -> String {
        let index = ["fr": 0, "es": 1][lang]
        var out = index.flatMap { i in table[text].flatMap { $0.indices.contains(i) ? $0[i] : nil } } ?? text
        for (name, value) in values { out = out.replacingOccurrences(of: "{\(name)}", with: "\(value)") }
        return out
    }
}

func t(_ text: String, _ values: [String: Any] = [:]) -> String { I18n.t(text, values) }
