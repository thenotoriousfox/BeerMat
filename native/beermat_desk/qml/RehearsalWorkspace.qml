// Rehearsal: run the quiz with simulated teams, watch real phones test their connection, and go live (Pro). The server
// decides the session mode and who may play; this only shows its state and sends the quizmaster's choices.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

RowLayout {
    id: rehearsal
    required property var view
    readonly property bool rehearsing: view.mode === "rehearsal"
    readonly property var options: view.rehearsalOptions || {}
    signal confirmGoLive()
    signal confirmEndLive()
    spacing: Theme.gap

    ColumnLayout {
        Layout.fillWidth: true
        Layout.fillHeight: true
        spacing: Theme.gap

        // ---- mode and plan ----
        Panel {
            Layout.fillWidth: true
            implicitHeight: 150
            title: rehearsing ? "Rehearsal" : "Live quiz"
            headerExtra: Pill { text: view.plan ? view.plan.name : ""; tone: view.plan && view.plan.live ? Theme.gold : Theme.muted }
            ColumnLayout {
                anchors.fill: parent
                spacing: 10
                Text {
                    Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                    text: rehearsing
                        ? (view.rehearsing ? `${(view.sims || []).length} simulated teams are playing this quiz through the real quiz server. Real phones can join to test their connection; they can't play.`
                                           : "Rehearse the whole quiz with simulated teams: every format, timer, buzzer and the leaderboard, scored by the real quiz server. Real phones can join to test their connection.")
                        : "Real teams are playing. Starting a rehearsal ends this quiz (its results are saved first)."
                }
                RowLayout {
                    spacing: 10
                    DeskButton {
                        text: view.rehearsing ? "Restart rehearsal" : "Start rehearsal"; kind: "primary"; enabled: !desk.busy
                        onClicked: rehearsing ? desk.startRehearsalWith(chosen()) : rehearsal.confirmEndLive()
                    }
                    DeskButton { text: "Stop rehearsal"; visible: !!view.rehearsing; enabled: !desk.busy; onClicked: desk.stopRehearsal() }
                    DeskButton {
                        text: "Go live"; kind: "danger"; visible: rehearsing; enabled: !desk.busy && !!view.canGoLive
                        onClicked: rehearsal.confirmGoLive()
                        ToolTip.visible: hovered && !view.canGoLive; ToolTip.text: "Hosting a live quiz with real teams is part of BeerMat Pro (Settings → Plan)."
                    }
                    Text { visible: rehearsing && !view.canGoLive; text: "Going live needs BeerMat Pro."; color: Theme.faint; font.pixelSize: 12 }
                }
            }
        }

        // ---- options ----
        Panel {
            Layout.fillWidth: true
            implicitHeight: 210
            title: "Rehearsal options"
            GridLayout {
                anchors.fill: parent
                columns: 4; columnSpacing: 18; rowSpacing: 8
                Label { text: "Simulated teams"; color: Theme.muted }
                SpinBox { id: teamCount; from: 0; to: 30; value: options.teams !== undefined ? options.teams : 6; editable: true }
                Label { text: "Right answers"; color: Theme.muted }
                RowLayout {
                    Slider { id: accuracy; from: 0; to: 1; stepSize: 0.05; value: options.accuracy !== undefined ? options.accuracy : 0.6; Layout.preferredWidth: 160 }
                    Text { text: `${Math.round(accuracy.value * 100)}%`; color: Theme.text; font.pixelSize: 13 }
                }
                CheckBox { id: auto; text: "Teams play by themselves"; checked: options.auto !== false; palette.windowText: Theme.text }
                CheckBox { id: fast; text: "Fast timers (a third of the time)"; checked: options.speed === "fast"; palette.windowText: Theme.text }
                CheckBox { id: buzzers; text: "Teams buzz in"; checked: options.buzzers !== false; palette.windowText: Theme.text }
                CheckBox { id: drops; text: "Simulate dropped connections"; checked: options.disconnects === true; palette.windowText: Theme.text }
                Text {
                    Layout.columnSpan: 4; Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 12
                    text: "Options take effect when the rehearsal (re)starts. Nothing from a rehearsal is kept: no results, history or sharing."
                }
            }
        }

        // ---- simulated teams ----
        Panel {
            Layout.fillWidth: true
            Layout.fillHeight: true
            title: "Simulated teams"
            headerExtra: Text { text: `${(view.sims || []).length}`; color: Theme.muted; font.pixelSize: 13 }
            ListView {
                anchors.fill: parent
                clip: true; spacing: 6
                model: view.sims || []
                delegate: Rectangle {
                    id: simRow
                    required property var modelData
                    width: ListView.view.width; height: 46; radius: 10
                    color: Theme.panelRaised; border.color: Theme.line
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 8; spacing: 6
                        Rectangle { width: 8; height: 8; radius: 4; color: modelData.connected ? Theme.good : Theme.bad }
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                        CheckBox { text: "Manual"; checked: modelData.manual; palette.windowText: Theme.muted; onToggled: desk.simManual(modelData.name, checked) }
                        Repeater {
                            model: [["right", "✓ Right"], ["wrong", "✗ Wrong"], ["buzz", "Buzz"], ["agree", "Agree"], ["duplicate", "Twice"], ["invalid", "Invalid"], ["stale", "Late"],
                                    [modelData.connected ? "disconnect" : "reconnect", modelData.connected ? "Drop" : "Reconnect"]]
                            delegate: DeskButton {
                                required property var modelData
                                text: modelData[1]; implicitHeight: 32; leftPadding: 10; rightPadding: 10
                                onClicked: desk.simAct(simRow.modelData.name, modelData[0])
                            }
                        }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                       text: "No simulated teams. Start a rehearsal to add them."; color: Theme.muted; font.pixelSize: 13 }
            }
        }
    }

    ColumnLayout {
        Layout.preferredWidth: 380; Layout.maximumWidth: 380
        Layout.fillHeight: true
        spacing: Theme.gap

        // ---- real phones, kept apart from the simulated teams ----
        Panel {
            Layout.fillWidth: true
            Layout.preferredHeight: 280
            title: "Test phones"
            headerExtra: Text { text: `${(view.devices || []).length}`; color: Theme.muted; font.pixelSize: 13 }
            ListView {
                anchors.fill: parent
                clip: true; spacing: 6
                model: view.devices || []
                delegate: Rectangle {
                    required property var modelData
                    width: ListView.view.width; height: 40; radius: 10
                    color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.1); border.color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.4)
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 12
                        Text { text: "📱"; font.pixelSize: 14 }
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 14; elide: Text.ElideRight; Layout.fillWidth: true }
                        Text { text: modelData.connected ? "connected" : "gone"; color: modelData.connected ? Theme.good : Theme.faint; font.pixelSize: 12; font.weight: Font.Bold }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                       text: "Phones that scan the TV's code during a rehearsal show up here. They see a connected screen; playing is off."; color: Theme.muted; font.pixelSize: 13 }
            }
        }

        // ---- what happened ----
        Panel {
            Layout.fillWidth: true
            Layout.fillHeight: true
            title: "What happened"
            ListView {
                anchors.fill: parent
                clip: true; spacing: 2
                model: view.rehearsalLog || []
                delegate: Text {
                    required property var modelData
                    width: ListView.view.width
                    text: `${new Date(modelData.at).toLocaleTimeString(Qt.locale(), "HH:mm:ss")}  ${modelData.ok ? "✓" : "✗"} ${modelData.team}: ${modelData.action}${modelData.detail ? " — " + modelData.detail : ""}`
                    color: modelData.ok ? Theme.text : Theme.bad; font.pixelSize: 12; font.family: "monospace"; elide: Text.ElideRight
                }
            }
        }
    }

    function chosen() {
        return {teams: teamCount.value, accuracy: accuracy.value, auto: auto.checked, speed: fast.checked ? "fast" : "normal", buzzers: buzzers.checked, disconnects: drops.checked}
    }
}
