import Foundation

/// The plaintext of one relay update: `{v:1, path, content, mtimeMs[, deleted]}`.
/// The relay `doc` id is the path; the blob is bound to it by AAD.
public struct DocPayload: Sendable, Equatable {
    public var path: String
    public var content: String
    public var mtimeMs: Int64
    public var deleted: Bool

    public init(path: String, content: String, mtimeMs: Int64, deleted: Bool = false) {
        self.path = path
        self.content = content
        self.mtimeMs = mtimeMs
        self.deleted = deleted
    }

    public static func tombstone(path: String, mtimeMs: Int64) -> DocPayload {
        DocPayload(path: path, content: "", mtimeMs: mtimeMs, deleted: true)
    }

    public static func aad(_ path: String) -> String { "vortex-doc-v1:" + path }

    public var json: JSValue {
        var pairs: [(String, JSValue)] = [
            ("v", .int(1)), ("path", .string(path)), ("content", .string(content)), ("mtimeMs", .int(mtimeMs)),
        ]
        if deleted { pairs.append(("deleted", .bool(true))) }
        return .object(pairs)
    }

    public func encrypt(spaceKey: Data) throws -> Data {
        try VortexCrypto.encryptPayload(Data(json.stringify().utf8), key: spaceKey, aad: Self.aad(path))
    }

    /// Decrypt a blob pulled for `docId`. The AAD check rejects blobs moved between docs.
    public static func decrypt(_ blob: Data, docId: String, spaceKey: Data) throws -> DocPayload {
        let plain = try VortexCrypto.decryptPayload(blob, key: spaceKey, aad: aad(docId))
        let v = try JSValue.parse(plain)
        guard let path = v["path"]?.string, let content = v["content"]?.string else { throw VortexError.decryptFailed }
        return DocPayload(
            path: path, content: content, mtimeMs: v["mtimeMs"]?.int ?? 0, deleted: v["deleted"]?.bool ?? false
        )
    }
}
