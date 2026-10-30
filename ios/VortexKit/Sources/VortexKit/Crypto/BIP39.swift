import CryptoKit
import Foundation

/// BIP39 (English, 12 words) as used by `generatePhrase` / `accountFromPhrase`.
public enum BIP39 {
    public static let words = BIP39Wordlist.english
    private static let index: [String: Int] = Dictionary(uniqueKeysWithValues: words.enumerated().map { ($1, $0) })

    /// trim, lowercase, collapse whitespace — what account.ts does before validating.
    public static func normalize(_ phrase: String) -> String {
        phrase.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    public static func generate() -> String {
        mnemonic(entropy: Bytes.random(16))
    }

    public static func mnemonic(entropy: Data) -> String {
        let checksumBits = entropy.count * 8 / 32
        let hash = [UInt8](Data(SHA256.hash(data: entropy)))
        var bits: [Int] = []
        for byte in entropy {
            for k in 0..<8 { bits.append(Int((byte >> UInt8(7 - k)) & 1)) }
        }
        for k in 0..<checksumBits { bits.append(Int((hash[k / 8] >> UInt8(7 - k % 8)) & 1)) }
        var out: [String] = []
        for start in stride(from: 0, to: bits.count, by: 11) {
            var i = 0
            for b in bits[start..<start + 11] { i = i << 1 | b }
            out.append(words[i])
        }
        return out.joined(separator: " ")
    }

    /// Valid only when every word is in the list and the checksum matches.
    public static func isValid(_ phrase: String) -> Bool {
        let list = normalize(phrase).split(separator: " ").map(String.init)
        guard [12, 15, 18, 21, 24].contains(list.count) else { return false }
        var bits = [UInt8]()
        for w in list {
            guard let i = index[w] else { return false }
            bits += (0..<11).map { UInt8((i >> (10 - $0)) & 1) }
        }
        let entBits = bits.count * 32 / 33
        var entropy = Data()
        for b in stride(from: 0, to: entBits, by: 8) {
            entropy.append(bits[b..<b + 8].reduce(0) { $0 << 1 | $1 })
        }
        let hash = [UInt8](Data(SHA256.hash(data: entropy)))
        for k in 0..<(bits.count - entBits) where bits[entBits + k] != (hash[k / 8] >> (7 - k % 8)) & 1 {
            return false
        }
        return true
    }

    /// Words starting with `prefix`, for onboarding autocomplete.
    public static func suggestions(_ prefix: String, limit: Int = 4) -> [String] {
        let p = prefix.lowercased()
        guard !p.isEmpty else { return [] }
        return Array(words.lazy.filter { $0.hasPrefix(p) }.prefix(limit))
    }

    /// Standard BIP39 seed: PBKDF2-HMAC-SHA512(phrase, "mnemonic", 2048) → 64 bytes.
    public static func seed(_ normalizedPhrase: String) -> Data {
        KDF.pbkdf2(
            password: Data(normalizedPhrase.decomposedStringWithCompatibilityMapping.utf8),
            salt: Data("mnemonic".utf8), rounds: 2048, length: 64, sha512: true
        )
    }
}
