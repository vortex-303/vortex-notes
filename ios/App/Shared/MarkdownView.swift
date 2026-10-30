import SwiftUI
import VortexKit

/// A small block-level Markdown renderer (headings, lists, tasks, quotes,
/// code, rules, paragraphs). Inline styling comes from AttributedString.
/// Frontmatter is hidden; [[wikilinks]] show as plain emphasized text for now.
struct MarkdownView: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.blocks(NoteText.splitFrontmatter(markdown).body).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    enum Block {
        case heading(Int, String)
        case paragraph(String)
        case bullet(String, indent: Int)
        case task(String, done: Bool, indent: Int)
        case numbered(String, String, indent: Int)
        case quote(String)
        case code(String)
        case rule
    }

    @ViewBuilder
    private func view(for block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(Self.inline(text))
                .font(.system(level == 1 ? .title : level == 2 ? .title2 : .title3, design: .serif).weight(.semibold))
                .padding(.top, level == 1 ? 6 : 4)
        case .paragraph(let text):
            Text(Self.inline(text)).font(.body).lineSpacing(3)
        case .bullet(let text, let indent):
            row(marker: Text("•").foregroundStyle(.secondary), text: text, indent: indent)
        case .task(let text, let done, let indent):
            row(marker: Image(systemName: done ? "checkmark.square.fill" : "square")
                .foregroundStyle(done ? Color.accentColor : .secondary), text: text, indent: indent, strike: done)
        case .numbered(let n, let text, let indent):
            row(marker: Text(n + ".").foregroundStyle(.secondary).monospacedDigit(), text: text, indent: indent)
        case .quote(let text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(Color.accentColor.opacity(0.6)).frame(width: 3)
                Text(Self.inline(text)).foregroundStyle(.secondary)
            }
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(.callout, design: .monospaced)).padding(12)
            }
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        case .rule:
            Divider().padding(.vertical, 4)
        }
    }

    private func row(marker: some View, text: String, indent: Int, strike: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            marker.frame(minWidth: 14)
            Text(Self.inline(text)).strikethrough(strike).foregroundStyle(strike ? .secondary : .primary)
        }
        .padding(.leading, CGFloat(indent) * 18)
    }

    static func inline(_ s: String) -> AttributedString {
        // [[target|label]] / [[target]] → *label*
        let linked = s.replacingOccurrences(of: #"\[\[([^\]|]+)\|([^\]]+)\]\]"#, with: "*$2*", options: .regularExpression)
            .replacingOccurrences(of: #"\[\[([^\]]+)\]\]"#, with: "*$1*", options: .regularExpression)
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: linked, options: opts)) ?? AttributedString(s)
    }

    static func blocks(_ text: String) -> [Block] {
        var out: [Block] = []
        var para: [String] = []
        var code: [String]? = nil
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))); para = [] }
        }
        for raw in text.components(separatedBy: "\n") {
            if var c = code {
                if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    out.append(.code(c.joined(separator: "\n")))
                    code = nil
                } else {
                    c.append(raw)
                    code = c
                }
                continue
            }
            let line = raw.trimmingCharacters(in: .whitespaces)
            let indent = (raw.prefix(while: { $0 == " " || $0 == "\t" }).reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }) / 2
            if line.hasPrefix("```") { flush(); code = []; continue }
            if line.isEmpty { flush(); continue }
            if line.hasPrefix("#") {
                let hashes = line.prefix(while: { $0 == "#" }).count
                let rest = line.dropFirst(hashes)
                if hashes <= 6, rest.first == " " {
                    flush(); out.append(.heading(hashes, rest.trimmingCharacters(in: .whitespaces))); continue
                }
            }
            if line.wholeMatch(of: /^([-*_])(\s*\1){2,}$/) != nil { flush(); out.append(.rule); continue }
            if let m = line.firstMatch(of: /^[-*+]\s+\[([ xX])\]\s+(.*)$/) {
                flush(); out.append(.task(String(m.2), done: m.1 != " ", indent: indent)); continue
            }
            if let m = line.firstMatch(of: /^[-*+]\s+(.*)$/) {
                flush(); out.append(.bullet(String(m.1), indent: indent)); continue
            }
            if let m = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush(); out.append(.numbered(String(m.1), String(m.2), indent: indent)); continue
            }
            if let m = line.firstMatch(of: /^>\s?(.*)$/) {
                flush(); out.append(.quote(String(m.1))); continue
            }
            para.append(line)
        }
        if let c = code { out.append(.code(c.joined(separator: "\n"))) }
        flush()
        return out
    }
}
