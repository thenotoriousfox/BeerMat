// Tools for the night, as the web desk's: what the TV shows, the wheel, a countdown on the TV, the tie-breaker, and the
// room's switches. Opens from the live control bar (or T); every change goes to the quiz server.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

Popup {
    id: tools
    required property var view
    readonly property var settings: view.settings || {}
    readonly property var timer: view.timer || {}
    readonly property var tie: view.tie || {}
    modal: true; focus: true
    width: Math.min(parent.width - 80, 980); height: Math.min(parent.height - 80, 640)
    x: (parent.width - width) / 2; y: (parent.height - height) / 2
    padding: 20
    background: Rectangle { radius: Theme.radius; color: Theme.panel; border.color: Theme.lineStrong }

    property real now: Date.now()
    Timer { interval: 250; running: tools.visible; repeat: true; onTriggered: tools.now = Date.now() + (desk.tv.offset || 0) }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        GridLayout {
            width: parent.width; columns: 2; columnSpacing: 24; rowSpacing: 18

            // ---- TV ----
            ColumnLayout {
                Layout.fillWidth: true; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { text: "The TV shows"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                ComboBox {
                    Layout.fillWidth: true
                    textRole: "text"; valueRole: "value"
                    model: [{value: "auto", text: "Auto — join, questions, and the leaderboard when you show it"}, {value: "join", text: "How to join (QR codes)"},
                            {value: "leaderboard", text: "Leaderboard"}, {value: "question", text: "Question & media"}, {value: "wheel", text: "Spin the wheel"},
                            {value: "winner", text: "Winner celebration"}, {value: "blank", text: "Blank screen"}]
                    currentIndex: Math.max(0, indexOfValue(tools.settings.displayMode || "auto"))
                    onActivated: desk.live.setDisplayMode(currentValue)
                }
                Text { text: "Spin the wheel"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold; Layout.topMargin: 10 }
                Area { id: wheelItems; Layout.fillWidth: true; Layout.preferredHeight: 110; placeholderText: "One item per line (empty: the teams in the room)" }
                DeskButton { text: "Spin on the TV"; onClicked: desk.live.spinWheel(wheelItems.text) }
            }

            // ---- countdown ----
            ColumnLayout {
                Layout.fillWidth: true; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { text: "Countdown on the TV"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                RowLayout {
                    spacing: 6
                    SpinBox { id: minutes; from: 0; to: 120; value: 5; editable: true }
                    Text { text: "min"; color: Theme.muted }
                    SpinBox { id: seconds; from: 0; to: 59; value: 0; editable: true }
                    Text { text: "s"; color: Theme.muted }
                }
                Field { id: timerLabel; Layout.fillWidth: true; placeholderText: "Label, e.g. Hand in your sheets"; maximumLength: 100 }
                RowLayout {
                    spacing: 6
                    DeskButton { text: "Start"; kind: "primary"; enabled: minutes.value * 60 + seconds.value >= 1; onClicked: desk.live.startTimer(minutes.value * 60 + seconds.value, timerLabel.text) }
                    DeskButton { text: tools.timer.endsAt === null ? "Resume" : "Pause"; shortcutHint: "T"; enabled: !!tools.timer.label || tools.timer.endsAt !== undefined; onClicked: desk.live.toggleTimer() }
                    DeskButton { text: "Remove"; enabled: tools.timer.endsAt !== undefined; onClicked: desk.live.stopTimer() }
                }
                Text {
                    visible: tools.timer.endsAt !== undefined
                    readonly property real msLeft: tools.timer.endsAt === null ? (tools.timer.remaining || 0) : Math.max(0, (tools.timer.endsAt || 0) - tools.now)
                    text: msLeft <= 0 ? `⏰ ${tools.timer.label || "Countdown"}: time's up` : `⏱ ${tools.timer.label || "Countdown"}: ${Math.floor(Math.ceil(msLeft / 1000) / 60)}:${String(Math.ceil(msLeft / 1000) % 60).padStart(2, "0")}${tools.timer.endsAt === null ? " (paused)" : ""}`
                    color: Theme.goldHi; font.pixelSize: 15
                }
                // A tie for first, and the saved tie-breaker.
                Rectangle {
                    visible: !!tools.tie.teams
                    Layout.fillWidth: true; implicitHeight: tieColumn.implicitHeight + 20; radius: 10
                    color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.1); border.color: Theme.gold
                    ColumnLayout {
                        id: tieColumn
                        anchors.fill: parent; anchors.margins: 10
                        Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 14
                               text: tools.tie.teams ? `🎯 ${tools.tie.teams.length} teams are tied for first on ${tools.tie.points}: ${tools.tie.teams.join(", ")}.` + (tools.tie.breaker ? "" : " No tie-breaker is saved: tick Tie-breaker on a Nearest wins question in the web desk.") : "" }
                        DeskButton { visible: !!tools.tie.breaker; text: tools.tie.breaker ? `Play the tie-breaker: ${tools.tie.breaker.text}` : ""; kind: "primary"; onClicked: desk.live.playTieBreaker() }
                    }
                }
            }

            // ---- the room ----
            ColumnLayout {
                Layout.columnSpan: 2; Layout.fillWidth: true; spacing: 6
                Text { text: "The room"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                GridLayout {
                    columns: 2; columnSpacing: 24; rowSpacing: 2
                    Repeater {
                        model: [["registrationOpen", "Teams can join"], ["leaderboardVisible", "Scores visible on the TV and phones"], ["showScores", "Show points (not only positions)"],
                                ["scrambleKeypads", "Scramble keypads (from the next question)"], ["waitingRoom", "Waiting room: let teams in by hand"], ["teamPhotos", "Team photos"],
                                ["bingoPhrases", "Bingo calls on the TV"], ["bingoVoice", "Spoken bingo caller"], ["bingoBoard", "Bingo board on the TV"]]
                        delegate: CheckBox {
                            required property var modelData
                            text: modelData[1]; checked: !!tools.settings[modelData[0]]
                            palette.windowText: Theme.text
                            onToggled: desk.live.setSwitch(modelData[0], checked)
                        }
                    }
                }
            }
        }
    }
}
