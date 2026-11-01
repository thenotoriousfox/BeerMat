#if os(macOS) || os(Linux)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import BeerMatKit

/// The leaderboard reveal on a team's phone, against the real quiz server (tests/fixtures/serve.mjs, needs Node.js): a
/// place shows only once the TV has shown it, the team's own included. As BoardRevealTest.kt in the Android app.
final class BoardRevealTests: XCTestCase {
    private var process: Process?
    private var input: Pipe?

    override func tearDown() { try? input?.fileHandleForWriting.close(); process?.waitUntilExit() }

    func testThePhoneFollowsTheTvsReveal() async throws {
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
        let server = try QuizServer("127.0.0.1:\(ready.int("port"))"), host = ready.str("hostKey")

        let app = try await server.join("Owls")
        var others: [String] = []
        for name in ["Bears", "Cats"] { others.append(try await server.join(name).secret) }
        try await server.host(host, "open", ["text": "Say yes", "type": "text", "answer": "yes", "seconds": 30, "points": 2])
        let q = try await server.state(app.secret).question!
        for s in others { try await server.answer(s, question: q.id, value: "yes") }
        try await server.host(host, "close")
        try await server.host(host, "board", ["action": "show"])

        var state = try await server.state(app.secret)
        XCTAssertEqual(state.board.map(\.name), [], "nothing before the TV shows it")
        XCTAssertEqual(state.boardHidden, 3)
        try await server.host(host, "board", ["action": "next"])
        state = try await server.state(app.secret)
        XCTAssertEqual(state.board.map(\.name), ["Owls"], "last place, the team's own, as on the TV")
        // Bears and Cats tie for first: their moment comes together, and the board is complete.
        try await server.host(host, "board", ["action": "next"])
        state = try await server.state(app.secret)
        XCTAssertEqual(state.board.count, 3); XCTAssertEqual(state.boardHidden, 0)
    }
}
#endif
