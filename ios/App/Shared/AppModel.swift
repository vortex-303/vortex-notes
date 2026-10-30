import Foundation
import Observation
import VortexKit

/// App state shared by the iPhone and Mac apps: who we are, the local vault,
/// and keeping it in sync. All UI reads from here.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case onboarding
        /// A new account: show the 12 words once before continuing.
        case newPhrase(String)
        case ready
    }

    enum SyncState: Equatable {
        case idle
        case syncing
        case synced(Date)
        case offline(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var notes: [NoteRow] = []
    private(set) var syncState: SyncState = .idle
    private(set) var conflicts: [String] = []
    /// A note the UI should open now (set by New Note); views clear it once they've navigated.
    var openRequest: String?
    /// The note just made by New Note: it opens with the caret ready, takes its title from
    /// its first line, and is thrown away if it's left empty.
    private(set) var freshNote: String?
    /// Pinned note paths, in pin order. Per device for now (the web app has no pins yet).
    private(set) var pins: [String] = []
    static let maxPins = 6
    /// Captures append to today's daily note (on) or become their own notes (off). Per device.
    var dailyCaptures: Bool = UserDefaults.standard.object(forKey: "dailyCaptures") as? Bool ?? true {
        didSet { UserDefaults.standard.set(dailyCaptures, forKey: "dailyCaptures") }
    }
    var relayURL: URL {
        didSet { UserDefaults.standard.set(relayURL.absoluteString, forKey: "relayURL") }
    }

    let store: NoteStore
    private var session: Session?
    private var engine: SyncEngine?
    private var live: LiveSync?
    private var syncAgain = false
    private var pollTask: Task<Void, Never>?

    static let defaultRelay = URL(string: "https://vortex-notes.pages.dev")!

    init() {
        let env = ProcessInfo.processInfo.environment
        let saved = UserDefaults.standard.string(forKey: "relayURL").flatMap(URL.init(string:))
        relayURL = env["VORTEX_RELAY"].flatMap(URL.init(string:)) ?? saved ?? Self.defaultRelay
        store = try! NoteStore(path: Self.storeURL())
    }

    var identity: DeviceIdentity? { session?.identity }
    var fingerprint: String { session?.identity.fingerprint ?? "" }

    // MARK: Launch & sign-in

    func launch() async {
        guard phase == .loading else { return }
        if let data = Keychain.load(), let identity = try? DeviceIdentity(serialized: data),
           let spaceId = store.meta("spaceId"), let sealHex = store.meta("deviceSeal"),
           let seal = try? Bytes.fromHex(sealHex),
           let key = try? VortexCrypto.openBox(seal, with: identity.deviceBox) {
            // Offline-capable: the space key is re-opened from our own seal, no network needed.
            start(Session(identity: identity, spaceId: spaceId, spaceKey: key))
            return
        }
        #if DEBUG
        if let phrase = ProcessInfo.processInfo.environment["VORTEX_TEST_PHRASE"] {
            do {
                try await signIn(phrase: phrase)
                return
            } catch {
                print("VORTEX_TEST_PHRASE sign-in failed: \(error)")
            }
        }
        #endif
        phase = .onboarding
    }

    func signIn(phrase: String) async throws {
        let s = try await Enrollment.signIn(phrase: phrase, relay: relayURL, deviceName: Self.deviceName)
        try persist(s)
        start(s)
    }

    func createAccount() async throws {
        let (phrase, s) = try await Enrollment.createAccount(relay: relayURL, deviceName: Self.deviceName)
        try persist(s)
        start(s)
        phase = .newPhrase(phrase)
    }

    func confirmedPhrase() { phase = .ready }

    func signOut() {
        live?.stop()
        pollTask?.cancel()
        Keychain.delete()
        try? store.wipe()
        session = nil
        engine = nil
        notes = []
        pins = []
        syncState = .idle
        phase = .onboarding
    }

    private func persist(_ s: Session) throws {
        guard Keychain.save(s.identity.serialized()) else { throw AppError.keychain }
        try store.wipe() // a different account must never see the previous one's notes
        try store.setMeta("spaceId", s.spaceId)
        try store.setMeta("deviceSeal", Bytes.hex(try VortexCrypto.sealBox(s.spaceKey, to: s.identity.deviceBox.pub)))
    }

    private func start(_ s: Session) {
        session = s
        let client = RelayClient(baseURL: relayURL, identity: s.identity)
        engine = SyncEngine(store: store, client: client, spaceId: s.spaceId, spaceKey: s.spaceKey)
        refresh()
        phase = .ready
        live = LiveSync(client: client, spaces: [s.spaceId]) { [weak self] event in
            guard case .changed = event else { return }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 150_000_000)
                await self?.sync()
            }
        }
        live?.start()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.sync()
                try? await Task.sleep(nanoseconds: 60_000_000_000) // safety net under the live channel
            }
        }
    }

    // MARK: Notes

    func refresh() {
        notes = store.notes()
        if pins.isEmpty, let saved = store.meta("pins")?.data(using: .utf8),
           let list = try? JSONSerialization.jsonObject(with: saved) as? [String] {
            pins = list
        }
    }

    func sortedNotes(_ sort: NoteSort) -> [NoteRow] {
        notes.sorted { a, b in
            let (x, y) = sort == .created ? (a.createdMs, b.createdMs) : (a.mtimeMs, b.mtimeMs)
            return x != y ? x > y : a.path < b.path
        }
    }

    /// Pinned notes that still exist, in pin order.
    var pinnedNotes: [NoteRow] { pins.compactMap { p in notes.first { $0.path == p } } }
    func isPinned(_ path: String) -> Bool { pins.contains(path) }
    var canPin: Bool { pinnedNotes.count < Self.maxPins }

    func togglePin(_ path: String) {
        if let i = pins.firstIndex(of: path) {
            pins.remove(at: i)
        } else {
            guard canPin else { return }
            pins = pins.filter { p in notes.contains { $0.path == p } } + [path] // drop pins of deleted notes
        }
        if let data = try? JSONSerialization.data(withJSONObject: pins) {
            try? store.setMeta("pins", String(decoding: data, as: UTF8.self))
        }
    }

    func capture(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if dailyCaptures {
            _ = try? store.appendDaily(trimmed)
        } else {
            _ = try? store.createNote(title: Self.captureTitle(trimmed), body: trimmed)
        }
        refresh()
        Task { await sync() }
    }

    // MARK: New note (Apple Notes style)

    /// Create a blank note and ask the UI to open it. The file name is a timestamp (like daily
    /// notes) so it never collides; the title follows the first line as you type.
    func newNote(now: Date = Date()) {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH.mm"
        guard let path = try? store.createNote(title: "Note \(f.string(from: now))", body: "", now: now) else { return }
        // createNote ends with the (empty) body's newline; drop it so typing starts one blank line under the header.
        if let n = store.note(path), n.content.hasSuffix("\n\n\n") { try? store.write(path, content: String(n.content.dropLast())) }
        refresh()
        freshNote = path
        openRequest = path
    }

    /// The placeholder title New Note gives a note until its first line takes over.
    static func isPlaceholderTitle(_ title: String) -> Bool {
        title.range(of: #"^Note \d{4}-\d\d-\d\d \d\d\.\d\d$"#, options: .regularExpression) != nil
    }

    /// Frontmatter with `title:` replaced (only that line), quoted when YAML needs it.
    static func retitled(_ prefix: String, _ title: String) -> String {
        let needsQuotes = title.range(of: #"[:#'"\[\]{}&*!|>%@`]|^\s|\s$"#, options: .regularExpression) != nil
        let value = needsQuotes ? "\"" + title.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" : title
        return prefix.replacingOccurrences(of: #"(?m)^title:.*$"#, with: NSRegularExpression.escapedTemplate(for: "title: " + value), options: .regularExpression)
    }

    /// Leaving a New Note without typing anything: delete it before it ever syncs.
    func discardIfEmpty(_ path: String) {
        guard path == freshNote else { return }
        freshNote = nil
        guard let note = store.note(path), !note.deleted,
              Self.noteParts(note.content).body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        try? store.delete(path)
        refresh()
    }

    /// First line, without Markdown markers, cut at a word boundary near 60 characters.
    static func captureTitle(_ text: String, now: Date = Date()) -> String {
        let first = text.split(separator: "\n").first.map(String.init) ?? ""
        let plain = first.replacingOccurrences(of: #"^\s*(#+|[-*+]|\d+[.)])\s+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "").trimmingCharacters(in: .whitespaces)
        guard !plain.isEmpty else { return "Capture \(now.formatted(date: .abbreviated, time: .shortened))" }
        guard plain.count > 60 else { return plain }
        let cut = plain.prefix(60)
        return (cut.lastIndex(of: " ").map { String(cut[..<$0]) } ?? String(cut)) + "…"
    }

    /// Most recently created notes, for the Capture screen when the daily note is off.
    var recentNotes: [NoteRow] { Array(sortedNotes(.created).prefix(8)) }

    /// A note's text split for the editor: `prefix` (frontmatter + the blank lines after it)
    /// stays exactly as is; `body` is what you edit. prefix + body == content, byte for byte.
    static func noteParts(_ content: String) -> (prefix: String, body: String) {
        var body = NoteText.splitFrontmatter(content).body
        while body.hasPrefix("\n") { body.removeFirst() }
        let ns = content as NSString
        let prefix = ns.substring(to: ns.length - (body as NSString).length)
        return (prefix, body)
    }

    /// Save an edited body; untouched notes are never written.
    func saveBody(path: String, body: String) {
        guard let note = store.note(path), !note.deleted else { return }
        var prefix = Self.noteParts(note.content).prefix
        // A New Note takes its title from its first line until it has one.
        let title = NoteText.splitFrontmatter(note.content).frontmatter.flatMap { fm in
            fm.split(separator: "\n").first { $0.hasPrefix("title:") }.map { String($0.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
        } ?? ""
        if Self.isPlaceholderTitle(title), !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            prefix = Self.retitled(prefix, Self.captureTitle(body))
        }
        let updated = prefix + body
        guard updated != note.content else { return }
        try? store.write(path, content: updated)
        refresh()
        Task { await sync() }
    }

    /// [[Target]] → the note whose title, path, file name or slug matches (as the web app does).
    func resolveWikilink(_ target: String) -> String? {
        let t = target.trimmingCharacters(in: .whitespaces).lowercased()
        let slug = NoteText.slugify(target)
        return notes.first { n in
            let file = String((n.path.split(separator: "/").last ?? "").dropLast(3)).lowercased()
            return n.title.lowercased() == t || String(n.path.dropLast(3)).lowercased() == t || file == t || file == slug
        }?.path
    }

    // MARK: Editor mode (rich by default; "Edit markdown" per note)

    var markdownByDefault: Bool = UserDefaults.standard.bool(forKey: "markdownByDefault") {
        didSet { UserDefaults.standard.set(markdownByDefault, forKey: "markdownByDefault") }
    }
    private var modeOverrides: [String: Bool] = (UserDefaults.standard.dictionary(forKey: "editorModes") as? [String: Bool]) ?? [:]

    func isRaw(_ path: String) -> Bool { modeOverrides[path] ?? markdownByDefault }

    func setRaw(_ path: String, _ raw: Bool) {
        modeOverrides[path] = raw == markdownByDefault ? nil : raw
        UserDefaults.standard.set(modeOverrides, forKey: "editorModes")
    }

    func save(path: String, content: String) {
        try? store.write(path, content: content)
        refresh()
        Task { await sync() }
    }

    func delete(path: String) {
        try? store.delete(path)
        refresh()
        Task { await sync() }
    }

    var todayPath: String { Daily.path(Date()) }
    /// Derived from `notes` (observed), so views update when sync brings today's note in.
    var today: NoteRow? { notes.first { $0.path == todayPath } }

    /// Simple scoring like the hosted MCP (title > path > body); semantic search arrives in M4.
    func search(_ query: String) -> [NoteRow] {
        let terms = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return [] }
        return notes.compactMap { n -> (NoteRow, Int)? in
            let title = n.title.lowercased(), path = n.path.lowercased(), body = n.content.lowercased()
            var score = 0
            for t in terms {
                var hit = false
                if title.contains(t) { score += 5; hit = true }
                if path.contains(t) { score += 2; hit = true }
                let count = min(20, body.components(separatedBy: t).count - 1)
                if count > 0 { score += count; hit = true }
                if !hit { return nil }
            }
            return (n, score)
        }
        .sorted { $0.1 > $1.1 }
        .map(\.0)
    }

    // MARK: Sync

    func sync() async {
        guard let engine else { return }
        if syncState == .syncing { syncAgain = true; return }
        syncState = .syncing
        repeat {
            syncAgain = false
            do {
                let r = try await engine.sync()
                conflicts += r.conflicts
                syncState = .synced(Date())
            } catch VortexError.relay(let status, let message) where status == 401 {
                syncState = .offline("Relay refused this device: \(message)")
            } catch {
                syncState = .offline(error.localizedDescription)
            }
            refresh()
        } while syncAgain
    }

    func usage() async -> (Int64, Int64?)? {
        guard let identity else { return nil }
        return try? await RelayClient(baseURL: relayURL, identity: identity).usage()
    }

    // MARK: Environment

    static var deviceName: String {
        #if os(iOS)
        return "\(DeviceInfo.model) · iOS"
        #else
        return "Mac · macOS"
        #endif
    }

    static func storeURL() -> URL {
        let fm = FileManager.default
        // The App Group container (shared with extensions) only when it's really ours: a
        // sandboxed Mac app gets a path back even without the entitlement, but can't write there.
        if let group = fm.containerURL(forSecurityApplicationGroupIdentifier: Keychain.appGroup),
           (try? fm.createDirectory(at: group, withIntermediateDirectories: true)) != nil,
           fm.isWritableFile(atPath: group.path) {
            return group.appendingPathComponent("vault.sqlite")
        }
        let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("VortexNotes")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("vault.sqlite")
    }
}

enum AppError: LocalizedError {
    case keychain
    var errorDescription: String? { "Couldn't save this device's keys to the Keychain." }
}

extension EnrollmentError: @retroactive LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .noSpace: "Those words are valid, but no notes live under them on this relay. Check each word against your saved copy."
        case .revoked: "This device was removed from your account. Sign in again with your 12 words."
        }
    }
}

extension VortexError: @retroactive LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidPhrase: "That's not a valid recovery phrase. It should be 12 English words; check for typos."
        case .relay(let status, let message): status == 0 ? message : "Relay error \(status): \(message)"
        default: "Something went wrong with encryption (\(self))."
        }
    }
}
