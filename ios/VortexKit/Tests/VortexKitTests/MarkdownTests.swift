import Foundation
import XCTest
@testable import VortexKit

final class MarkdownSyntaxTests: XCTestCase {
    private func visible(_ text: String) -> String {
        // What the editor shows: the text minus every hidden range.
        let syntax = MarkdownSyntax(text)
        let ns = text as NSString
        var keep = [Bool](repeating: true, count: ns.length)
        for r in syntax.hidden { for i in r.location..<r.upperBound { keep[i] = false } }
        var out = [unichar]()
        for i in 0..<ns.length where keep[i] { out.append(ns.character(at: i)) }
        return String(utf16CodeUnits: out, count: out.count)
    }

    func testBlocks() {
        let s = MarkdownSyntax("# Title\n## Sub\n- item\n  - [ ] todo\n- [x] done\n1. one\n> quote\n---\n| a | b |\n```\n# not a heading\n```\n\ntext")
        let kinds = s.lines.map(\.kind)
        XCTAssertEqual(kinds, [
            .heading(1), .heading(2), .bullet(depth: 0), .task(depth: 1, checked: false), .task(depth: 0, checked: true),
            .ordered(depth: 0), .quote, .rule, .table, .fence, .code, .fence, .blank, .paragraph,
        ])
        XCTAssertEqual(s.lines[3].box, NSRange(location: 26, length: 3))
    }

    func testVisibleTextHidesMarkers() {
        XCTAssertEqual(visible("# Milanesa ñ\n\nBreaded **meat** with *cheese* and ~~ham~~ `code`."),
                       "Milanesa ñ\n\nBreaded meat with cheese and ham code.")
        XCTAssertEqual(visible("- [ ] eggs\n- [x] milk\n- bread\n> wise"), "eggs\nmilk\nbread\nwise")
        XCTAssertEqual(visible("See [the docs](https://example.com) and [[Clay notes]] or [[kiln|the kiln]]."),
                       "See the docs and Clay notes or the kiln.")
        XCTAssertEqual(visible("1. first\n2. second"), "1. first\n2. second") // numbers stay, like Notes
        XCTAssertEqual(visible("```\n**raw**\n```"), "```\n**raw**\n```")      // code is never styled
    }

    func testLinks() {
        let s = MarkdownSyntax("Go to https://vortex-notes.pages.dev/app, <mailto:a@b.co>, [x](http://e.com \"t\") and [[Note|alias]] `https://no.link`")
        let links = s.inlines.compactMap { i -> String? in
            switch i.kind {
            case .link(let u): u
            case .wikilink(let t): "wiki:" + t
            default: nil
            }
        }
        XCTAssertEqual(Set(links), ["https://vortex-notes.pages.dev/app", "mailto:a@b.co", "http://e.com", "wiki:Note"])
    }

    func testEmphasisEdgeCases() {
        XCTAssertEqual(visible("**unclosed and *ok*"), "**unclosed and ok")
        XCTAssertEqual(visible("snake_case_name stays"), "snake_case_name stays")
        XCTAssertEqual(visible("[**bold link**](https://e.com)"), "bold link")
        XCTAssertEqual(visible("2 * 3 * 4"), "2 * 3 * 4")
        XCTAssertEqual(visible("***both***"), "*both*") // bold wins; the leftover pair is shown, never lost
    }

    func testFixturesNeverChangeText() throws {
        // The scanner only reports ranges; every range must be inside the text.
        let v = try JSONSerialization.jsonObject(with: Data(contentsOf: InteropTests.vectorsURL)) as! [String: Any]
        var samples = (v["merges"] as! [[String: Any]]).flatMap { [$0["base"] as! String, $0["local"] as! String] }
        samples.append((v["locks"] as! [String: Any])["plain"] as! String)
        for text in samples {
            let s = MarkdownSyntax(text)
            let len = (text as NSString).length
            for r in s.hidden + s.inlines.map(\.range) + s.lines.map(\.range) {
                XCTAssertTrue(r.location >= 0 && r.upperBound <= len, "\(r) out of \(len) in \(text.debugDescription)")
            }
        }
    }
}

final class MarkdownEditingTests: XCTestCase {
    private func run(_ edit: TextEdit?, _ text: String) -> (String, Int)? {
        guard let edit else { return nil }
        return (edit.applied(to: text), edit.selection.location)
    }

    func testReturnContinuesLists() {
        XCTAssertEqual(run(MarkdownEditing.returnKey("- [x] eggs", NSRange(location: 10, length: 0)), "- [x] eggs")?.0, "- [x] eggs\n- [ ] ")
        XCTAssertEqual(run(MarkdownEditing.returnKey("  - a", NSRange(location: 5, length: 0)), "  - a")?.0, "  - a\n  - ")
        XCTAssertEqual(run(MarkdownEditing.returnKey("9. a", NSRange(location: 4, length: 0)), "9. a")?.0, "9. a\n10. ")
        XCTAssertEqual(run(MarkdownEditing.returnKey("> a", NSRange(location: 3, length: 0)), "> a")?.0, "> a\n> ")
        // Empty item ends the list.
        let t = "- a\n- "
        XCTAssertEqual(run(MarkdownEditing.returnKey(t, NSRange(location: 6, length: 0)), t)?.0, "- a\n")
        XCTAssertNil(MarkdownEditing.returnKey("plain", NSRange(location: 5, length: 0)))
    }

    func testBackspace() {
        // At the start of an item: the marker goes, the text stays.
        XCTAssertEqual(run(MarkdownEditing.backspace("- [ ] eggs", NSRange(location: 6, length: 0)), "- [ ] eggs")?.0, "eggs")
        XCTAssertEqual(run(MarkdownEditing.backspace("## Head", NSRange(location: 3, length: 0)), "## Head")?.0, "Head")
        // Right after hidden "**": delete the visible letter, keep the bold.
        let b = "a **bold**"
        XCTAssertEqual(run(MarkdownEditing.backspace(b, NSRange(location: 10, length: 0)), b)?.0, "a **bol**")
        XCTAssertNil(MarkdownEditing.backspace("plain", NSRange(location: 3, length: 0)))
    }

    func testFormats() {
        let line = "Groceries"
        XCTAssertEqual(MarkdownEditing.format(.heading, line, NSRange(location: 3, length: 0))?.applied(to: line), "## Groceries")
        XCTAssertEqual(MarkdownEditing.format(.checklist, "a\nb", NSRange(location: 0, length: 3))?.applied(to: "a\nb"), "- [ ] a\n- [ ] b")
        XCTAssertEqual(MarkdownEditing.format(.numbers, "a\nb", NSRange(location: 0, length: 3))?.applied(to: "a\nb"), "1. a\n2. b")
        XCTAssertEqual(MarkdownEditing.format(.bullets, "- a", NSRange(location: 3, length: 0))?.applied(to: "- a"), "a") // toggle off
        XCTAssertEqual(MarkdownEditing.format(.checklist, "- a", NSRange(location: 3, length: 0))?.applied(to: "- a"), "- [ ] a")
        XCTAssertEqual(MarkdownEditing.format(.body, "## H", NSRange(location: 4, length: 0))?.applied(to: "## H"), "H")
        XCTAssertEqual(MarkdownEditing.format(.bold, "a word", NSRange(location: 2, length: 4))?.applied(to: "a word"), "a **word**")
        XCTAssertEqual(MarkdownEditing.format(.bold, "a **word**", NSRange(location: 4, length: 4))?.applied(to: "a **word**"), "a word")
        let empty = MarkdownEditing.format(.italic, "ab", NSRange(location: 1, length: 0))
        XCTAssertEqual(empty?.applied(to: "ab"), "a**b")
        XCTAssertEqual(empty?.selection.location, 2)
        XCTAssertEqual(MarkdownEditing.format(.link, "see docs", NSRange(location: 4, length: 4), url: "https://e.com")?.applied(to: "see docs"), "see [docs](https://e.com)")
        XCTAssertEqual(MarkdownEditing.format(.code, "x = 1", NSRange(location: 0, length: 0))?.applied(to: "x = 1"), "```\nx = 1\n```")
    }

    func testToggleTask() {
        let t = "- [ ] a\n- [x] b"
        let s = MarkdownSyntax(t)
        XCTAssertEqual(MarkdownEditing.toggleTask(t, line: s.lines[0])?.applied(to: t), "- [x] a\n- [x] b")
        XCTAssertEqual(MarkdownEditing.toggleTask(t, line: s.lines[1])?.applied(to: t), "- [ ] a\n- [ ] b")
    }

    func testCaretSnap() {
        let t = "- [ ] eggs\n**b**"
        let s = MarkdownSyntax(t)
        // Tap at the very start of a task line → after the hidden marker.
        XCTAssertEqual(MarkdownEditing.snap(NSRange(location: 0, length: 0), previous: NSRange(location: 14, length: 0), syntax: s)?.location, 6)
        // Arrow left from the content start → end of the previous line (here: none, stays at the marker end).
        XCTAssertEqual(MarkdownEditing.snap(NSRange(location: 5, length: 0), previous: NSRange(location: 6, length: 0), syntax: s)?.location, 6)
        // Inside "**" → to the nearer edge.
        XCTAssertEqual(MarkdownEditing.snap(NSRange(location: 12, length: 0), previous: NSRange(location: 3, length: 0), syntax: s)?.location, 11)
        XCTAssertNil(MarkdownEditing.snap(NSRange(location: 8, length: 0), previous: NSRange(location: 7, length: 0), syntax: s))
    }
}
