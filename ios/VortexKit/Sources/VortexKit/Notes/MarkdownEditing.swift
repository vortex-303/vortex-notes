import Foundation

/// One change to the markdown text: replace `range` with `replacement`, then select `selection`.
public struct TextEdit: Equatable, Sendable {
    public var range: NSRange
    public var replacement: String
    public var selection: NSRange

    public init(range: NSRange, replacement: String, selection: NSRange) {
        self.range = range
        self.replacement = replacement
        self.selection = selection
    }

    public func applied(to text: String) -> String {
        (text as NSString).replacingCharacters(in: range, with: replacement)
    }
}

/// The Aa menu (same list as the web app's FORMATS).
public enum FormatKind: String, CaseIterable, Identifiable, Sendable {
    case title, heading, subheading, body, checklist, bullets, numbers, quote, code, bold, italic, strike, link

    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .title: "Title"
        case .heading: "Heading"
        case .subheading: "Subheading"
        case .body: "Body"
        case .checklist: "Checklist"
        case .bullets: "Bulleted list"
        case .numbers: "Numbered list"
        case .quote: "Quote"
        case .code: "Code block"
        case .bold: "Bold"
        case .italic: "Italic"
        case .strike: "Strikethrough"
        case .link: "Link…"
        }
    }
    public var symbol: String {
        switch self {
        case .title: "textformat.size.larger"
        case .heading: "textformat.size"
        case .subheading: "textformat.size.smaller"
        case .body: "text.alignleft"
        case .checklist: "checklist"
        case .bullets: "list.bullet"
        case .numbers: "list.number"
        case .quote: "text.quote"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .bold: "bold"
        case .italic: "italic"
        case .strike: "strikethrough"
        case .link: "link"
        }
    }
}

/// Editing behaviour of the live markdown editor, as pure text transforms
/// (the views apply the returned edits through the system text view, so undo works).
/// Every edit writes markdown: the text view never holds anything else.
public enum MarkdownEditing {
    // MARK: Return / Backspace

    /// Return inside a list, checklist or quote continues it; on an empty item it ends it.
    /// nil = let the text view insert a plain newline.
    public static func returnKey(_ text: String, _ sel: NSRange) -> TextEdit? {
        guard sel.length == 0 else { return nil }
        let syntax = MarkdownSyntax(text)
        guard let line = syntax.line(at: sel.location), sel.location >= line.content.location else { return nil }
        let ns = text as NSString
        let content = ns.substring(with: line.content)
        let marker = ns.substring(with: line.marker)
        let next: String
        switch line.kind {
        case .task:
            next = marker.replacingOccurrences(of: "[x]", with: "[ ]").replacingOccurrences(of: "[X]", with: "[ ]")
        case .bullet, .quote:
            next = marker
        case .ordered:
            let digits = marker.drop(while: { $0 == " " || $0 == "\t" }).prefix(while: \.isNumber)
            next = marker.replacingOccurrences(of: String(digits), with: String((Int(digits) ?? 0) + 1),
                                               options: [], range: marker.range(of: String(digits)))
        default:
            return nil
        }
        if content.trimmingCharacters(in: .whitespaces).isEmpty {
            // Empty item: Return ends the list (the line becomes an empty paragraph).
            return TextEdit(range: line.range, replacement: "", selection: NSRange(location: line.range.location, length: 0))
        }
        let insert = "\n" + next
        return TextEdit(range: sel, replacement: insert, selection: NSRange(location: sel.location + (insert as NSString).length, length: 0))
    }

    /// Backspace at the start of a list item / heading / quote removes its (hidden) marker;
    /// right after a hidden inline marker it deletes the visible character before it.
    public static func backspace(_ text: String, _ sel: NSRange) -> TextEdit? {
        guard sel.length == 0, sel.location > 0 else { return nil }
        let syntax = MarkdownSyntax(text)
        if let line = syntax.line(at: sel.location), line.marker.length > 0, MarkdownSyntax.hidesMarker(line.kind),
           sel.location == line.marker.upperBound {
            return TextEdit(range: line.marker, replacement: "", selection: NSRange(location: line.marker.location, length: 0))
        }
        // The character backspace would delete is part of a hidden inline marker.
        if let m = syntax.inlineMarkers.first(where: { NSLocationInRange(sel.location - 1, $0) }) {
            var start = m.location
            while let prev = syntax.inlineMarkers.first(where: { $0.upperBound == start }) { start = prev.location }
            guard start > 0 else { return nil }
            let target = NSRange(location: start - 1, length: 1)
            if (text as NSString).character(at: target.location) == 10 { return nil } // never join lines this way
            return TextEdit(range: target, replacement: "", selection: NSRange(location: sel.location - 1, length: 0))
        }
        return nil
    }

    // MARK: Checkboxes

    public static func toggleTask(_ text: String, line: MarkdownSyntax.Line) -> TextEdit? {
        guard let box = line.box, case .task(_, let checked) = line.kind else { return nil }
        return TextEdit(range: box, replacement: checked ? "[ ]" : "[x]", selection: NSRange(location: NSNotFound, length: 0))
    }

    // MARK: Aa formats

    public static func format(_ kind: FormatKind, _ text: String, _ sel: NSRange, url: String? = nil) -> TextEdit? {
        switch kind {
        case .bold: return wrap(text, sel, "**", .bold)
        case .italic: return wrap(text, sel, "*", .italic)
        case .strike: return wrap(text, sel, "~~", .strike)
        case .link: return link(text, sel, url ?? "")
        case .code: return codeBlock(text, sel)
        default: return block(kind, text, sel)
        }
    }

    private static func prefix(_ kind: FormatKind, index: Int, indent: String) -> String {
        switch kind {
        case .title: "# "
        case .heading: "## "
        case .subheading: "### "
        case .checklist: indent + "- [ ] "
        case .bullets: indent + "- "
        case .numbers: indent + "\(index + 1). "
        case .quote: "> "
        default: ""
        }
    }

    private static func matches(_ kind: FormatKind, _ line: MarkdownSyntax.LineKind) -> Bool {
        switch (kind, line) {
        case (.title, .heading(1)), (.heading, .heading(2)), (.subheading, .heading(3)),
             (.checklist, .task), (.bullets, .bullet), (.numbers, .ordered), (.quote, .quote): true
        default: false
        }
    }

    private static func block(_ kind: FormatKind, _ text: String, _ sel: NSRange) -> TextEdit? {
        let syntax = MarkdownSyntax(text)
        let ns = text as NSString
        let picked = syntax.lines.filter {
            NSIntersectionRange($0.range, sel).length > 0 || NSLocationInRange(sel.location, NSRange(location: $0.range.location, length: $0.range.length + 1))
                || (sel.length == 0 && sel.location == $0.range.upperBound)
        }
        let lines = picked.filter {
            switch $0.kind { case .fence, .code, .table, .rule: false; default: true }
        }
        guard let first = lines.first, let last = lines.last else { return nil }
        // Toggling the same list/quote/heading kind again turns it back into body text.
        let effective: FormatKind = lines.allSatisfy({ matches(kind, $0.kind) }) && kind != .body ? .body : kind
        var out: [String] = []
        var firstDelta = 0
        for (i, line) in lines.enumerated() {
            let content = ns.substring(with: line.content)
            let oldMarker = ns.substring(with: line.marker)
            let indent: String
            switch line.kind {
            case .bullet, .task, .ordered: indent = String(oldMarker.prefix(while: { $0 == " " || $0 == "\t" }))
            default: indent = ""
            }
            let p = prefix(effective, index: i, indent: indent)
            if i == 0 { firstDelta = (p as NSString).length - line.marker.length }
            out.append(p + content)
        }
        let range = NSRange(location: first.range.location, length: last.range.upperBound - first.range.location)
        let replacement = out.joined(separator: "\n")
        let selection: NSRange
        if lines.count == 1 {
            let newContentStart = first.range.location + first.marker.length + firstDelta
            selection = NSRange(location: max(newContentStart, sel.location + firstDelta), length: sel.length)
        } else {
            selection = NSRange(location: range.location, length: (replacement as NSString).length)
        }
        return TextEdit(range: range, replacement: replacement, selection: selection)
    }

    private static func codeBlock(_ text: String, _ sel: NSRange) -> TextEdit? {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: sel)
        var body = ns.substring(with: lineRange)
        let hadNewline = body.hasSuffix("\n")
        if hadNewline { body.removeLast() }
        let replacement = "```\n" + body + "\n```" + (hadNewline ? "\n" : "")
        return TextEdit(range: lineRange, replacement: replacement,
                        selection: NSRange(location: lineRange.location + 4 + (body as NSString).length, length: 0))
    }

    private static func wrap(_ text: String, _ sel: NSRange, _ mark: String, _ kind: MarkdownSyntax.InlineKind) -> TextEdit? {
        let syntax = MarkdownSyntax(text)
        let m = (mark as NSString).length
        // Already styled → unwrap.
        if let span = syntax.inlines.first(where: { $0.kind == kind && NSLocationInRange(sel.location, NSRange(location: $0.range.location, length: $0.range.length + 1)) && sel.upperBound <= $0.range.upperBound }) {
            let full = NSRange(location: span.range.location - m, length: span.range.length + 2 * m)
            let inner = (text as NSString).substring(with: span.range)
            return TextEdit(range: full, replacement: inner,
                            selection: NSRange(location: sel.location - m, length: sel.length))
        }
        let selected = (text as NSString).substring(with: sel)
        return TextEdit(range: sel, replacement: mark + selected + mark,
                        selection: NSRange(location: sel.location + m, length: sel.length))
    }

    private static func link(_ text: String, _ sel: NSRange, _ url: String) -> TextEdit? {
        let u = url.trimmingCharacters(in: .whitespaces)
        guard !u.isEmpty else { return nil }
        let selected = (text as NSString).substring(with: sel)
        let label = selected.isEmpty ? u : selected
        let replacement = "[\(label)](\(u))"
        return TextEdit(range: sel, replacement: replacement,
                        selection: NSRange(location: sel.location + (replacement as NSString).length, length: 0))
    }

    // MARK: Caret

    /// Keeps the caret out of hidden markers. `previous` tells a one-step arrow move
    /// (which should step over the marker in its direction) from a tap.
    public static func snap(_ sel: NSRange, previous: NSRange, syntax: MarkdownSyntax) -> NSRange? {
        guard sel.length == 0 else { return nil }
        let loc = sel.location
        let leftStep = previous.length == 0 && previous.location - loc == 1
        for line in syntax.lines where line.marker.length > 0 && MarkdownSyntax.hidesMarker(line.kind) {
            if loc >= line.marker.location && loc < line.marker.upperBound {
                if leftStep && line.marker.location > 0 { return NSRange(location: line.marker.location - 1, length: 0) }
                return NSRange(location: line.marker.upperBound, length: 0)
            }
        }
        for m in syntax.inlineMarkers where loc > m.location && loc < m.upperBound {
            if leftStep { return NSRange(location: m.location, length: 0) }
            if previous.length == 0 && loc - previous.location == 1 { return NSRange(location: m.upperBound, length: 0) }
            return NSRange(location: loc - m.location <= m.upperBound - loc ? m.location : m.upperBound, length: 0)
        }
        return nil
    }
}
