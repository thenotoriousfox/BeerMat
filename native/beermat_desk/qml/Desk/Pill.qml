// A small status label: Live, Paused, a type of question, a count.
import QtQuick

Rectangle {
    property alias text: label.text
    property color tone: Theme.muted
    property bool strong: false
    implicitWidth: label.implicitWidth + 20
    implicitHeight: 26
    radius: 13
    color: strong ? tone : Qt.rgba(tone.r, tone.g, tone.b, 0.14)
    border.color: Qt.rgba(tone.r, tone.g, tone.b, strong ? 0 : 0.45)
    Text { id: label; anchors.centerIn: parent; color: parent.strong ? Theme.onAccent : parent.tone; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 0.4 }
}
