// BeerMat Desk: the quizmaster's control room. A rail of workspaces (Live, Rehearsal, Quizzes, Teams, Venue &
// network, Library, Settings), a status bar that's always in view, and the live controls. Everything shown comes from desk.view
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
    // The Basic style draws drop-downs, number boxes, checkboxes and sliders from the palette: the desk's own colours,
    // so none of them is a light system widget on the dark desk. Popups and dialogs inherit it.
    palette {
        window: Theme.panel; windowText: Theme.text; base: Theme.bg2; alternateBase: Theme.panelRaised
        text: Theme.text; placeholderText: Theme.faint; button: Theme.panelRaised; buttonText: Theme.text; brightText: Theme.text
        highlight: Theme.gold; highlightedText: Theme.onAccent; toolTipBase: Theme.panelRaised; toolTipText: Theme.text
        light: Theme.panelRaised; midlight: "#3a2a6e"; mid: "#4a3a80"; dark: Theme.gold; shadow: "#000000"
        link: Theme.goldHi; linkVisited: Theme.gold
        disabled.text: Theme.faint; disabled.buttonText: Theme.faint; disabled.windowText: Theme.faint; disabled.button: Theme.panel
    }
    title: desk.view.event ? `BeerMat Desk — ${desk.view.event}` : "BeerMat Desk"
    color: Theme.bg

    readonly property var view: desk.view
    readonly property bool rehearsal: view.mode === "rehearsal"
    property int workspace: 0
    readonly property var workspaces: [
        {name: "Live", icon: "●", key: "Ctrl+1"}, {name: "Rehearsal", icon: "◎", key: "Ctrl+2"}, {name: "Quizzes", icon: "▤", key: "Ctrl+3"},
        {name: "Teams & marking", icon: "♟", key: "Ctrl+4"}, {name: "Venue & network", icon: "⌁", key: "Ctrl+5"}, {name: "Library", icon: "♫", key: "Ctrl+6"},
        {name: "Settings", icon: "⚙", key: "Ctrl+7"}]

    background: Rectangle {
        color: Theme.bg
        SmoothGradient { anchors.fill: parent; stops: [[0, Theme.bg2], [1, Theme.bg]] }
    }

    // ---- keys: the live ones work from every workspace, as on the web desk ----
    Shortcut { sequence: "N"; onActivated: desk.next() }
    Shortcut { sequence: "Backspace"; onActivated: desk.back() }
    Shortcut { sequence: "C"; onActivated: desk.closeAnswers() }
    Shortcut { sequence: "S"; onActivated: desk.send() }
    Shortcut { sequence: "R"; onActivated: desk.reveal() }
    Shortcut { sequence: "P"; onActivated: window.view.canResume ? desk.resume() : desk.pause() }
    Shortcut { sequences: [StandardKey.Open]; onActivated: openQuiz.open() }
    Shortcut { sequence: "F7"; onActivated: screens.toggle() }
    Shortcut { sequence: "F8"; onActivated: screens.setBlank(!screens.blanked) }

    TvWindow { id: tvWindow; objectName: "tv" }
    // Closing the desk closes BeerMat, the TV and the quiz server with it. Qt.exit, not Qt.quit: in Qt 6 a quit first
    // asks every window to close, and the TV window refuses (its ✕ only hides it), which cancelled the whole quit and
    // left BeerMat running unseen.
    onClosing: Qt.exit(0)

    // First run: how players join (as the Electron app's welcome); the TV screen is automatic.
    Dialog {
        id: welcome
        objectName: "welcome"
        anchors.centerIn: parent; modal: true; width: 640
        title: "Welcome to BeerMat"
        visible: desk.firstRun && desk.connected
        closePolicy: Popup.NoAutoClose
        background: Rectangle { radius: Theme.radius; color: Theme.panel; border.color: Theme.gold }
        header: Text { text: "How will players join your quizzes?"; color: Theme.text; font.family: Theme.display; font.pixelSize: 24; font.weight: Font.Bold; padding: 20 }
        ColumnLayout {
            width: parent.width; spacing: 10
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                   text: "Venue Wi-Fi: phones on the venue's own Wi-Fi open this laptop's address.\nBeerMat Wi-Fi: this laptop makes its own quiz Wi-Fi, no internet needed.\n\nYou can change this any time under Venue & network. The TV shows the joining code either way."
                         + (Qt.platform.os === "windows" ? "\n\nWindows Firewall: if Windows asked whether to allow BeerMat on networks, choose Allow (with Private networks ticked), or phones can't connect." : "") }
            RowLayout {
                spacing: 8
                DeskButton { text: "Venue Wi-Fi or network"; kind: "primary"; onClicked: { desk.welcomed("lan"); welcome.close() } }
                DeskButton { text: "BeerMat Wi-Fi from this laptop"; onClicked: { desk.welcomed("hotspot"); welcome.close() } }
                DeskButton { text: "Decide later"; onClicked: { desk.welcomed(""); welcome.close() } }
            }
            // The computer wired to the TVs, while the quiz runs on the quizmaster's laptop (tvscreen.py).
            Text { Layout.fillWidth: true; Layout.topMargin: 6; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                   text: "Is this the computer wired to the TVs, with the quiz run from another laptop? Make it the TV screen: it finds that laptop's quiz, shows the TV full screen and plays all the sound." }
            DeskButton { objectName: "welcomeTvScreen"; text: "This computer is the TV screen"; onClicked: { desk.welcomed(""); welcome.close(); desk.becomeTvScreen() } }
        }
    }
    // Another laptop on this BeerMat Online account is running a quiz (link.py): what is this device for?
    Dialog {
        id: otherDesk
        objectName: "otherDesk"
        anchors.centerIn: parent; modal: true; width: Math.min(620, window.width - 40)
        visible: !!desk.link.other.name && desk.connected && !welcome.visible
        closePolicy: Popup.NoAutoClose
        background: Rectangle { radius: Theme.radius; color: Theme.panel; border.color: Theme.gold }
        header: Text { text: "BeerMat is open on another device"; color: Theme.text; font.family: Theme.display; font.pixelSize: 24; font.weight: Font.Bold; padding: 20 }
        ColumnLayout {
            width: parent.width; spacing: 10
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                   text: `${desk.link.other.title || "A quiz"} is running on ${desk.link.other.name || "another laptop"}, signed in to the same BeerMat account.` }
            DeskButton { objectName: "useAsDesk"; Layout.fillWidth: true; kind: "primary"; enabled: !desk.link.busy; text: "Use this device as the desk"; onClicked: desk.link.useAsDesk() }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 12
                   text: "Run that quiz from here. Its phones, TV and sound stay on that laptop, which shows that the desk is here." }
            DeskButton { objectName: "useAsTv"; Layout.fillWidth: true; enabled: !desk.link.busy; text: "Use this device as the TV"; onClicked: desk.link.useAsTv() }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 12
                   text: "Show that quiz's TV full screen here, with its sound. BeerMat opens again as a TV screen." }
            DeskButton { objectName: "ignoreOther"; Layout.fillWidth: true; enabled: !desk.link.busy; text: "Ignore"; onClicked: desk.link.ignore() }
        }
    }
    // The TV's sounds play while the TV is showing, as Electron's TV window does.
    Binding { target: desk.sound; property: "on"; value: screens.open && !screens.blanked }
    // "Automatic" sends the TV's sound down its own cable while it is full screen on its screen, as the Electron app.
    Binding { target: desk.sound; property: "tvOnScreen"; value: screens.open && screens.fullScreen }
    Repeater {
        model: window.workspaces.length
        delegate: Item { required property int index; Shortcut { sequence: `Ctrl+${index + 1}`; onActivated: window.workspace = index } }
    }

    // Desk and TV change screens (when the TV is plugged into the screen the desk opened on, say).
    function swapScreens() {
        const moveTo = screens.swap(window.screen.name)
        const target = Qt.application.screens.find(s => s.name === moveTo)
        if (!target) return toast.show("Swapping needs two screens and the TV on one of them.", true)
        window.screen = target
        window.x = target.virtualX + 40; window.y = target.virtualY + 40
        toast.show("Desk and TV swapped screens", false)
    }

    // Library → Quizzes, on Browse (0) or Share yours (1).
    function openQuizLibrary(tab) {
        libraryWorkspace.tab = 0; libraryWorkspace.quizTab = tab
        window.workspace = window.workspaces.findIndex(w => w.name === "Library")
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
    MessageDialog { id: transferNote; title: "Move a team to another phone"; buttons: MessageDialog.Ok }
    function ask(title, text, yes) { confirm.title = title; confirm.text = text; confirm.onYes = yes; confirm.open() }
    Connections {
        target: desk
        function onToast(message, error) { toast.show(message, error) }
        function onConfirmLoad(path) {
            window.ask("Load a new quiz?", "Start a fresh quiz with this file? The current quiz ends: its results are saved, and all teams and scores are cleared."
                       + (desk.quizzes.dirty ? " Unsaved changes on the Quizzes page are discarded." : ""),
                       () => desk.loadQuizConfirmed(path))
        }
        function onConfirmFinish(text) { window.ask("Finish the quiz?", text, () => desk.finishConfirmed()) }
        function onConfirmBack(text) { window.ask("Take this question back?", text, () => desk.backConfirmed()) }
        function onQuitRequested() { Qt.exit(0) }
        function onTransferCode(code) {
            transferNote.text = `On the team's new phone: open the quiz, then under “Get it back” (or “Already playing?” in the app) type ${code}. The code works for 5 minutes.`
            transferNote.open()
        }
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
                    // A new version: to Settings, where it's installed (never mid-question).
                    Pill { visible: !!desk.updates.latest; text: "Update: " + desk.updates.latest; tone: Theme.gold
                           TapHandler { onTapped: window.workspace = window.workspaces.findIndex(w => w.name === "Settings") }
                           HoverHandler { cursorShape: Qt.PointingHandCursor } }
                    // Running another laptop's quiz from here (link.py).
                    Pill { objectName: "remotePill"; visible: !!desk.link.remote.name; text: (desk.link.lost ? "Finding " : "On ") + (desk.link.remote.name || "") + (desk.link.lost ? " again…" : ""); tone: desk.link.lost ? Theme.bad : Theme.gold; strong: true }
                    DeskButton { visible: !!desk.link.remote.name; text: "Back to this laptop's quiz"; onClicked: desk.link.leave() }
                    DeskButton { text: "Load quiz…"; shortcutHint: "Ctrl+O"; onClicked: openQuiz.open() }
                }
            }

            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                currentIndex: window.workspace
                LiveWorkspace { view: window.view; onShareQuiz: window.openQuizLibrary(1) }
                RehearsalWorkspace {
                    view: window.view
                    onConfirmGoLive: window.ask("Go live?", "Real teams will be able to join and play. The rehearsal ends and nothing from it is kept.", () => desk.goLive())
                    onConfirmEndLive: window.ask("End the live quiz and rehearse?", "The live quiz's results are saved first, then all teams and scores are cleared for the rehearsal.",
                                                 () => desk.startRehearsalWith(Object.assign(chosen(), {endLive: true})))
                }
                QuizzesWorkspace { objectName: "quizzes"; onOpenQuiz: openQuiz.open(); onOpenWebDesk: window.openWebDesk()
                                   onShareQuiz: window.openQuizLibrary(1); onBrowseLibrary: window.openQuizLibrary(0) }
                TeamsWorkspace { view: window.view }
                VenueWorkspace { objectName: "venue" }
                LibraryWorkspace { id: libraryWorkspace; objectName: "library" }
                SettingsWorkspace { view: window.view; onOpenWebDesk: window.openWebDesk(); onSwapScreens: window.swapScreens()
                                    onOpenLibrary: (tab) => { libraryWorkspace.tab = tab; window.workspace = window.workspaces.findIndex(w => w.name === "Library") } }
            }
        }
    }

    // ---- this laptop's desk is on another device: the quiz, its phones, TV and sound stay here ----
    Rectangle {
        objectName: "deskAway"
        anchors.fill: parent; z: 50
        visible: !!desk.link.away.name
        color: Qt.rgba(Theme.bg.r, Theme.bg.g, Theme.bg.b, 0.96)
        MouseArea { anchors.fill: parent; hoverEnabled: true }   // the desk underneath stays out of reach
        ColumnLayout {
            anchors.centerIn: parent; width: Math.min(560, parent.width - 48); spacing: 14
            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; color: Theme.text; font.family: Theme.display; font.pixelSize: 30; font.weight: Font.Bold
                   text: `The desk is on ${desk.link.away.name || "another device"}` }
            Text { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 15
                   text: "This laptop keeps the quiz: the phones, the TV and the sound stay here. Leave BeerMat open." }
            DeskButton { objectName: "takeDeskBack"; Layout.alignment: Qt.AlignHCenter; kind: "primary"; text: "Take the desk back"; onClicked: desk.link.takeBack() }
        }
    }

    // ---- toast ----
    Rectangle {
        id: toast
        property bool error: false
        function show(message, isError) { label.text = message; error = isError; opacity = 1; hide.restart() }
        // Top right, under the status bar: clear of the live controls and the lists people are reading.
        anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 24; anchors.topMargin: 92
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
