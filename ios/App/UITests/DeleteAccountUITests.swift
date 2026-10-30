import XCTest

/// Settings → Delete Account…: after confirming, the app is back at onboarding (the caller then
/// checks the relay holds nothing for the account). Same relay setup as SmokeUITests.
final class DeleteAccountUITests: XCTestCase {
    func testDeleteAccountFromSettings() throws {
        let env = ProcessInfo.processInfo.environment
        guard let relay = env["VORTEX_RELAY"], let phrase = env["VORTEX_TEST_PHRASE"] else {
            throw XCTSkip("set TEST_RUNNER_VORTEX_RELAY and TEST_RUNNER_VORTEX_TEST_PHRASE")
        }
        let app = XCUIApplication()
        app.launchEnvironment = ["VORTEX_RELAY": relay, "VORTEX_TEST_PHRASE": phrase]
        app.launch()
        XCTAssertTrue(app.navigationBars["Notes"].waitForExistence(timeout: 20))

        app.tabBars.buttons["Settings"].tap()
        let delete = app.buttons["deleteAccount"]
        for _ in 0..<4 where !(delete.exists && delete.isHittable) { app.swipeUp() } // it's at the bottom of the form
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        let confirm = app.buttons["Delete Account"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "a confirmation is required")
        attach(app, "confirm-delete")
        confirm.tap()

        // Signed out: the welcome screen offers sign-in again.
        XCTAssertTrue(app.buttons["Sign in with my 12 words"].waitForExistence(timeout: 15), "back at onboarding")
        attach(app, "after-delete")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
