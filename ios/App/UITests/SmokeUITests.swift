import XCTest

/// Drives the real app against a relay. Needs VORTEX_RELAY and VORTEX_TEST_PHRASE
/// (passed through as TEST_RUNNER_ env vars); see ios/README.md.
final class SmokeUITests: XCTestCase {
    func testCaptureAndRead() throws {
        let env = ProcessInfo.processInfo.environment
        guard let relay = env["VORTEX_RELAY"], let phrase = env["VORTEX_TEST_PHRASE"] else {
            throw XCTSkip("set TEST_RUNNER_VORTEX_RELAY and TEST_RUNNER_VORTEX_TEST_PHRASE")
        }
        let app = XCUIApplication()
        app.launchEnvironment = ["VORTEX_RELAY": relay, "VORTEX_TEST_PHRASE": phrase]
        app.launch()
        XCTAssertTrue(app.navigationBars["Notes"].waitForExistence(timeout: 20)) // Notes is the first tab now
        attach(app, "launch")
        app.tabBars.buttons["Capture"].tap()
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 1.5), "keyboard must wait for a tap")
        attach(app, "capture-idle")

        let field = app.textFields["What's on your mind?"].firstMatch.exists
            ? app.textFields["What's on your mind?"].firstMatch
            : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Typed in the simulator by XCUITest")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Typed in the simulator by XCUITest"].waitForExistence(timeout: 5))
        attach(app, "capture")
        app.buttons["Hide keyboard"].tap() // keyboard stays up for rapid capture; dismiss it

        app.tabBars.buttons["Notes"].tap()
        let milanesa = app.buttons.containing(.staticText, identifier: "Milanesa napolitana").firstMatch
        XCTAssertTrue(milanesa.waitForExistence(timeout: 10))
        // Pin the recipe: swipe right on its row.
        milanesa.swipeRight()
        app.buttons["Pin to top"].tap()
        XCTAssertTrue(app.images["Pinned"].waitForExistence(timeout: 5))
        attach(app, "notes")
        milanesa.tap()
        let editor = app.textViews["noteEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertTrue((editor.value as? String ?? "").contains("## Ingredients"))
        attach(app, "reader")

        app.tabBars.buttons["Search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("cheese\n")
        XCTAssertTrue(app.staticTexts["Milanesa napolitana"].waitForExistence(timeout: 5))
        attach(app, "search")

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Fingerprint"].waitForExistence(timeout: 5))
        attach(app, "settings")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
