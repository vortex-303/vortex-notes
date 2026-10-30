import Foundation
import SQLite3

/// A minimal SQLite wrapper over the system library (no dependencies).
/// One connection, serialized by a lock; WAL lets the app and its extensions
/// share the App Group database file.
final class SQLiteDB: @unchecked Sendable {
    private var db: OpaquePointer?
    private let lock = NSRecursiveLock()

    init(path: String) throws {
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK else {
            throw SQLiteError(message: String(cString: sqlite3_errmsg(db)))
        }
        sqlite3_busy_timeout(db, 5000)
        if path != ":memory:" { try exec("PRAGMA journal_mode=WAL") }
    }

    deinit { sqlite3_close_v2(db) }

    func exec(_ sql: String) throws {
        try locked {
            guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
        }
    }

    /// Runs `sql` with positional `?` bindings and returns every row.
    @discardableResult
    func query(_ sql: String, _ args: [SQLValue] = []) throws -> [[SQLValue]] {
        try locked {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw error() }
            defer { sqlite3_finalize(stmt) }
            for (i, a) in args.enumerated() {
                let idx = Int32(i + 1)
                switch a {
                case .null: sqlite3_bind_null(stmt, idx)
                case .int(let v): sqlite3_bind_int64(stmt, idx, v)
                case .text(let s): sqlite3_bind_text(stmt, idx, s, -1, SQLITE_TRANSIENT)
                case .blob(let d):
                    _ = d.withUnsafeBytes { sqlite3_bind_blob(stmt, idx, $0.baseAddress, Int32(d.count), SQLITE_TRANSIENT) }
                }
            }
            var rows: [[SQLValue]] = []
            while true {
                let rc = sqlite3_step(stmt)
                if rc == SQLITE_DONE { break }
                guard rc == SQLITE_ROW else { throw error() }
                rows.append((0..<sqlite3_column_count(stmt)).map { col in
                    switch sqlite3_column_type(stmt, col) {
                    case SQLITE_NULL: return .null
                    case SQLITE_INTEGER: return .int(sqlite3_column_int64(stmt, col))
                    case SQLITE_BLOB:
                        let n = Int(sqlite3_column_bytes(stmt, col))
                        return .blob(n == 0 ? Data() : Data(bytes: sqlite3_column_blob(stmt, col), count: n))
                    default: return .text(String(cString: sqlite3_column_text(stmt, col)))
                    }
                })
            }
            return rows
        }
    }

    /// BEGIN IMMEDIATE … COMMIT: takes the write lock up front, so a read-modify-write
    /// (e.g. appending to today's note) can't interleave with another process.
    func transaction<T>(_ body: () throws -> T) throws -> T {
        try locked {
            try exec("BEGIN IMMEDIATE")
            do {
                let r = try body()
                try exec("COMMIT")
                return r
            } catch {
                try? exec("ROLLBACK")
                throw error
            }
        }
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func error() -> SQLiteError { SQLiteError(message: String(cString: sqlite3_errmsg(db))) }
}

enum SQLValue: Equatable {
    case null
    case int(Int64)
    case text(String)
    case blob(Data)

    var int: Int64? { if case .int(let v) = self { v } else { nil } }
    var text: String? { if case .text(let s) = self { s } else { nil } }
}

struct SQLiteError: Error, CustomStringConvertible {
    let message: String
    var description: String { "SQLite: \(message)" }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
