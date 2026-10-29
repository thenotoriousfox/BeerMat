// The quiz library (Library → Quizzes; BeerMat Online): quizzes BeerMat and other venues shared, each with its rounds
// and formats (never its questions). With BeerMat Pro, Download and load puts one on this desk, as Load quiz file does;
// Share sends the quiz on this desk (its pictures and sounds inside it), which BeerMat looks at before it's listed.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: quizzes
    readonly property var lib: desk.prefs.quizzes
    property int tab: 0
    property string reporting: ""
    spacing: 10
    RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
               text: quizzes.lib.pro ? "Quizzes from BeerMat and other venues, ready to run. Every quiz in the library has been looked at by BeerMat; report anything that shouldn’t be there."
                                     : "Quizzes from BeerMat and other venues, ready to run. Anyone can look; downloading and sharing quizzes is part of BeerMat Pro." }
        Repeater {
            model: ["Browse", "Share yours"]
            delegate: DeskButton { required property int index; required property string modelData
                                   text: modelData; kind: quizzes.tab === index ? "primary" : "quiet"; implicitHeight: 34; onClicked: quizzes.tab = index }
        }
    }
    Text { visible: !!quizzes.lib.onlineError || !!quizzes.lib.error; text: quizzes.lib.onlineError || quizzes.lib.error || ""; color: Theme.bad; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }

    StackLayout {
        Layout.fillWidth: true; Layout.fillHeight: true
        currentIndex: quizzes.tab

        // ---- the library ----
        ColumnLayout {
            spacing: 10
            RowLayout {
                Field { id: search; placeholderText: "Search quizzes"; maximumLength: 60; Layout.fillWidth: true; onAccepted: desk.prefs.searchQuizzes(text) }
                DeskButton { text: "Search"; implicitHeight: 38; onClicked: desk.prefs.searchQuizzes(search.text) }
            }
            ListView {
                objectName: "quizList"
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 10
                ScrollBar.vertical: ScrollBar {}
                model: quizzes.lib.quizzes || []
                delegate: Rectangle {
                    required property var modelData
                    readonly property bool downloaded: (quizzes.lib.downloaded || []).includes(modelData.id)
                    width: ListView.view.width - 12; height: card.implicitHeight + 24; radius: 12
                    color: Theme.panelRaised; border.color: Theme.line
                    ColumnLayout {
                        id: card
                        x: 12; y: 12; width: parent.width - 24; spacing: 6
                        RowLayout {
                            Layout.fillWidth: true
                            Text { text: modelData.title; color: Theme.text; font.family: Theme.display; font.pixelSize: 20; font.weight: Font.Bold; elide: Text.ElideRight; Layout.fillWidth: true }
                            Text { visible: downloaded; text: "✓ Downloaded"; color: Theme.good; font.pixelSize: 13; font.weight: Font.Bold }
                            DeskButton { visible: !!quizzes.lib.pro; text: downloaded ? "Load again" : "Download and load"; kind: downloaded ? "quiet" : "primary"; implicitHeight: 32
                                         onClicked: desk.prefs.downloadQuiz(modelData.id) }
                            DeskButton { visible: !!quizzes.lib.pro; text: "Report"; implicitHeight: 32; onClicked: quizzes.reporting = quizzes.reporting === modelData.id ? "" : modelData.id }
                        }
                        Text { color: Theme.muted; font.pixelSize: 12
                               text: [modelData.by ? `By ${modelData.by}` : "", `${modelData.rounds} round${modelData.rounds === 1 ? "" : "s"}`, `${modelData.questions} questions`].filter(x => x).join(" · ") }
                        Text { visible: !!modelData.description; text: modelData.description || ""; color: Theme.text; font.pixelSize: 13; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                        Text { text: (modelData.outline || []).map(r => `${r.title} (${r.questions})`).join("  ·  "); color: Theme.faint; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                        Flow {
                            Layout.fillWidth: true; spacing: 6
                            Repeater { model: modelData.formats || []; delegate: Pill { required property string modelData; text: modelData } }
                        }
                        RowLayout {
                            visible: quizzes.reporting === modelData.id; Layout.fillWidth: true
                            Field { id: reason; Layout.fillWidth: true; maximumLength: 300; placeholderText: `What’s wrong with “${modelData.title}”? (wrong answers, offensive, copied…)` }
                            DeskButton { text: "Send report"; implicitHeight: 34; enabled: reason.text.trim().length > 0
                                         onClicked: { desk.prefs.reportQuiz(modelData.id, reason.text); quizzes.reporting = ""; reason.text = "" } }
                        }
                    }
                }
                Text { visible: parent.count === 0; anchors.centerIn: parent; color: Theme.muted; font.pixelSize: 13
                       text: quizzes.lib.loading ? "Looking…" : quizzes.lib.query ? "Nothing matches." : "No quizzes shared yet." }
            }
        }

        // ---- share yours ----
        ColumnLayout {
            id: sharePage
            spacing: 10
            readonly property var current: quizzes.lib.current || {}
            Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; color: Theme.muted; font.pixelSize: 13
                   text: "Share the quiz on this desk with other BeerMat venues, its pictures and sounds included. BeerMat reads every quiz before it’s in the library; other venues see its title, your description, its rounds and formats, never the questions until they download it." }
            Rectangle {
                Layout.fillWidth: true; implicitHeight: share.implicitHeight + 24; radius: 12; color: Theme.panelRaised; border.color: Theme.line
                ColumnLayout {
                    id: share
                    x: 12; y: 12; width: parent.width - 24; spacing: 8
                    Text { text: sharePage.current.title || "No quiz"; color: Theme.text; font.family: Theme.display; font.pixelSize: 20; font.weight: Font.Bold }
                    Text { color: Theme.muted; font.pixelSize: 12
                           text: `${sharePage.current.rounds || 0} rounds · ${sharePage.current.questions || 0} questions` }
                    Text { visible: !!desk.quizzes.dirty; color: Theme.bad; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true
                           text: "The Quizzes page has unsaved changes: save them first, or the library gets the quiz as it was last saved." }
                    Field { id: description; objectName: "quizDescription"; Layout.fillWidth: true; maximumLength: 300; placeholderText: "A line about it for other venues, e.g. Six easy rounds for a Tuesday night" }
                    CheckBox { id: rights; objectName: "quizRights"; palette.windowText: Theme.text
                               text: "I have the right to share everything in this quiz (questions, pictures and sounds) with other BeerMat venues (beermatquiz.co.uk/terms)" }
                    DeskButton {
                        objectName: "shareQuiz"
                        text: quizzes.lib.pro ? "Share" : "Sharing is part of BeerMat Pro"; kind: "primary"; implicitHeight: 38
                        enabled: !!quizzes.lib.pro && rights.checked && (sharePage.current.questions || 0) > 0
                        onClicked: { desk.prefs.shareQuiz(description.text, rights.checked); description.text = ""; rights.checked = false }
                    }
                }
            }
            Text { text: "Shared from this laptop"; color: Theme.text; font.pixelSize: 14; font.weight: Font.DemiBold; visible: (quizzes.lib.shared || []).length > 0 }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 6
                model: quizzes.lib.shared || []
                delegate: RowLayout {
                    required property var modelData
                    width: ListView.view.width
                    ColumnLayout {
                        Layout.fillWidth: true; spacing: 2
                        Text { text: modelData.title; color: Theme.text; font.pixelSize: 15; font.weight: Font.Bold }
                        Text {
                            Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 12
                            color: modelData.status === "rejected" ? Theme.bad : Theme.muted
                            text: modelData.status === "pending" ? "Waiting for BeerMat to look at it"
                                : modelData.status === "approved" ? "In the library"
                                : modelData.status === "rejected" ? `Turned down: ${modelData.note || "no reason given"}`
                                : modelData.status === "hidden" ? "Hidden while BeerMat looks at reports about it"
                                : `(${modelData.status})`
                        }
                    }
                    DeskButton { text: "Take out"; implicitHeight: 32; onClicked: desk.prefs.removeSharedQuiz(modelData.id) }
                }
            }
        }
    }
}
