#if os(macOS) || os(Linux)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import BeerMatKit

/// Run the night (the phone deck) against the real quiz server (tests/fixtures/serve.mjs, needs Node.js): the phone
/// signs in with the desk's code, reads the quiz as DeckState, and opens, closes and reveals a question as the Qt desk
/// does; the desk lists it and takes it off. As DeckIntegrationTest.kt in the Android app.
final class DeckTests: XCTestCase {
    private var process: Process?
    private var input: Pipe?

    override func tearDown() { try? input?.fileHandleForWriting.close(); process?.waitUntilExit() }

    func testFinderTriesTheLastAddressTheHotspotThenTheNetwork() {
        let places = DeckFinder.candidates(saved: "192.168.1.20:3000", own: "192.168.1.31")
        XCTAssertEqual(Array(places.prefix(3)), ["http://192.168.1.20:3000", "http://10.42.0.1", "http://10.42.0.1:3000"])
        XCTAssertEqual(places.count, 3 + 253 - 1, "the saved address isn't asked twice")
        XCTAssertFalse(places.contains("http://192.168.1.31:3000"))
    }

    func testAPhoneHostsTheQuizWithTheDesksCode() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../..").standardized
        let p = Process(), output = Pipe(), input = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "--disable-warning=ExperimentalWarning", "tests/fixtures/serve.mjs", "pro"]
        p.currentDirectoryURL = root; p.standardOutput = output; p.standardInput = input
        do { try p.run() } catch { throw XCTSkip("Node.js is needed for this test") }
        process = p; self.input = input
        var line = Data()
        while let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty, byte != Data("\n".utf8) { line.append(byte) }
        let ready = try JSONSerialization.jsonObject(with: line) as! [String: Any]
        let server = try QuizServer("127.0.0.1:\(ready.int("port"))"), desk = ready.str("hostKey")

        let hello = try await server.deckHello()
        XCTAssertFalse(hello.str("venueKey").isEmpty)
        do { _ = try await server.deckLogin(name: "Phone", code: "000000"); XCTFail("no code shown yet") } catch let e as QuizError { XCTAssertEqual(e.status, 403) }
        let code = try await server.host(desk, "deck-code").str("code")
        let key = try await server.deckLogin(name: "Dan’s phone", code: code)

        var d = DeckState.parse(try await server.host(key, "state"))
        XCTAssertEqual(d.nextStep, "question"); XCTAssertTrue(d.canNext); XCTAssertNil(d.question); XCTAssertFalse(d.deskOpen)
        try await server.host(key, "next", ["expectedQuestion": NSNull()])
        d = DeckState.parse(try await server.host(key, "state"))
        let q = try XCTUnwrap(d.question)
        XCTAssertEqual(q.text, "Which planet is known as the Red Planet?"); XCTAssertEqual(q.answer, "Mars")
        XCTAssertTrue(d.canClose); XCTAssertFalse(d.canNext, "Next waits while the question is open")
        try await server.host(key, "close", ["expectedQuestion": q.id])
        d = DeckState.parse(try await server.host(key, "state"))
        XCTAssertTrue(d.canReveal)
        try await server.host(key, "reveal", ["question": q.id, "revealed": true, "delay": 0])
        d = DeckState.parse(try await server.host(key, "state"))
        XCTAssertTrue(d.question?.revealed == true); XCTAssertTrue(d.canNext); XCTAssertNotNil(d.back)

        // Clips and songs play from the laptop: with no desk open, the phone is told so.
        do { try await server.host(key, "deck-command", ["action": "playClips"]); XCTFail("no desk") } catch let e as QuizError { XCTAssertEqual(e.status, 409) }

        let decks = try await server.host(desk, "state")["decks"] as? [[String: Any]] ?? []
        XCTAssertEqual(decks.first?.str("name"), "Dan’s phone")
        try await server.host(desk, "deck/disconnect", ["id": decks.first?.str("id") ?? ""])
        do { try await server.host(key, "state"); XCTFail("taken off") } catch let e as QuizError { XCTAssertEqual(e.status, 403) }
    }
}
#endif
