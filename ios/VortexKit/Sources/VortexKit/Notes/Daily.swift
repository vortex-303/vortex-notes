import Foundation

/// Daily notes: `daily/YYYY-MM-DD.md`, entries `- **HH:MM** text`, the web
/// app's format (src/webapp/main.ts appendDaily).
public enum Daily {
    /// Every client uses UTC today. Change here and in web/CLI/MCP together.
    public static let defaultTimeZone = TimeZone(identifier: "UTC")!

    public static func path(_ date: Date, timeZone: TimeZone = defaultTimeZone) -> String {
        "daily/\(day(date, timeZone)).md"
    }

    public static func append(_ text: String, to existing: String?, now: Date, timeZone: TimeZone = defaultTimeZone) -> String {
        let entry = "- **\(format(now, "HH:mm", timeZone))** \(text.trimmingCharacters(in: .whitespacesAndNewlines))"
        guard let existing, !existing.isEmpty else {
            return "---\ntitle: \(day(now, timeZone))\ntags:\n  - daily\n---\n\n\(entry)\n"
        }
        return existing.hasSuffix("\n") ? existing + entry + "\n" : existing + "\n" + entry + "\n"
    }

    static func day(_ d: Date, _ tz: TimeZone) -> String { format(d, "yyyy-MM-dd", tz) }

    private static func format(_ d: Date, _ pattern: String, _ tz: TimeZone) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = tz
        f.dateFormat = pattern
        return f.string(from: d)
    }
}
