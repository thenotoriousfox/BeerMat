// A titled panel of the dashboard.
import QtQuick
import QtQuick.Layouts

Rectangle {
    id: panel
    property string title: ""
    property alias headerExtra: extra.data
    default property alias content: body.data
    color: Theme.panel
    radius: Theme.radius
    border.color: Theme.line
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10
        RowLayout {
            visible: panel.title !== ""
            Layout.fillWidth: true
            Text { text: panel.title; color: Theme.text; font.family: Theme.display; font.pixelSize: 15; font.weight: Font.DemiBold; Layout.fillWidth: true }
            Item { id: extra; implicitWidth: childrenRect.width; implicitHeight: childrenRect.height }
        }
        Item { id: body; Layout.fillWidth: true; Layout.fillHeight: true }
    }
}
