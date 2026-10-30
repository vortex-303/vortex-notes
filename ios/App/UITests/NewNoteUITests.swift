import XCTest

/// New Note, the Apple Notes way: a blank note opens with the keyboard up, the first line
/// becomes the title, and a note left empty disappears. Same relay setup as SmokeUITests.
final class NewNoteUITests: XCTestCase {
    func testNewNoteTitleAndEmptyDiscard() throws {
        let env = ProcessInfo.processInfo.environment
        guard let relay = env["VORTEX_RELAY"], let phrase = env["VORTEX_TEST_PHRASE"] else {
            throw XCTSkip("set TEST_RUNNER_VORTEX_RELAY and TEST_RUNNER_VORTEX_TEST_PHRASE")
        }
        let app = XCUIApplication()
        app.launchEnvironment = ["VORTEX_RELAY": relay, "VORTEX_TEST_PHRASE": phrase]
        app.launch()
        XCTAssertTrue(app.navigationBars["Notes"].waitForExistence(timeout: 20))

        // New note: caret ready, type a title line and a body line.
        app.buttons["newNote"].tap()
        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "a new note opens with the keyboard up")
        editor.typeText("Shopping list\nmilk")
        attach(app, "new-note-typed")
        app.navigationBars.buttons.element(boundBy: 0).tap() // back to Notes

        // The first line is the title in the list.
        XCTAssertTrue(app.staticTexts["Shopping list"].waitForExistence(timeout: 5), "first line becomes the title")
        attach(app, "list-with-new-note")

        // A new note left empty is thrown away.
        let rowsBefore = app.cells.count
        app.buttons["newNote"].tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Notes"].waitForExistence(timeout: 5))
        sleep(1)
        XCTAssertEqual(app.cells.count, rowsBefore, "an empty new note is discarded")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Note 20'")).firstMatch.exists)
        sleep(4) // let the background sync push before the app is torn down (the peer checks it)
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
