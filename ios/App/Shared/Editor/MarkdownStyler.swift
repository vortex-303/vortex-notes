import Foundation
import VortexKit
#if os(iOS)
import UIKit
typealias PFont = UIFont
typealias PColor = UIColor
typealias PFontDescriptor = UIFontDescriptor
#else
import AppKit
typealias PFont = NSFont
typealias PColor = NSColor
typealias PFontDescriptor = NSFontDescriptor
#endif

extension NSAttributedString.Key {
    /// A tappable link: an http(s)/mailto URL, or "wikilink:<target>".
    static let vortexLink = NSAttributedString.Key("vortexLink")
    /// Set on list / task / quote lines: what the layout fragment draws in the indent.
    static let vortexBlock = NSAttributedString.Key("vortexBlock")
}

/// What a line's layout fragment draws to its left.
enum BlockDecoration: Equatable {
    case bullet(indent: CGFloat)
    case task(indent: CGFloat, checked: Bool)
    case quote
}

/// Applies the Apple-Notes look to the raw markdown in a text storage. Attributes only:
/// the characters are never touched, so the file stays byte-exact.
@MainActor
enum MarkdownStyler {
    static let indentStep: CGFloat = 26

    #if os(iOS)
    static var bodySize: CGFloat { UIFont.preferredFont(forTextStyle: .body).pointSize }
    static let ink = UIColor.label
    static let soft = UIColor.secondaryLabel
    static let codeBackground = UIColor.secondarySystemFill
    static var accent: UIColor { UIColor(named: "AccentColor") ?? .systemGreen }
    #else
    static let bodySize: CGFloat = 14
    static let ink = NSColor.labelColor
    static let soft = NSColor.secondaryLabelColor
    static let codeBackground = NSColor.quaternaryLabelColor
    static var accent: NSColor { NSColor(named: "AccentColor") ?? .systemGreen }
    #endif

    static var body: PFont { .systemFont(ofSize: bodySize) }
    static var mono: PFont { .monospacedSystemFont(ofSize: bodySize * 0.9, weight: .regular) }
    static let hiddenFont = PFont.systemFont(ofSize: 0.01)

    static func serif(_ size: CGFloat, bold: Bool = true) -> PFont {
        let base = PFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
        #if os(iOS)
        guard let d = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: d, size: size)
        #else
        guard let d = base.fontDescriptor.withDesign(.serif) else { return base }
        return NSFont(descriptor: d, size: size) ?? base
        #endif
    }

    static func adding(_ trait: Trait, to font: PFont) -> PFont {
        #if os(iOS)
        var traits = font.fontDescriptor.symbolicTraits
        traits.insert(trait == .bold ? .traitBold : .traitItalic)
        guard let d = font.fontDescriptor.withSymbolicTraits(traits) else { return font }
        return UIFont(descriptor: d, size: font.pointSize)
        #else
        var traits = font.fontDescriptor.symbolicTraits
        traits.insert(trait == .bold ? .bold : .italic)
        return NSFont(descriptor: font.fontDescriptor.withSymbolicTraits(traits), size: font.pointSize) ?? font
        #endif
    }

    enum Trait { case bold, italic }

    /// Comfortable, Notes-like rhythm: a little air inside paragraphs, more between them.
    static func paragraph(indent: CGFloat = 0, spacing: CGFloat = 8, before: CGFloat = 0) -> NSParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = 4
        p.paragraphSpacing = spacing
        p.paragraphSpacingBefore = before
        p.firstLineHeadIndent = indent
        p.headIndent = indent
        return p
    }

    /// Plain monospaced text with nothing hidden ("Edit markdown").
    static func applyRaw(to storage: NSTextStorage) {
        let all = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.setAttributes([.font: mono, .foregroundColor: ink, .paragraphStyle: paragraph()], range: all)
        storage.endEditing()
    }

    static func apply(_ syntax: MarkdownSyntax, to storage: NSTextStorage) {
        let all = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        defer { storage.endEditing() }
        storage.setAttributes([.font: body, .foregroundColor: ink, .paragraphStyle: paragraph()], range: all)

        for line in syntax.lines {
            // Include the line's "\n" so paragraph attributes cover the whole paragraph.
            let r = NSIntersectionRange(NSRange(location: line.range.location, length: line.range.length + 1), all)
            switch line.kind {
            case .heading(let level):
                let size: CGFloat = level == 1 ? bodySize * 1.65 : level == 2 ? bodySize * 1.3 : level == 3 ? bodySize * 1.12 : bodySize
                storage.addAttributes([.font: serif(size), .paragraphStyle: paragraph(spacing: 8, before: level <= 2 ? 12 : 6)], range: r)
            case .bullet(let depth), .ordered(let depth):
                let indent = CGFloat(depth + 1) * indentStep
                storage.addAttribute(.paragraphStyle, value: paragraph(indent: indent, spacing: 9), range: r)
                if case .bullet = line.kind { storage.addAttribute(.vortexBlock, value: BlockDecoration.bullet(indent: indent), range: r) }
            case .task(let depth, let checked):
                let indent = CGFloat(depth + 1) * indentStep
                storage.addAttributes([.paragraphStyle: paragraph(indent: indent, spacing: 9),
                                       .vortexBlock: BlockDecoration.task(indent: indent, checked: checked)], range: r)
                if checked {
                    storage.addAttributes([.foregroundColor: soft, .strikethroughStyle: NSUnderlineStyle.single.rawValue], range: line.content)
                }
            case .quote:
                storage.addAttributes([.foregroundColor: soft, .paragraphStyle: paragraph(indent: 16),
                                       .vortexBlock: BlockDecoration.quote], range: r)
            case .code, .fence:
                storage.addAttributes([.font: mono, .backgroundColor: codeBackground], range: r)
                if case .fence = line.kind { storage.addAttribute(.foregroundColor, value: soft, range: r) }
            case .table:
                storage.addAttribute(.font, value: mono, range: r)
            case .rule:
                storage.addAttribute(.foregroundColor, value: soft, range: r)
            case .blank:
                // Blank lines separate paragraphs in markdown; keep them short, like Notes' spacing.
                storage.addAttributes([.font: PFont.systemFont(ofSize: bodySize * 0.55), .paragraphStyle: paragraph(spacing: 0)], range: r)
            case .ordered, .paragraph:
                break
            }
            if case .ordered = line.kind { storage.addAttribute(.foregroundColor, value: soft, range: line.marker) }
        }

        for span in syntax.inlines where span.range.length > 0 {
            switch span.kind {
            case .bold, .italic:
                let trait: Trait = span.kind == .bold ? .bold : .italic
                storage.enumerateAttribute(.font, in: span.range) { value, range, _ in
                    if let f = value as? PFont { storage.addAttribute(.font, value: adding(trait, to: f), range: range) }
                }
            case .strike:
                storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: span.range)
            case .code:
                storage.addAttributes([.font: mono, .backgroundColor: codeBackground], range: span.range)
            case .link(let url):
                storage.addAttributes([.foregroundColor: accent, .underlineStyle: NSUnderlineStyle.single.rawValue,
                                       .vortexLink: url], range: span.range)
            case .wikilink(let target):
                storage.addAttributes([.foregroundColor: accent, .vortexLink: "wikilink:" + target], range: span.range)
            }
        }

        for r in syntax.hidden {
            storage.addAttributes([.font: hiddenFont, .foregroundColor: PColor.clear], range: r)
            storage.removeAttribute(.underlineStyle, range: r)
            storage.removeAttribute(.strikethroughStyle, range: r)
            storage.removeAttribute(.backgroundColor, range: r)
        }
    }
}
