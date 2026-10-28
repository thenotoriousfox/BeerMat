// BeerMat Desk: the quizmaster's control room. A rail of workspaces (Live, Rehearsal, Quizzes, Teams, Venue &
// network, Settings), a status bar that's always in view, and the live controls. Everything shown comes from desk.view
// (desk.py); every button calls the quiz server's existing desk API through it.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

ApplicationWindow {
    id: window
    width: 1440; height: 900
    minimumWidth: 1024; minimumHeight: 640
    visible: true
    title: desk.view.event ? `BeerMat Desk — ${desk.view.event}` : "BeerMat Desk"
    color: Theme.bg

    readonly property var view: desk.view
    readonly property bool rehearsal: view.mode === "rehearsal"
    property int workspace: 0
    readonly property var workspaces: [
        {name: "Live", icon: "●", key: "Ctrl+1"}, {name: "Rehearsal", icon: "◎", key: "Ctrl+2"}, {name: "Quizzes", icon: "▤", key: "Ctrl+3"},
        {name: "Teams", icon: "♟", key: "Ctrl+4"}, {name: "Venue & network", icon: "⌁", key: "Ctrl+5"}, {name: "Settings", icon: "⚙", key: "Ctrl+6"}]

    background: Rectangle {
        gradient: Gradient {
            GradientStop { position: 0; color: Theme.bg2 }
            GradientStop { position: 1; color: Theme.bg }
        }
    }

    // ---- keys: the live ones work from every workspace, as on the web desk ----
    Shortcut { sequence: "N"; onActivated: desk.next() }
    Shortcut { sequence: "C"; onActivated: desk.closeAnswers() }
    Shortcut { sequence: "R"; onActivated: desk.reveal() }
    Shortcut { sequence: "P"; onActivated: window.view.canResume ? desk.resume() : desk.pause() }
    Shortcut { sequences: [StandardKey.Open]; onActivated: openQuiz.open() }
    Shortcut { sequence: "F7"; onActivated: screens.toggle() }
    Shortcut { sequence: "F8"; onActivated: screens.setBlank(!screens.blanked) }

    TvWindow { id: tvWindow; objectName: "tv" }
    Repeater {
        model: window.workspaces.length
        delegate: Item { required property int index; Shortcut { sequence: `Ctrl+${index + 1}`; onActivated: window.workspace = index } }
    }

    function openWebDesk() {
        Qt.openUrlExternally(desk.deskUrl)
        toast.show("The web desk asks for the quizmaster key: it's in Settings → Quizmaster key.", false)
    }

    FileDialog {
        id: openQuiz
        title: "Load a quiz file"
        nameFilters: ["BeerMat quiz (*.json)", "All files (*)"]
        onAccepted: desk.loadQuiz(selectedFile)
    }
    MessageDialog {
        id: confirm
        property var onYes: null
        buttons: MessageDialog.Yes | MessageDialog.Cancel
        onButtonClicked: (button) => { if (button === MessageDialog.Yes && onYes) onYes() }
    }
    function ask(title, text, yes) { confirm.title = title; confirm.text = text; confirm.onYes = yes; confirm.open() }
    Connections {
        target: desk
        function onToast(message, error) { toast.show(message, error) }
        function onConfirmLoad(path) {
            window.ask("Load a new quiz?", "Start a fresh quiz with this file? The current quiz ends: its results are saved, and all teams and scores are cleared.",
                       () => desk.loadQuizConfirmed(path))
        }
        function onConfirmFinish(text) { window.ask("Finish the quiz?", text, () => desk.finishConfirmed()) }
        function onQuitRequested() { Qt.quit() }
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ---- workspace rail ----
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: 92
            color: Qt.rgba(0, 0, 0, 0.22)
            ColumnLayout {
                anchors.fill: parent; anchors.topMargin: 14; anchors.bottomMargin: 14
                spacing: 4
                Image { source: brand + "mark.svg"; sourceSize: Qt.size(44, 44); Layout.alignment: Qt.AlignHCenter; Layout.bottomMargin: 14 }
                Repeater {
                    model: window.workspaces
                    delegate: Rectangle {
                        required property var modelData
                        required property int index
                        readonly property bool selected: window.workspace === index
                        Layout.alignment: Qt.AlignHCenter
                        width: 78; height: 64; radius: 12
                        color: selected ? Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.16) : railMouse.containsMouse ? Qt.rgba(1, 1, 1, 0.05) : "transparent"
                        border.color: selected ? Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.5) : "transparent"
                        Accessible.role: Accessible.PageTab; Accessible.name: modelData.name
                        Column {
                            anchors.centerIn: parent; spacing: 4
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.icon; color: selected ? Theme.gold : Theme.muted; font.pixelSize: 20
                                   // The Live icon goes red while a question is open, wherever the quizmaster is.
                                   Component.onCompleted: if (index === 0) color = Qt.binding(() => window.view.phase === "Live" ? Theme.bad : selected ? Theme.gold : Theme.muted) }
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.name; color: selected ? Theme.text : Theme.muted; font.pixelSize: 11
                                   font.weight: selected ? Font.Bold : Font.Normal; width: 74; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap }
                        }
                        MouseArea { id: railMouse; anchors.fill: parent; hoverEnabled: true; onClicked: window.workspace = index }
                        ToolTip.visible: railMouse.containsMouse; ToolTip.delay: 600; ToolTip.text: `${modelData.name} (${modelData.key})`
                    }
                }
                Item { Layout.fillHeight: true }
                Rectangle {
                    Layout.alignment: Qt.AlignHCenter
                    width: 12; height: 12; radius: 6; color: desk.connected ? Theme.good : Theme.bad
                    ToolTip.visible: serverMouse.containsMouse; ToolTip.text: desk.status
                    MouseArea { id: serverMouse; anchors.fill: parent; anchors.margins: -8; hoverEnabled: true }
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.margins: 16
            spacing: Theme.gap

            // ---- status bar ----
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 64
                radius: Theme.radius
                color: Theme.panel
                border.color: window.rehearsal ? Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.55) : Theme.line
                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 16; anchors.rightMargin: 14
                    spacing: 14
                    ColumnLayout {
                        spacing: 2
                        Layout.fillWidth: true
                        Text { text: view.event || "BeerMat"; color: Theme.text; font.family: Theme.display; font.pixelSize: 20; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                        Text { text: `${view.title || "No quiz loaded"}${view.progress ? "  ·  " + view.progress : ""}`; color: Theme.muted; font.pixelSize: 13; elide: Text.ElideRight; Layout.fillWidth: true }
                    }
                    Pill { visible: window.rehearsal; text: "REHEARSAL"; tone: Theme.teal; strong: true }
                    Pill {
                        text: view.phase === "Live" ? "ANSWERS OPEN" : (view.phase || "Starting").toUpperCase()
                        tone: view.phase === "Live" ? Theme.good : view.phase === "Paused" ? Theme.gold : view.phase === "Finished" ? Theme.violet : view.phase === "Preparing" ? Theme.muted : Theme.teal
                        strong: view.phase === "Live"
                    }
                    Pill { text: `${(view.teams || []).length} ${window.rehearsal ? "simulated" : "teams"}`; tone: Theme.text }
                    Pill { visible: window.rehearsal; text: `${(view.devices || []).length} test phones`; tone: Theme.teal }
                    Pill { text: desk.connected ? "● Server live" : "○ " + desk.status; tone: desk.connected ? Theme.good : Theme.bad }
                    DeskButton { text: "Load quiz…"; shortcutHint: "Ctrl+O"; onClicked: openQuiz.open() }
                }
            }

            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                currentIndex: window.workspace
                LiveWorkspace { view: window.view }
                RehearsalWorkspace {
                    view: window.view
                    onConfirmGoLive: window.ask("Go live?", "Real teams will be able to join and play. The rehearsal ends and nothing from it is kept.", () => desk.goLive())
                    onConfirmEndLive: window.ask("End the live quiz and rehearse?", "The live quiz's results are saved first, then all teams and scores are cleared for the rehearsal.",
                                                 () => desk.startRehearsalWith(Object.assign(chosen(), {endLive: true})))
                }
                PendingWorkspace { heading: "Quizzes"; summary: "Browse, create, duplicate, import, export and edit quizzes: every format, scoring rule, media type and round."; onOpenWebDesk: window.openWebDesk() }
                PendingWorkspace { heading: "Teams & marking"; summary: "Recovery codes, renaming, moving phones, returning teams, blocked names, marking and score corrections."; onOpenWebDesk: window.openWebDesk() }
                PendingWorkspace { heading: "Venue & network"; summary: "The quiz Wi-Fi, venue LAN and online link, joining codes, diagnostics, BeerMat Online and this laptop's registration."; onOpenWebDesk: window.openWebDesk() }
                SettingsWorkspace { view: window.view; onOpenWebDesk: window.openWebDesk() }
            }
        }
    }

    // ---- toast ----
    Rectangle {
        id: toast
        property bool error: false
        function show(message, isError) { label.text = message; error = isError; opacity = 1; hide.restart() }
        anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 24; anchors.bottomMargin: 120
        width: Math.min(460, label.implicitWidth + 36); height: label.implicitHeight + 24
        radius: 12
        color: error ? "#3a1020" : Theme.panelRaised
        border.color: error ? Theme.bad : Theme.lineStrong
        opacity: 0
        Behavior on opacity { NumberAnimation { duration: 180 } }
        Text { id: label; anchors.centerIn: parent; width: Math.min(424, implicitWidth); wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 14 }
        Timer { id: hide; interval: 3500; onTriggered: toast.opacity = 0 }
    }
}
