// The desk's buttons: primary (gold, the next thing to do), danger (pink, closes answers) or quiet, each with the
// key that does the same thing.
import QtQuick
import QtQuick.Controls.Basic

Button {
    id: control
    property string kind: "quiet"          // primary | danger | quiet
    property string shortcutHint: ""
    property bool big: false
    readonly property color base: kind === "primary" ? Theme.gold : kind === "danger" ? Theme.pink : Theme.panelRaised
    implicitHeight: big ? 64 : 42
    leftPadding: big ? 28 : 18
    rightPadding: big ? 28 : 18
    hoverEnabled: true
    focusPolicy: Qt.TabFocus

    contentItem: Row {
        spacing: 10
        Text {
            text: control.text
            anchors.verticalCenter: parent.verticalCenter
            // Disabled: readable but clearly off, whatever the kind (dark text on a faded gold vanished).
            color: !control.enabled ? Theme.faint : control.kind === "quiet" ? Theme.text : Theme.onAccent
            font.family: control.big ? Theme.display : Theme.ui
            font.pixelSize: control.big ? 22 : 14
            font.weight: Font.Bold
        }
        Rectangle {
            visible: control.shortcutHint !== ""
            anchors.verticalCenter: parent.verticalCenter
            width: hint.implicitWidth + 10; height: Math.max(20, hint.implicitHeight + 4); radius: 5
            color: Qt.rgba(0, 0, 0, control.kind === "quiet" || !control.enabled ? 0.25 : 0.14)
            Text { id: hint; anchors.centerIn: parent; text: control.shortcutHint; font.pixelSize: 11; font.weight: Font.Bold
                   color: !control.enabled ? Theme.faint : control.kind === "quiet" ? Theme.muted : Theme.onAccent }
        }
    }
    background: Rectangle {
        radius: control.big ? 18 : 12
        color: !control.enabled ? Qt.rgba(1, 1, 1, 0.05) : control.down ? Qt.darker(control.base, 1.2) : control.hovered ? Qt.lighter(control.base, 1.12) : control.base
        border.color: control.visualFocus ? Theme.teal : control.kind === "quiet" || !control.enabled ? Theme.line : "transparent"
        border.width: control.visualFocus ? 2 : 1
        Behavior on color { ColorAnimation { duration: 120 } }
    }
    opacity: enabled ? 1 : 0.75
}
