// A one-line text field in the desk's dark style.
import QtQuick
import QtQuick.Controls.Basic

TextField {
    color: Theme.text
    placeholderTextColor: Theme.faint
    selectionColor: Theme.violet
    selectedTextColor: Theme.text
    leftPadding: 12; rightPadding: 12
    implicitHeight: 38
    background: Rectangle {
        radius: 10
        color: Qt.rgba(0, 0, 0, 0.25)
        border.color: parent.activeFocus ? Theme.gold : Theme.lineStrong
    }
}
