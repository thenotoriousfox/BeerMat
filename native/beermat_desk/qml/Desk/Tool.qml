// A small quiet button for rows of items (play, remove, change), in the desk's dark style.
import QtQuick
import QtQuick.Controls.Basic

Button {
    id: control
    implicitHeight: 30
    leftPadding: 10; rightPadding: 10
    hoverEnabled: true
    focusPolicy: Qt.TabFocus
    contentItem: Text { text: control.text; color: control.enabled ? Theme.text : Theme.faint; font.pixelSize: 13; font.weight: Font.DemiBold
                        horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
    background: Rectangle {
        radius: 8
        color: control.down ? Qt.rgba(1, 1, 1, 0.14) : control.hovered ? Qt.rgba(1, 1, 1, 0.09) : Qt.rgba(1, 1, 1, 0.04)
        border.color: control.visualFocus ? Theme.teal : Theme.line
    }
}
