import Foundation

public struct SyncResult: Sendable, Equatable {
    public var pulled = 0
    public var pushed = 0
    public var conflicts: [String] = []
}

/// Store ↔ relay sync with the CLI's rules (src/sync.ts `syncVault`):
/// pull before push; newest update per doc wins the pull; diff3 against the
/// last-synced base; overlapping edits → newest mtime wins and the loser is
/// kept as `<name>.conflict-<ms>.md`; an edit beats a delete.
/// Unlike the CLI it pages past 500 updates, and pushes never move the cursor
/// (that could skip another device's update that landed in between).
public actor SyncEngine {
    public let store: NoteStore
    public let client: RelayClient
    public let spaceId: String
    let spaceKey: Data
    let now: @Sendable () -> Date

    public init(store: NoteStore, client: RelayClient, spaceId: String, spaceKey: Data, now: @escaping @Sendable () -> Date = Date.init) {
        self.store = store
        self.client = client
        self.spaceId = spaceId
        self.spaceKey = spaceKey
        self.now = now
    }

    public var cursor: Int64 { Int64(store.meta(Self.cursorKey) ?? "0") ?? 0 }
    static let cursorKey = "cursor"

    @discardableResult
    public func sync() async throws -> SyncResult {
        var result = SyncResult()
        try await pull(&result)
        try await push(&result)
        return result
    }

    // MARK: Pull

    func pull(_ result: inout SyncResult) async throws {
        var since = cursor
        while true {
            let page = try await client.pullUpdates(spaceId: spaceId, since: since)
            // Only the newest update per doc matters (last writer wins by seq).
            var latest: [String: RemoteUpdate] = [:]
            var order: [String] = []
            for u in page {
                if latest[u.doc] == nil { order.append(u.doc) }
                latest[u.doc] = u
            }
            for doc in order {
                let u = latest[doc]!
                if u.author == client.identity.deviceSignPub { continue } // our own echo
                guard let payload = try? DocPayload.decrypt(u.blob, docId: u.doc, spaceKey: spaceKey),
                      payload.path == u.doc, Self.isNotePath(payload.path) else { continue }
                try store.transaction { try apply(payload, &result) }
            }
            if let last = page.last {
                since = last.seq
                try store.setMeta(Self.cursorKey, String(since))
            }
            if page.count < RelayClient.pageSize { break }
        }
    }

    private func apply(_ remote: DocPayload, _ result: inout SyncResult) throws {
        let rel = remote.path
        let local = store.note(rel)

        if remote.deleted {
            guard let local else { return }
            if !local.deleted && local.syncedHash != nil && local.contentHash != local.syncedHash {
                // An edit beats a delete: forget the sync state so push republishes it.
                var keep = local
                keep.syncedHash = nil
                keep.base = nil
                try store.put(keep)
                return
            }
            try store.remove(rel)
            if !local.deleted { result.pulled += 1 }
            return
        }

        let remoteHash = VortexCrypto.sha256Hex(Data(remote.content.utf8))
        guard let local, !local.deleted else {
            // New to us (or we deleted it but someone edited it since: their edit wins).
            try store.put(NoteRow(path: rel, content: remote.content, mtimeMs: remote.mtimeMs,
                                  syncedHash: remoteHash, base: remote.content, deleted: false))
            result.pulled += 1
            return
        }
        if local.contentHash == remoteHash {
            var same = local
            same.syncedHash = remoteHash
            same.base = remote.content
            try store.put(same)
            return
        }
        let locallyChanged = local.syncedHash == nil || local.contentHash != local.syncedHash
        if locallyChanged {
            if let base = local.base, let merged = Diff3.merge(base: base, local: local.content, remote: remote.content) {
                // Keep the OLD synced hash so push sees the merge as a change and publishes it.
                try store.put(NoteRow(path: rel, content: merged, mtimeMs: NoteStore.ms(now()),
                                      syncedHash: local.syncedHash, base: remote.content, deleted: false))
                result.pulled += 1
                return
            }
            let conflictPath = Self.conflictPath(rel, ms: NoteStore.ms(now()))
            if local.mtimeMs >= remote.mtimeMs {
                // Local wins; remote becomes the conflict copy. Push publishes both.
                try store.put(NoteRow(path: conflictPath, content: remote.content, mtimeMs: remote.mtimeMs,
                                      syncedHash: nil, base: nil, deleted: false))
                var winner = local
                winner.syncedHash = remoteHash
                winner.base = remote.content
                try store.put(winner)
                result.conflicts.append(conflictPath)
                return
            }
            try store.put(NoteRow(path: conflictPath, content: local.content, mtimeMs: local.mtimeMs,
                                  syncedHash: nil, base: nil, deleted: false))
            result.conflicts.append(conflictPath)
        }
        try store.put(NoteRow(path: rel, content: remote.content, mtimeMs: remote.mtimeMs,
                              syncedHash: remoteHash, base: remote.content, deleted: false))
        result.pulled += 1
    }

    // MARK: Push

    func push(_ result: inout SyncResult) async throws {
        for row in store.dirtyNotes() {
            if row.deleted {
                let tomb = DocPayload.tombstone(path: row.path, mtimeMs: NoteStore.ms(now()))
                try await client.pushUpdate(spaceId: spaceId, docId: row.path, blob: tomb.encrypt(spaceKey: spaceKey))
                try store.transaction {
                    // Re-check: the row may have been re-created while the push was in flight.
                    if store.note(row.path)?.deleted == true { try store.remove(row.path) }
                }
            } else {
                let payload = DocPayload(path: row.path, content: row.content, mtimeMs: row.mtimeMs)
                try await client.pushUpdate(spaceId: spaceId, docId: row.path, blob: payload.encrypt(spaceKey: spaceKey))
                try store.markPushed(row.path, content: row.content)
            }
            result.pushed += 1
        }
    }

    // MARK: Helpers

    /// vault.ts `isNotePath`: .md, no dot-segments.
    public static func isNotePath(_ rel: String) -> Bool {
        rel.hasSuffix(".md") && !rel.split(separator: "/", omittingEmptySubsequences: false).contains { $0.hasPrefix(".") }
    }

    static func conflictPath(_ rel: String, ms: Int64) -> String {
        String(rel.dropLast(3)) + ".conflict-\(ms).md"
    }
}
