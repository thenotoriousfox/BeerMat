// Teams & marking: mark the current question's answers once it's closed (points, or a sheet item by item), correct a
// team's score with a reason, and look after teams (let in, rename, move to another phone, disable, restore). The
// server checks every value; nothing here works out a score.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

RowLayout {
    id: teams
    required property var view
    readonly property var q: view.question || null
    spacing: Theme.gap

    // ---- answers and marking ----
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: q ? `Answers · ${q.text}` : "Answers"
        headerExtra: Text {
            text: !q ? "" : view.canMark ? "closed: mark below" : "close answers to mark"
            color: view.canMark ? Theme.good : Theme.muted; font.pixelSize: 12; font.weight: Font.Bold
        }
        ListView {
            anchors.fill: parent
            clip: true; spacing: 8
            model: view.answerRows || []
            delegate: Rectangle {
                id: answerCard
                required property var modelData
                // The sheet's ticks as the quizmaster sets them, saved together.
                property var sheetMarks: view.sheetItems.map((_, i) => (modelData.marks || [])[i] === 1)
                width: ListView.view.width
                height: cardColumn.implicitHeight + 24
                radius: 12
                color: modelData.points > 0 ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.12) : Theme.panelRaised
                border.color: modelData.points > 0 ? Qt.rgba(Theme.good.r, Theme.good.g, Theme.good.b, 0.5) : Theme.line
                ColumnLayout {
                    id: cardColumn
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 12
                    spacing: 6
                    RowLayout {
                        Layout.fillWidth: true
                        Text { text: modelData.team; color: Theme.text; font.pixelSize: 15; font.weight: Font.Bold; Layout.fillWidth: true; elide: Text.ElideRight }
                        Text { text: modelData.submitted || modelData.points !== 0 ? "" : "draft"; color: Theme.faint; font.pixelSize: 11 }
                        Text { text: `${modelData.points} pts`; color: Theme.goldHi; font.family: Theme.display; font.pixelSize: 16; font.weight: Font.Bold }
                    }
                    Text { visible: !view.isSheet; text: modelData.value || "—"; color: Theme.text; font.pixelSize: 15; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                    // Points for the whole answer
                    RowLayout {
                        visible: view.canMark && !view.isSheet
                        spacing: 6
                        SpinBox { id: points; from: -200; to: 200; value: modelData.points; editable: true }
                        DeskButton { text: "Set points"; implicitHeight: 34; onClicked: desk.mark(answerCard.modelData.teamId, points.value) }
                        DeskButton { text: `✓ Right (${q ? q.points : 1})`; implicitHeight: 34; enabled: !!q; onClicked: desk.mark(answerCard.modelData.teamId, q.points) }
                        DeskButton { text: "✗ Wrong"; implicitHeight: 34; onClicked: desk.mark(answerCard.modelData.teamId, 0) }
                    }
                    // A sheet, item by item
                    Repeater {
                        model: view.isSheet ? view.sheetItems : []
                        delegate: RowLayout {
                            required property int index
                            required property string modelData
                            Layout.fillWidth: true
                            CheckBox {
                                enabled: view.canMark
                                checked: answerCard.sheetMarks[index] === true
                                onToggled: { const m = answerCard.sheetMarks.slice(); m[index] = checked; answerCard.sheetMarks = m }
                                palette.windowText: Theme.text
                                text: `${index + 1}. ${modelData}: ${(answerCard.modelData.items || [])[index] || "—"}`
                            }
                        }
                    }
                    DeskButton {
                        visible: view.canMark && view.isSheet
                        text: "Save sheet marks"; implicitHeight: 34
                        onClicked: desk.markSheet(answerCard.modelData.teamId, answerCard.sheetMarks)
                    }
                }
            }
            Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                   text: q ? "No answers yet." : "Answers to the current question appear here."; color: Theme.muted; font.pixelSize: 13 }
        }
    }

    // ---- teams ----
    ColumnLayout {
        Layout.preferredWidth: 460; Layout.maximumWidth: 460; Layout.fillHeight: true
        spacing: Theme.gap

        Panel {
            Layout.fillWidth: true; Layout.fillHeight: true
            title: "Teams"
            headerExtra: DeskButton { visible: view.waitingCount > 0; text: `Let ${view.waitingCount} in`; kind: "primary"; implicitHeight: 30; onClicked: desk.admitAll() }
            ListView {
                id: teamList
                anchors.fill: parent
                clip: true; spacing: 6
                model: view.allTeams || []
                property string chosen: ""
                delegate: Rectangle {
                    id: teamRow
                    required property var modelData
                    readonly property bool open: teamList.chosen === modelData.id
                    width: ListView.view.width
                    height: open ? 44 + tools.implicitHeight + 12 : 44
                    radius: 10
                    color: open ? Theme.panelRaised : Qt.rgba(1, 1, 1, 0.03)
                    border.color: modelData.waiting ? Theme.gold : Theme.line
                    opacity: modelData.enabled ? 1 : 0.5
                    Behavior on height { NumberAnimation { duration: 120 } }
                    clip: true
                    RowLayout {
                        x: 12; width: parent.width - 24; height: 44
                        Rectangle { width: 8; height: 8; radius: 4; color: modelData.connected ? Theme.good : Theme.bad }
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                        Pill { visible: modelData.waiting; text: "WAITING"; tone: Theme.gold }
                        Pill { visible: !modelData.enabled; text: "DISABLED"; tone: Theme.bad }
                        Text { text: modelData.score; color: Theme.goldHi; font.family: Theme.display; font.pixelSize: 16; font.weight: Font.Bold }
                    }
                    MouseArea { width: parent.width; height: 44; onClicked: teamList.chosen = teamRow.open ? "" : teamRow.modelData.id }
                    ColumnLayout {
                        id: tools
                        visible: teamRow.open
                        x: 12; y: 48; width: parent.width - 24
                        spacing: 6
                        RowLayout {
                            TextField { id: newName; placeholderText: "New name"; Layout.fillWidth: true; maximumLength: 40 }
                            DeskButton { text: "Rename"; implicitHeight: 32; enabled: newName.text.trim().length >= 2; onClicked: desk.teamAction(teamRow.modelData.id, "rename", newName.text) }
                        }
                        RowLayout {
                            SpinBox { id: correction; from: -100; to: 100; value: 0; editable: true }
                            TextField { id: reason; placeholderText: "Reason (shown in the results)"; Layout.fillWidth: true; maximumLength: 200 }
                            DeskButton { text: "Correct score"; implicitHeight: 32; enabled: correction.value !== 0 && reason.text.trim() !== ""
                                         onClicked: { desk.adjust(teamRow.modelData.id, correction.value, reason.text); correction.value = 0; reason.text = "" } }
                        }
                        Flow {
                            Layout.fillWidth: true; spacing: 6
                            DeskButton { visible: teamRow.modelData.waiting; text: "Let in"; kind: "primary"; implicitHeight: 32; onClicked: desk.teamAction(teamRow.modelData.id, "admit", "") }
                            DeskButton { text: "Move to another phone"; implicitHeight: 32; onClicked: desk.teamAction(teamRow.modelData.id, "transfer", "") }
                            DeskButton { text: teamRow.modelData.enabled ? "Disable" : "Restore"; kind: teamRow.modelData.enabled ? "danger" : "quiet"; implicitHeight: 32
                                         onClicked: desk.teamAction(teamRow.modelData.id, teamRow.modelData.enabled ? "disable" : "restore", "") }
                        }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                       text: "No teams yet."; color: Theme.muted; font.pixelSize: 13 }
            }
        }
    }
}
