// A workspace not yet built natively. It says so plainly and offers the web desk, which has every feature and talks to
// the same quiz server, so nothing is out of reach meanwhile.
import QtQuick
import QtQuick.Layouts
import Desk

Panel {
    id: pending
    property string heading: ""
    property string summary: ""
    signal openWebDesk()
    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(parent.width, 620)
        spacing: 14
        Text { text: pending.heading; color: Theme.text; font.family: Theme.display; font.pixelSize: 28; font.weight: Font.Bold; Layout.fillWidth: true; wrapMode: Text.WordWrap }
        Text { text: pending.summary; color: Theme.muted; font.pixelSize: 15; Layout.fillWidth: true; wrapMode: Text.WordWrap }
        Text { text: "This workspace isn't native yet. The web desk has all of it and runs on the same quiz server, so changes there show here at once."
               color: Theme.faint; font.pixelSize: 13; Layout.fillWidth: true; wrapMode: Text.WordWrap }
        DeskButton { text: "Open the desk in a browser"; kind: "primary"; onClicked: pending.openWebDesk() }
    }
}
