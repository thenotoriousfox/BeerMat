// BeerMat Desk: the live dashboard. Everything shown comes from desk.view (desk.py), and every button calls the quiz
// server's existing desk API through it. Keys: N next, C close answers, P pause/resume, R reveal (as the web desk).
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
    readonly property var q: view.question || null
    property real now: Date.now()
    readonly property real remainingMs: q && q.deadline ? Math.max(0, q.deadline - now) : (q ? q.remaining : 0)
    Timer { interval: 200; running: true; repeat: true; onTriggered: window.now = Date.now() }

    background: Rectangle {
        gradient: Gradient {
            GradientStop { position: 0; color: Theme.bg2 }
            GradientStop { position: 1; color: Theme.bg }
        }
    }

    // ---- keys, as the web desk ----
    Shortcut { sequence: "N"; onActivated: desk.next() }
    Shortcut { sequence: "C"; onActivated: desk.closeAnswers() }
    Shortcut { sequence: "R"; onActivated: desk.reveal() }
    Shortcut { sequence: "P"; onActivated: window.view.canResume ? desk.resume() : desk.pause() }
    Shortcut { sequences: [StandardKey.Open]; onActivated: openQuiz.open() }

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
    Connections {
        target: desk
        function onToast(message, error) { toast.show(message, error) }
        function onConfirmLoad(path) {
            confirm.title = "Load a new quiz?"
            confirm.text = "Start a fresh quiz with this file? The current quiz ends: its results are saved, and all teams and scores are cleared."
            confirm.onYes = () => desk.loadQuizConfirmed(path)
            confirm.open()
        }
        function onConfirmFinish(text) {
            confirm.title = "Finish the quiz?"
            confirm.text = text
            confirm.onYes = () => desk.finishConfirmed()
            confirm.open()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: Theme.gap

        // ---- top bar ----
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 68
            radius: Theme.radius
            color: Theme.panel
            border.color: Theme.line
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 14; anchors.rightMargin: 14
                spacing: 14
                Image { source: brand + "mark.svg"; sourceSize: Qt.size(44, 44); Layout.preferredWidth: 44; Layout.preferredHeight: 44 }
                ColumnLayout {
                    spacing: 0
                    Image { source: brand + "wordmark.svg"; sourceSize.height: 24; Layout.preferredHeight: 24; fillMode: Image.PreserveAspectFit }
                    Text { text: "Quizmaster desk"; color: Theme.muted; font.family: Theme.display; font.pixelSize: 12 }
                }
                Rectangle { width: 1; Layout.fillHeight: true; Layout.margins: 12; color: Theme.line }
                ColumnLayout {
                    spacing: 2
                    Layout.fillWidth: true
                    Text { text: view.event || "BeerMat"; color: Theme.text; font.family: Theme.display; font.pixelSize: 20; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                    Text { text: `${view.title || "No quiz loaded"}${view.progress ? "  ·  " + view.progress : ""}`; color: Theme.muted; font.pixelSize: 13; elide: Text.ElideRight; Layout.fillWidth: true }
                }
                Pill {
                    text: (view.phase || "Starting").toUpperCase()
                    tone: view.phase === "Live" ? Theme.good : view.phase === "Paused" ? Theme.gold : view.phase === "Finished" ? Theme.violet : view.phase === "Preparing" ? Theme.muted : Theme.teal
                    strong: view.phase === "Live"
                }
                Pill { text: `${(view.teams || []).length} teams`; tone: Theme.text }
                Pill { text: desk.connected ? "● Server live" : "○ " + desk.status; tone: desk.connected ? Theme.good : Theme.bad }
                DeskButton { text: "Load quiz…"; shortcutHint: "Ctrl+O"; onClicked: openQuiz.open() }
            }
        }

        // ---- main area ----
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: Theme.gap

            Panel {
                id: questionPanel
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumWidth: 480
                border.color: q && q.open ? Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.5) : Theme.line

                ColumnLayout {
                    anchors.fill: parent
                    spacing: 14

                    RowLayout {
                        Layout.fillWidth: true
                        visible: !!q
                        Text { text: q ? q.round.toUpperCase() : ""; color: Theme.gold; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2; Layout.fillWidth: true; elide: Text.ElideRight }
                        Pill { text: q ? q.type : ""; tone: Theme.teal }
                        Pill { text: q ? `${q.points} ${q.points === 1 ? "point" : "points"}` : ""; tone: Theme.muted }
                    }
                    Text {
                        Layout.fillWidth: true
                        text: q ? q.text : "Ready when you are"
                        color: Theme.text
                        font.family: Theme.display; font.pixelSize: q ? 36 : 40; font.weight: Font.Bold
                        wrapMode: Text.WordWrap
                    }
                    Text {
                        visible: !q
                        Layout.fillWidth: true
                        text: view.title && view.title !== "No quiz loaded" ? `${view.title} is loaded. Press ${view.next ? view.next.label : "Start"} (N) to open the first question.` : "Load a quiz file to begin (Ctrl+O)."
                        color: Theme.muted; font.pixelSize: 16; wrapMode: Text.WordWrap
                    }

                    // Choices, with how many teams picked each once answers are in.
                    GridLayout {
                        visible: !!q && q.options.length > 0
                        Layout.fillWidth: true
                        columns: 2; columnSpacing: 10; rowSpacing: 10
                        Repeater {
                            model: q ? q.options : []
                            delegate: Rectangle {
                                required property string modelData
                                required property int index
                                readonly property var tones: [Theme.bad, "#3b82f6", Theme.good, Theme.gold, Theme.violet, Theme.teal]
                                readonly property bool correct: !!q && q.answer === modelData
                                Layout.fillWidth: true
                                implicitHeight: 56
                                radius: 12
                                color: Qt.rgba(tones[index % 6].r, tones[index % 6].g, tones[index % 6].b, correct ? 0.42 : 0.2)
                                border.color: correct ? Theme.good : Qt.rgba(tones[index % 6].r, tones[index % 6].g, tones[index % 6].b, 0.6)
                                border.width: correct ? 2 : 1
                                RowLayout {
                                    anchors.fill: parent; anchors.margins: 14
                                    Text { text: `${String.fromCharCode(65 + index)}.  ${modelData}`; color: Theme.text; font.pixelSize: 18; font.weight: Font.Bold; Layout.fillWidth: true; elide: Text.ElideRight }
                                    Text { text: correct ? "✓" : ""; color: Theme.good; font.pixelSize: 20; font.weight: Font.Bold }
                                    Text { text: q && q.tally[modelData] ? q.tally[modelData] : ""; color: Theme.text; font.pixelSize: 16; font.weight: Font.Bold }
                                }
                            }
                        }
                    }

                    Item { Layout.fillHeight: true }

                    // The answer: on this desk only, never on the TV until it is revealed there.
                    Rectangle {
                        visible: !!q && q.answer !== ""
                        Layout.fillWidth: true
                        implicitHeight: answerColumn.implicitHeight + 28
                        radius: 12
                        color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.1)
                        border.color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.45)
                        ColumnLayout {
                            id: answerColumn
                            anchors.fill: parent; anchors.margins: 14
                            spacing: 4
                            Text { text: q && q.revealed ? "ANSWER · REVEALED ON THE TV" : "ANSWER · ONLY ON THIS DESK"; color: Theme.teal; font.pixelSize: 11; font.weight: Font.Bold; font.letterSpacing: 1.5 }
                            Text { text: q ? q.answer : ""; color: Theme.text; font.pixelSize: 22; font.weight: Font.Bold; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                            Text { visible: !!q && q.note !== ""; text: q ? q.note : ""; color: Theme.muted; font.pixelSize: 13; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                        }
                    }

                    // Time and answers.
                    RowLayout {
                        visible: !!q
                        Layout.fillWidth: true
                        spacing: 16
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 6
                            RowLayout {
                                Layout.fillWidth: true
                                Text {
                                    text: !q ? "" : q.paused ? `Paused · ${Math.ceil(remainingMs / 1000)}s left` : q.open ? `${Math.ceil(remainingMs / 1000)}s remaining` : q.revealed ? "Answer revealed" : "Answers closed"
                                    color: q && q.open ? Theme.goldHi : Theme.muted; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.DemiBold; Layout.fillWidth: true
                                }
                                Text { text: `${view.answers || 0} of ${(view.teams || []).length} answered`; color: Theme.text; font.pixelSize: 16; font.weight: Font.DemiBold }
                            }
                            Rectangle {
                                Layout.fillWidth: true; implicitHeight: 8; radius: 4; color: Qt.rgba(1, 1, 1, 0.08)
                                Rectangle {
                                    width: parent.width * (q && q.seconds ? Math.min(1, remainingMs / (q.seconds * 1000)) : 0)
                                    height: parent.height; radius: 4
                                    gradient: Gradient { orientation: Gradient.Horizontal; GradientStop { position: 0; color: Theme.gold } GradientStop { position: 1; color: Theme.pink } }
                                }
                            }
                        }
                    }
                }
            }

            // A fixed-width column: a nested layout would otherwise share the width with the question.
            ColumnLayout {
                Layout.preferredWidth: 360
                Layout.maximumWidth: 360
                Layout.fillWidth: false
                Layout.fillHeight: true
                spacing: Theme.gap

                Panel {
                    title: "Teams in the room"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    headerExtra: Text { text: `${(view.teams || []).length}`; color: Theme.muted; font.pixelSize: 13 }
                    ListView {
                        anchors.fill: parent
                        clip: true
                        spacing: 6
                        model: view.teams || []
                        delegate: Rectangle {
                            required property var modelData
                            width: ListView.view.width
                            height: 42
                            radius: 10
                            color: modelData.answered ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.13) : Theme.panelRaised
                            border.color: modelData.answered ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.5) : Theme.line
                            RowLayout {
                                anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 12
                                Rectangle { width: 8; height: 8; radius: 4; color: modelData.connected ? Theme.good : Theme.bad }
                                Text { text: modelData.name; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                                Text { text: modelData.answered ? "answered" : ""; color: Theme.good; font.pixelSize: 11; font.weight: Font.Bold }
                                Text { text: modelData.score; color: Theme.goldHi; font.family: Theme.display; font.pixelSize: 16; font.weight: Font.Bold }
                            }
                        }
                        Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                               text: "No teams yet: they scan the code on the TV."; color: Theme.muted; font.pixelSize: 13 }
                    }
                }

                Panel {
                    title: "Up next"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ListView {
                        id: upNext
                        anchors.fill: parent
                        clip: true
                        spacing: 2
                        model: view.upcoming || []
                        delegate: Column {
                            required property var modelData
                            width: ListView.view.width
                            Text { visible: modelData.first; text: modelData.round; color: Theme.gold; font.pixelSize: 11; font.weight: Font.Bold; topPadding: 8; bottomPadding: 4; width: parent.width; elide: Text.ElideRight }
                            Text {
                                width: parent.width
                                text: `${modelData.played ? "✓ " : modelData.current ? "▶ " : "· "}${modelData.text}`
                                color: modelData.current ? Theme.goldHi : modelData.played ? Theme.faint : Theme.text
                                font.pixelSize: 13; font.weight: modelData.current ? Font.Bold : Font.Normal
                                elide: Text.ElideRight
                            }
                        }
                    }
                }
            }
        }

        // ---- live control bar ----
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 92
            radius: Theme.radius
            color: Theme.panel
            border.color: Theme.lineStrong
            RowLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 10
                DeskButton {
                    id: nextButton
                    big: true; kind: "primary"
                    text: view.next ? view.next.label : "Start next question"
                    shortcutHint: "N"
                    enabled: !!view.next && view.next.enabled && !desk.busy
                    onClicked: desk.next()
                    Layout.preferredWidth: 340
                }
                DeskButton { text: "Close answers"; kind: "danger"; shortcutHint: "C"; enabled: !!view.canClose && !desk.busy; onClicked: desk.closeAnswers() }
                DeskButton { text: view.canResume ? "Resume timer" : "Pause timer"; shortcutHint: "P"; enabled: (!!view.canPause || !!view.canResume) && !desk.busy
                             onClicked: view.canResume ? desk.resume() : desk.pause() }
                DeskButton { text: "Reveal answer"; shortcutHint: "R"; enabled: !!view.canReveal && !desk.busy; onClicked: desk.reveal() }
                Item { Layout.fillWidth: true }
                Text { text: desk.status; color: Theme.faint; font.pixelSize: 12; horizontalAlignment: Text.AlignRight; elide: Text.ElideLeft; Layout.maximumWidth: 360 }
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
