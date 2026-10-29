// Library: what BeerMat and its venues share through BeerMat Online, in one place: buzzer sounds (BuzzerLibrary) and
// themes for the TV and phones (ThemeLibrary). Everyone can look; adding, installing and sharing is BeerMat Pro.
import QtQuick
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: library
    property int tab: 0
    spacing: Theme.gap
    // Fresh each time it's opened: other venues share all the time.
    onVisibleChanged: if (visible) { desk.prefs.searchLibrary(""); desk.prefs.searchThemes("") }
    RowLayout {
        spacing: 6
        Repeater {
            model: ["Buzzers", "Themes"]
            delegate: DeskButton { required property int index; required property string modelData
                                   text: modelData; kind: library.tab === index ? "primary" : "quiet"; implicitHeight: 36; onClicked: library.tab = index }
        }
    }
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: library.tab === 0 ? "Shared buzzer library" : "Theme library"
        StackLayout {
            anchors.fill: parent
            currentIndex: library.tab
            BuzzerLibrary {}
            ThemeLibrary {}
        }
    }
}
