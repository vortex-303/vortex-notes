import XCTest

/// Every note shows in the list (top level, folders, nested folders, daily), with a small folder
/// tag above the title; View → By folder groups them under folder headers like the web sidebar.
/// The peer writes: alpha.md, zeta/plan.md, projects/kiln/firing.md, daily/2026-10-29.md.
final class FolderViewUITests: XCTestCase {
    func testAllNotesAndFolderView() throws {
        let env = ProcessInfo.processInfo.environment
        guard let relay = env["VORTEX_RELAY"], let phrase = env["VORTEX_TEST_PHRASE"] else {
            throw XCTSkip("set TEST_RUNNER_VORTEX_RELAY and TEST_RUNNER_VORTEX_TEST_PHRASE")
        }
        let app = XCUIApplication()
        app.launchEnvironment = ["VORTEX_RELAY": relay, "VORTEX_TEST_PHRASE": phrase]
        app.launch()
        XCTAssertTrue(app.navigationBars["Notes"].waitForExistence(timeout: 20))
        for title in ["Alpha", "Plan", "Firing", "2026-10-29"] {
            XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 15), "\(title) is listed")
        }
        XCTAssertTrue(app.staticTexts["projects/kiln"].exists, "folder tag above a nested note's title")
        attach(app, "all-notes")

        app.buttons["viewMenu"].tap()
        app.buttons["By folder"].tap()
        for folder in ["", "daily", "projects/kiln", "zeta"] {
            XCTAssertTrue(app.otherElements["folder:\(folder)"].waitForExistence(timeout: 5) || app.staticTexts[folder.isEmpty ? "No folder" : folder].exists,
                          "header for \(folder.isEmpty ? "No folder" : folder)")
        }
        for title in ["Alpha", "Plan", "Firing", "2026-10-29"] { XCTAssertTrue(app.staticTexts[title].exists, "\(title) still listed") }
        attach(app, "by-folder")

        app.buttons["viewMenu"].tap()
        app.buttons["Name"].tap()
        attach(app, "by-folder-name")
        app.buttons["viewMenu"].tap()
        app.buttons["All notes"].tap()
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
