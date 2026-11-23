// A multi-line text box in the desk's dark style.
import QtQuick
import QtQuick.Controls.Basic

TextArea {
    color: Theme.text
    placeholderTextColor: Theme.faint
    selectionColor: Theme.violet
    selectedTextColor: Theme.text
    wrapMode: TextEdit.Wrap
    padding: 10
    background: Rectangle {
        radius: 10
        color: Qt.rgba(0, 0, 0, 0.25)
        border.color: parent.activeFocus ? Theme.gold : Theme.lineStrong
    }
}
