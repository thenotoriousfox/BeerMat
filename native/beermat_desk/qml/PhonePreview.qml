// A theme on a phone in the BeerMat app, as the app draws a quiz in a look (native/android ui/Theme.kt and
// Screens.kt LookScene): the look's background and phone scenery (tv.json's phone, on a stage 390 wide placed from the
// bottom), its colours on the team bar, a question, the answer keys and the button. For the theme library's previews.
import QtQuick
import Desk

Rectangle {
    id: phone
    property string lookId: ""
    // The look's colours over BeerMat's own (the app's Brand), key by key.
    readonly property var colours: {
        const p = (desk.lookPalettes || {})[lookId] || {}
        return {panel: p.panel || "#221447", text: p.text || "#fff8ec", muted: p.muted || "#c8b9e4", gold: p.gold || "#ffb21a", goldHi: p.goldHi || "#ffd25e",
                onAccent: p.onAccent || "#1c1036", good: p.good || "#34d399", bg: p.bg || "#140b2e", bg2: p.bg2 || "#0d0720"}
    }
    readonly property var look: (desk.lookScenes || {})[lookId] || null
    readonly property var phoneLook: look && look.phone ? look.phone : null
    readonly property var stops: phoneLook && phoneLook.background && phoneLook.background.gradient ? phoneLook.background.gradient
                                 : [[0, "#241046"], [0.5, colours.bg], [1, colours.bg2]]
    width: 390; height: 844; radius: 36; clip: true
    color: colours.bg
    gradient: Gradient {
        GradientStop { position: phone.stops[0][0]; color: phone.stops[0][1] }
        GradientStop { position: phone.stops[Math.min(1, phone.stops.length - 1)][0]; color: phone.stops[Math.min(1, phone.stops.length - 1)][1] }
        GradientStop { position: phone.stops[Math.min(2, phone.stops.length - 1)][0]; color: phone.stops[Math.min(2, phone.stops.length - 1)][1] }
        GradientStop { position: phone.stops[phone.stops.length - 1][0]; color: phone.stops[phone.stops.length - 1][1] }
    }
    // The scenery, from the bottom of the screen.
    Repeater {
        model: phone.phoneLook && phone.phoneLook.scene ? phone.phoneLook.scene : []
        delegate: Image {
            required property var modelData
            source: phone.look.base + modelData.image
            x: modelData.x || 0; y: phone.height - (modelData.bottom || 0) - height
            width: modelData.width; height: modelData.height; opacity: modelData.opacity ?? 1
            fillMode: Image.Stretch; smooth: true; sourceSize: Qt.size(width * 2, height * 2)
        }
    }
    // The team bar.
    Rectangle {
        y: 44; width: parent.width; height: 52; color: phone.colours.panel
        Row {
            anchors.verticalCenter: parent.verticalCenter; x: 18; spacing: 10
            Rectangle { width: 10; height: 10; radius: 5; color: phone.colours.good; anchors.verticalCenter: parent.verticalCenter }
            Text { text: "The Quizzly Bears"; color: phone.colours.text; font.pixelSize: 17; font.weight: Font.Bold }
        }
        Text { anchors.right: parent.right; anchors.rightMargin: 18; anchors.verticalCenter: parent.verticalCenter
               text: "#1 · 4 pts"; color: phone.colours.goldHi; font.pixelSize: 15; font.weight: Font.Bold }
    }
    Column {
        x: 20; y: 120; width: parent.width - 40; spacing: 12
        Text { text: "ROUND 1"; color: phone.colours.gold; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2 }
        Text { width: parent.width; text: "Which planet is known as the Red Planet?"; wrapMode: Text.WordWrap; color: phone.colours.text
               font.family: Theme.display; font.pixelSize: 27; font.weight: Font.Bold }
        Text { text: "42s left"; color: phone.colours.goldHi; font.pixelSize: 15; font.weight: Font.Bold }
        Repeater {
            model: [["A", "Venus", "#ff5470"], ["B", "Mars", "#3b82f6"], ["C", "Jupiter", "#34d399"], ["D", "Saturn", "#ffb21a"]]
            delegate: Rectangle {
                required property var modelData
                width: parent.width; height: 56; radius: 14; color: modelData[2]
                Text { x: 18; anchors.verticalCenter: parent.verticalCenter; text: `${modelData[0]}.  ${modelData[1]}`; color: "white"; font.pixelSize: 19; font.weight: Font.Bold }
            }
        }
        Rectangle {
            width: parent.width; height: 54; radius: 27; color: phone.colours.gold
            Text { anchors.centerIn: parent; text: "Lock in answer"; color: phone.colours.onAccent; font.pixelSize: 17; font.weight: Font.Bold }
        }
    }
}
