// Venue & network: how phones reach the quiz (Network), and the venue on BeerMat Online.
import QtQuick
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: venue
    property int tab: 0
    spacing: Theme.gap
    RowLayout {
        spacing: 6
        Repeater {
            model: ["Network", "BeerMat Online"]
            delegate: DeskButton { required property int index; required property string modelData
                                   text: modelData; kind: venue.tab === index ? "primary" : "quiet"; implicitHeight: 36; onClicked: venue.tab = index }
        }
    }
    StackLayout {
        Layout.fillWidth: true; Layout.fillHeight: true
        currentIndex: venue.tab
        NetworkView { visible: venue.visible && venue.tab === 0 }
        OnlineView { visible: venue.visible && venue.tab === 1 }
    }
}
