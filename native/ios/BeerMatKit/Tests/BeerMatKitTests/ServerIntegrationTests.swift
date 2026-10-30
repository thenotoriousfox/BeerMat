#if os(macOS) || os(Linux)
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import BeerMatKit

/// The app's client against the real quiz server (tests/fixtures/serve.mjs, needs Node.js on the PATH): a live quiz on
/// Pro played by this client and a browser-style team, scored alike; and a rehearsal on Free where this client is a
/// test device the server keeps out of the game. Runs on the Mac (or Linux) that runs the tests, not on a phone.
final class ServerIntegrationTests: XCTestCase {
    private var process: Process?
    private var input: Pipe?

    private func start(_ plan: String) throws -> (QuizServer, String) {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../..").standardized
        let p = Process(), output = Pipe(), input = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "--disable-warning=ExperimentalWarning", "tests/fixtures/serve.mjs", plan]
        p.currentDirectoryURL = root
        p.standardOutput = output; p.standardInput = input
        do { try p.run() } catch { throw XCTSkip("Node.js is needed for this test") }
        process = p; self.input = input
        var line = Data()
        while let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty, byte != Data("\n".utf8) { line.append(byte) }
        let ready = try JSONSerialization.jsonObject(with: line) as! [String: Any]
        return (try QuizServer("127.0.0.1:\(ready.int("port"))"), ready.str("hostKey"))
    }

    override func tearDown() { try? input?.fileHandleForWriting.close(); process?.waitUntilExit() }

    /// The quizmaster's side, and a browser's: plain HTTP, as web/host.js and web/client.js send it.
    @discardableResult
    private func call(_ server: QuizServer, _ route: String, _ body: [String: Any], _ key: String) async throws -> [String: Any] {
        var r = URLRequest(url: URL(string: server.base + route)!)
        r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: r)
        let status = (response as! HTTPURLResponse).statusCode
        guard status < 300 else { throw QuizError(message: "\(route): \(String(decoding: data, as: UTF8.self))", status: status) }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    func testLiveQuizAppAndBrowserScoredAlike() async throws {
        let (server, host) = try start("pro")
        let hello = try await server.hello()
        XCTAssertEqual(hello.proto, 1); XCTAssertFalse(hello.rehearsal)
        let app = try await server.join("iPhone Inquisitors")
        let browser = try await call(server, "/api/join", ["name": "Browser Brains"], "").str("secret")

        try await call(server, "/api/host/next", ["expectedQuestion": NSNull()], host)
        let q = try await server.state(app.secret).question!
        XCTAssertEqual(q.type, "choice"); XCTAssertNil(q.answer)
        try await server.answer(app.secret, question: q.id, value: "Mars")
        try await call(server, "/api/answer", ["question": q.id, "value": "Venus"], browser)
        do { try await server.answer(app.secret, question: q.id, value: "Venus"); XCTFail("a second answer must be refused") } catch let e as QuizError { XCTAssert((400..<500).contains(e.status)) }

        try await call(server, "/api/host/close", ["expectedQuestion": q.id], host)
        try await call(server, "/api/host/reveal", ["question": q.id, "revealed": true, "delay": 0], host)
        let after = try await server.state(app.secret)
        XCTAssertEqual(after.question?.answer, "Mars"); XCTAssertEqual(after.answer?.points, 1)
        let board = Dictionary(uniqueKeysWithValues: after.teams.map { ($0.name, $0.score) })
        XCTAssertEqual(board["iPhone Inquisitors"], 1); XCTAssertEqual(board["Browser Brains"], 0)
    }

    /// Send Question, six fixed buttons, the table number at join and music bingo's reaction table, as this app sends them.
    func testSendQuestionFixedSixTablesAndReactions() async throws {
        let (server, host) = try start("pro")
        try await call(server, "/api/host/settings", ["askTable": true, "sendQuestion": true, "fixedSix": true], host)
        let hello = try await server.hello()
        XCTAssertTrue(hello.askTable)
        let app = try await server.join("iPhone Inquisitors", table: 9)
        let teams = try await call(server, "/api/host/state", [:], host)["teams"] as! [[String: Any]]
        XCTAssertEqual(teams.first { $0.str("name") == "iPhone Inquisitors" }?.int("table_no"), 9)

        try await call(server, "/api/host/open", ["text": "Red planet?", "type": "choice", "options": ["Venus", "Mars"], "answer": "Mars", "seconds": 30, "points": 1], host)
        let held = try await server.state(app.secret).question!
        XCTAssertTrue(held.held); XCTAssertEqual(held.text, ""); XCTAssertTrue(held.options.isEmpty)
        try await call(server, "/api/host/send", [:], host)
        let sent = try await server.state(app.secret).question!
        XCTAssertFalse(sent.held); XCTAssertTrue(sent.open); XCTAssertTrue(sent.fixedSix)
        try await server.answer(app.secret, question: sent.id, value: "#E")
        try await call(server, "/api/host/close", [:], host)
        let marked = try await server.state(app.secret)
        XCTAssertEqual(marked.teams.first { $0.name == "iPhone Inquisitors" }?.score, 0)

        try await call(server, "/api/host/settings", ["sendQuestion": false], host)
        let songs = (1...15).map { ["title": "Song \($0)"] }
        try await call(server, "/api/host/open", ["text": "Music bingo", "type": "musicbingo", "mode": "line", "songs": songs, "reactions": true, "seconds": 600, "points": 3], host)
        let q = try await server.state(app.secret).question!
        let number = try await call(server, "/api/host/bingo", ["question": q.id], host).int("number")
        try await server.react(app.secret, question: q.id, title: "Song \(number)")
        let table = try await server.state(app.secret).question!.raw["reactionTable"] as! [String: Any]
        XCTAssertEqual((table["now"] as! [[String: Any]]).first?.str("name"), "iPhone Inquisitors")
        do { try await server.react(app.secret, question: q.id, title: nil); XCTFail("one go per song") } catch let e as QuizError { XCTAssertEqual(e.status, 409) }
    }

    func testRehearsalKeepsTheAppOutOfTheGame() async throws {
        let (server, host) = try start("free")
        let hello = try await server.hello()
        XCTAssertTrue(hello.rehearsal)
        try await call(server, "/api/host/rehearsal/start", ["options": ["teams": 2, "auto": false]], host)
        let phone = try await server.join("Test iPhone")
        XCTAssertTrue(phone.rehearsal)
        try await call(server, "/api/host/next", ["expectedQuestion": NSNull()], host)
        let state = try await server.state(phone.secret)
        XCTAssertTrue(state.testDevice); XCTAssertNil(state.question)
        for attempt in [{ try await server.answer(phone.secret, question: 1, value: "Mars") }, { try await server.buzz(phone.secret, question: 1) }] as [() async throws -> Void] {
            do { try await attempt(); XCTFail("the server must refuse a test device") } catch let e as QuizError { XCTAssertEqual(e.status, 403) }
        }
    }
}
#endif
