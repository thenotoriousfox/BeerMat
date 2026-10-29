// Live Control: the question on now, the teams, what's next, and the big live controls. Everything comes from
// desk.view; every button calls the quiz server's desk API through desk.py.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: live
    required property var view
    readonly property var q: view.question || null
    // The current question's answers (choice questions show their counts on the tiles instead), as Teams & marking
    // has them; not while it is marking a past question.
    readonly property var feed: q && !(view.marking && view.marking.past) && !(q.options && q.options.length) ? (view.answerRows || []) : []
    property real now: Date.now()
    readonly property real remainingMs: q && q.deadline ? Math.max(0, q.deadline - now) : (q ? q.remaining : 0)
    Timer { interval: 200; running: live.visible; repeat: true; onTriggered: live.now = Date.now() }
    signal shareQuiz()
    spacing: Theme.gap

    // ---- the quiz is over: share it ----
    Rectangle {
        objectName: "shareFinished"
        visible: view.phase === "Finished" && (view.questions || 0) > 0
        Layout.fillWidth: true; implicitHeight: 64; radius: Theme.radius
        color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.12); border.color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.5)
        RowLayout {
            anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 12; spacing: 12
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 15
                   text: `That’s “${view.title}” done. Share it in the quiz library and other BeerMat pubs can run it too.` }
            DeskButton { objectName: "shareFinishedButton"; text: "Share in the quiz library…"; kind: "primary"; implicitHeight: 38; onClicked: live.shareQuiz() }
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

                RoundControls { view: live.view; Layout.fillWidth: true }

                // The answers as they come in: each team's answer, and its points once marked.
                Text {
                    visible: live.feed.length > 0
                    text: `ANSWERS SO FAR · ${live.feed.length}`; color: Theme.teal; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2
                }
                Flickable {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    clip: true; contentHeight: feedFlow.implicitHeight; boundsBehavior: Flickable.StopAtBounds
                    ScrollBar.vertical: ScrollBar {}
                    Flow {
                        id: feedFlow
                        width: parent.width; spacing: 8
                        Repeater {
                            model: live.feed
                            delegate: Rectangle {
                                required property var modelData
                                readonly property bool marked: !view.canClose
                                width: Math.min(feedFlow.width, Math.max(220, feedText.implicitWidth + 32)); height: 58; radius: 12
                                color: marked && modelData.points > 0 ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.16) : Theme.panelRaised
                                border.color: marked && modelData.points > 0 ? Theme.good : Theme.line
                                Column {
                                    id: feedText
                                    anchors.verticalCenter: parent.verticalCenter; x: 16; width: parent.width - 32
                                    Text { text: modelData.team + (parent.parent.marked ? `  ·  ${modelData.points} pts` : ""); color: Theme.muted; font.pixelSize: 12; font.weight: Font.Bold; elide: Text.ElideRight; width: parent.width }
                                    Text { text: modelData.value || "—"; color: Theme.text; font.pixelSize: 17; font.weight: Font.DemiBold; elide: Text.ElideRight; width: Math.min(implicitWidth, 600) }
                                }
                            }
                        }
                    }
                }
                Item { Layout.fillHeight: true; visible: live.feed.length === 0 }

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

            // What the room sees, drawn by the same stage as the TV window.
            Panel {
                title: "On the TV"
                Layout.fillWidth: true
                Layout.preferredHeight: 300
                headerExtra: Text { text: !screens.open ? "closed" : screens.blanked ? "blanked" : screens.fullScreen ? "on the TV screen" : "in a window"
                                    color: screens.open && !screens.blanked ? Theme.good : Theme.muted; font.pixelSize: 12; font.weight: Font.Bold }
                ColumnLayout {
                    anchors.fill: parent; spacing: 8
                    Rectangle {
                        Layout.fillWidth: true; Layout.fillHeight: true; radius: 8; color: "black"; clip: true
                        border.color: screens.open && !screens.blanked ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.6) : Theme.line
                        TvStage { anchors.fill: parent; anchors.margins: 2; tv: desk.tv; serverUrl: desk.serverUrl; blanked: screens.blanked }
                    }
                    RowLayout {
                        spacing: 6
                        DeskButton { text: screens.open ? "Close TV" : "Show TV"; shortcutHint: "F7"; implicitHeight: 34; onClicked: screens.toggle() }
                        DeskButton { text: screens.blanked ? "Unblank" : "Blank"; shortcutHint: "F8"; implicitHeight: 34; enabled: screens.open; onClicked: screens.setBlank(!screens.blanked) }
                    }
                }
            }

            Panel {
                title: "Teams in the room"
                Layout.fillWidth: true
                Layout.fillHeight: true
                headerExtra: Text { text: `${(view.teams || []).length}`; color: Theme.muted; font.pixelSize: 13 }
                ListView {
                    anchors.fill: parent
                    clip: true
                    spacing: 6
                    ScrollBar.vertical: ScrollBar {}
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
                           // In a rehearsal real phones are only testing their connection; simulated teams do the playing.
                           text: view.mode === "rehearsal"
                                 ? ((view.devices || []).length ? `${view.devices.length} test ${view.devices.length === 1 ? "phone is" : "phones are"} connected (they test the connection, not play). ` : "")
                                   + "Start the rehearsal (Rehearsal) to add simulated teams."
                                 : "No teams yet: they scan the code on the TV."
                           color: Theme.muted; font.pixelSize: 13 }
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
                    ScrollBar.vertical: ScrollBar {}
                    spacing: 2
                    model: view.upcoming || []
                    delegate: Column {
                        required property var modelData
                        width: ListView.view.width
                        Text { visible: modelData.first; text: modelData.round; color: Theme.gold; font.pixelSize: 11; font.weight: Font.Bold; topPadding: 8; bottomPadding: 4; width: parent.width; elide: Text.ElideRight }
                        Text {
                            width: parent.width
                            text: `${modelData.current ? "▶ " : modelData.played ? "✓ " : "· "}${modelData.text}`
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
                text: "◀ Back"; shortcutHint: "Backspace"
                enabled: !!view.back && !desk.busy
                onClicked: desk.back()
                ToolTip.visible: hovered; ToolTip.text: view.back ? view.back.label : "Nothing to go back to"
            }
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
            DeskButton { text: "Tools"; onClicked: toolsPopup.open() }
            DeskButton { visible: !!live.view.timer && live.view.timer.endsAt !== undefined; text: live.view.timer && live.view.timer.endsAt === null ? "Resume countdown" : "Pause countdown"; shortcutHint: "T"; onClicked: desk.live.toggleTimer() }
            Item { Layout.fillWidth: true }
            Text { text: desk.status; color: Theme.faint; font.pixelSize: 12; horizontalAlignment: Text.AlignRight; elide: Text.ElideLeft; Layout.maximumWidth: 360 }
        }
    }

    ToolsPopup { id: toolsPopup; view: live.view; parent: Overlay.overlay }
    Shortcut { sequence: "T"; enabled: live.visible; onActivated: desk.live.toggleTimer() }
}
