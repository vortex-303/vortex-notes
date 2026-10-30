import Foundation

/// A JSON value that serializes exactly like JavaScript's `JSON.stringify`
/// (no whitespace, `/` and non-ASCII unescaped, lowercase \u00xx for controls).
/// Object key order is preserved, which signatures depend on.
public indirect enum JSValue: Equatable, Sendable {
    case string(String)
    case int(Int64)
    case bool(Bool)
    case null
    case array([JSValue])
    case object([(String, JSValue)])

    public static func == (a: JSValue, b: JSValue) -> Bool { a.stringify() == b.stringify() }

    public func stringify() -> String {
        var out = ""
        write(&out)
        return out
    }

    public subscript(key: String) -> JSValue? {
        guard case .object(let pairs) = self else { return nil }
        return pairs.first(where: { $0.0 == key })?.1
    }

    public var string: String? { if case .string(let s) = self { s } else { nil } }
    public var int: Int64? { if case .int(let i) = self { i } else { nil } }
    public var bool: Bool? { if case .bool(let b) = self { b } else { nil } }

    /// Same object with keys sorted by UTF-16 code units (JS `<` on strings). Top level only,
    /// like account.ts `canonical()`.
    public func sortedKeys() -> JSValue {
        guard case .object(let pairs) = self else { return self }
        return .object(pairs.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) })
    }

    private func write(_ out: inout String) {
        switch self {
        case .string(let s): JSValue.quote(s, into: &out)
        case .int(let i): out += String(i)
        case .bool(let b): out += b ? "true" : "false"
        case .null: out += "null"
        case .array(let items):
            out += "["
            for (i, v) in items.enumerated() {
                if i > 0 { out += "," }
                v.write(&out)
            }
            out += "]"
        case .object(let pairs):
            out += "{"
            for (i, (k, v)) in pairs.enumerated() {
                if i > 0 { out += "," }
                JSValue.quote(k, into: &out)
                out += ":"
                v.write(&out)
            }
            out += "}"
        }
    }

    private static func quote(_ s: String, into out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    out += String(format: "\\u%04x", u.value)
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }
}

extension JSValue {
    /// Parse with Foundation; object key order follows the source text only for
    /// our own serializer's output, so never re-sign parsed objects.
    public static func parse(_ data: Data) throws -> JSValue {
        try from(JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    }

    static func from(_ any: Any) throws -> JSValue {
        switch any {
        case let s as String: return .string(s)
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .int(n.int64Value)
        case let a as [Any]: return .array(try a.map(from))
        case let d as [String: Any]: return .object(try d.keys.sorted().map { ($0, try from(d[$0]!)) })
        case is NSNull: return .null
        default: throw VortexError.invalidKey
        }
    }
}
