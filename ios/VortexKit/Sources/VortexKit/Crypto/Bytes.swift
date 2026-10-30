import Foundation
import Security

/// Byte helpers matching src/crypto.ts: lowercase hex, standard padded base64.
public enum Bytes {
    public static func hex(_ data: Data) -> String {
        let digits = Array("0123456789abcdef".utf8)
        var out = [UInt8]()
        out.reserveCapacity(data.count * 2)
        for b in data {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    public static func fromHex(_ hex: String) throws -> Data {
        let chars = Array(hex.utf8)
        guard chars.count % 2 == 0 else { throw VortexError.invalidHex }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { throw VortexError.invalidHex }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    public static func b64(_ data: Data) -> String { data.base64EncodedString() }

    public static func fromB64(_ s: String) throws -> Data {
        guard let d = Data(base64Encoded: s) else { throw VortexError.invalidBase64 }
        return d
    }

    public static func utf8(_ s: String) -> Data { Data(s.utf8) }

    public static func random(_ count: Int) -> Data {
        var d = Data(count: count)
        let status = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return d
    }

    private static func nibble(_ c: UInt8) -> UInt8? {
        switch c {
        case 48...57: return c - 48
        case 97...102: return c - 87
        case 65...70: return c - 55
        default: return nil
        }
    }
}

public enum VortexError: Error, Equatable, Sendable {
    case invalidHex
    case invalidBase64
    case invalidPhrase
    case ciphertextTooShort
    case decryptFailed
    case invalidKey
    case relay(status: Int, message: String)
}
