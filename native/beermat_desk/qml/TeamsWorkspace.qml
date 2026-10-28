// Teams & marking: mark the current question's answers once it's closed (points, or a sheet item by item), correct a
// team's score with a reason, and look after teams (let in, rename, move to another phone, disable, restore). The
// server checks every value; nothing here works out a score.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

RowLayout {
    id: teams
    required property var view
    readonly property var q: view.question || null
    spacing: Theme.gap

    FileDialog { id: resultsFile; title: "Save this quiz's results"; fileMode: FileDialog.SaveFile; defaultSuffix: "json"
                 nameFilters: ["BeerMat results (*.json)"]; onAccepted: desk.saveResults(selectedFile) }

    // ---- answers and marking ----
    Panel {
        Layout.fillWidth: true; Layout.fillHeight: true
        title: view.marking && view.marking.id ? `Answers · ${view.marking.text}` : "Answers"
        headerExtra: RowLayout {
            spacing: 8
            Text {
                text: !(view.marking && view.marking.id) ? "" : view.canMark ? "closed: mark below" : "close answers to mark"
                color: view.canMark ? Theme.good : Theme.muted; font.pixelSize: 12; font.weight: Font.Bold
            }
            // Any question played so far can be marked again (paper answers, a disputed mark).
            ComboBox {
                Layout.preferredWidth: 320
                textRole: "text"; valueRole: "value"
                model: [{value: 0, text: "The current question"}].concat((view.history || []).map(h => ({value: h.id, text: `${h.round ? h.round + " · " : ""}${h.text}`})))
                currentIndex: view.marking && view.marking.past ? Math.max(0, indexOfValue(view.marking.id)) : 0
                onActivated: desk.review(currentValue)
            }
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
                        DeskButton { text: `✓ Right (${view.marking ? view.marking.points : 1})`; implicitHeight: 34; onClicked: desk.mark(answerCard.modelData.teamId, view.marking.points) }
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
                    border.color: modelData.waiting || modelData.photoStatus === "pending" ? Theme.gold : Theme.line
                    opacity: modelData.enabled ? 1 : 0.5
                    Behavior on height { NumberAnimation { duration: 120 } }
                    clip: true
                    RowLayout {
                        x: 12; width: parent.width - 24; height: 44
                        Rectangle { width: 8; height: 8; radius: 4; color: modelData.connected ? Theme.good : Theme.bad }
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; elide: Text.ElideRight; Layout.fillWidth: true }
                        Pill { visible: modelData.waiting; text: "WAITING"; tone: Theme.gold }
                        Pill { visible: modelData.photoStatus === "pending"; text: "PHOTO"; tone: Theme.gold }
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
                            Field { id: newName; placeholderText: "New name"; Layout.fillWidth: true; maximumLength: 40 }
                            DeskButton { text: "Rename"; implicitHeight: 32; enabled: newName.text.trim().length >= 2; onClicked: desk.teamAction(teamRow.modelData.id, "rename", newName.text) }
                        }
                        RowLayout {
                            SpinBox { id: correction; from: -100; to: 100; value: 0; editable: true }
                            Field { id: reason; placeholderText: "Reason (shown in the results)"; Layout.fillWidth: true; maximumLength: 200 }
                            DeskButton { text: "Correct score"; implicitHeight: 32; enabled: correction.value !== 0 && reason.text.trim() !== ""
                                         onClicked: { desk.adjust(teamRow.modelData.id, correction.value, reason.text); correction.value = 0; reason.text = "" } }
                        }
                        RowLayout {
                            Field { id: note; placeholderText: "Private note (only on the desk)"; text: teamRow.modelData.note; Layout.fillWidth: true; maximumLength: 500 }
                            DeskButton { text: "Save note"; implicitHeight: 32; onClicked: desk.teamNote(teamRow.modelData.id, note.text) }
                        }
                        RowLayout {
                            visible: teamRow.modelData.photo !== ""
                            Image { source: teamRow.modelData.photo ? desk.serverUrl + teamRow.modelData.photo : ""; sourceSize.height: 56; Layout.preferredHeight: 56; Layout.preferredWidth: 56; fillMode: Image.PreserveAspectCrop }
                            Text { text: teamRow.modelData.photoStatus === "pending" ? "Photo waiting for approval" : "Photo on the TV"; color: Theme.muted; font.pixelSize: 12; Layout.fillWidth: true }
                            DeskButton { visible: teamRow.modelData.photoStatus === "pending"; text: "Approve"; kind: "primary"; implicitHeight: 32; onClicked: desk.teamAction(teamRow.modelData.id, "approvePhoto", "") }
                            DeskButton { text: teamRow.modelData.photoStatus === "pending" ? "Reject" : "Remove"; kind: "danger"; implicitHeight: 32; onClicked: desk.teamAction(teamRow.modelData.id, "rejectPhoto", "") }
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

        Panel {
            id: more
            Layout.fillWidth: true; Layout.preferredHeight: 330
            property int tab: 0
            onVisibleChanged: if (visible) desk.loadResults()
            Component.onCompleted: desk.loadResults()
            ColumnLayout {
                anchors.fill: parent; spacing: 8
                RowLayout {
                    spacing: 4
                    Repeater {
                        model: ["Past quizzes", "Returning teams", "Blocked names"]
                        delegate: DeskButton { required property int index; required property string modelData
                                               text: modelData; implicitHeight: 30; kind: more.tab === index ? "primary" : "quiet"; onClicked: more.tab = index }
                    }
                }
                // Past quizzes kept on this laptop, and this quiz's full results.
                ColumnLayout {
                    visible: more.tab === 0; Layout.fillWidth: true; Layout.fillHeight: true
                    ListView {
                        Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 4
                        model: desk.results.events || []
                        delegate: RowLayout {
                            required property var modelData
                            width: ListView.view.width
                            Text { text: `${new Date(modelData.finished).toLocaleDateString()} · ${modelData.title} · ${modelData.teams} teams · 🏆 ${modelData.winner}`
                                   color: Theme.text; font.pixelSize: 13; elide: Text.ElideRight; Layout.fillWidth: true }
                            ToolButton { text: "✕"; onClicked: desk.deleteResult(modelData.event) }
                        }
                        Text { visible: parent.count === 0; width: parent.width; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 13
                               text: "Results of live quizzes are kept here when each one ends (rehearsals aren't)." }
                    }
                    RowLayout {
                        spacing: 6
                        DeskButton { text: "Save this quiz's results…"; implicitHeight: 32; onClicked: resultsFile.open() }
                        DeskButton { visible: (desk.results.pending || 0) > 0; text: `Send ${desk.results.pending} to BeerMat Online`; implicitHeight: 32; onClicked: desk.syncResults() }
                    }
                }
                // Returning teams: remembered with a PIN to rejoin at a later quiz.
                ListView {
                    visible: more.tab === 1; Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 4
                    model: desk.results.regulars || []
                    delegate: RowLayout {
                        required property var modelData
                        width: ListView.view.width
                        Text { text: modelData.name; color: Theme.text; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                        Text { text: `PIN ${modelData.pin}`; color: Theme.goldHi; font.pixelSize: 13; font.weight: Font.Bold }
                        ToolButton { text: "Forget"; onClicked: desk.forgetRegular(modelData.id) }
                    }
                    Text { visible: parent.count === 0; width: parent.width; wrapMode: Text.WordWrap; color: Theme.faint; font.pixelSize: 13
                           text: "Every team that answers in a live quiz is remembered with a 4-digit PIN, so it can come back as itself next time." }
                }
                // Names teams can't use.
                ColumnLayout {
                    visible: more.tab === 2; Layout.fillWidth: true; Layout.fillHeight: true
                    Area { id: blocked; Layout.fillWidth: true; Layout.fillHeight: true; text: view.blockedWords || ""; placeholderText: "Words teams can't use in their names, one per line" }
                    DeskButton { text: "Save blocked names"; implicitHeight: 32; onClicked: desk.setBlockedWords(blocked.text) }
                }
            }
        }
    }
}
