import Foundation

/// Per-note password locks, format-compatible with src/notelock.ts.
/// v1: body under scrypt(password). v2: body under a random key K, K wrapped
/// under scrypt(password) AND sealed to the account box key.
public enum NoteLock {
    public static let lockAAD = "vortex-note-lock-v1"
    public static let keyAAD = "vortex-note-key-v2"
    static let hint = "🔒 Password-protected — open in Vortex Notes to unlock.\n\n"

    public struct Envelope: Sendable {
        public var version: Int
        public var salt: Data
        public var wrapPw: Data?
        public var sealedAcct: Data?
        public var ct: Data
    }

    public static func findEnvelope(_ body: String) -> Envelope? {
        let b = "([A-Za-z0-9+/=]+)"
        if let m = groups(#"(?m)^vortex-locked:v2:\#(b):\#(b):\#(b):\#(b)\s*$"#, body), m.count == 4,
           let salt = try? Bytes.fromB64(m[0]), let w = try? Bytes.fromB64(m[1]),
           let s = try? Bytes.fromB64(m[2]), let ct = try? Bytes.fromB64(m[3]) {
            return Envelope(version: 2, salt: salt, wrapPw: w, sealedAcct: s, ct: ct)
        }
        if let m = groups(#"(?m)^vortex-locked:v1:\#(b):\#(b)\s*$"#, body), m.count == 2,
           let salt = try? Bytes.fromB64(m[0]), let ct = try? Bytes.fromB64(m[1]) {
            return Envelope(version: 1, salt: salt, ct: ct)
        }
        return nil
    }

    public static func isLocked(_ content: String) -> Bool {
        findEnvelope(NoteText.splitFrontmatter(content).body) != nil
    }

    /// The body key from the note password, or nil on a wrong password.
    public static func key(_ env: Envelope, password: String) -> Data? {
        let pwKey = KDF.noteKey(password: password, salt: env.salt)
        if env.version == 1 {
            return (try? VortexCrypto.decryptPayload(env.ct, key: pwKey, aad: lockAAD)) != nil ? pwKey : nil
        }
        guard let wrap = env.wrapPw else { return nil }
        return try? VortexCrypto.decryptPayload(wrap, key: pwKey, aad: keyAAD)
    }

    /// The body key from the 12 words (v2 only).
    public static func key(_ env: Envelope, accountBox: BoxKeypair) -> Data? {
        guard env.version == 2, let sealed = env.sealedAcct else { return nil }
        return try? VortexCrypto.openBox(sealed, with: accountBox)
    }

    public static func openBody(_ env: Envelope, key: Data) throws -> String {
        String(decoding: try VortexCrypto.decryptPayload(env.ct, key: key, aad: lockAAD), as: UTF8.self)
    }

    /// Lock a note as v2 (frontmatter kept readable), like `lockContent` with an account.
    public static func lock(_ content: String, password: String, accountBoxPub: Data) throws -> String {
        let (fm, body) = NoteText.splitFrontmatter(content)
        let salt = Bytes.random(32)
        let k = Bytes.random(32)
        let wrapPw = try VortexCrypto.encryptPayload(k, key: KDF.noteKey(password: password, salt: salt), aad: keyAAD)
        let sealedAcct = try VortexCrypto.sealBox(k, to: accountBoxPub)
        let plain = String(body.drop(while: { $0 == "\n" }))
        let ct = try VortexCrypto.encryptPayload(Data(plain.utf8), key: k, aad: lockAAD)
        let parts = [salt, wrapPw, sealedAcct, ct].map(Bytes.b64).joined(separator: ":")
        let wrapped = hint + "vortex-locked:v2:" + parts
        return fm.map { "---\n\($0)\n---\n\n\(wrapped)" } ?? wrapped
    }

    /// Decrypt a locked note's body with its password; nil if wrong or not locked.
    public static func unlock(_ content: String, password: String) -> (frontmatter: String?, body: String)? {
        let (fm, body) = NoteText.splitFrontmatter(content)
        guard let env = findEnvelope(body), let k = key(env, password: password),
              let plain = try? openBody(env, key: k) else { return nil }
        return (fm, plain)
    }

    public static func unlock(_ content: String, accountBox: BoxKeypair) -> (frontmatter: String?, body: String)? {
        let (fm, body) = NoteText.splitFrontmatter(content)
        guard let env = findEnvelope(body), let k = key(env, accountBox: accountBox),
              let plain = try? openBody(env, key: k) else { return nil }
        return (fm, plain)
    }

    private static func groups(_ pattern: String, _ s: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (1..<m.numberOfRanges).compactMap { Range(m.range(at: $0), in: s).map { String(s[$0]) } }
    }
}
