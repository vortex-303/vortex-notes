import Foundation

/// Signed relay requests (src/relay/client.ts `signed`, verified in core.ts).
public struct RequestSigner: Sendable {
    public let deviceSign: SignKeypair

    public init(deviceSign: SignKeypair) { self.deviceSign = deviceSign }

    public var devicePub: String { Bytes.hex(deviceSign.pub) }

    /// `METHOD\n<path+query exactly as sent>\n<ts>\n<sha256hex(body)>`.
    public static func canonical(method: String, pathWithQuery: String, ts: String, body: Data) -> String {
        "\(method)\n\(pathWithQuery)\n\(ts)\n\(VortexCrypto.sha256Hex(body))"
    }

    /// The three auth headers for a request.
    public func headers(method: String, pathWithQuery: String, body: Data, now: Date = Date()) -> [String: String] {
        let ts = String(Int64(now.timeIntervalSince1970 * 1000))
        let msg = Self.canonical(method: method, pathWithQuery: pathWithQuery, ts: ts, body: body)
        return [
            "x-vortex-device": devicePub,
            "x-vortex-ts": ts,
            "x-vortex-sig": Bytes.hex(deviceSign.sign(Data(msg.utf8))),
        ]
    }

    /// `WS-SUB\n<ts>\n<sha256hex(sorted spaces joined by ",")>`.
    public static func wsCanonical(spaces: [String], ts: String) -> String {
        let joined = spaces.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }.joined(separator: ",")
        return "WS-SUB\n\(ts)\n\(VortexCrypto.sha256Hex(Data(joined.utf8)))"
    }

    /// The `/ws` subscribe frame.
    public func wsSubFrame(spaces: [String], now: Date = Date()) -> JSValue {
        let ts = String(Int64(now.timeIntervalSince1970 * 1000))
        let sig = Bytes.hex(deviceSign.sign(Data(Self.wsCanonical(spaces: spaces, ts: ts).utf8)))
        return .object([
            ("type", .string("sub")), ("device", .string(devicePub)), ("ts", .string(ts)),
            ("sig", .string(sig)), ("spaces", .array(spaces.map { .string($0) })),
        ])
    }

    /// A doc id as ONE path segment: everything outside [A-Za-z0-9._-] percent-encoded
    /// (uppercase hex), because the relay route only admits [A-Za-z0-9._%-].
    public static func encodeDocId(_ docId: String) -> String {
        var out = ""
        for b in docId.utf8 {
            switch b {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
                 UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "."), UInt8(ascii: "_"), UInt8(ascii: "-"):
                out.unicodeScalars.append(Unicode.Scalar(b))
            default:
                out += String(format: "%%%02X", b)
            }
        }
        return out
    }
}
