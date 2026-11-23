import XCTest
@testable import BeerMatKit

/// An answer sheet's revealed answers (a music round's artist and title) reach the app, line by line. As
/// SheetRevealTest.kt in the Android app.
final class SheetRevealTests: XCTestCase {
    func testASheetsAnswersAreRead() {
        let q = Question.parse(["id": 7, "type": "sheet", "items": ["Artist", "Title"], "itemAnswers": ["Tracy Chapman", "Fast Car"], "answer": "", "revealed": true])
        XCTAssertEqual(q.itemAnswers, ["Tracy Chapman", "Fast Car"])
        XCTAssertEqual(Question.parse(["id": 8, "type": "text", "answer": "Cardiff"]).itemAnswers, [])
    }

    /// Run the night shows the quizmaster a sheet's answers to read out, before and after the reveal.
    func testRunTheNightShowsASheetsAnswers() {
        let sheet: [String: Any] = ["id": 7, "type": "sheet", "items": ["Artist", "Title"], "itemAnswers": ["Tracy Chapman", "Fast Car"], "answer": ""]
        XCTAssertEqual(DeckState.parse(["question": sheet]).question?.answer, "Artist: Tracy Chapman · Title: Fast Car")
        XCTAssertEqual(DeckState.parse(["question": ["id": 8, "type": "text", "answer": "Cardiff"]]).question?.answer, "Cardiff")
        // A first letter's whole answer, from its note.
        XCTAssertEqual(DeckState.parse(["question": ["id": 9, "type": "letter", "answer": "S", "answerNote": "Scoville"]]).question?.answer, "S · Scoville")
    }

    /// The next round's intro reaches the phone deck, to read out; none when the round has no intro.
    func testRunTheNightShowsTheNextRoundsIntro() {
        XCTAssertEqual(DeckState.parse(["nextRound": ["id": "r2", "title": "Round 2", "intro": "Wrong answers lose points."]]).nextRound, DeckRound(title: "Round 2", intro: "Wrong answers lose points."))
        XCTAssertNil(DeckState.parse(["nextRound": NSNull()]).nextRound)
    }
}
