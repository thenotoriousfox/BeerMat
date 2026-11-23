import XCTest
@testable import BeerMatKit

/// Run the night shows what each team answered to the question in play, to overrule the automatic marking (as
/// DeckMarkingTest.kt in the Android app).
final class DeckMarkingTests: XCTestCase {
    func testEachTeamsAnswerForTheQuestionInPlay() {
        let d = DeckState.parse(["question": ["id": 7, "text": "Capital of France?"], "deckAnswers": ["question": 7, "full": 2, "canMark": true,
            "rows": [["team": "t1", "name": "Bears", "answer": "Pari", "points": 0], ["team": "t2", "name": "Owls", "answer": "Paris", "points": 2]]]])
        XCTAssertEqual(d.marking, DeckMarking(question: 7, full: 2, canMark: true, rows: [DeckAnswer(team: "t1", name: "Bears", answer: "Pari", points: 0, canMark: true), DeckAnswer(team: "t2", name: "Owls", answer: "Paris", points: 2, canMark: true)]))
        // While answers are open, a team's mark can be changed once it has locked its answer in.
        let open = DeckState.parse(["question": ["id": 7], "deckAnswers": ["question": 7, "full": 1, "canMark": false,
            "rows": [["team": "t1", "name": "Bears", "answer": "Pari", "points": 0, "canMark": true], ["team": "t2", "name": "Owls", "answer": "", "points": 0, "canMark": false]]]])
        XCTAssertEqual(open.marking?.rows.map(\.canMark), [true, false])
        // Another question's answers (a state from just before Next) aren't shown against this one.
        XCTAssertNil(DeckState.parse(["question": ["id": 8], "deckAnswers": ["question": 7, "full": 1, "canMark": false, "rows": [[String: Any]]()]]).marking)
        XCTAssertNil(DeckState.parse([:]).marking)
    }
}
