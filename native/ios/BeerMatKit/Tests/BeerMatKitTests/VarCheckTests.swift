import XCTest
@testable import BeerMatKit

/// VAR Check reaches the app: a team's own (can it ask, how many left, how it went) and the deck's list to rule on. As
/// VarCheckTest.kt in the Android app.
final class VarCheckTests: XCTestCase {
    func testATeamsVarCheck() {
        let s = PlayerState.parse(["settings": ["varCheck": "night"], "myVar": ["left": 1, "status": NSNull(), "points": NSNull(), "canAsk": true]])
        XCTAssertEqual(s.myVar, MyVar(left: 1, status: nil, points: nil, canAsk: true))
        XCTAssertTrue(s.varPerNight)
        XCTAssertEqual(PlayerState.parse(["myVar": ["left": NSNull(), "status": "overturned", "points": 2, "canAsk": false]]).myVar, MyVar(left: nil, status: "overturned", points: 2, canAsk: false))
        XCTAssertNil(PlayerState.parse(["myVar": NSNull()]).myVar)
    }

    func testRunTheNightListsVarChecks() {
        let d = DeckState.parse(["varChecks": [["id": 4, "name": "Owls", "answer": "Cardif", "full": 2]]])
        XCTAssertEqual(d.varChecks, [DeckVar(id: 4, team: "Owls", answer: "Cardif", full: 2)])
    }
}
