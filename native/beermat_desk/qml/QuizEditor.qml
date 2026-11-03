// The quiz editor (Quizzes → Edit quiz): the quiz on this laptop, round by round. Add, duplicate, reorder and delete questions and rounds, edit each
// question's format, wording, answer, choices, items, picture or sound (or a Spotify track), pinpoint target, clips,
// songs, points, time and every format option, then save (Ctrl+S). The quiz server checks every question as it saves.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

RowLayout {
    id: quizzes
    readonly property var lib: desk.quizzes
    readonly property var q: lib.question
    readonly property bool chosen: q.type !== undefined
    readonly property var fields: q.fields || []
    readonly property var spotifyClip: q.spotifyClip || ({})
    signal openQuiz()
    signal openWebDesk()
    signal showShelf()          // back to the list of quizzes (QuizShelf)
    spacing: Theme.gap

    Shortcut { sequences: [StandardKey.Save]; enabled: quizzes.visible; onActivated: lib.save() }
    FileDialog { id: mediaFile; property string target: "media"; title: "Choose a picture or sound"
                 nameFilters: ["Pictures and sounds (*.png *.jpg *.jpeg *.webp *.mp3 *.ogg *.wav)"]
                 onAccepted: { lib.uploadMedia(target, selectedFile); target = "media" } }
    FileDialog { id: sheetsFile; title: "Save the answer sheets (PDF), then print them"; fileMode: FileDialog.SaveFile; defaultSuffix: "pdf"
                 nameFilters: ["PDF (*.pdf)"]; onAccepted: lib.printSheets(selectedFile) }
    FileDialog { id: exportFile; title: "Save the quiz as a file"; fileMode: FileDialog.SaveFile; defaultSuffix: "json"
                 nameFilters: ["BeerMat quiz (*.json)"]; onAccepted: lib.export(selectedFile, true) }

    // ---- outline ----
    Panel {
        Layout.preferredWidth: 440; Layout.maximumWidth: 440; Layout.fillHeight: true
        title: "Rounds & questions"
        headerExtra: RowLayout {
            spacing: 6
            Pill { visible: lib.dirty; text: "UNSAVED"; tone: Theme.gold }
            DeskButton { objectName: "allQuizzes"; text: "◀ All quizzes"; implicitHeight: 30; onClicked: quizzes.showShelf() }
        }
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            Field {
                Layout.fillWidth: true; placeholderText: "Quiz title"; text: lib.title; font.pixelSize: 16
                onEditingFinished: lib.setTitle(text)
            }
            ListView {
                id: outline
                Layout.fillWidth: true; Layout.fillHeight: true
                clip: true; spacing: 2
                ScrollBar.vertical: ScrollBar {}
                model: lib.outline
                delegate: Rectangle {
                    id: row
                    required property var modelData
                    width: ListView.view.width
                    height: modelData.kind === "round" ? 40 : 34
                    radius: 8
                    color: modelData.selected ? Qt.rgba(Theme.gold.r, Theme.gold.g, Theme.gold.b, 0.18) : rowMouse.containsMouse ? Qt.rgba(1, 1, 1, 0.04) : "transparent"
                    MouseArea { id: rowMouse; anchors.fill: parent; hoverEnabled: true; enabled: row.modelData.kind === "question"; onClicked: lib.select(row.modelData.round, row.modelData.question) }
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: row.modelData.kind === "round" ? 4 : 18; anchors.rightMargin: 4; spacing: 6
                        TextField {
                            visible: row.modelData.kind === "round"
                            text: row.modelData.text; Layout.fillWidth: true; font.weight: Font.Bold
                            color: Theme.gold; background: Item {}
                            onEditingFinished: lib.renameRound(row.modelData.round, text)
                        }
                        Text { visible: row.modelData.kind === "round"; text: `${row.modelData.count}`; color: Theme.faint; font.pixelSize: 12 }
                        Tool { visible: row.modelData.kind === "round"; text: "+"; ToolTip.visible: hovered; ToolTip.text: "Add a question to this round"; onClicked: lib.addQuestion(row.modelData.round) }
                        Tool { visible: row.modelData.kind === "round" && row.modelData.count === 0; text: "✕"; ToolTip.visible: hovered; ToolTip.text: "Delete this empty round"; onClicked: lib.deleteRound(row.modelData.round) }
                        Text { visible: row.modelData.kind === "question"; text: row.modelData.text; color: row.modelData.selected ? Theme.goldHi : Theme.text; font.pixelSize: 13; elide: Text.ElideRight; Layout.fillWidth: true }
                        Text { visible: row.modelData.kind === "question"; text: row.modelData.tieBreaker ? "tie-breaker" : row.modelData.type || ""; color: Theme.faint; font.pixelSize: 11 }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                       text: "No quiz yet. Load a quiz file, or add a round."; color: Theme.muted; font.pixelSize: 13 }
            }
            Flow {
                Layout.fillWidth: true; spacing: 6
                DeskButton { text: "Add round"; implicitHeight: 34; onClicked: lib.addRound() }
                DeskButton { text: "Load quiz file…"; implicitHeight: 34; onClicked: quizzes.openQuiz() }
                DeskButton { text: "Save as file…"; implicitHeight: 34; onClicked: exportFile.open() }
                DeskButton { text: "Print blank sheets…"; implicitHeight: 34; onClicked: sheetsFile.open() }
            }
            RowLayout {
                Layout.fillWidth: true
                Field { id: driveLink; placeholderText: "Google Drive link to a quiz file"; Layout.fillWidth: true }
                DeskButton { text: "Load"; implicitHeight: 34; enabled: driveLink.text.trim() !== ""; onClicked: { desk.importDrive(driveLink.text.trim()); driveLink.text = "" } }
            }
        }
    }

    // ---- the question ----
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: chosen ? `${q.roundTitle} · question ${q.index + 1}` : "Question"
        headerExtra: RowLayout {
            spacing: 6
            DeskButton { text: "Revert"; implicitHeight: 32; enabled: lib.dirty; onClicked: lib.revert() }
            DeskButton { text: "Save"; kind: "primary"; shortcutHint: "Ctrl+S"; implicitHeight: 32; enabled: lib.dirty; onClicked: lib.save() }
        }
        ScrollView {
            anchors.fill: parent
            visible: chosen
            contentWidth: availableWidth
            ColumnLayout {
                width: parent.width; spacing: 10
                // Format, points and time; they wrap onto a second line in a narrow window.
                Flow {
                    objectName: "questionBasics"
                    Layout.fillWidth: true; Layout.maximumWidth: parent.width; spacing: 10
                    RowLayout {
                    spacing: 10
                    Label { text: "Format"; color: Theme.muted }
                    ComboBox {
                        Layout.preferredWidth: 240
                        // Simple mode (Settings) keeps to the everyday formats; a question already in another keeps its own.
                        readonly property var shown: (desk.view.settings || {}).simpleMode ? lib.types.filter(t => ["text", "choice", "letter", "number", "nearest", "picture", "audio", "buzzer", "bingo", "sheet"].includes(t.value) || t.value === q.type) : lib.types
                        textRole: "text"; valueRole: "value"; model: shown
                        currentIndex: Math.max(0, shown.findIndex(t => t.value === q.type))
                        onActivated: lib.setType(currentValue)
                    }
                    }
                    RowLayout {
                    spacing: 10
                    Label { text: "Points"; color: Theme.muted }
                    SpinBox { from: 0; to: 100; editable: true; value: q.points !== undefined ? q.points : 1; onValueModified: lib.setField("points", value) }
                    }
                    RowLayout {
                    spacing: 10
                    Label { text: "Seconds"; color: Theme.muted }
                    SpinBox { from: 5; to: 7200; editable: true; value: q.seconds !== undefined ? q.seconds : 30; onValueModified: lib.setField("seconds", value) }
                    }
                }
                Flow {
                    objectName: "questionActions"
                    Layout.fillWidth: true; Layout.maximumWidth: parent.width; spacing: 6
                    DeskButton { text: "↑ Move up"; implicitHeight: 32; onClicked: lib.moveQuestion(-1) }
                    DeskButton { text: "↓ Move down"; implicitHeight: 32; onClicked: lib.moveQuestion(1) }
                    DeskButton { text: "Duplicate"; implicitHeight: 32; onClicked: lib.duplicateQuestion() }
                    DeskButton { text: "Delete"; kind: "danger"; implicitHeight: 32; onClicked: lib.deleteQuestion() }
                }
                Label { text: "Question"; color: Theme.muted }
                Area { Layout.fillWidth: true; wrapMode: TextEdit.Wrap; text: q.text || ""; font.pixelSize: 17; onEditingFinished: lib.setField("text", text) }

                Label { visible: fields.includes("clues"); text: "Clues, hardest first (one per line, 2–8; one more appears every few seconds)"; color: Theme.muted }
                Area { visible: fields.includes("clues"); Layout.fillWidth: true; text: q.clues || ""; onEditingFinished: lib.setField("clues", text) }
                Label { visible: fields.includes("survey"); text: "Survey answers, one a line: answer = points (2–12; alternatives with |, e.g. Kettle | Electric kettle = 5)"; color: Theme.muted }
                Area { visible: fields.includes("survey"); Layout.fillWidth: true; text: q.survey || ""; onEditingFinished: lib.setField("survey", text) }
                Label { visible: fields.includes("linkGroups"); text: "Groups, one a line: link: item, item, item (2–4 groups of 2–5; alternatives for a link with |, e.g. Planets | Planet names: Mars, Venus)"; color: Theme.muted }
                Area { visible: fields.includes("linkGroups"); Layout.fillWidth: true; text: q.linkGroups || ""; onEditingFinished: lib.setField("linkGroups", text) }
                Label { visible: fields.includes("sorting"); text: "Items and their groups, one a line: item = group (2–16 items, 2–5 groups; mix them up, phones show them in this order)"; color: Theme.muted }
                Area { visible: fields.includes("sorting"); Layout.fillWidth: true; text: q.sorting || ""; onEditingFinished: lib.setField("sorting", text) }
                Label { visible: fields.includes("pairs"); text: "Pairs, one a line: left = right (2–8; phones get the right-hand side shuffled)"; color: Theme.muted }
                Area { visible: fields.includes("pairs"); Layout.fillWidth: true; text: q.pairs || ""; onEditingFinished: lib.setField("pairs", text) }
                Label { visible: fields.includes("accepted"); text: "Accepted answers (one per line, 2–50; alternatives with |, e.g. UK | United Kingdom)"; color: Theme.muted }
                Area { visible: fields.includes("accepted"); Layout.fillWidth: true; text: q.accepted || ""; onEditingFinished: lib.setField("accepted", text) }
                Label { visible: fields.includes("options"); text: "Choices (one per line)"; color: Theme.muted }
                Area { visible: fields.includes("options"); Layout.fillWidth: true; text: q.options || ""; onEditingFinished: lib.setField("options", text) }
                Label { visible: fields.includes("correct"); text: "Right choices (one per line, as written above)"; color: Theme.muted }
                Area { visible: fields.includes("correct"); Layout.fillWidth: true; text: q.correct || ""; onEditingFinished: lib.setField("correct", text) }
                Label { visible: fields.includes("items"); text: q.type === "sequence" ? "Items in the right order (one per line; phones get them shuffled)" : "Sheet items (one per line)"; color: Theme.muted }
                Area { visible: fields.includes("items"); Layout.fillWidth: true; text: q.items || ""; onEditingFinished: lib.setField("items", text) }
                Label { visible: fields.includes("itemAnswers"); text: "Sheet answers (one per line, in the same order)"; color: Theme.muted }
                Area { visible: fields.includes("itemAnswers"); Layout.fillWidth: true; text: q.itemAnswers || ""; onEditingFinished: lib.setField("itemAnswers", text) }
                Label { visible: fields.includes("answer"); text: q.type === "choice" ? "Right choice (as written above)" : "Answer"; color: Theme.muted }
                Field { visible: fields.includes("answer"); Layout.fillWidth: true; text: q.answer || ""; onEditingFinished: lib.setField("answer", text) }
                Label { visible: fields.includes("aliases"); text: "Also accept (one per line)"; color: Theme.muted }
                Area { visible: fields.includes("aliases"); Layout.fillWidth: true; text: q.aliases || ""; onEditingFinished: lib.setField("aliases", text) }
                Label { visible: fields.includes("media"); text: "Picture or sound (a file on this laptop's quiz, e.g. /media/…)"; color: Theme.muted }
                Field { visible: fields.includes("media"); Layout.fillWidth: true; text: q.media || ""; onEditingFinished: lib.setField("media", text) }
                Label { text: "Note shown with the answer"; color: Theme.muted }
                Field { Layout.fillWidth: true; text: q.answerNote || ""; onEditingFinished: lib.setField("answerNote", text) }

                // ---- picture or sound ----
                RowLayout {
                    visible: ["picture", "audio", "pinpoint", "text", "choice", "multi", "letter", "number", "nearest", "sequence", "tiles", "wordsnake", "vote", "buzzer", "sheet"].includes(q.type)
                    Layout.fillWidth: true; Layout.maximumWidth: parent.width; spacing: 8
                    DeskButton { text: q.media ? "Replace the picture or sound…" : "Add a picture or sound…"; implicitHeight: 34; onClicked: mediaFile.open() }
                    DeskButton { visible: !!q.media; text: "Remove"; implicitHeight: 34; onClicked: lib.setField("media", "") }
                    Text { text: q.media ? q.media.split("/").pop() : ""; color: Theme.muted; font.pixelSize: 12; Layout.fillWidth: true; elide: Text.ElideMiddle }
                }
                // The picture; for a pinpoint question, click it to place the target.
                Image {
                    id: picture
                    visible: !!q.media && !/\.(mp3|ogg|wav)$/i.test(q.media)
                    source: visible ? desk.serverUrl + q.media : ""
                    Layout.preferredWidth: Math.min(560, parent.width); Layout.preferredHeight: 320
                    fillMode: Image.PreserveAspectFit; asynchronous: true
                    readonly property real ox: (width - paintedWidth) / 2
                    readonly property real oy: (height - paintedHeight) / 2
                    // Several places to find: every one placed so far.
                    Repeater {
                        model: q.type === "pinpoint" && q.targets ? q.targets : []
                        delegate: Rectangle {
                            required property var modelData
                            readonly property real rx: (modelData.r || 0.06) * picture.paintedWidth
                            width: rx * 2; height: width; radius: width / 2
                            x: picture.ox + modelData.x * picture.paintedWidth - width / 2
                            y: picture.oy + modelData.y * picture.paintedHeight - height / 2
                            color: Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.25); border.color: Theme.good; border.width: 3
                        }
                    }
                    Rectangle {
                        visible: q.type === "pinpoint" && !q.targets && q.target && q.target.x !== undefined
                        readonly property real rx: (q.target ? q.target.r || 0.06 : 0) * picture.paintedWidth
                        width: rx * 2; height: width; radius: width / 2
                        x: picture.ox + (q.target ? q.target.x : 0) * picture.paintedWidth - width / 2
                        y: picture.oy + (q.target ? q.target.y : 0) * picture.paintedHeight - height / 2
                        color: Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.25); border.color: Theme.good; border.width: 3
                    }
                    MouseArea {
                        anchors.fill: parent; enabled: q.type === "pinpoint"; cursorShape: enabled ? Qt.CrossCursor : Qt.ArrowCursor
                        onClicked: (m) => lib.setTarget((m.x - picture.ox) / picture.paintedWidth, (m.y - picture.oy) / picture.paintedHeight)
                    }
                }
                RowLayout {
                    visible: q.type === "pinpoint"
                    readonly property bool placed: q.targets ? q.targets.length > 0 : !!(q.target && q.target.x !== undefined)
                    Text { text: q.targets ? (q.targets.length ? `${q.targets.length} ${q.targets.length === 1 ? "place" : "places"}: click to add more (2–10), size` : "Click the picture for each place to find (2–10)")
                                : parent.placed ? "Target size" : "Click the picture to place the target"; color: Theme.muted }
                    Slider { visible: parent.placed; from: 0.01; to: 0.5; value: q.targets && q.targets.length ? q.targets[0].r : q.target && q.target.r ? q.target.r : 0.06; Layout.preferredWidth: 220
                             onMoved: lib.setTargetShape(value, picture.paintedWidth / Math.max(1, picture.paintedHeight)) }
                    DeskButton { visible: !!q.targets && q.targets.length > 0; text: "Clear"; implicitHeight: 32; onClicked: lib.clearTargets() }
                }
                CheckBox {
                    visible: q.type === "pinpoint"
                    objectName: "severalTargets"
                    text: "Several places to find: each click adds one, the question's points for each found"
                    checked: !!q.targets; palette.windowText: Theme.text
                    onToggled: lib.setSeveralTargets(checked)
                }
                // An audio question (or a sheet) can play a Spotify track instead of a file.
                RowLayout {
                    visible: q.type === "audio" || q.type === "sheet"
                    spacing: 6
                    Label { text: "Or a Spotify track"; color: Theme.muted }
                    Field { id: clipTrack; text: quizzes.spotifyClip.spotify || ""; placeholderText: "open.spotify.com/track/… (Pro)"; Layout.fillWidth: true }
                    Field { id: clipStart; text: quizzes.spotifyClip.start !== undefined ? String(quizzes.spotifyClip.start) : ""; placeholderText: "Start (s)"; implicitWidth: 90 }
                    Field { id: clipSeconds; text: quizzes.spotifyClip.seconds !== undefined ? String(quizzes.spotifyClip.seconds) : ""; placeholderText: "Plays (s)"; implicitWidth: 90 }
                    DeskButton { text: "Set"; implicitHeight: 34; onClicked: lib.setSpotifyClip(clipTrack.text, clipStart.text, clipSeconds.text) }
                }
                Label { visible: q.type === "sheet"; text: "Also accept, for each part (one line per part, answers separated by |)"; color: Theme.muted; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                Area { visible: q.type === "sheet"; Layout.fillWidth: true; text: q.itemAliases || ""; onEditingFinished: lib.setItemAliases(text) }

                // ---- sound clips ----
                ColumnLayout {
                    visible: q.type === "clips"
                    Layout.fillWidth: true; spacing: 4
                    Text { text: "Clips, played in order (tick the one teams tap for)"; color: Theme.text; font.weight: Font.DemiBold }
                    Repeater {
                        model: q.clipsList || []
                        delegate: RowLayout {
                            required property var modelData
                            required property int index
                            Layout.fillWidth: true; spacing: 6
                            RadioButton { checked: q.targetClip === index; onClicked: lib.setTargetClip(index) }
                            Field { text: modelData.label; placeholderText: "Name"; Layout.preferredWidth: 180; onEditingFinished: lib.setItem("clip", index, "label", text) }
                            Text { visible: !!modelData.media; text: modelData.media.split("/").pop(); color: Theme.muted; font.pixelSize: 12; Layout.fillWidth: true; elide: Text.ElideMiddle }
                            Field { visible: !modelData.media; text: modelData.spotify; placeholderText: "Spotify track link"; Layout.fillWidth: true; onEditingFinished: lib.setItem("clip", index, "spotify", text) }
                            Field { visible: !modelData.media; text: String(modelData.start); placeholderText: "Start (s)"; implicitWidth: 80; onEditingFinished: lib.setItem("clip", index, "start", text) }
                            Tool { text: "✕"; onClicked: lib.removeItem("clip", index) }
                        }
                    }
                    RowLayout {
                        DeskButton { text: "Upload a clip…"; implicitHeight: 32; onClicked: { mediaFile.target = "clip"; mediaFile.open() } }
                        DeskButton { text: "Add a Spotify clip"; implicitHeight: 32; onClicked: lib.addSpotifyItem("clip") }
                    }
                }

                // ---- music bingo songs ----
                ColumnLayout {
                    visible: q.type === "musicbingo"
                    Layout.fillWidth: true; spacing: 4
                    Text { text: `Songs (${(q.songsList || []).length}; music bingo needs 15–300)`; color: Theme.text; font.weight: Font.DemiBold }
                    ListView {
                        Layout.fillWidth: true; Layout.preferredHeight: Math.min(300, count * 40); clip: true; spacing: 2
                        model: q.songsList || []
                        delegate: RowLayout {
                            required property var modelData
                            required property int index
                            width: ListView.view.width; spacing: 6
                            Field { text: modelData.title; Layout.preferredWidth: 240; Layout.fillWidth: true; Layout.minimumWidth: 100; Layout.maximumWidth: 240
                                    onEditingFinished: lib.setItem("song", index, "title", text) }
                            Text { visible: !!modelData.media; text: modelData.media.split("/").pop(); color: Theme.muted; font.pixelSize: 12; Layout.fillWidth: true; elide: Text.ElideMiddle }
                            Field { visible: !modelData.media; text: modelData.spotify; placeholderText: "Spotify track link"; Layout.fillWidth: true; onEditingFinished: lib.setItem("song", index, "spotify", text) }
                            Field { text: String(modelData.start); placeholderText: "Start"; implicitWidth: 70; onEditingFinished: lib.setItem("song", index, "start", text) }
                            Field { text: String(modelData.seconds); placeholderText: "Plays"; implicitWidth: 70; onEditingFinished: lib.setItem("song", index, "seconds", text) }
                            Tool { text: "✕"; onClicked: lib.removeItem("song", index) }
                        }
                    }
                    RowLayout {
                        DeskButton { text: "Upload a song…"; implicitHeight: 32; onClicked: { mediaFile.target = "song"; mediaFile.open() } }
                        DeskButton { text: "Add a Spotify song"; implicitHeight: 32; onClicked: lib.addSpotifyItem("song") }
                    }
                    RowLayout {
                        Area { id: spotifyLinks; Layout.fillWidth: true; Layout.preferredHeight: 60; placeholderText: "Spotify track or playlist links, one per line (Pro, Spotify connected)" }
                        DeskButton { text: "Add from Spotify"; implicitHeight: 32; enabled: spotifyLinks.text.trim() !== ""; onClicked: { lib.importSongs(spotifyLinks.text); spotifyLinks.text = "" } }
                    }
                }

                // ---- this format's options ----
                Text { visible: (q.options_ || []).length > 0; text: "Options"; color: Theme.text; font.weight: Font.DemiBold; Layout.topMargin: 6 }
                GridLayout {
                    id: optionGrid
                    // Two equal columns, or one when the editor is narrow; every label wraps beside its control.
                    Layout.fillWidth: true; Layout.maximumWidth: parent.width; columns: parent.width < 760 ? 1 : 2; columnSpacing: 16; rowSpacing: 4
                    Repeater {
                        // Simple mode shows only the options most quizzes use.
                        model: (desk.view.settings || {}).simpleMode ? (q.options_ || []).filter(o => ["fastestFingers", "speedBonus", "mode", "variation", "places", "tieBreaker", "partScoring"].includes(o.key)) : (q.options_ || [])
                        delegate: RowLayout {
                            id: option
                            required property var modelData
                            objectName: "option-" + modelData.key
                            Layout.fillWidth: true; Layout.preferredWidth: 1; spacing: 8
                            CheckBox { id: tick; visible: option.modelData.kind === "bool"; checked: option.modelData.value === true
                                       onToggled: lib.setOption(option.modelData.key, checked ? "true" : "false") }
                            Text {
                                objectName: "optionLabel"
                                text: option.modelData.label; color: option.modelData.kind === "bool" ? Theme.text : Theme.muted; font.pixelSize: 13
                                Layout.fillWidth: true; Layout.minimumWidth: 110; wrapMode: Text.WordWrap
                                // A tick box's label ticks it, as a CheckBox's own text would.
                                MouseArea { anchors.fill: parent; enabled: option.modelData.kind === "bool"; onClicked: { tick.toggle(); tick.toggled() } }
                            }
                            SpinBox { visible: modelData.kind === "int"; from: modelData.range[0] || 0; to: modelData.range[1] || 100; editable: true
                                      value: typeof modelData.value === "number" ? modelData.value : 0; onValueModified: lib.setOption(modelData.key, String(value)) }
                            ComboBox { visible: modelData.kind === "choice"; Layout.preferredWidth: 260; Layout.minimumWidth: 160; Layout.fillWidth: true; Layout.maximumWidth: 260
                                       textRole: "text"; valueRole: "value"; model: modelData.choices
                                       currentIndex: Math.max(0, indexOfValue(modelData.value)); onActivated: lib.setOption(modelData.key, currentValue) }
                            Field { visible: modelData.kind === "ints"; text: String(modelData.value || ""); placeholderText: "2, 3, 5"; implicitWidth: 120
                                    onEditingFinished: lib.setOption(modelData.key, text) }
                        }
                    }
                }
            }
        }
        Text { visible: !chosen; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 15; text: "Choose a question on the left, or add one with + on a round." }
    }
}
