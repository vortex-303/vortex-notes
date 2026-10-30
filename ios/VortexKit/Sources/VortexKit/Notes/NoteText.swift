import Foundation

/// Pure text helpers ported from src/textutil.ts.
public enum NoteText {
    /// `/^---\n([\s\S]*?)\n---\n?/` — LF only, like the TS regex.
    public static func splitFrontmatter(_ raw: String) -> (frontmatter: String?, body: String) {
        guard raw.hasPrefix("---\n") else { return (nil, raw) }
        let rest = raw.dropFirst(4)
        // Shortest match: the first "\n---" after the opening fence. An empty block
        // ("---\n---") can't match because the regex needs "\n---" after the first "\n".
        guard let close = rest.range(of: "\n---") else { return (nil, raw) }
        let fm = String(rest[rest.startIndex..<close.lowerBound])
        var bodyStart = close.upperBound
        if bodyStart < rest.endIndex && rest[bodyStart] == "\n" { bodyStart = rest.index(after: bodyStart) }
        return (fm, String(rest[bodyStart...]))
    }

    public static func titleFromPath(_ rel: String, body: String? = nil) -> String {
        if let body, let h1 = firstMatch(#"(?m)^#\s+(.+)$"#, in: body) {
            return h1.trimmingCharacters(in: .whitespaces)
        }
        let base = rel.split(separator: "/").last.map(String.init) ?? rel
        return base.hasSuffix(".md") ? String(base.dropLast(3)) : base
    }

    /// frontmatter title > first h1 > basename.
    public static func title(path: String, raw: String) -> String {
        let (fm, body) = splitFrontmatter(raw)
        if let fm, let t = firstMatch(#"(?m)^title:\s*['"]?(.+?)['"]?\s*$"#, in: fm) {
            return t.trimmingCharacters(in: .whitespaces)
        }
        return titleFromPath(path, body: body)
    }

    /// Frontmatter `created:` as a date: ISO 8601 (with or without ms, quoted or not) or YYYY-MM-DD.
    public static func created(_ raw: String) -> Date? {
        guard let fm = splitFrontmatter(raw).frontmatter,
              let v = firstMatch(#"(?m)^created:\s*['"]?([^'"\n]+?)['"]?\s*$"#, in: fm) else { return nil }
        let iso = ISO8601DateFormatter()
        for opts: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime], [.withFullDate]] {
            iso.formatOptions = opts
            if let d = iso.date(from: v) { return d }
        }
        return nil
    }

    public static func slugify(_ title: String) -> String {
        let folded = title.lowercased().decomposedStringWithCanonicalMapping.unicodeScalars
            .filter { !(0x300...0x36f).contains($0.value) }
        var out = ""
        var dash = false
        for u in folded {
            if ("a"..."z").contains(u) || ("0"..."9").contains(u) {
                out.unicodeScalars.append(u)
                dash = false
            } else if !dash {
                out += "-"
                dash = true
            }
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        let slug = String(trimmed.prefix(80))
        return slug.isEmpty ? "note" : slug
    }

    static func firstMatch(_ pattern: String, in s: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: s)
        else { return nil }
        return String(s[r])
    }
}
