import CryptoKit
import Foundation

/// XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha), built from HChaCha20 + CryptoKit's
/// IETF ChaCha20-Poly1305, since CryptoKit has no 24-byte-nonce variant.
/// Byte-compatible with @noble/ciphers `xchacha20poly1305`.
public enum XChaCha20Poly1305 {
    public static let nonceLength = 24
    public static let tagLength = 16

    /// Returns ciphertext ‖ tag (no nonce), like noble's `.encrypt`.
    public static func seal(_ plaintext: Data, key: Data, nonce: Data, aad: Data? = nil) throws -> Data {
        let (subkey, ietfNonce) = try subkeyAndNonce(key: key, nonce: nonce)
        let box: ChaChaPoly.SealedBox
        if let aad {
            box = try ChaChaPoly.seal(plaintext, using: subkey, nonce: ietfNonce, authenticating: aad)
        } else {
            box = try ChaChaPoly.seal(plaintext, using: subkey, nonce: ietfNonce)
        }
        return box.ciphertext + box.tag
    }

    /// Opens ciphertext ‖ tag. Throws `decryptFailed` on a bad key, nonce, AAD or tamper.
    public static func open(_ sealed: Data, key: Data, nonce: Data, aad: Data? = nil) throws -> Data {
        guard sealed.count >= tagLength else { throw VortexError.ciphertextTooShort }
        let (subkey, ietfNonce) = try subkeyAndNonce(key: key, nonce: nonce)
        let ct = sealed.prefix(sealed.count - tagLength)
        let tag = sealed.suffix(tagLength)
        do {
            let box = try ChaChaPoly.SealedBox(nonce: ietfNonce, ciphertext: ct, tag: tag)
            if let aad {
                return try ChaChaPoly.open(box, using: subkey, authenticating: aad)
            }
            return try ChaChaPoly.open(box, using: subkey)
        } catch {
            throw VortexError.decryptFailed
        }
    }

    private static func subkeyAndNonce(key: Data, nonce: Data) throws -> (SymmetricKey, ChaChaPoly.Nonce) {
        guard key.count == 32, nonce.count == nonceLength else { throw VortexError.invalidKey }
        let subkey = hChaCha20(key: key, nonce: nonce.prefix(16))
        let ietf = Data(repeating: 0, count: 4) + nonce.suffix(8)
        return (SymmetricKey(data: subkey), try ChaChaPoly.Nonce(data: ietf))
    }

    static func hChaCha20(key: Data, nonce: Data) -> Data {
        var s = [UInt32](repeating: 0, count: 16)
        s[0] = 0x6170_7865
        s[1] = 0x3320_646e
        s[2] = 0x7962_2d32
        s[3] = 0x6b20_6574
        let k = [UInt8](key)
        let n = [UInt8](nonce)
        for i in 0..<8 { s[4 + i] = le32(k, i * 4) }
        for i in 0..<4 { s[12 + i] = le32(n, i * 4) }
        for _ in 0..<10 {
            quarter(&s, 0, 4, 8, 12); quarter(&s, 1, 5, 9, 13)
            quarter(&s, 2, 6, 10, 14); quarter(&s, 3, 7, 11, 15)
            quarter(&s, 0, 5, 10, 15); quarter(&s, 1, 6, 11, 12)
            quarter(&s, 2, 7, 8, 13); quarter(&s, 3, 4, 9, 14)
        }
        var out = Data(capacity: 32)
        for i in [0, 1, 2, 3, 12, 13, 14, 15] {
            withUnsafeBytes(of: s[i].littleEndian) { out.append(contentsOf: $0) }
        }
        return out
    }

    @inline(__always)
    private static func quarter(_ s: inout [UInt32], _ a: Int, _ b: Int, _ c: Int, _ d: Int) {
        s[a] &+= s[b]; s[d] ^= s[a]; s[d] = rotl(s[d], 16)
        s[c] &+= s[d]; s[b] ^= s[c]; s[b] = rotl(s[b], 12)
        s[a] &+= s[b]; s[d] ^= s[a]; s[d] = rotl(s[d], 8)
        s[c] &+= s[d]; s[b] ^= s[c]; s[b] = rotl(s[b], 7)
    }

    @inline(__always)
    private static func rotl(_ x: UInt32, _ n: UInt32) -> UInt32 { (x << n) | (x >> (32 - n)) }

    @inline(__always)
    static func le32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
    }
}
