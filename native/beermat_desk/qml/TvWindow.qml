// The TV/projector window: full screen on the audience screen (see screens.py), or a preview window when there's only
// one screen. On pure Wayland, where an app can't choose its screen, it asks to be dragged to the TV (F11 for full
// screen). Closing it only hides it; F7 brings it back.
import QtQuick
import QtQuick.Window
import Desk

Window {
    id: tvWindow
    title: "BeerMat TV"
    color: "black"
    width: 1280; height: 720
    minimumWidth: 480; minimumHeight: 270
    property bool manualFull: false
    readonly property bool full: screens.canPlace ? screens.fullScreen : manualFull
    readonly property var tvScreen: screens.target >= 0 ? Qt.application.screens[screens.target] : Qt.application.screens[0]
    screen: tvScreen
    // X11 puts a full-screen window on the screen it's on, so it's placed there first (setting `screen` alone doesn't
    // move it). Found on a real two-screen desk: without this the TV filled the desk's screen.
    x: tvScreen ? tvScreen.virtualX + (full ? 0 : 60) : 0
    y: tvScreen ? tvScreen.virtualY + (full ? 0 : 60) : 0
    // X11 won't move a full-screen window (leaving full screen restores its old place): when the TV's screen changes
    // (a swap, a choice, a screen plugged in) it's hidden for a moment, placed on the new screen and shown there.
    property bool placing: false
    onTvScreenChanged: if (screens.open) { placing = true; replace.restart() }
    Timer { id: replace; interval: 250; onTriggered: tvWindow.placing = false }
    visibility: !screens.open || placing ? Window.Hidden : full ? Window.FullScreen : Window.Windowed
    onClosing: (close) => { close.accepted = false; screens.setOpen(false) }

    TvStage { anchors.fill: parent; tv: desk.tv; serverUrl: desk.serverUrl; blanked: screens.blanked }

    // No pointer over the picture once it's full screen.
    MouseArea { anchors.fill: parent; cursorShape: tvWindow.full ? Qt.BlankCursor : Qt.ArrowCursor; acceptedButtons: Qt.NoButton }

    Shortcut { sequence: "F11"; onActivated: tvWindow.manualFull = !tvWindow.manualFull }
    Shortcut { sequence: "F7"; onActivated: screens.toggle() }
    Shortcut { sequence: "F8"; onActivated: screens.setBlank(!screens.blanked) }
    Shortcut { sequence: "Escape"; enabled: !screens.canPlace && tvWindow.manualFull; onActivated: tvWindow.manualFull = false }

    // Wayland: the quizmaster places the window.
    Rectangle {
        visible: !screens.canPlace && !tvWindow.manualFull
        anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom; anchors.bottomMargin: 24
        width: hint.implicitWidth + 40; height: hint.implicitHeight + 24; radius: 12
        color: Theme.panelRaised; border.color: Theme.gold
        Text { id: hint; anchors.centerIn: parent; color: Theme.text; font.pixelSize: 16
               text: "Drag this window to the TV, then press F11 for full screen." }
    }
}
