import XCTest

/// The live markdown editor on a real relay. Needs TEST_RUNNER_VORTEX_RELAY / _VORTEX_TEST_PHRASE,
/// and a note "Kiln notes" (see ios/README.md).
final class EditorUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        let env = ProcessInfo.processInfo.environment
        guard let relay = env["VORTEX_RELAY"], let phrase = env["VORTEX_TEST_PHRASE"] else {
            throw XCTSkip("set TEST_RUNNER_VORTEX_RELAY and TEST_RUNNER_VORTEX_TEST_PHRASE")
        }
        app = XCUIApplication()
        app.launchEnvironment = ["VORTEX_RELAY": relay, "VORTEX_TEST_PHRASE": phrase]
        app.launch()
    }

    func openKiln() -> XCUIElement {
        let row = app.buttons.containing(.staticText, identifier: "Kiln notes").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        return editor
    }

    func testRendersWithoutKeyboard() {
        _ = openKiln()
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 1.5), "opening a note must not raise the keyboard")
        attach("editor")
    }

    /// Tap at a point in iPhone 17 Pro points (layout from the Kiln note screenshot).
    func tap(_ x: CGFloat, _ y: CGFloat) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
    }

    func testInteractions() {
        let editor = openKiln()
        let original = editor.value as? String ?? ""
        XCTAssertTrue(original.contains("- [ ] order shelves"))

        // 1. Checkbox: toggles in the markdown, no keyboard.
        tap(25, 295)
        XCTAssertTrue(waitFor { (editor.value as? String ?? "").contains("- [x] order shelves") }, "checkbox toggled")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "checkbox tap must not raise the keyboard")
        attach("checked")

        // 2. Markdown link opens Safari; coming back, no keyboard.
        tap(157, 422)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10), "link opened Safari")
        app.activate()
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 1.5), "link tap must not raise the keyboard")

        // 3. Bare URL opens Safari too.
        tap(192, 446)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10), "bare URL opened Safari")
        app.activate()

        // 4. Wikilink opens the note.
        tap(116, 470)
        XCTAssertTrue(app.navigationBars["Clay notes"].waitForExistence(timeout: 5), "wikilink opened Clay notes")
        attach("wikilink")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // 5. Typing at the end of a paragraph edits only that line.
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        tap(118, 215)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "tapping text raises the keyboard")
        app.typeText(" Truly.")
        attach("typed")

        // 6. The CLI (driven by the test runner script) edits another line meanwhile: both survive.
        XCTAssertTrue(waitFor(timeout: 60) { (editor.value as? String ?? "").contains("brushes") }, "remote edit arrived in the open note")
        let final = editor.value as? String ?? ""
        XCTAssertTrue(final.contains("fine. Truly."), "local edit kept")
        attach("merged")
    }

    func testListsAaAndRawMode() {
        let row = app.buttons.containing(.staticText, identifier: "Clay notes").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))

        // Tap the end of the body line, start a checklist from the Aa bar, Return continues it.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 330, dy: 196)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("\nglaze")
        app.buttons["Checklist"].tap()
        app.typeText("\nbrushes")
        XCTAssertTrue(waitFor { (editor.value as? String ?? "").contains("- [ ] glaze\n- [ ] brushes") }, "Return continues the checklist")
        // Return on the empty item ends the list.
        app.typeText("\n\nDone.")
        XCTAssertTrue(waitFor { (editor.value as? String ?? "").contains("- [ ] brushes\n\nDone.") || (editor.value as? String ?? "").contains("- [ ] brushes\nDone.") }, "empty item ends the list")

        // Aa → Heading on the current line.
        app.buttons["Format"].tap()
        app.buttons["Heading"].tap()
        XCTAssertTrue(waitFor { (editor.value as? String ?? "").contains("## Done.") }, "Aa → Heading")
        attach("lists")

        // ⋯ → Edit markdown shows the raw text.
        app.buttons["Hide keyboard"].tap()
        app.buttons["Note menu"].tap()
        app.buttons["Edit markdown"].tap()
        attach("raw")
        app.buttons["Note menu"].tap()
        app.buttons["Rich text"].tap()
    }

    func testNoGhostCheckboxAndSpacing() {
        let row = app.buttons.containing(.staticText, identifier: "Clay notes").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        // Tap below the text → caret at the end; start a fresh checklist.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("\nfirst")
        app.buttons["Checklist"].tap()
        app.typeText("\nsecond\nthird")
        // Delete "third", then backspace once more: its checkbox must go away completely.
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        app.typeText("a plain line")
        XCTAssertTrue(waitFor { (editor.value as? String ?? "").contains("- [ ] second\na plain line") }, "marker removed")
        attach("ghost-check")
    }

    func waitFor(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if cond() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return cond()
    }

    func attach(_ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
