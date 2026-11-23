#if os(macOS) || os(Linux)
import Foundation
import XCTest

/// The app's words come from web/i18n.js, the dictionary the browser player and the TV use.
final class I18nTests: XCTestCase {
    private let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../..").standardized
    private var bundled: [String: [String]] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("native/ios/BeerMat/i18n.json")))) as? [String: [String]] ?? [:] }

    func testDictionaryMatchesTheWebPlayer() throws {
        let p = Process(), output = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["node", "-e", "import('./web/i18n.js').then(m => console.log(JSON.stringify(m.translations)))"]
        p.currentDirectoryURL = root; p.standardOutput = output
        do { try p.run() } catch { throw XCTSkip("Node.js is needed for this test") }
        p.waitUntilExit()
        let expected = try JSONSerialization.jsonObject(with: output.fileHandleForReading.readDataToEndOfFile()) as! [String: [String]]
        XCTAssertEqual(expected, bundled, "run scripts/export-i18n.mjs")
    }

    func testEveryPhraseTheAppUsesIsTranslated() throws {
        // t("…") in the app's sources must name a phrase in the dictionary, or players would see English.
        let folder = root.appendingPathComponent("native/ios/BeerMat")
        let pattern = try NSRegularExpression(pattern: #"\bt\("((?:[^"\\]|\\.)*)""#)
        var missing: [String] = []
        for name in try FileManager.default.contentsOfDirectory(atPath: folder.path) where name.hasSuffix(".swift") {
            let text = try String(contentsOf: folder.appendingPathComponent(name), encoding: .utf8)
            for m in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                let phrase = String(text[Range(m.range(at: 1), in: text)!])
                if bundled[phrase] == nil { missing.append("\(name): \(phrase)") }
            }
        }
        XCTAssertEqual(missing, [])
    }
}
#endif
