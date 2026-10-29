// Library: what BeerMat and its venues share through BeerMat Online, in one place: quizzes (QuizLibrary), buzzer
// sounds (BuzzerLibrary) and themes for the TV and phones (ThemeLibrary). Everyone can look; downloading, adding,
// installing and sharing is BeerMat Pro.
import QtQuick
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: library
    property int tab: 0
    property alias quizTab: quizLibrary.tab      // Quizzes: 0 browse, 1 share yours
    spacing: Theme.gap
    // Fresh each time it's opened: other venues share all the time.
    onVisibleChanged: if (visible) { desk.prefs.searchQuizzes(""); desk.prefs.searchLibrary(""); desk.prefs.searchThemes("") }
    RowLayout {
        spacing: 6
        Repeater {
            model: ["Quizzes", "Buzzers", "Themes"]
            delegate: DeskButton { required property int index; required property string modelData
                                   text: modelData; kind: library.tab === index ? "primary" : "quiet"; implicitHeight: 36; onClicked: library.tab = index }
        }
    }
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: ["Quiz library", "Shared buzzer library", "Theme library"][library.tab]
        StackLayout {
            anchors.fill: parent
            currentIndex: library.tab
            QuizLibrary { id: quizLibrary }
            BuzzerLibrary {}
            ThemeLibrary {}
        }
    }
}
