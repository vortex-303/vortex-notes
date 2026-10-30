import Foundation

/// Scans a note body (markdown) into what the live editor needs to make it look
/// rendered without changing a byte: the kind of each line, which ranges to hide
/// (`#`, `- [ ] `, `**`, `](url)` …), inline styles, and tappable links.
/// All ranges are UTF-16 `NSRange`s, ready for TextKit.
public struct MarkdownSyntax: Sendable {
    public enum LineKind: Equatable, Sendable {
        case blank
        case paragraph
        case heading(Int)
        case bullet(depth: Int)
        case task(depth: Int, checked: Bool)
        case ordered(depth: Int)
        case quote
        case fence
        case code
        case rule
        case table
    }

    public struct Line: Equatable, Sendable {
        /// The whole line, without its "\n".
        public var range: NSRange
        public var kind: LineKind
        /// The block prefix to hide ("## ", "- ", "  - [ ] ", "> "); empty if none.
        public var marker: NSRange
        /// Tasks: the "[ ]" / "[x]" box, the bit a tap toggles.
        public var box: NSRange?
        public var content: NSRange { NSRange(location: marker.upperBound, length: range.upperBound - marker.upperBound) }
    }

    public enum InlineKind: Equatable, Sendable {
        case bold, italic, strike, code
        /// A markdown link, autolink or bare URL.
        case link(String)
        /// `[[target]]` / `[[target|alias]]`; `target` is the part before "|".
        case wikilink(String)
    }

    public struct Inline: Equatable, Sendable {
        public var kind: InlineKind
        /// Visible text (markers excluded).
        public var range: NSRange
    }

    public private(set) var lines: [Line] = []
    public private(set) var inlines: [Inline] = []
    /// Everything to hide: block markers plus inline markers.
    public private(set) var hidden: [NSRange] = []
    /// Inline markers only (caret snapping treats them differently from block markers).
    public private(set) var inlineMarkers: [NSRange] = []

    public init(_ text: String) {
        let ns = text as NSString
        var inFence = false
        var location = 0
        while location <= ns.length {
            let nl = ns.range(of: "\n", options: [], range: NSRange(location: location, length: ns.length - location))
            let end = nl.location == NSNotFound ? ns.length : nl.location
            let range = NSRange(location: location, length: end - location)
            let lineText = ns.substring(with: range)
            var line = Self.classify(lineText, at: location, inFence: &inFence)
            line.range = range
            lines.append(line)
            if line.marker.length > 0 && Self.hidesMarker(line.kind) { hidden.append(line.marker) }
            if Self.hasInline(line.kind) { scanInline(ns, line.content) }
            if nl.location == NSNotFound { break }
            location = end + 1
        }
    }

    /// The line containing a UTF-16 offset.
    public func line(at offset: Int) -> Line? {
        lines.first { offset >= $0.range.location && offset <= $0.range.upperBound }
    }

    public func inline(at offset: Int) -> Inline? {
        inlines.first { NSLocationInRange(offset, $0.range) }
    }

    // MARK: Blocks

    static func hidesMarker(_ k: LineKind) -> Bool {
        switch k {
        case .heading, .bullet, .task, .quote: true
        default: false // ordered numbers stay visible, like Notes; fences/tables show as-is
        }
    }

    static func hasInline(_ k: LineKind) -> Bool {
        switch k {
        case .fence, .code, .rule, .table, .blank: false
        default: true
        }
    }

    private static let fenceRE = try! NSRegularExpression(pattern: #"^ {0,3}(```|~~~)"#)
    private static let headingRE = try! NSRegularExpression(pattern: #"^ {0,3}(#{1,6})[ \t]+"#)
    private static let ruleRE = try! NSRegularExpression(pattern: #"^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$"#)
    private static let taskRE = try! NSRegularExpression(pattern: #"^([ \t]*)[-*+][ \t]+(\[[ xX]\])[ \t]+"#)
    private static let taskEmptyRE = try! NSRegularExpression(pattern: #"^([ \t]*)[-*+][ \t]+(\[[ xX]\])[ \t]*$"#)
    private static let bulletRE = try! NSRegularExpression(pattern: #"^([ \t]*)[-*+][ \t]+"#)
    private static let orderedRE = try! NSRegularExpression(pattern: #"^([ \t]*)\d{1,9}[.)][ \t]+"#)
    private static let quoteRE = try! NSRegularExpression(pattern: #"^ {0,3}>[ \t]?"#)

    static func classify(_ s: String, at base: Int, inFence: inout Bool) -> Line {
        let ns = s as NSString
        let all = NSRange(location: 0, length: ns.length)
        func line(_ kind: LineKind, _ marker: Int = 0, box: NSRange? = nil) -> Line {
            Line(range: NSRange(location: base, length: ns.length), kind: kind,
                 marker: NSRange(location: base, length: marker),
                 box: box.map { NSRange(location: base + $0.location, length: $0.length) })
        }
        if fenceRE.firstMatch(in: s, range: all) != nil {
            inFence.toggle()
            return line(.fence)
        }
        if inFence { return line(.code) }
        if s.trimmingCharacters(in: .whitespaces).isEmpty { return line(.blank) }
        if let m = headingRE.firstMatch(in: s, range: all) {
            return line(.heading(m.range(at: 1).length), m.range.length)
        }
        if ruleRE.firstMatch(in: s, range: all) != nil { return line(.rule) }
        if let m = taskRE.firstMatch(in: s, range: all) ?? taskEmptyRE.firstMatch(in: s, range: all) {
            let box = m.range(at: 2)
            let checked = ns.substring(with: box).lowercased() == "[x]"
            return line(.task(depth: depth(ns.substring(with: m.range(at: 1))), checked: checked), m.range.length, box: box)
        }
        if let m = bulletRE.firstMatch(in: s, range: all) {
            return line(.bullet(depth: depth(ns.substring(with: m.range(at: 1)))), m.range.length)
        }
        if let m = orderedRE.firstMatch(in: s, range: all) {
            return line(.ordered(depth: depth(ns.substring(with: m.range(at: 1)))), m.range.length)
        }
        if let m = quoteRE.firstMatch(in: s, range: all) { return line(.quote, m.range.length) }
        if s.hasPrefix("|") || s.trimmingCharacters(in: .whitespaces).hasPrefix("|") { return line(.table) }
        return line(.paragraph)
    }

    static func depth(_ indent: String) -> Int {
        indent.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) } / 2
    }

    // MARK: Inline

    private static let codeRE = try! NSRegularExpression(pattern: #"(`+)(.+?)\1"#)
    private static let wikiRE = try! NSRegularExpression(pattern: #"\[\[([^\]\[\n]+?)\]\]"#)
    private static let linkRE = try! NSRegularExpression(pattern: #"\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#)
    private static let autoRE = try! NSRegularExpression(pattern: #"<((?:https?://|mailto:)[^>\s]+)>"#)
    private static let boldRE = try! NSRegularExpression(pattern: #"(\*\*|__)(?=\S)(.+?)(?<=\S)\1"#)
    private static let strikeRE = try! NSRegularExpression(pattern: #"~~(?=\S)(.+?)(?<=\S)~~"#)
    private static let italicRE = try! NSRegularExpression(pattern: #"(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*])|(?<![_\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![_\w])"#)
    private static let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    private mutating func scanInline(_ ns: NSString, _ content: NSRange) {
        guard content.length > 0 else { return }
        let s = ns as String
        // Code spans, wikilinks and URLs are atomic: nothing is styled inside them.
        var atomic: [NSRange] = []
        // Markdown links: emphasis may sit inside the link text, never across the "](url)" part.
        var links: [(full: NSRange, text: NSRange)] = []
        func free(_ r: NSRange) -> Bool {
            !atomic.contains { NSIntersectionRange($0, r).length > 0 } && !links.contains { NSIntersectionRange($0.full, r).length > 0 }
        }

        for m in Self.codeRE.matches(in: s, range: content) {
            let fence = m.range(at: 1).length
            add(.code, NSRange(location: m.range.location + fence, length: m.range.length - 2 * fence),
                markers: [NSRange(location: m.range.location, length: fence), NSRange(location: m.range.upperBound - fence, length: fence)])
            atomic.append(m.range)
        }
        for m in Self.wikiRE.matches(in: s, range: content) where free(m.range) {
            let inner = ns.substring(with: m.range(at: 1))
            let target = inner.split(separator: "|", maxSplits: 1).first.map(String.init) ?? inner
            var visible = m.range(at: 1)
            var markers = [NSRange(location: m.range.location, length: 2), NSRange(location: m.range.upperBound - 2, length: 2)]
            if let bar = inner.firstIndex(of: "|") {
                let aliasStart = inner[..<bar].utf16.count + 1
                markers.append(NSRange(location: visible.location, length: aliasStart)) // hide "target|"
                visible = NSRange(location: visible.location + aliasStart, length: visible.length - aliasStart)
            }
            add(.wikilink(target.trimmingCharacters(in: .whitespaces)), visible, markers: markers)
            atomic.append(m.range)
        }
        for m in Self.linkRE.matches(in: s, range: content) where free(m.range) {
            let text = m.range(at: 1)
            add(.link(ns.substring(with: m.range(at: 2))), text,
                markers: [NSRange(location: m.range.location, length: 1),
                          NSRange(location: text.upperBound, length: m.range.upperBound - text.upperBound)])
            links.append((m.range, text))
        }
        for m in Self.autoRE.matches(in: s, range: content) where free(m.range) {
            add(.link(ns.substring(with: m.range(at: 1))), m.range(at: 1),
                markers: [NSRange(location: m.range.location, length: 1), NSRange(location: m.range.upperBound - 1, length: 1)])
            atomic.append(m.range)
        }
        for m in Self.detector.matches(in: s, range: content) where free(m.range) {
            guard let url = m.url else { continue }
            add(.link(url.absoluteString), m.range, markers: [])
            atomic.append(m.range)
        }

        func emphasisOK(_ r: NSRange) -> Bool {
            !atomic.contains { NSIntersectionRange($0, r).length > 0 }
                && links.allSatisfy { NSIntersectionRange($0.full, r).length == 0 || (r.location >= $0.text.location && r.upperBound <= $0.text.upperBound) }
        }
        var boldMarkers: [NSRange] = []
        for m in Self.boldRE.matches(in: s, range: content) where emphasisOK(m.range) {
            let w = m.range(at: 1).length
            let marks = [NSRange(location: m.range.location, length: w), NSRange(location: m.range.upperBound - w, length: w)]
            add(.bold, m.range(at: 2), markers: marks)
            boldMarkers += marks
        }
        for m in Self.strikeRE.matches(in: s, range: content) where emphasisOK(m.range) {
            add(.strike, m.range(at: 1), markers: [NSRange(location: m.range.location, length: 2), NSRange(location: m.range.upperBound - 2, length: 2)])
        }
        for m in Self.italicRE.matches(in: s, range: content) where emphasisOK(m.range) {
            // Skip "*" that are really halves of a bold "**".
            let open = NSRange(location: m.range.location, length: 1), close = NSRange(location: m.range.upperBound - 1, length: 1)
            if boldMarkers.contains(where: { NSIntersectionRange($0, open).length > 0 || NSIntersectionRange($0, close).length > 0 }) { continue }
            let inner = m.range(at: 1).location != NSNotFound ? m.range(at: 1) : m.range(at: 2)
            add(.italic, inner, markers: [open, close])
        }
    }

    private mutating func add(_ kind: InlineKind, _ range: NSRange, markers: [NSRange]) {
        inlines.append(Inline(kind: kind, range: range))
        for m in markers where m.length > 0 {
            hidden.append(m)
            inlineMarkers.append(m)
        }
    }
}
