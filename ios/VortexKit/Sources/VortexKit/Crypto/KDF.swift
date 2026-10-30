import CommonCrypto
import CryptoKit
import Foundation

/// Key derivation matching src/crypto.ts: HKDF-SHA256 (no salt), PBKDF2 and scrypt.
public enum KDF {
    /// `derive(ikm, info)`: HKDF-SHA256 with an undefined salt (= 32 zero bytes, same as empty).
    public static func hkdf(_ ikm: Data, info: String, salt: Data = Data(), length: Int = 32) -> Data {
        let key = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: ikm),
            salt: salt,
            info: Data(info.utf8),
            outputByteCount: length
        )
        return key.withUnsafeBytes { Data($0) }
    }

    public static func pbkdf2(password: Data, salt: Data, rounds: Int, length: Int, sha512: Bool) -> Data {
        var out = Data(count: length)
        let status = out.withUnsafeMutableBytes { outPtr in
            password.withUnsafeBytes { pw in
                salt.withUnsafeBytes { s in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        pw.baseAddress?.assumingMemoryBound(to: CChar.self), password.count,
                        s.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                        CCPseudoRandomAlgorithm(sha512 ? kCCPRFHmacAlgSHA512 : kCCPRFHmacAlgSHA256),
                        UInt32(rounds),
                        outPtr.baseAddress!.assumingMemoryBound(to: UInt8.self), length
                    )
                }
            }
        }
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        return out
    }

    /// Per-note password key: scrypt(N=2^15, r=8, p=1, dkLen=32), as `deriveNoteKey`.
    public static func noteKey(password: String, salt: Data) -> Data {
        scrypt(password: Data(password.utf8), salt: salt, n: 1 << 15, r: 8, p: 1, length: 32)
    }

    /// RFC 7914 scrypt. Hot loops run on raw pointers: Swift arrays (bounds checks,
    /// copy-on-write) made this ~8 s per note key in debug builds.
    public static func scrypt(password: Data, salt: Data, n: Int, r: Int, p: Int, length: Int) -> Data {
        precondition(n > 1 && n & (n - 1) == 0, "N must be a power of two")
        let bw = 32 * r // words per 128·r-byte block
        let b = pbkdf2(password: password, salt: salt, rounds: 1, length: p * 128 * r, sha512: false)
        let words = UnsafeMutablePointer<UInt32>.allocate(capacity: p * bw)
        let v = UnsafeMutablePointer<UInt32>.allocate(capacity: n * bw)
        let x = UnsafeMutablePointer<UInt32>.allocate(capacity: bw)
        let y = UnsafeMutablePointer<UInt32>.allocate(capacity: bw)
        let t = UnsafeMutablePointer<UInt32>.allocate(capacity: 16)
        defer { [words, v, x, y, t].forEach { $0.deallocate() } }
        b.withUnsafeBytes { raw in
            for i in 0..<(p * bw) { words[i] = UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: i * 4, as: UInt32.self)) }
        }
        for chunk in 0..<p {
            x.update(from: words + chunk * bw, count: bw)
            for i in 0..<n {
                (v + i * bw).update(from: x, count: bw)
                blockMix(x, y, t, r)
            }
            for _ in 0..<n {
                let j = Int(x[(2 * r - 1) * 16]) & (n - 1)
                let vj = v + j * bw
                for w in 0..<bw { x[w] ^= vj[w] }
                blockMix(x, y, t, r)
            }
            (words + chunk * bw).update(from: x, count: bw)
        }
        var mixed = Data(capacity: p * bw * 4)
        for i in 0..<(p * bw) { withUnsafeBytes(of: words[i].littleEndian) { mixed.append(contentsOf: $0) } }
        return pbkdf2(password: password, salt: mixed, rounds: 1, length: length, sha512: false)
    }

    /// BlockMix(salsa20/8): b ← mixed b, using y as scratch.
    private static func blockMix(
        _ b: UnsafeMutablePointer<UInt32>, _ y: UnsafeMutablePointer<UInt32>, _ t: UnsafeMutablePointer<UInt32>, _ r: Int
    ) {
        t.update(from: b + (2 * r - 1) * 16, count: 16)
        for i in 0..<(2 * r) {
            for w in 0..<16 { t[w] ^= b[i * 16 + w] }
            salsa20_8(t)
            // Even blocks go to the first half, odd blocks to the second.
            (y + (i % 2 == 0 ? i / 2 : r + i / 2) * 16).update(from: t, count: 16)
        }
        b.update(from: y, count: 32 * r)
    }

    private static func salsa20_8(_ b: UnsafeMutablePointer<UInt32>) {
        var x0 = b[0], x1 = b[1], x2 = b[2], x3 = b[3], x4 = b[4], x5 = b[5], x6 = b[6], x7 = b[7]
        var x8 = b[8], x9 = b[9], x10 = b[10], x11 = b[11], x12 = b[12], x13 = b[13], x14 = b[14], x15 = b[15]
        @inline(__always) func r(_ a: UInt32, _ n: UInt32) -> UInt32 { (a << n) | (a >> (32 - n)) }
        for _ in 0..<4 {
            x4 ^= r(x0 &+ x12, 7); x8 ^= r(x4 &+ x0, 9); x12 ^= r(x8 &+ x4, 13); x0 ^= r(x12 &+ x8, 18)
            x9 ^= r(x5 &+ x1, 7); x13 ^= r(x9 &+ x5, 9); x1 ^= r(x13 &+ x9, 13); x5 ^= r(x1 &+ x13, 18)
            x14 ^= r(x10 &+ x6, 7); x2 ^= r(x14 &+ x10, 9); x6 ^= r(x2 &+ x14, 13); x10 ^= r(x6 &+ x2, 18)
            x3 ^= r(x15 &+ x11, 7); x7 ^= r(x3 &+ x15, 9); x11 ^= r(x7 &+ x3, 13); x15 ^= r(x11 &+ x7, 18)
            x1 ^= r(x0 &+ x3, 7); x2 ^= r(x1 &+ x0, 9); x3 ^= r(x2 &+ x1, 13); x0 ^= r(x3 &+ x2, 18)
            x6 ^= r(x5 &+ x4, 7); x7 ^= r(x6 &+ x5, 9); x4 ^= r(x7 &+ x6, 13); x5 ^= r(x4 &+ x7, 18)
            x11 ^= r(x10 &+ x9, 7); x8 ^= r(x11 &+ x10, 9); x9 ^= r(x8 &+ x11, 13); x10 ^= r(x9 &+ x8, 18)
            x12 ^= r(x15 &+ x14, 7); x13 ^= r(x12 &+ x15, 9); x14 ^= r(x13 &+ x12, 13); x15 ^= r(x14 &+ x13, 18)
        }
        b[0] &+= x0; b[1] &+= x1; b[2] &+= x2; b[3] &+= x3; b[4] &+= x4; b[5] &+= x5; b[6] &+= x6; b[7] &+= x7
        b[8] &+= x8; b[9] &+= x9; b[10] &+= x10; b[11] &+= x11; b[12] &+= x12; b[13] &+= x13; b[14] &+= x14; b[15] &+= x15
    }
}
