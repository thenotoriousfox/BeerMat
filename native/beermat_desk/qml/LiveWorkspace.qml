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

    // ---- a TV without a cable: its own browser opens the TV page (/tv) on the quiz Wi-Fi ----
    Popup {
        id: cableFree
        objectName: "cableFree"
        readonly property var settings: desk.tv.settings || {}
        // The TV is usually on the venue's own Wi-Fi, which the laptop stays on beside its quiz Wi-Fi: the laptop's
        // address there (the quiz server answers the TV page on every network). Without one, the quiz Wi-Fi's.
        readonly property var venue: ((desk.network || {}).addresses || []).find(a => a.kind === "lan") || null
        readonly property int port: (desk.network || {}).port || 0
        readonly property string venueUrl: venue && port ? `http://${venue.address}${port === 80 ? "" : ":" + port}` : ""
        readonly property string address: settings.online ? (settings.joinUrl || "").replace(/\/$/, "") + "/tv"
                                        : venueUrl ? venueUrl + "/tv" : settings.joinUrl ? settings.joinUrl.replace(/\/$/, "") + "/tv" : ""
        readonly property bool hotspot: !settings.online && !venueUrl
        parent: Overlay.overlay; anchors.centerIn: parent; modal: true; padding: 24
        width: Math.min(parent.width - 80, 860)
        onAboutToShow: desk.loadNetwork()
        background: Rectangle { color: Theme.panel; radius: Theme.radius; border.color: Theme.lineStrong }
        contentItem: ColumnLayout {
            spacing: 14
            Text { text: "A TV without a cable"; color: Theme.text; font.family: Theme.display; font.pixelSize: 24; font.weight: Font.Bold }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 14
                   text: "A smart TV, or a Fire TV or Google TV stick, can show the quiz by itself: its web browser opens the TV page from this laptop. It draws the quiz on the TV, so it’s as sharp as the TV and barely touches the Wi-Fi. Keep the desk’s own TV window closed (or on another screen)." }
            RowLayout {
                spacing: 24; Layout.fillWidth: true
                Rectangle {
                    Layout.preferredWidth: 220; Layout.preferredHeight: 220; radius: 16; color: "white"; visible: !!cableFree.address
                    QrCode { anchors.fill: parent; anchors.margins: 12; text: cableFree.address }
                }
                ColumnLayout {
                    Layout.fillWidth: true; spacing: 10
                    Repeater {
                        model: [
                            cableFree.settings.online ? "The TV only needs the internet: the quiz has a web address tonight."
                                : cableFree.hotspot ? `Connect the TV to the “${cableFree.settings.joinSsid || "BeerMat"}” Wi-Fi${cableFree.settings.joinPassword ? " (password " + cableFree.settings.joinPassword + ")" : ""}, as the phones do (this laptop isn’t on another network).`
                                : "Leave the TV on the venue’s Wi-Fi or network, the one this laptop is on (not the quiz Wi-Fi).",
                            "Open the TV’s web browser (on a Fire TV stick: Silk; on Google TV: any browser from its app store).",
                            "Go to the address below (or scan the code with a phone and send it to the TV).",
                            "Press OK on “Start the TV”: full screen, with sound."
                        ]
                        delegate: Text { required property string modelData; required property int index
                                         text: `${index + 1}.  ${modelData}`; color: Theme.text; font.pixelSize: 15; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                    }
                }
            }
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                   text: "On an Android TV, Google TV or Fire TV stick: install the BeerMat app and open BeerMat TV. On the quiz Wi-Fi it finds the quiz by itself." }
            Rectangle {
                Layout.fillWidth: true; implicitHeight: 64; radius: 12; color: Theme.bg2; border.color: Theme.gold
                Text { objectName: "tvAddress"; anchors.centerIn: parent; text: cableFree.address || "Set how players join (Venue & network) first"; color: Theme.goldHi
                       font.family: Theme.display; font.pixelSize: cableFree.address ? 30 : 16; font.weight: Font.Bold }
            }
            DeskButton { text: "Close"; Layout.alignment: Qt.AlignRight; implicitHeight: 36; onClicked: cableFree.close() }
        }
    }

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

    // ---- the next round's intro, for the quizmaster to read out before starting it (not shown on the TV) ----
    Rectangle {
        objectName: "nextRoundIntro"
        visible: !!view.nextRound
        Layout.fillWidth: true; implicitHeight: introColumn.implicitHeight + 24; radius: Theme.radius
        color: Qt.rgba(Theme.violet.r, Theme.violet.g, Theme.violet.b, 0.16); border.color: Qt.rgba(Theme.violet.r, Theme.violet.g, Theme.violet.b, 0.6)
        ColumnLayout {
            id: introColumn
            anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 18; anchors.rightMargin: 18; spacing: 4
            Text { Layout.fillWidth: true; elide: Text.ElideRight; color: Theme.gold; font.pixelSize: 12; font.weight: Font.Bold
                   text: view.nextRound ? `Read out before ${view.nextRound.title}` : "" }
            Text { objectName: "nextRoundIntroText"; Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 16
                   text: view.nextRound ? view.nextRound.intro : "" }
        }
    }

    // ---- VAR Check: teams' appeals waiting for a ruling (overturned gives the question's points; the TV shows it) ----
    Repeater {
        objectName: "varChecks"
        model: view.varChecks || []
        delegate: Rectangle {
            required property var modelData
            objectName: "varCheck"
            Layout.fillWidth: true; implicitHeight: varRow.implicitHeight + 20; radius: Theme.radius
            color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.12); border.color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.6)
            RowLayout {
                id: varRow
                anchors.fill: parent; anchors.leftMargin: 18; anchors.rightMargin: 12; spacing: 12
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 15
                       text: `📺 VAR Check: ${modelData.name} answered “${modelData.answer || "(nothing)"}”, ${modelData.points} ${modelData.points === 1 ? "point" : "points"} now${modelData.questionText ? ` · ${modelData.questionText}` : ""}` }
                DeskButton { objectName: "varOverturn"; text: `Overturn (+${modelData.full})`; kind: "primary"; implicitHeight: 38; enabled: !desk.busy; onClicked: desk.live.ruleVar(modelData.id, "overturned") }
                DeskButton { objectName: "varStands"; text: "Decision stands"; implicitHeight: 38; enabled: !desk.busy; onClicked: desk.live.ruleVar(modelData.id, "stands") }
            }
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

                // Hidden wording (hideText): only this desk shows it until the reveal; the TV and phones ask the room to listen.
                Rectangle {
                    objectName: "readItOut"
                    visible: !!q && q.hideText === true && !q.revealed
                    Layout.fillWidth: true; implicitHeight: readItOutText.implicitHeight + 20; radius: 12
                    color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.14); border.color: Theme.gold
                    Text { id: readItOutText; anchors.fill: parent; anchors.margins: 10; verticalAlignment: Text.AlignVCenter; wrapMode: Text.WordWrap
                           text: "🎙  Read it out: the TV and phones don't show the wording until the answer is revealed."; color: Theme.text; font.pixelSize: 15 }
                }
                // Send Question: you read it out first; the TV and phones show it, and its clock starts, on Send.
                Rectangle {
                    visible: !!q && q.held
                    Layout.fillWidth: true; implicitHeight: 52; radius: 12
                    color: Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.14); border.color: Theme.gold
                    RowLayout {
                        anchors.fill: parent; anchors.margins: 10
                        Text { text: "Read it out, then send it: the TV and phones show it and the clock starts."; color: Theme.text; font.pixelSize: 15; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                        DeskButton { text: "Send question"; shortcutHint: "S"; kind: "primary"; implicitHeight: 34; enabled: !!view.canSend && !desk.busy; onClicked: desk.send() }
                    }
                }
                // On the fly: the answer is set once answers close, and everyone is marked against it.
                RowLayout {
                    visible: !!q && q.onTheFly && !q.open && !q.held && q.answer === ""
                    Layout.fillWidth: true; spacing: 8
                    Text { text: "The answer was"; color: Theme.text; font.pixelSize: 15 }
                    Field { id: flyAnswer; Layout.preferredWidth: 220; placeholderText: "e.g. B, 42 or Paris"; maximumLength: 300; onAccepted: if (text.trim()) desk.live.flyAnswer(text) }
                    DeskButton { text: "Mark everyone"; kind: "primary"; implicitHeight: 34; enabled: flyAnswer.text.trim() !== "" && !desk.busy; onClicked: desk.live.flyAnswer(flyAnswer.text) }
                }
                // Music bingo's reaction table: the song playing, quickest dabs first.
                Rectangle {
                    readonly property var table: q ? q.reactionTable : null
                    visible: !!table
                    Layout.fillWidth: true; implicitHeight: reactionColumn.implicitHeight + 20; radius: 12
                    color: Theme.panelRaised; border.color: Theme.line
                    ColumnLayout {
                        id: reactionColumn
                        anchors.fill: parent; anchors.margins: 10; spacing: 4
                        Text { text: parent.parent.table ? `REACTIONS · SONG ${parent.parent.table.song}` : ""; color: Theme.teal; font.pixelSize: 12; font.weight: Font.Bold; font.letterSpacing: 2 }
                        Text {
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.text; font.pixelSize: 15
                            text: { const t = parent.parent.table; if (!t) return ""; return t.now.length ? t.now.map((r, i) => `${i + 1}. ${r.name} ${(r.ms / 1000).toFixed(1)}s`).join("   ") : "Nobody has dabbed this song yet" }
                        }
                        Text {
                            visible: !!parent.parent.table && parent.parent.table.leaders.length > 0
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                            text: parent.parent.table ? "Quickest on most songs: " + parent.parent.table.leaders.map(l => `${l.name} (${l.songs})`).join(", ") : ""
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
                                text: !q ? "" : q.held ? `Ready to send · ${Math.ceil(remainingMs / 1000)}s once sent` : q.paused ? `Paused · ${Math.ceil(remainingMs / 1000)}s left` : q.open ? `${Math.ceil(remainingMs / 1000)}s remaining` : q.revealed ? "Answer revealed" : "Answers closed"
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
                        TvStage { anchors.fill: parent; anchors.margins: 2; tv: desk.tv; serverUrl: desk.serverUrl; blanked: screens.blanked; silent: true }
                    }
                    // Wraps when the panel is narrow (the desk's side column), rather than running off its edge.
                    Flow {
                        Layout.fillWidth: true
                        spacing: 6
                        DeskButton { text: screens.open ? "Close TV" : "Show TV"; shortcutHint: "F7"; implicitHeight: 34; onClicked: screens.toggle() }
                        DeskButton { text: screens.blanked ? "Unblank" : "Blank"; shortcutHint: "F8"; implicitHeight: 34; enabled: screens.open; onClicked: screens.setBlank(!screens.blanked) }
                        DeskButton { objectName: "tvWithoutCable"; text: "TV without a cable…"; implicitHeight: 34; onClicked: cableFree.open() }
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
                            Text { visible: modelData.table > 0; text: `T${modelData.table}`; color: Theme.muted; font.pixelSize: 11; font.weight: Font.Bold }
                            // The signal monitor: the phone's last round trip (green under ½ s, amber under 2 s, red beyond).
                            Text {
                                visible: modelData.rtt !== null && modelData.rtt !== undefined
                                text: "▂▄▆".slice(0, modelData.rtt < 500 ? 3 : modelData.rtt < 2000 ? 2 : 1)
                                color: modelData.rtt < 500 ? Theme.good : modelData.rtt < 2000 ? Theme.gold : Theme.bad; font.pixelSize: 12
                                ToolTip.visible: signalArea.containsMouse; ToolTip.text: `Phone round trip ${modelData.rtt} ms`
                                MouseArea { id: signalArea; anchors.fill: parent; hoverEnabled: true }
                            }
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
                // Wide enough for its label (Finish quiz & reveal leaderboard); a narrow window shrinks the text instead.
                Layout.preferredWidth: Math.max(340, implicitWidth); Layout.minimumWidth: 200
            }
            DeskButton { visible: !!view.canSend; text: "Send question"; kind: "primary"; shortcutHint: "S"; enabled: !desk.busy; onClicked: desk.send() }
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

    ToolsPopup { id: toolsPopup; objectName: "toolsPopup"; view: live.view; parent: Overlay.overlay }
    Shortcut { sequence: "T"; enabled: live.visible; onActivated: desk.live.toggleTimer() }
}
