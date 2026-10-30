import Foundation
import XCTest
@testable import VortexKit

/// End to end against a real local relay (src/relay/server.ts) with the real
/// TypeScript CLI as the other machine (test/ios-peer.ts). Needs node + the
/// repo's node_modules; skipped unless VORTEX_LIVE=1.
///
///   VORTEX_LIVE=1 swift test --filter LiveRelayTests
final class LiveRelayTests: XCTestCase {
    var tmp: URL!
    var relayProcess: Process!
    var relayURL: URL!
    var cliHome: String { tmp.appendingPathComponent("cli-home").path }
    var cliVault: String { tmp.appendingPathComponent("cli-vault").path }
    var relayDB: URL { tmp.appendingPathComponent("relay.db") }

    override func setUp() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["VORTEX_LIVE"] == "1", "set VORTEX_LIVE=1 to run")
        tmp = FileManager.default.temporaryDirectory.appendingPathComponent("vortex-live-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let (process, firstLine) = try startPeer(["relay", relayDB.path])
        relayProcess = process
        let port = try XCTUnwrap(try JSValue.parse(Data(firstLine.utf8))["port"]?.int)
        relayURL = URL(string: "http://127.0.0.1:\(port)")!
    }

    override func tearDown() async throws {
        relayProcess?.terminate()
        relayProcess?.waitUntilExit()
        if let tmp { try? FileManager.default.removeItem(at: tmp) }
    }

    func testSwiftAndCLIStayInSync() async throws {
        // Machine 1 = CLI: new account with two notes.
        let phrase = try XCTUnwrap(try peer(["init", cliHome, cliVault, relayURL.absoluteString])["phrase"]?.string)
        try peer(["write", cliVault, "ideas.md", "# Ideas\n\nfirst\nsecond\nthird\n"])
        try peer(["write", cliVault, "Recetas/Milanesa ñ (v2) ~!'*.md", "# Milanesa\n\nZEBRA-PLAINTEXT-CANARY\n"])
        try peer(["write", cliVault, "old.md", "to be deleted by swift\n"])
        try peer(["write", cliVault, "contested.md", "keep me\n"])
        try peer(["sync", cliHome, cliVault])

        // Machine 2 = Swift: sign in with the 12 words, pull everything.
        let session = try await Enrollment.signIn(phrase: phrase, relay: relayURL, deviceName: "iPhone · test")
        let store = try NoteStore()
        let engine = SyncEngine(store: store, client: RelayClient(baseURL: relayURL, identity: session.identity),
                                spaceId: session.spaceId, spaceKey: session.spaceKey)
        var r = try await engine.sync()
        XCTAssertEqual(r.pulled, 4)
        XCTAssertEqual(store.find("Recetas/Milanesa ñ (v2) ~!'*.md")?.content, "# Milanesa\n\nZEBRA-PLAINTEXT-CANARY\n")

        // Capture + edit + delete on Swift → CLI sees them.
        let daily = try store.appendDaily("captured on the phone 📱")
        try store.write("ideas.md", content: "# Ideas\n\nfirst\nsecond\nthird\nfrom swift\n")
        try store.delete("old.md")
        r = try await engine.sync()
        XCTAssertEqual(r.pushed, 3)
        try peer(["sync", cliHome, cliVault])
        XCTAssertEqual(try cliRead(daily), store.note(daily)?.content)
        XCTAssertTrue(try cliRead(daily)?.contains("captured on the phone 📱") == true)
        XCTAssertEqual(try cliRead("ideas.md"), "# Ideas\n\nfirst\nsecond\nthird\nfrom swift\n")
        XCTAssertNil(try cliRead("old.md"))

        // Concurrent, non-overlapping edits merge on both sides.
        try peer(["write", cliVault, "ideas.md", "# Ideas!\n\nfirst\nsecond\nthird\nfrom swift\n"])
        try peer(["sync", cliHome, cliVault])
        try store.write("ideas.md", content: "# Ideas\n\nfirst\nsecond\nthird\nfrom swift\nmore from swift\n")
        r = try await engine.sync()
        XCTAssertEqual(r.conflicts, [])
        let merged = "# Ideas!\n\nfirst\nsecond\nthird\nfrom swift\nmore from swift\n"
        XCTAssertEqual(store.note("ideas.md")?.content, merged)
        try peer(["sync", cliHome, cliVault])
        XCTAssertEqual(try cliRead("ideas.md"), merged)

        // Overlapping edits: the newer (Swift) wins, the CLI's version survives as a conflict file.
        try peer(["write", cliVault, "ideas.md", merged.replacingOccurrences(of: "second", with: "SECOND (cli)")])
        try peer(["sync", cliHome, cliVault])
        try await Task.sleep(nanoseconds: 50_000_000)
        try store.write("ideas.md", content: merged.replacingOccurrences(of: "second", with: "SECOND (swift)"))
        r = try await engine.sync()
        XCTAssertEqual(r.conflicts.count, 1)
        XCTAssertTrue(store.note(r.conflicts[0])?.content.contains("SECOND (cli)") == true)
        XCTAssertTrue(store.note("ideas.md")?.content.contains("SECOND (swift)") == true)
        try peer(["sync", cliHome, cliVault])
        XCTAssertTrue(try cliRead("ideas.md")?.contains("SECOND (swift)") == true)
        XCTAssertTrue(try cliRead(r.conflicts[0])?.contains("SECOND (cli)") == true)

        // An edit beats a delete: CLI deletes, Swift had edited → note comes back everywhere.
        try store.write("contested.md", content: "keep me\nedited on the phone\n")
        try peer(["rm", cliVault, "contested.md"])
        try peer(["sync", cliHome, cliVault])
        r = try await engine.sync()
        XCTAssertEqual(store.note("contested.md")?.content, "keep me\nedited on the phone\n")
        try peer(["sync", cliHome, cliVault])
        XCTAssertEqual(try cliRead("contested.md"), "keep me\nedited on the phone\n")

        // Paging: more than one 500-update page.
        try peer(["bulk", cliVault, "620"])
        try peer(["sync", cliHome, cliVault])
        r = try await engine.sync()
        XCTAssertEqual(r.pulled, 620)
        XCTAssertEqual(store.notes().filter { $0.path.hasPrefix("bulk/") }.count, 620)
        let cliFiles = try peer(["ls", cliVault])["files"]
        guard case .array(let files)? = cliFiles else { return XCTFail("ls") }
        XCTAssertEqual(Set(files.compactMap(\.string)), Set(store.notes().map(\.path)))

        // Quiet when nothing changed.
        r = try await engine.sync()
        XCTAssertEqual(r, SyncResult())

        // Relaunch without the phrase: the device seal opens the same space.
        let resumed = try await Enrollment.resume(identity: try DeviceIdentity(serialized: session.identity.serialized()), relay: relayURL)
        XCTAssertEqual(resumed.spaceKey, session.spaceKey)

        // The relay never saw plaintext.
        for suffix in ["", "-wal"] {
            let bytes = (try? Data(contentsOf: URL(fileURLWithPath: relayDB.path + suffix))) ?? Data()
            XCTAssertNil(bytes.range(of: Data("ZEBRA-PLAINTEXT-CANARY".utf8)), "plaintext in relay.db\(suffix)")
            XCTAssertNil(bytes.range(of: Data("captured on the phone".utf8)), "plaintext in relay.db\(suffix)")
        }
    }

    func testLiveChannelPokesOnRemoteWrite() async throws {
        let phrase = try XCTUnwrap(try peer(["init", cliHome, cliVault, relayURL.absoluteString])["phrase"]?.string)
        let session = try await Enrollment.signIn(phrase: phrase, relay: relayURL, deviceName: "iPhone")
        let client = RelayClient(baseURL: relayURL, identity: session.identity)
        let subscribed = expectation(description: "subscribed")
        let changed = expectation(description: "changed")
        let live = LiveSync(client: client, spaces: [session.spaceId]) { event in
            switch event {
            case .subscribed(let s) where s == [session.spaceId]: subscribed.fulfill()
            case .changed(let space, _) where space == session.spaceId: changed.fulfill()
            default: break
            }
        }
        live.start()
        defer { live.stop() }
        await fulfillment(of: [subscribed], timeout: 10)
        let started = Date()
        try peer(["write", cliVault, "poke.md", "hello\n"])
        try peer(["sync", cliHome, cliVault])
        await fulfillment(of: [changed], timeout: 10)
        print("live poke after CLI push: \(Date().timeIntervalSince(started))s (includes CLI process start)")
    }

    func testWrongPhraseFindsNoSpace() async throws {
        _ = try peer(["init", cliHome, cliVault, relayURL.absoluteString])
        do {
            _ = try await Enrollment.signIn(phrase: BIP39.generate(), relay: relayURL, deviceName: "iPhone")
            XCTFail("expected noSpace")
        } catch let e as EnrollmentError {
            XCTAssertEqual(e, .noSpace)
        }
    }

    func testCreateAccountThenCLIJoinsIsNotNeeded() async throws {
        // A Swift-created account syncs with a second Swift device.
        let (phrase, first) = try await Enrollment.createAccount(relay: relayURL, deviceName: "iPhone")
        let a = try NoteStore()
        try a.appendDaily("hello from device one")
        try await SyncEngine(store: a, client: RelayClient(baseURL: relayURL, identity: first.identity),
                             spaceId: first.spaceId, spaceKey: first.spaceKey).sync()
        let second = try await Enrollment.signIn(phrase: phrase, relay: relayURL, deviceName: "Mac")
        XCTAssertEqual(second.spaceId, first.spaceId)
        let b = try NoteStore()
        let r = try await SyncEngine(store: b, client: RelayClient(baseURL: relayURL, identity: second.identity),
                                     spaceId: second.spaceId, spaceKey: second.spaceKey).sync()
        XCTAssertEqual(r.pulled, 1)
        XCTAssertEqual(b.notes().first?.content, a.notes().first?.content)
    }

    // MARK: Peer plumbing

    @discardableResult
    func peer(_ args: [String]) throws -> JSValue {
        let p = makePeer(args)
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            let msg = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            throw VortexError.relay(status: Int(p.terminationStatus), message: "peer \(args[0]): \(msg)")
        }
        return try JSValue.parse(data)
    }

    func cliRead(_ path: String) throws -> String? { try peer(["read", cliVault, path])["content"]?.string }

    func startPeer(_ args: [String]) throws -> (Process, String) {
        let p = makePeer(args)
        let out = Pipe()
        p.standardOutput = out
        try p.run()
        var line = Data()
        while true {
            let byte = out.fileHandleForReading.readData(ofLength: 1)
            if byte.isEmpty || byte == Data("\n".utf8) { break }
            line.append(byte)
        }
        return (p, String(decoding: line, as: UTF8.self))
    }

    func makePeer(_ args: [String]) -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["npx", "tsx", "test/ios-peer.ts"] + args
        p.currentDirectoryURL = InteropTests.repo
        return p
    }
}
