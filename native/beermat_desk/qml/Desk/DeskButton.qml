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

    // A big button's natural width is its label at full size (the label shrinks only when the button is narrower).
    implicitWidth: big ? leftPadding + rightPadding + label.implicitWidth + (shortcutHint !== "" ? hintBox.width + 10 : 0)
                       : Math.max(implicitBackgroundWidth + leftInset + rightInset, implicitContentWidth + leftPadding + rightPadding)
    contentItem: Row {
        spacing: 10
        Text {
            id: label
            text: control.text
            anchors.verticalCenter: parent.verticalCenter
            // Disabled: readable but clearly off, whatever the kind (dark text on a faded gold vanished).
            color: !control.enabled ? Theme.faint : control.kind === "quiet" ? Theme.text : Theme.onAccent
            font.family: control.big ? Theme.display : Theme.ui
            font.pixelSize: control.big ? 22 : 14
            font.weight: Font.Bold
            // A big button's long label (Finish quiz & reveal leaderboard) shrinks to fit its width.
            width: control.big ? Math.min(implicitWidth, control.availableWidth - (control.shortcutHint !== "" ? hintBox.width + parent.spacing : 0)) : implicitWidth
            height: implicitHeight; verticalAlignment: Text.AlignVCenter
            fontSizeMode: control.big ? Text.HorizontalFit : Text.FixedSize
            minimumPixelSize: 14
        }
        Rectangle {
            id: hintBox
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
