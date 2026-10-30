import Foundation
import XCTest
@testable import VortexKit

final class Diff3Tests: XCTestCase {
    /// Every case must merge (or refuse) exactly like the CLI's tryDiff3.
    func testMatchesNodeDiff3() throws {
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: InteropTests.vectorsURL)) as! [String: Any]
        let cases = v["merges"] as! [[String: Any]]
        XCTAssertGreaterThan(cases.count, 400)
        for (i, c) in cases.enumerated() {
            let got = Diff3.merge(base: c["base"] as! String, local: c["local"] as! String, remote: c["remote"] as! String)
            XCTAssertEqual(got, c["merged"] as? String, "case \(i): \(c)")
        }
    }
}

final class NoteTextTests: XCTestCase {
    func testCreatedFromFrontmatter() {
        let ms = { (s: String) in NoteText.created(s).map { Int64($0.timeIntervalSince1970 * 1000) } }
        XCTAssertEqual(ms("---\ntitle: T\ncreated: '2026-10-29T12:34:56.789Z'\n---\n\nbody"), 1_793_277_296_789)
        XCTAssertEqual(ms("---\ncreated: 2026-10-29T12:34:56Z\n---\n"), 1_793_277_296_000)
        XCTAssertNotNil(ms("---\ncreated: 2026-10-29\n---\n"))
        XCTAssertNil(ms("no frontmatter"))
        let row = NoteRow(path: "a.md", content: "x", mtimeMs: 42, syncedHash: nil, base: nil, deleted: false)
        XCTAssertEqual(row.createdMs, 42)
    }
}

final class NoteStoreTests: XCTestCase {
    func testCreateNoteUniquePathsAndTemplate() throws {
        let store = try NoteStore()
        let a = try store.createNote(title: "Buy milk ñ", body: "Buy milk ñ and eggs")
        let b = try store.createNote(title: "Buy milk ñ", body: "again")
        XCTAssertEqual(a, "buy-milk-n.md")
        XCTAssertEqual(b, "buy-milk-n-2.md")
        let row = try XCTUnwrap(store.note(a))
        XCTAssertEqual(row.title, "Buy milk ñ")
        XCTAssertNotNil(NoteText.created(row.content))
        XCTAssertTrue(row.isDirty)
    }

    func testAppendDailyCreatesThenAppends() throws {
        let store = try NoteStore()
        let now = Date(timeIntervalSince1970: 1_793_277_296)
        let path = try store.appendDaily("one", now: now)
        try store.appendDaily("two", now: now.addingTimeInterval(60))
        XCTAssertEqual(path, "daily/2026-10-29.md")
        XCTAssertEqual(store.note(path)?.content, "---\ntitle: 2026-10-29\ntags:\n  - daily\n---\n\n- **12:34** one\n- **12:35** two\n")
    }
}
