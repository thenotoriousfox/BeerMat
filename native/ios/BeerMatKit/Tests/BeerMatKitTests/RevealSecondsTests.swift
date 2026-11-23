import XCTest
@testable import BeerMatKit

/// A picture revealed over its first seconds (revealSeconds): the app reads how long its reveal takes.
final class RevealSecondsTests: XCTestCase {
    private func picture(_ extra: [String: Any]) -> Question? {
        var q: [String: Any] = ["id": 7, "type": "picture", "text": "Who is this?", "seconds": 30, "points": 3, "media": "/media/a.png", "reveal": "tiles", "open": true, "live": true]
        q.merge(extra) { $1 }
        return PlayerState.parse(["protocol": 1, "settings": [String: Any](), "teams": [Any](), "question": q]).question
    }

    func testReadsTheRevealTime() {
        XCTAssertEqual(picture(["revealSeconds": 15])?.revealSeconds, 15)
        XCTAssertEqual(picture([:])?.revealSeconds, 0, "over the whole time when it doesn't say")
    }
}
