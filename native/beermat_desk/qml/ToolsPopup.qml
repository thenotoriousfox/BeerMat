// Tools for the night: what the TV shows, the wheels (teams, weighted teams, a random number, saved lists and rollover
// jackpots), Fast Track, a question on the fly, slides between rounds, a countdown on the TV, the tie-breaker, and the
// room's switches. Opens from the live control bar (or T); every change goes to the quiz server.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

Popup {
    id: tools
    required property var view
    readonly property var settings: view.settings || {}
    readonly property var timer: view.timer || {}
    readonly property var tie: view.tie || {}
    readonly property var wheels: view.wheels || []
    readonly property var slides: view.slides || []
    readonly property var roomTeams: view.teams || []
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
            width: parent.width; columns: 1; columnSpacing: 24; rowSpacing: 22

            // ---- TV ----
            ColumnLayout {
                Layout.fillWidth: true; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { text: "The TV shows"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                ComboBox {
                    Layout.fillWidth: true
                    textRole: "text"; valueRole: "value"
                    model: [{value: "auto", text: "Auto — join, questions, and the leaderboard when you show it"}, {value: "join", text: "How to join (QR codes)"},
                            {value: "leaderboard", text: "Leaderboard"}, {value: "question", text: "Question & media"}, {value: "wheel", text: "Spin the wheel"},
                            {value: "winner", text: "Winner celebration"}, {value: "slides", text: "Slides"}, {value: "blank", text: "Blank screen"}]
                    currentIndex: Math.max(0, indexOfValue(tools.settings.displayMode || "auto"))
                    onActivated: desk.live.setDisplayMode(currentValue)
                }
                Text { text: "Spin the wheel"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold; Layout.topMargin: 10 }
                // A long list scrolls in its own box (the Tools window around it took the mouse wheel).
                ScrollView {
                    objectName: "wheelItemsBox"
                    Layout.fillWidth: true; Layout.preferredHeight: 120
                    Area { id: wheelItems; objectName: "wheelItems"; placeholderText: "One item per line (empty: the teams in the room)" }
                }
                RowLayout {
                    spacing: 6
                    DeskButton { text: "Spin on the TV"; kind: "primary"; onClicked: desk.live.spinWheel(wheelItems.text) }
                    DeskButton { text: "Teams, weighted"; onClicked: desk.live.spin({kind: "weighted"})
                                 ToolTip.visible: hovered; ToolTip.text: "Teams lower down the leaderboard get more slices (up to three each)" }
                    Field { id: wheelName; Layout.preferredWidth: 150; placeholderText: "Name to save it"; maximumLength: 40 }
                    DeskButton { text: "Save"; enabled: wheelName.text.trim() !== "" && wheelItems.text.trim().split("\n").filter(x => x.trim()).length >= 2
                                 onClicked: desk.live.saveWheel({name: wheelName.text, kind: "custom", items: wheelItems.text.split("\n").filter(x => x.trim())}) }
                }
                RowLayout {
                    spacing: 6
                    Text { text: "Random number"; color: Theme.muted }
                    SpinBox { id: numberFrom; from: -1000; to: 1000; value: 1; editable: true }
                    Text { text: "to"; color: Theme.muted }
                    SpinBox { id: numberTo; from: -1000; to: 1000; value: 10; editable: true }
                    DeskButton { text: "Spin"; enabled: numberTo.value > numberFrom.value && numberTo.value - numberFrom.value < 60; onClicked: desk.live.spin({kind: "number", min: numberFrom.value, max: numberTo.value}) }
                }
                // A rollover jackpot: one jackpot slice, the rest roll it over and add to it.
                RowLayout {
                    spacing: 6
                    Field { id: rolloverName; Layout.preferredWidth: 120; placeholderText: "Jackpot name"; maximumLength: 40 }
                    Field { id: rolloverPrize; Layout.preferredWidth: 46; text: "£"; maximumLength: 20 }
                    SpinBox { id: rolloverBase; from: 0; to: 100000; value: 20; editable: true; ToolTip.visible: hovered; ToolTip.text: "Starting jackpot" }
                    Text { text: "+"; color: Theme.muted }
                    SpinBox { id: rolloverStep; from: 0; to: 10000; value: 10; editable: true; ToolTip.visible: hovered; ToolTip.text: "Added each roll over" }
                    SpinBox { id: rolloverSlices; from: 2; to: 24; value: 8; editable: true; ToolTip.visible: hovered; ToolTip.text: "Slices on the wheel" }
                    DeskButton { text: "Save jackpot"; enabled: rolloverName.text.trim() !== ""
                                 onClicked: desk.live.saveWheel({name: rolloverName.text, kind: "rollover", prize: rolloverPrize.text, base: rolloverBase.value, step: rolloverStep.value, slices: rolloverSlices.value}) }
                }
                Repeater {
                    model: tools.wheels
                    delegate: RowLayout {
                        required property var modelData
                        spacing: 6
                        Text { text: modelData.name + (modelData.kind === "rollover" ? `  ·  jackpot ${modelData.prize}${modelData.amount}` : modelData.kind === "number" ? `  ·  ${modelData.min}–${modelData.max}` : `  ·  ${modelData.items.length} slices`)
                               color: Theme.text; font.pixelSize: 14; Layout.fillWidth: true; elide: Text.ElideRight }
                        DeskButton { text: "Spin"; implicitHeight: 30; onClicked: desk.live.spin({saved: modelData.id}) }
                        DeskButton { text: "Delete"; kind: "danger"; implicitHeight: 30; onClicked: desk.live.deleteWheel(modelData.id) }
                    }
                }
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

            // ---- Fast Track and a question on the fly ----
            ColumnLayout {
                Layout.fillWidth: true; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { text: "Fast Track"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: "A comeback, when the room has earned one (say the top three all got it wrong): a team jumps into first place, or spins the Fast Track wheel." }
                ComboBox { id: fastTeam; Layout.fillWidth: true; textRole: "name"; valueRole: "id"; model: tools.roomTeams }
                RowLayout {
                    spacing: 6
                    DeskButton { text: "Into first place"; kind: "primary"; enabled: fastTeam.currentIndex >= 0; onClicked: desk.live.fastTrack(fastTeam.currentValue, "first") }
                    DeskButton { text: "Spin the Fast Track wheel"; enabled: fastTeam.currentIndex >= 0; onClicked: desk.live.fastTrack(fastTeam.currentValue, "wheel") }
                }
            }
            ColumnLayout {
                Layout.fillWidth: true; Layout.alignment: Qt.AlignTop; spacing: 8
                Text { text: "A question on the fly"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: "Read out a question that isn't in the quiz; set its answer once answers close." }
                Field { id: flyText; Layout.fillWidth: true; placeholderText: "Wording for the TV (optional)"; maximumLength: 1000 }
                RowLayout {
                    spacing: 6
                    ComboBox { id: flyKind; textRole: "text"; valueRole: "value"; Layout.preferredWidth: 170
                               model: [{value: "choice", text: "Multiple choice"}, {value: "letter", text: "Letter"}, {value: "number", text: "Number"}, {value: "text", text: "Typed answer"}] }
                    SpinBox { id: flyOptions; visible: flyKind.currentValue === "choice"; from: 2; to: 6; value: 4; ToolTip.visible: hovered; ToolTip.text: "Options (A, B, C…)" }
                    SpinBox { id: flySeconds; from: 5; to: 600; value: 30; editable: true; ToolTip.visible: hovered; ToolTip.text: "Seconds" }
                    SpinBox { id: flyPoints; from: 0; to: 100; value: 1; editable: true; ToolTip.visible: hovered; ToolTip.text: "Points" }
                }
                DeskButton { text: "Ask it now"; kind: "primary"; onClicked: desk.live.askOnTheFly(flyKind.currentValue, flyOptions.value, flySeconds.value, flyPoints.value, flyText.text) }
            }

            // ---- slides between rounds ----
            ColumnLayout {
                Layout.fillWidth: true; spacing: 6
                Text { text: "Slides between rounds"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                       text: `${tools.slides.length ? tools.slides.length + (tools.slides.length === 1 ? " picture" : " pictures") : "No pictures yet"}: your adverts, food, next week's quiz. With “Play slides after each round” on, the TV plays them once a round's leaderboard has been up for 20 seconds (or a minute after the round if you don't show it); TV shows → Slides plays them now.` }
                RowLayout {
                    spacing: 6
                    DeskButton { text: "Add pictures…"; onClicked: slidePicker.open() }
                    Text { text: "Each for"; color: Theme.muted }
                    SpinBox { id: slideSeconds; from: 3; to: 120; value: tools.slides.length ? tools.slides[0].seconds : 8; editable: true }
                    Text { text: "s"; color: Theme.muted }
                    DeskButton { text: "Use"; enabled: tools.slides.length > 0; onClicked: desk.live.setSlides(tools.slides.map(x => ({media: x.media, seconds: slideSeconds.value}))) }
                    DeskButton { text: "Remove all"; kind: "danger"; enabled: tools.slides.length > 0; onClicked: desk.live.setSlides([]) }
                }
            }
            FileDialog {
                id: slidePicker
                title: "Pictures for the TV between rounds"
                fileMode: FileDialog.OpenFiles
                nameFilters: ["Pictures (*.png *.jpg *.jpeg *.webp)"]
                onAccepted: desk.live.addSlides(selectedFiles)
            }

            // ---- the room ----
            ColumnLayout {
                Layout.fillWidth: true; spacing: 6
                Text { text: "The room"; color: Theme.text; font.family: Theme.display; font.pixelSize: 18; font.weight: Font.DemiBold }
                GridLayout {
                    columns: 2; columnSpacing: 24; rowSpacing: 2
                    Repeater {
                        model: [["registrationOpen", "Teams can join"], ["leaderboardVisible", "Scores visible on the TV and phones"], ["showScores", "Show points (not only positions)"],
                                ["scrambleKeypads", "Scramble keypads (from the next question)"], ["waitingRoom", "Waiting room: let teams in by hand"], ["teamPhotos", "Team photos"],
                                ["bingoPhrases", "Bingo calls on the TV"], ["bingoVoice", "Spoken bingo caller"], ["bingoBoard", "Bingo board on the TV"],
                                ["sendQuestion", "Send Question: phones get each question when you send it (S)"], ["fixedSix", "Multiple choice: phones always show A–F"],
                                ["askTable", "Teams give their table number when they join"], ["groupBoard", "Team groups on the TV's leaderboard"],
                                ["slidesAuto", "Play slides after each round"]]
                        delegate: CheckBox {
                            required property var modelData
                            text: modelData[1]; checked: !!tools.settings[modelData[0]]
                            palette.windowText: Theme.text
                            onToggled: desk.live.setSwitch(modelData[0], checked)
                        }
                    }
                }
                // VAR Check: teams appeal their marking from their phones after a reveal.
                RowLayout {
                    Layout.topMargin: 6; spacing: 10
                    Text { text: "VAR Check (teams appeal their marking)"; color: Theme.text; font.pixelSize: 14 }
                    ComboBox {
                        objectName: "varCheckSetting"; Layout.preferredWidth: 260
                        textRole: "text"; valueRole: "value"
                        model: [{value: "round", text: "One per team each round"}, {value: "night", text: "One per team each night"}, {value: "any", text: "No limit"}, {value: "off", text: "Off"}]
                        currentIndex: Math.max(0, indexOfValue(tools.settings.varCheck || "round"))
                        onActivated: desk.live.setVarCheck(currentValue)
                    }
                }
            }
        }
    }
}
