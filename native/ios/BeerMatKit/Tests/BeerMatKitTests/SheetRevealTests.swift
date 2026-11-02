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
    }
}
