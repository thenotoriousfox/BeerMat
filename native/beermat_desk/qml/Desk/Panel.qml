// A titled panel of the dashboard.
import QtQuick
import QtQuick.Layouts

Rectangle {
    id: panel
    property string title: ""
    property alias headerExtra: extra.data
    default property alias content: body.data
    // The height its title and content need at its current width (wrapped text and all): a panel whose content can
    // wrap sets implicitHeight: Math.max(<its usual height>, fitHeight), so a narrow window grows it instead of spilling.
    readonly property real fitHeight: 32 + (title !== "" ? header.implicitHeight + 10 : 0) + Math.max(0, ...body.children.map(c => c.implicitHeight || 0))
    color: Theme.panel
    radius: Theme.radius
    border.color: Theme.line
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10
        RowLayout {
            id: header
            visible: panel.title !== ""
            Layout.fillWidth: true
            // A long title (a question's wording) shortens rather than push the header's buttons out of the panel.
            Text { text: panel.title; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.Bold; Layout.fillWidth: true
                   Layout.minimumWidth: 80; elide: Text.ElideRight }
            Item { id: extra; implicitWidth: childrenRect.width; implicitHeight: childrenRect.height }
        }
        Item { id: body; Layout.fillWidth: true; Layout.fillHeight: true }
    }
}
