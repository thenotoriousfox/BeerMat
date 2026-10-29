import SwiftUI

/// BeerMat's tokens (web/style.css, the desk's Theme.qml, the Android app's Brand): night-purple, gold, pink, teal.
enum Brand {
    static let bg = Color(hex: 0x140B2E), bg2 = Color(hex: 0x0D0720), panel = Color(hex: 0x221447), raised = Color(hex: 0x2C1A5C)
    static let text = Color(hex: 0xFFF8EC), muted = Color(hex: 0xC8B9E4), faint = Color(hex: 0x8D82A8)
    static let gold = Color(hex: 0xFFB21A), goldHi = Color(hex: 0xFFD25E), pink = Color(hex: 0xFF3D81), teal = Color(hex: 0x1FD6C6)
    static let violet = Color(hex: 0x7A2CF0), good = Color(hex: 0x34D399), bad = Color(hex: 0xFF5470), onAccent = Color(hex: 0x1C1036)
    /// Answer keys, matching the TV's option tiles.
    static let options = [Color(hex: 0xFF5470), Color(hex: 0x3B82F6), Color(hex: 0x34D399), Color(hex: 0xFFB21A), Color(hex: 0x7A2CF0), Color(hex: 0x1FD6C6)]

    /// Fredoka for headings (bundled, UIAppFonts), scaled with Dynamic Type.
    static func display(_ size: CGFloat, _ style: Font.TextStyle = .title) -> Font { .custom("Fredoka", size: size, relativeTo: style).weight(.bold) }
}

extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255) }
}

struct BigButton: View {
    let title: String
    var colour: Color = Brand.gold
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(Brand.display(20, .headline)).frame(maxWidth: .infinity, minHeight: 58)
                .foregroundStyle(enabled ? Brand.onAccent : Brand.faint)
                .background(enabled ? colour : Brand.raised, in: RoundedRectangle(cornerRadius: 18))
        }.disabled(!enabled)
    }
}

struct Pill: View {
    let text: String, colour: Color
    var body: some View {
        Text(text).font(.footnote.weight(.bold)).tracking(1).foregroundStyle(colour)
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(colour.opacity(0.15), in: Capsule()).overlay(Capsule().stroke(colour.opacity(0.5)))
    }
}

struct MessageText: View {
    @EnvironmentObject var model: PlayerModel
    var body: some View {
        if !model.message.isEmpty {
            Text(t(model.message)).fontWeight(.semibold).foregroundStyle(model.isError ? Brand.bad : Brand.goldHi)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8).accessibilityAddTraits(.updatesFrequently)
        }
    }
}
