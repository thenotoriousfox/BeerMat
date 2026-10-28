// BeerMat's colours and type for the native desk (the same tokens as web/style.css), tuned for a dark control room.
pragma Singleton
import QtQuick

QtObject {
    readonly property color bg: "#0d0720"
    readonly property color bg2: "#140b2e"
    readonly property color panel: "#1b1138"
    readonly property color panelRaised: "#241650"
    readonly property color line: Qt.rgba(1, 0.953, 0.839, 0.11)
    readonly property color lineStrong: Qt.rgba(1, 0.953, 0.839, 0.24)
    readonly property color text: "#fff8ec"
    readonly property color muted: "#c8b9e4"
    readonly property color faint: "#8d82a8"
    readonly property color gold: "#ffb21a"
    readonly property color goldHi: "#ffd25e"
    readonly property color gold2: "#ff8a1f"
    readonly property color pink: "#ff3d81"
    readonly property color teal: "#1fd6c6"
    readonly property color violet: "#7a2cf0"
    readonly property color good: "#34d399"
    readonly property color bad: "#ff5470"
    readonly property color onAccent: "#140b2e"
    readonly property string display: "Fredoka"
    // The interface font: the system's own sans serif.
    readonly property string ui: Qt.application.font.family
    readonly property int radius: 14
    readonly property int gap: 12
}
