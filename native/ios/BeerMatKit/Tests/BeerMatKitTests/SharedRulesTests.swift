import Foundation
import XCTest
@testable import BeerMatKit

/// What the app must do exactly as the browser player, the Android app and the server do.
final class SharedRulesTests: XCTestCase {
    // Expected orders are seededOrder() in web/app.js run in Node (the same fixtures as the Android tests).
    func testSeededOrderMatchesTheWebPlayer() {
        XCTAssertEqual(seededOrder(26, "abc123:7"), [15, 5, 18, 10, 4, 11, 0, 25, 14, 7, 6, 3, 2, 12, 22, 16, 23, 21, 24, 20, 9, 8, 13, 19, 1, 17])
        XCTAssertEqual(seededOrder(4, "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978:42"), [1, 3, 0, 2])
        XCTAssertEqual(seededOrder(10, "team:1"), [3, 2, 1, 5, 7, 6, 8, 9, 0, 4])
        XCTAssertEqual(seededOrder(6, "é🍺x:3"), [3, 1, 5, 4, 2, 0])
    }

    func testAddressesAndWifiCodes() throws {
        XCTAssertEqual(try QuizServer.normalise(" 10.42.0.1:3000/ "), "http://10.42.0.1:3000")
        XCTAssertEqual(try QuizServer.normalise("https://abc.trycloudflare.com/?x=1"), "https://abc.trycloudflare.com")
        XCTAssertEqual(Scanned.parse("http://192.168.1.20:3000/"), .address("http://192.168.1.20:3000"))
        XCTAssertEqual(Scanned.parse(#"WIFI:T:WPA;S:Pub Quiz\;1;P:pa\:ss;;"#), .wifi(ssid: "Pub Quiz;1", password: "pa:ss"))
        XCTAssertEqual(Scanned.parse("WIFI:T:nopass;S:BeerMat;;"), .wifi(ssid: "BeerMat", password: ""))
    }

    func testRehearsalTestDeviceState() throws {
        let json = #"{"protocol":1,"serverTime":1,"build":"b","settings":{"title":"Rehearsal night"},"event":"e","question":null,"teams":[],"team":{"id":"t","name":"Dave's phone","waiting":false},"answer":null,"draft":null,"rehearsal":{"device":true,"connected":true}}"#
        let s = PlayerState.parse(try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any])
        XCTAssertTrue(s.testDevice); XCTAssertNil(s.question); XCTAssertEqual(s.team?.name, "Dave's phone")
    }

    func testQuestionNeverCarriesTheAnswerUntilRevealed() throws {
        let open = Question.parse(try JSONSerialization.jsonObject(with: Data(#"{"id":3,"type":"choice","options":["A","B"],"points":1,"seconds":30,"open":true,"revealed":false}"#.utf8)) as! [String: Any])
        XCTAssertNil(open.answer); XCTAssertEqual(open.options, ["A", "B"]); XCTAssertEqual(open.seconds, 30)
        let revealed = Question.parse(try JSONSerialization.jsonObject(with: Data(#"{"id":3,"type":"multi","answer":["A","B"],"revealed":true}"#.utf8)) as! [String: Any])
        XCTAssertEqual(revealed.answer, "A, B")
    }
}
