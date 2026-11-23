// BeerMat as a TV screen (tvscreen.py): the TV of the quizmaster's laptop, full screen on this computer. Until it has
// found the quiz it shows how it's finding it: a QR code to sign this TV in to the BeerMat account, the account's
// laptops to choose from, or a place to type the laptop's address on the quiz Wi-Fi; afterwards moving the mouse, or
// Escape, brings up a small bar to change quiz, become the quizmaster desk or close.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Window
import Desk

Window {
    id: win
    objectName: "tvScreenWindow"
    width: 1280; height: 720
    visible: true
    visibility: full ? Window.FullScreen : Window.Windowed
    property bool full: true
    color: "black"
    title: tvScreen.connected ? `BeerMat TV · ${tvScreen.title}` : "BeerMat TV"
    readonly property bool shown: Object.keys(tvScreen.tv || {}).length > 0

    TvStage { anchors.fill: parent; visible: win.shown; tv: tvScreen.tv; serverUrl: tvScreen.serverUrl }

    // ---- finding the quiz ----
    Rectangle {
        objectName: "findQuiz"
        anchors.fill: parent
        visible: !win.shown
        color: Theme.bg
        ColumnLayout {
            anchors.centerIn: parent
            width: Math.min(parent.width - 80, 720)
            spacing: 16
            Text { text: "BeerMat TV screen"; color: Theme.text; font.family: Theme.display; font.pixelSize: 40; font.weight: Font.Bold }
            Text {
                objectName: "tvScreenMessage"
                Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 18
                text: tvScreen.message || "Looking for the quiz…"
            }
            // Signing this TV in: a phone signed in to the account scans it (BeerMat Online's /connect).
            Rectangle {
                visible: tvScreen.pairUrl !== ""
                Layout.alignment: Qt.AlignHCenter
                width: 300; height: 300; radius: 12; color: "white"
                QrCode { objectName: "tvSignInQr"; anchors.fill: parent; anchors.margins: 14; text: tvScreen.pairUrl }
            }
            Repeater {
                model: tvScreen.found
                delegate: DeskButton {
                    required property var modelData
                    objectName: "quiz-" + modelData.venueKey
                    Layout.fillWidth: true; implicitHeight: 52
                    text: `${modelData.title}  ·  ${modelData.name}`
                    kind: "primary"
                    onClicked: tvScreen.choose(modelData.venueKey)
                }
            }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 14
                   text: "On BeerMat’s own quiz Wi-Fi, with no internet, type the laptop’s address instead (10.42.0.1 on Linux, 192.168.137.1 on Windows)." }
            RowLayout {
                Layout.fillWidth: true; spacing: 8
                Field { id: typed; objectName: "typedAddress"; Layout.fillWidth: true; placeholderText: "Laptop address, e.g. 10.42.0.1 or 192.168.1.20"
                        text: tvScreen.savedAddress; onAccepted: tvScreen.connectTo(text) }
                DeskButton { text: "Connect"; implicitHeight: 40; enabled: typed.text.trim() !== ""; onClicked: tvScreen.connectTo(typed.text) }
            }
            Flow {
                Layout.fillWidth: true; spacing: 8
                DeskButton { text: tvScreen.searching ? "Searching…" : "Search again"; enabled: !tvScreen.searching; implicitHeight: 40; onClicked: tvScreen.search() }
                DeskButton { visible: tvScreen.signedIn; text: "Sign this TV out"; implicitHeight: 40; onClicked: tvScreen.signOut() }
                DeskButton { text: "Use this computer as the quizmaster desk"; implicitHeight: 40; onClicked: tvScreen.becomeDesk() }
                DeskButton { text: "Close"; implicitHeight: 40; onClicked: tvScreen.quit() }
            }
            Text { visible: tvScreen.serverUrl !== "" && !tvScreen.connected; text: `Connecting to ${tvScreen.address}…`; color: Theme.faint; font.pixelSize: 14 }
        }
    }

    // ---- connected: a quiet badge if the laptop drops out, and a bar on demand ----
    Rectangle {
        visible: win.shown && !tvScreen.connected
        anchors.left: parent.left; anchors.top: parent.top; anchors.margins: 16
        width: lost.implicitWidth + 24; height: 36; radius: 18; color: "#cc000000"
        Text { id: lost; anchors.centerIn: parent; text: "Reconnecting to the quiz…"; color: "white"; font.pixelSize: 15 }
    }
    Rectangle {
        id: bar
        objectName: "tvScreenBar"
        property bool open: false
        visible: win.shown && open
        anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 16
        width: barRow.implicitWidth + 24; height: 52; radius: 12; color: "#e6101018"; border.color: "#33ffffff"
        RowLayout {
            id: barRow
            anchors.centerIn: parent; spacing: 8
            Text { text: `TV screen · ${tvScreen.title}`; color: "white"; font.pixelSize: 14 }
            DeskButton { text: "Change quiz"; implicitHeight: 34; onClicked: { bar.open = false; tvScreen.forget() } }
            DeskButton { text: win.full ? "Window" : "Full screen"; implicitHeight: 34; onClicked: win.full = !win.full }
            DeskButton { text: "Quizmaster desk"; implicitHeight: 34; onClicked: tvScreen.becomeDesk() }
            DeskButton { text: "Close"; implicitHeight: 34; onClicked: tvScreen.quit() }
        }
        Timer { id: hide; interval: 4000; onTriggered: bar.open = false }
    }
    MouseArea {
        anchors.fill: parent; hoverEnabled: true; acceptedButtons: Qt.NoButton
        visible: win.shown
        onPositionChanged: { bar.open = true; hide.restart() }
        cursorShape: bar.open ? Qt.ArrowCursor : Qt.BlankCursor
    }
    Shortcut { sequence: "Escape"; onActivated: { bar.open = !bar.open; hide.restart() } }
    Shortcut { sequence: "F11"; onActivated: win.full = !win.full }
}
