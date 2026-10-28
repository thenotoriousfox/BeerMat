// Quizzes: the quiz on this laptop, round by round. Add, duplicate, reorder and delete questions and rounds, edit each
// question's format, wording, answer, choices, items, picture or sound, points and time, then save (Ctrl+S). The quiz
// server checks every question when it saves; options the editor doesn't show yet are kept as they are.
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
    signal openQuiz()
    signal openWebDesk()
    spacing: Theme.gap

    Shortcut { sequences: [StandardKey.Save]; enabled: quizzes.visible; onActivated: lib.save() }
    FileDialog { id: exportFile; title: "Save the quiz as a file"; fileMode: FileDialog.SaveFile; defaultSuffix: "json"
                 nameFilters: ["BeerMat quiz (*.json)"]; onAccepted: lib.export(selectedFile) }

    // ---- outline ----
    Panel {
        Layout.preferredWidth: 440; Layout.maximumWidth: 440; Layout.fillHeight: true
        title: "Rounds & questions"
        headerExtra: Pill { visible: lib.dirty; text: "UNSAVED"; tone: Theme.gold }
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
                RowLayout {
                    spacing: 10
                    Label { text: "Format"; color: Theme.muted }
                    ComboBox {
                        Layout.preferredWidth: 240
                        textRole: "text"; valueRole: "value"; model: lib.types
                        currentIndex: Math.max(0, lib.types.findIndex(t => t.value === q.type))
                        onActivated: lib.setType(currentValue)
                    }
                    Label { text: "Points"; color: Theme.muted }
                    SpinBox { from: 0; to: 100; editable: true; value: q.points !== undefined ? q.points : 1; onValueModified: lib.setField("points", value) }
                    Label { text: "Seconds"; color: Theme.muted }
                    SpinBox { from: 5; to: 7200; editable: true; value: q.seconds !== undefined ? q.seconds : 30; onValueModified: lib.setField("seconds", value) }
                }
                RowLayout {
                    spacing: 6
                    DeskButton { text: "↑ Move up"; implicitHeight: 32; onClicked: lib.moveQuestion(-1) }
                    DeskButton { text: "↓ Move down"; implicitHeight: 32; onClicked: lib.moveQuestion(1) }
                    DeskButton { text: "Duplicate"; implicitHeight: 32; onClicked: lib.duplicateQuestion() }
                    DeskButton { text: "Delete"; kind: "danger"; implicitHeight: 32; onClicked: lib.deleteQuestion() }
                }
                Label { text: "Question"; color: Theme.muted }
                Area { Layout.fillWidth: true; wrapMode: TextEdit.Wrap; text: q.text || ""; font.pixelSize: 17; onEditingFinished: lib.setField("text", text) }

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

                Rectangle {
                    Layout.fillWidth: true; implicitHeight: more.implicitHeight + 24; radius: 10
                    color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.08); border.color: Qt.rgba(Theme.teal.r, Theme.teal.g, Theme.teal.b, 0.35)
                    RowLayout {
                        id: more
                        anchors.fill: parent; anchors.margins: 12
                        Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                               text: "This format's other settings (Evil Mode, speed bonus, go wide, buzzer and bingo options, clips and songs, the pinpoint target, word snake grid, uploading media) are kept as they are. Edit them in the web desk for now." }
                        DeskButton { text: "Open the web desk"; implicitHeight: 32; onClicked: quizzes.openWebDesk() }
                    }
                }
            }
        }
        Text { visible: !chosen; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 15; text: "Choose a question on the left, or add one with + on a round." }
    }
}
