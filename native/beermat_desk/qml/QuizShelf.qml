// Quizzes: the quizzes on this laptop. The one on the desk (edit it, share it in the quiz library, save it as a file,
// clear it), a new one, My quizzes (a copy of every quiz this laptop has had, kept by the quiz server whenever one is
// saved or replaced) and the quizzes downloaded from the quiz library. Loading one asks first if a quiz is under way.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Desk

ColumnLayout {
    id: shelf
    readonly property var view: desk.view
    readonly property var mine: desk.prefs.myQuizzes
    readonly property bool hasQuiz: (view.questions || 0) > 0
    signal edit()
    signal openQuiz()
    signal shareQuiz()
    signal browseLibrary()
    spacing: Theme.gap
    onVisibleChanged: if (visible) desk.prefs.loadMyQuizzes()
    // A quiz loaded, cleared or saved elsewhere: the lists again.
    property string shownQuiz: `${view.title}/${view.questions}`
    onShownQuizChanged: if (visible) desk.prefs.loadMyQuizzes()

    FileDialog { id: exportFile; title: "Save the quiz as a file"; fileMode: FileDialog.SaveFile; defaultSuffix: "json"
                 nameFilters: ["BeerMat quiz (*.json)"]; onAccepted: desk.quizzes.export(selectedFile, true) }
    MessageDialog {
        id: clearConfirm
        objectName: "clearConfirm"
        property bool thenEdit: false
        title: thenEdit ? "Start a new quiz?" : "Clear the quiz?"
        text: `“${shelf.view.title}” comes off the desk${shelf.hasQuiz ? " (a copy stays in My quizzes)" : ""}${shelf.view.running ? ", and the quiz under way ends: its results are saved, and all teams and scores are cleared" : ""}.`
              + (desk.quizzes.dirty ? " Unsaved changes on the editor are lost." : "")
        buttons: MessageDialog.Yes | MessageDialog.Cancel
        onButtonClicked: (button) => { if (button === MessageDialog.Yes) { desk.clearQuiz(); if (thenEdit) shelf.edit() } }
    }
    function newQuiz() {
        // Nothing on the desk yet: straight to the editor.
        if (!hasQuiz && !view.running) return edit()
        clearConfirm.thenEdit = true; clearConfirm.open()
    }

    // ---- on the desk ----
    Panel {
        Layout.fillWidth: true; implicitHeight: 176
        title: "On the desk"
        headerExtra: Pill { visible: !!shelf.view.running; text: "UNDER WAY"; tone: Theme.good }
        ColumnLayout {
            anchors.fill: parent; spacing: 8
            Text { text: shelf.hasQuiz ? shelf.view.title : "No quiz yet"; color: Theme.text; font.family: Theme.display; font.pixelSize: 22; font.weight: Font.Bold
                   elide: Text.ElideRight; Layout.fillWidth: true }
            Text { color: Theme.muted; font.pixelSize: 13
                   text: shelf.hasQuiz ? `${shelf.view.rounds} round${shelf.view.rounds === 1 ? "" : "s"} · ${shelf.view.questions} questions` + (desk.quizzes.dirty ? " · unsaved changes" : "")
                                       : "Create a new quiz, load one below, or download one from the quiz library." }
            Item { Layout.fillHeight: true }
            Flow {
                Layout.fillWidth: true; spacing: 6
                DeskButton { objectName: "editQuiz"; text: shelf.hasQuiz ? "Edit quiz" : "Start writing"; kind: "primary"; implicitHeight: 36; onClicked: shelf.edit() }
                DeskButton { objectName: "shareCurrent"; visible: shelf.hasQuiz; text: "Share in the quiz library…"; implicitHeight: 36; onClicked: shelf.shareQuiz() }
                DeskButton { visible: shelf.hasQuiz; text: "Save as file…"; implicitHeight: 36; onClicked: exportFile.open() }
                DeskButton { objectName: "clearQuiz"; visible: shelf.hasQuiz || !!shelf.view.running; text: "Clear quiz"; kind: "danger"; implicitHeight: 36
                             onClicked: { clearConfirm.thenEdit = false; clearConfirm.open() } }
            }
        }
    }
    Flow {
        Layout.fillWidth: true; spacing: 6
        DeskButton { objectName: "newQuiz"; text: "＋ Create a new quiz"; kind: "primary"; implicitHeight: 40; onClicked: shelf.newQuiz() }
        DeskButton { text: "Load quiz file…"; implicitHeight: 40; onClicked: shelf.openQuiz() }
        DeskButton { text: "Browse the quiz library"; implicitHeight: 40; onClicked: shelf.browseLibrary() }
        DeskButton { text: "Open My quizzes folder"; implicitHeight: 40; onClicked: desk.prefs.openMyQuizzes() }
    }

    // ---- the quizzes on this laptop ----
    component QuizList: Panel {
        id: list
        property string kind: "mine"
        property var quizzes: []
        property string empty: ""
        Layout.fillWidth: true; Layout.fillHeight: true
        ListView {
            anchors.fill: parent; clip: true; spacing: 6
            ScrollBar.vertical: ScrollBar {}
            model: list.quizzes
            delegate: Rectangle {
                required property var modelData
                readonly property bool onDesk: modelData.title === shelf.view.title && shelf.hasQuiz
                width: ListView.view.width - 12; height: 56; radius: 10
                color: Theme.panelRaised; border.color: onDesk ? Theme.gold : Theme.line
                RowLayout {
                    anchors.fill: parent; anchors.leftMargin: 12; anchors.rightMargin: 8; spacing: 8
                    ColumnLayout {
                        Layout.fillWidth: true; spacing: 1
                        Text { text: modelData.title; color: Theme.text; font.pixelSize: 15; font.weight: Font.Bold; elide: Text.ElideRight; Layout.fillWidth: true }
                        Text { color: Theme.faint; font.pixelSize: 12
                               text: `${modelData.rounds} rounds · ${modelData.questions} questions · ${new Date(modelData.saved).toLocaleDateString(Qt.locale(), Locale.ShortFormat)}` + (onDesk ? " · on the desk" : "") }
                    }
                    DeskButton { text: "Load"; kind: "primary"; implicitHeight: 32; visible: !onDesk; onClicked: desk.prefs.loadQuizFile(modelData.path) }
                    Tool { text: "✕"; ToolTip.visible: hovered; ToolTip.text: "Delete this copy from the laptop"; onClicked: { deleteConfirm.quiz = modelData; deleteConfirm.kind = list.kind; deleteConfirm.open() } }
                }
            }
            Text { visible: parent.count === 0; anchors.centerIn: parent; width: parent.width - 40; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                   text: list.empty; color: Theme.muted; font.pixelSize: 13 }
        }
    }
    MessageDialog {
        id: deleteConfirm
        property var quiz: ({})
        property string kind: "mine"
        title: "Delete this quiz from the laptop?"
        text: `“${quiz.title || ""}” is deleted from this laptop.` + (kind === "downloaded" ? " You can download it again from the quiz library." : " If it’s on the desk, it stays there until it’s cleared.")
        buttons: MessageDialog.Yes | MessageDialog.Cancel
        onButtonClicked: (button) => { if (button === MessageDialog.Yes) desk.prefs.deleteMyQuiz(kind, quiz.file) }
    }
    RowLayout {
        Layout.fillWidth: true; Layout.fillHeight: true; spacing: Theme.gap
        QuizList {
            objectName: "myQuizList"
            title: "My quizzes"; kind: "mine"; quizzes: shelf.mine.mine || []
            empty: "Every quiz you write or load is kept here when you save it, or when another quiz takes its place."
        }
        QuizList {
            objectName: "downloadedQuizList"
            title: "From the quiz library"; kind: "downloaded"; quizzes: shelf.mine.downloaded || []
            empty: "Quizzes you download from the quiz library (Library → Quizzes) show here."
        }
    }
}
