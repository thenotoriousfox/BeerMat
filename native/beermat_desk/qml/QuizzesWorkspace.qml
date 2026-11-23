// Quizzes: the quizzes on this laptop (QuizShelf: the one on the desk, My quizzes, downloads from the quiz library)
// and the editor for the one on the desk (QuizEditor). It opens on the list, or on the editor while a quiz is under way.
import QtQuick
import QtQuick.Layouts

StackLayout {
    id: page
    property bool editing: false
    signal openQuiz()
    signal openWebDesk()
    signal shareQuiz()          // the quiz library's Share yours
    signal browseLibrary()      // the quiz library
    currentIndex: editing ? 1 : 0
    onVisibleChanged: if (visible) editing = !!desk.view.running
    QuizShelf {
        objectName: "quizShelf"
        onEdit: page.editing = true
        onOpenQuiz: page.openQuiz()
        onShareQuiz: page.shareQuiz()
        onBrowseLibrary: page.browseLibrary()
    }
    QuizEditor {
        objectName: "quizEditor"
        onOpenQuiz: page.openQuiz()
        onOpenWebDesk: page.openWebDesk()
        onShowShelf: page.editing = false
    }
}
