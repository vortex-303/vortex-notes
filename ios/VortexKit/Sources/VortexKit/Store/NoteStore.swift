import Foundation

/// One note as the store sees it. `syncedHash` and `base` describe what the
/// relay holds (the CLI's `state.files[rel]` and `.vortex/sync-base/`); a row
/// is dirty when its content differs from that.
public struct NoteRow: Sendable, Equatable {
    public var path: String
    public var content: String
    public var mtimeMs: Int64
    public var syncedHash: String?
    public var base: String?
    /// Deleted locally, tombstone not pushed yet.
    public var deleted: Bool

    public var contentHash: String { VortexCrypto.sha256Hex(Data(content.utf8)) }
    public var isDirty: Bool { deleted ? syncedHash != nil : contentHash != syncedHash }
    public var title: String { NoteText.title(path: path, raw: content) }
    /// Frontmatter `created` (web app / CLI write it), else the last modification.
    public var createdMs: Int64 { NoteText.created(content).map { Int64($0.timeIntervalSince1970 * 1000) } ?? mtimeMs }
}

/// The local vault: decrypted notes in SQLite (iOS Data Protection covers the file),
/// shared by the app, share extension, widgets and intents via the App Group.
/// Local writes ARE the outbox: anything dirty is pushed on the next sync.
public final class NoteStore: @unchecked Sendable {
    let db: SQLiteDB

    public init(path: URL) throws {
        db = try SQLiteDB(path: path.path)
        try migrate()
    }

    /// In-memory store for tests.
    public init() throws {
        db = try SQLiteDB(path: ":memory:")
        try migrate()
    }

    private func migrate() throws {
        try db.exec("""
        CREATE TABLE IF NOT EXISTS notes (
          path TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          mtime_ms INTEGER NOT NULL,
          synced_hash TEXT,
          base TEXT,
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        if (try? db.query("SELECT path_nfc FROM notes LIMIT 0")) == nil {
            try db.exec("ALTER TABLE notes ADD COLUMN path_nfc TEXT")
        }
        try db.exec("CREATE INDEX IF NOT EXISTS notes_path_nfc ON notes(path_nfc)")
    }

    // MARK: Meta (cursor, space)

    public func meta(_ key: String) -> String? {
        (try? db.query("SELECT value FROM meta WHERE key=?", [.text(key)]))?.first?.first?.text
    }

    public func setMeta(_ key: String, _ value: String?) throws {
        if let value {
            try db.query("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [.text(key), .text(value)])
        } else {
            try db.query("DELETE FROM meta WHERE key=?", [.text(key)])
        }
    }

    // MARK: Reads

    /// Exact lookup: doc ids are byte-exact (they are the relay key and the AAD).
    public func note(_ path: String) -> NoteRow? {
        (try? db.query("SELECT \(Self.cols) FROM notes WHERE path=?", [.text(path)]))?.first.map(Self.row)
    }

    /// Lookup for people: "ñ" typed on iOS (NFC) finds a note named on macOS as "n\u{303}" (NFD).
    public func find(_ path: String) -> NoteRow? {
        if let exact = note(path), !exact.deleted { return exact }
        let rows = (try? db.query("SELECT \(Self.cols) FROM notes WHERE deleted=0 AND path_nfc=?", [.text(Self.nfc(path))])) ?? []
        return rows.first.map(Self.row)
    }

    /// Visible notes (not locally deleted), sorted by path.
    public func notes() -> [NoteRow] {
        ((try? db.query("SELECT \(Self.cols) FROM notes WHERE deleted=0 ORDER BY path")) ?? []).map(Self.row)
    }

    public func dirtyNotes() -> [NoteRow] {
        ((try? db.query("SELECT \(Self.cols) FROM notes ORDER BY path")) ?? []).map(Self.row).filter(\.isDirty)
    }

    // MARK: Local edits (become pushes)

    public func write(_ path: String, content: String, now: Date = Date()) throws {
        try db.transaction { try upsertLocal(path, content: content, now: now) }
    }

    public func delete(_ path: String) throws {
        try db.transaction {
            guard let row = note(path) else { return }
            if row.syncedHash == nil {
                try db.query("DELETE FROM notes WHERE path=?", [.text(path)]) // never reached the relay
            } else {
                try db.query("UPDATE notes SET deleted=1, mtime_ms=? WHERE path=?", [.int(Self.ms(Date())), .text(path)])
            }
        }
    }

    /// Append a capture to today's daily note atomically (safe across app + extension).
    @discardableResult
    public func appendDaily(_ text: String, now: Date = Date(), timeZone: TimeZone = Daily.defaultTimeZone) throws -> String {
        let path = Daily.path(now, timeZone: timeZone)
        try db.transaction {
            let existing = note(path).flatMap { $0.deleted ? nil : $0.content }
            try upsertLocal(path, content: Daily.append(text, to: existing, now: now, timeZone: timeZone), now: now)
        }
        return path
    }

    /// A new note in the web app's template (`title/created/updated` frontmatter) at a
    /// free `slug.md` / `slug-2.md` path. Used for captures when the daily note is off.
    @discardableResult
    public func createNote(title: String, body: String, folder: String = "", now: Date = Date()) throws -> String {
        let iso = isoString(now)
        let content = "---\ntitle: \(title)\ncreated: '\(iso)'\nupdated: '\(iso)'\n---\n\n\(body)\n"
        let prefix = folder.isEmpty ? "" : folder + "/"
        let slug = NoteText.slugify(title)
        return try db.transaction {
            var path = "\(prefix)\(slug).md"
            var n = 2
            while note(path) != nil { // a pending tombstone also holds its path
                path = "\(prefix)\(slug)-\(n).md"
                n += 1
            }
            try upsertLocal(path, content: content, now: now)
            return path
        }
    }

    private func upsertLocal(_ path: String, content: String, now: Date) throws {
        try db.query("""
        INSERT INTO notes(path, content, mtime_ms, deleted, path_nfc) VALUES(?,?,?,0,?)
        ON CONFLICT(path) DO UPDATE SET content=excluded.content, mtime_ms=excluded.mtime_ms, deleted=0
        """, [.text(path), .text(content), .int(Self.ms(now)), .text(Self.nfc(path))])
    }

    /// Forget every note and the sync position (sign-out, or switching accounts).
    public func wipe() throws {
        try db.transaction {
            try db.query("DELETE FROM notes")
            try db.query("DELETE FROM meta")
        }
    }

    // MARK: Sync bookkeeping (used by SyncEngine)

    func transaction<T>(_ body: () throws -> T) throws -> T { try db.transaction(body) }

    /// Write a row exactly as given (sync applying remote state).
    func put(_ row: NoteRow) throws {
        try db.query("""
        INSERT INTO notes(path, content, mtime_ms, synced_hash, base, deleted, path_nfc) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET content=excluded.content, mtime_ms=excluded.mtime_ms,
          synced_hash=excluded.synced_hash, base=excluded.base, deleted=excluded.deleted
        """, [
            .text(row.path), .text(row.content), .int(row.mtimeMs),
            row.syncedHash.map(SQLValue.text) ?? .null, row.base.map(SQLValue.text) ?? .null, .int(row.deleted ? 1 : 0),
            .text(Self.nfc(row.path)),
        ])
    }

    func remove(_ path: String) throws {
        try db.query("DELETE FROM notes WHERE path=?", [.text(path)])
    }

    /// After a push: the relay now holds `content`. Leaves `content` alone, so an edit
    /// made while the push was in flight stays dirty and goes out next time.
    func markPushed(_ path: String, content: String) throws {
        try db.query("UPDATE notes SET synced_hash=?, base=? WHERE path=?",
                     [.text(VortexCrypto.sha256Hex(Data(content.utf8))), .text(content), .text(path)])
    }

    private static let cols = "path, content, mtime_ms, synced_hash, base, deleted"

    private static func row(_ r: [SQLValue]) -> NoteRow {
        NoteRow(path: r[0].text ?? "", content: r[1].text ?? "", mtimeMs: r[2].int ?? 0,
                syncedHash: r[3].text, base: r[4].text, deleted: r[5].int == 1)
    }

    static func nfc(_ s: String) -> String { s.precomposedStringWithCanonicalMapping }

    static func ms(_ d: Date) -> Int64 { Int64((d.timeIntervalSince1970 * 1000).rounded()) }
}
