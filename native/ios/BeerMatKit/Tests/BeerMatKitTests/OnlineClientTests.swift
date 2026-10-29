#if os(macOS) || os(Linux)
import Foundation
import XCTest
@testable import BeerMatKit

/// The Online client against a real BeerMat Online (tests/fixtures/online.mjs, needs Node.js): an account, a Pro
/// venue's quiz night found by town, and offline the last search comes back marked out of date.
final class OnlineClientTests: XCTestCase {
    private var process: Process?
    private var input: Pipe?

    override func tearDown() { try? input?.fileHandleForWriting.close(); process?.waitUntilExit() }

    private func start() throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../..").standardized
        let p = Process(), output = Pipe(), input = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "--disable-warning=ExperimentalWarning", "tests/fixtures/online.mjs"]
        p.currentDirectoryURL = root; p.standardOutput = output; p.standardInput = input
        do { try p.run() } catch { throw XCTSkip("Node.js is needed for this test") }
        process = p; self.input = input
        func line() throws -> Data { var d = Data(); while let b = try output.fileHandleForReading.read(upToCount: 1), !b.isEmpty, b != Data("\n".utf8) { d.append(b) }; return d }
        let port = (try JSONSerialization.jsonObject(with: try line()) as! [String: Any])["port"] as! NSNumber
        input.fileHandleForWriting.write(Data("pro red-lion-bristol\nevent red-lion-bristol Halloween special\n".utf8))
        _ = try line(); _ = try line()
        return "http://127.0.0.1:\(port)"
    }

    func testAccountSearchAndOffline() async throws {
        let base = try start(), storage = MemoryStorage()
        let client = OnlineClient(baseUrl: base, storage: storage)
        let account = try await client.signUp(email: "ios@example.com", password: "correct horse battery", displayName: "Ira")
        XCTAssertEqual(account["displayName"] as? String, "Ira"); XCTAssertTrue(client.signedIn)
        let found = try await client.findEvents(q: "Bristol")
        XCTAssertEqual((found["events"] as? [[String: Any]])?.first?["title"] as? String, "Halloween special")
        // Offline: the same search comes back from the last results, marked stale.
        client.baseUrl = "http://127.0.0.1:9"
        let cached = try await client.findEvents(q: "Bristol")
        XCTAssertEqual(cached["stale"] as? Bool, true)
        // A result kept while offline waits in the outbox.
        let waiting = try await client.saveResult(["event": "e1", "team": "t1", "v": 1])
        XCTAssertEqual(waiting.waiting, 1)
    }

    func testBadgesMatchTheServer() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../..").standardized
        let p = Process(), output = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "-e", "import('./shared/achievements.js').then(m => console.log(JSON.stringify(m.badges.map(({id, name, description}) => ({id, name, description})))))"]
        p.currentDirectoryURL = root; p.standardOutput = output
        do { try p.run() } catch { throw XCTSkip("Node.js is needed for this test") }
        p.waitUntilExit()
        let expected = try JSONSerialization.jsonObject(with: output.fileHandleForReading.readDataToEndOfFile()) as! [[String: String]]
        let bundled = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("native/ios/BeerMat/badges.json"))) as! [[String: String]]
        XCTAssertEqual(expected, bundled, "copy native/android/app/src/main/assets/badges.json (regenerated from shared/achievements.js)")
    }
}
#endif
