import Foundation
import VortexKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// What the core needs from the platform text view (UITextView / NSTextView).
@MainActor
protocol EditorHost: AnyObject {
    var markdown: String { get }
    var selection: NSRange { get set }
    var storage: NSTextStorage { get }
    var layoutManager2: NSTextLayoutManager? { get }
    /// Replace text as an undoable user edit.
    func perform(_ edit: TextEdit)
    /// Replace everything (remote change), not undoable.
    func load(_ text: String, selection: NSRange)
}

/// Shared behaviour of the live markdown editor on iPhone and Mac: styling, Notes-style
/// typing rules, saving, link and checkbox taps, and taking in changes from sync.
@MainActor
final class EditorCore {
    weak var host: EditorHost?
    var raw: Bool
    private(set) var syntax = MarkdownSyntax("")

    /// The body as last read from / written to the store.
    private(set) var storeBody: String
    private(set) var dirty = false
    private var saveTask: Task<Void, Never>?
    private var previousSelection = NSRange(location: 0, length: 0)
    private var applying = false

    var onSave: (String) -> Void = { _ in }
    var onWikilink: (String) -> Void = { _ in }
    var onRequestLink: (String, @escaping (String) -> Void) -> Void = { _, _ in }

    init(body: String, raw: Bool) {
        storeBody = body
        self.raw = raw
        MarkdownStylerColors.soft = MarkdownStyler.soft
        MarkdownStylerColors.accent = MarkdownStyler.accent
    }

    // MARK: Styling

    func restyle() {
        guard let host else { return }
        syntax = MarkdownSyntax(host.markdown)
        if raw { MarkdownStyler.applyRaw(to: host.storage) } else { MarkdownStyler.apply(syntax, to: host.storage) }
        // Decorations live in paragraph attributes; make TextKit 2 rebuild the fragments.
        if let tlm = host.layoutManager2 { tlm.invalidateLayout(for: tlm.documentRange) }
    }

    // MARK: Text changes

    func textDidChange() {
        guard !applying else { return }
        restyle()
        dirty = host?.markdown != storeBody
        scheduleSave()
    }

    /// Return / Backspace rules. false = handled here.
    func shouldChange(_ range: NSRange, _ replacement: String) -> Bool {
        guard !applying, !raw, let host else { return true }
        let text = host.markdown
        let sel = host.selection
        var edit: TextEdit?
        if replacement == "\n", range == sel {
            edit = MarkdownEditing.returnKey(text, sel)
        } else if replacement.isEmpty, range.length == 1, sel.length == 0, range.location == sel.location - 1 {
            edit = MarkdownEditing.backspace(text, sel)
        }
        guard let edit else { return true }
        apply(edit)
        return false
    }

    func apply(_ edit: TextEdit) {
        guard let host else { return }
        applying = true
        host.perform(edit)
        if edit.selection.location != NSNotFound { host.selection = edit.selection }
        applying = false
        textDidChange()
    }

    func selectionDidChange() {
        guard !applying, !raw, let host else { return }
        let sel = host.selection
        defer { previousSelection = host.selection }
        if let snapped = MarkdownEditing.snap(sel, previous: previousSelection, syntax: syntax), snapped != sel {
            applying = true
            host.selection = snapped
            applying = false
        }
    }

    // MARK: Aa

    func format(_ kind: FormatKind) {
        guard let host, !raw else { return }
        if kind == .link {
            let current = linkURL(at: host.selection.location) ?? ""
            onRequestLink(current) { [weak self] url in
                guard let self, let host = self.host else { return }
                if let edit = MarkdownEditing.format(.link, host.markdown, host.selection, url: url) { self.apply(edit) }
            }
            return
        }
        if let edit = MarkdownEditing.format(kind, host.markdown, host.selection) { apply(edit) }
    }

    /// First load into a fresh text view.
    func start(_ body: String) {
        storeBody = body
        dirty = false
        restyle()
    }

    // MARK: Taps (container coordinates)

    /// Is there a checkbox or link under this point? (Decides whether the tap is ours.)
    func isTappable(at point: CGPoint) -> Bool {
        guard !raw, let host, let tlm = host.layoutManager2 else { return false }
        if let frag = tlm.textLayoutFragment(for: point) as? BlockLayoutFragment, case .task = frag.decoration {
            let local = CGPoint(x: point.x - frag.layoutFragmentFrame.minX, y: point.y - frag.layoutFragmentFrame.minY)
            if frag.markerRect.insetBy(dx: -8, dy: -6).contains(local) { return true }
        }
        return link(at: point) != nil
    }

    /// Checkbox → toggles; link → opens. true if the tap was used (the caller then must
    /// not place the caret or bring up the keyboard).
    func handleTap(at point: CGPoint) -> Bool {
        guard !raw, let host, let tlm = host.layoutManager2 else { return false }
        if let frag = tlm.textLayoutFragment(for: point) as? BlockLayoutFragment, case .task = frag.decoration {
            let local = CGPoint(x: point.x - frag.layoutFragmentFrame.minX, y: point.y - frag.layoutFragmentFrame.minY)
            if frag.markerRect.insetBy(dx: -8, dy: -6).contains(local), let offset = paragraphOffset(of: frag, in: tlm),
               let line = syntax.line(at: offset), let edit = MarkdownEditing.toggleTask(host.markdown, line: line) {
                let keep = host.selection
                apply(TextEdit(range: edit.range, replacement: edit.replacement, selection: keep))
                return true
            }
        }
        if let link = link(at: point) {
            open(link)
            return true
        }
        return false
    }

    /// The link under a point, if the point is on its glyphs.
    func link(at point: CGPoint) -> String? {
        guard let offset = characterOffset(at: point), let host, offset < host.storage.length else { return nil }
        return host.storage.attribute(.vortexLink, at: offset, effectiveRange: nil) as? String
    }

    func linkURL(at offset: Int) -> String? {
        guard let host, offset < host.storage.length, offset >= 0 else { return nil }
        return host.storage.attribute(.vortexLink, at: offset, effectiveRange: nil) as? String
    }

    func linkRange(at offset: Int) -> NSRange? {
        guard let host, offset < host.storage.length else { return nil }
        var r = NSRange()
        return host.storage.attribute(.vortexLink, at: offset, longestEffectiveRange: &r, in: NSRange(location: 0, length: host.storage.length)) != nil ? r : nil
    }

    /// Opens http(s)/mailto URLs and wikilinks; anything else (javascript:, file:) stays inert.
    func open(_ link: String) {
        if link.hasPrefix("wikilink:") { return onWikilink(String(link.dropFirst(9))) }
        guard let url = Self.safeURL(link) else { return }
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    static func safeURL(_ link: String) -> URL? {
        var s = link.trimmingCharacters(in: .whitespaces)
        if s.lowercased().hasPrefix("www.") { s = "https://" + s }
        guard let url = URL(string: s), let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return nil }
        return url
    }

    /// Remove a link but keep its visible text.
    func unlink(at offset: Int) {
        guard let host, let span = syntax.inline(at: offset) else { return }
        guard case .link = span.kind else { return }
        let ns = host.markdown as NSString
        // The full markdown span: visible text plus adjacent hidden markers.
        var start = span.range.location, end = span.range.upperBound
        while let m = syntax.inlineMarkers.first(where: { $0.upperBound == start }) { start = m.location }
        while let m = syntax.inlineMarkers.first(where: { $0.location == end }) { end = m.upperBound }
        let full = NSRange(location: start, length: end - start)
        apply(TextEdit(range: full, replacement: ns.substring(with: span.range),
                       selection: NSRange(location: start + span.range.length, length: 0)))
    }

    // MARK: Hit testing (TextKit 2)

    func characterOffset(at point: CGPoint) -> Int? {
        guard let host, let tlm = host.layoutManager2, let frag = tlm.textLayoutFragment(for: point),
              let paraStart = paragraphOffset(of: frag, in: tlm) else { return nil }
        let p = CGPoint(x: point.x - frag.layoutFragmentFrame.minX, y: point.y - frag.layoutFragmentFrame.minY)
        for line in frag.textLineFragments where line.typographicBounds.contains(p) {
            let lp = CGPoint(x: p.x - line.typographicBounds.minX, y: p.y - line.typographicBounds.minY)
            let idx = line.characterIndex(for: lp)
            // characterIndex is the nearest insertion point; keep the glyph the point is on.
            for i in [idx - 1, idx] where i >= line.characterRange.location && i < line.characterRange.upperBound {
                let x0 = line.locationForCharacter(at: i).x, x1 = line.locationForCharacter(at: i + 1).x
                // Line character indexes are relative to the paragraph's attributed string.
                if lp.x >= min(x0, x1) && lp.x <= max(x0, x1) { return paraStart + i }
            }
        }
        return nil
    }

    private func paragraphOffset(of frag: NSTextLayoutFragment, in tlm: NSTextLayoutManager) -> Int? {
        guard let cm = tlm.textContentManager, let start = frag.textElement?.elementRange?.location else { return nil }
        return cm.offset(from: cm.documentRange.location, to: start)
    }

    // MARK: Saving & sync

    private func scheduleSave() {
        saveTask?.cancel()
        guard dirty else { return }
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    /// Save now if anything changed (leaving the note, app to background, Cmd-S).
    func flush() {
        saveTask?.cancel()
        guard dirty, let host else { return }
        let body = host.markdown
        storeBody = body
        dirty = false
        onSave(body)
    }

    /// The store's copy changed (sync pulled or merged). Take it unless we hold unsaved typing;
    /// then save first, so sync merges both instead of anything being overwritten.
    func storeChanged(_ body: String) {
        guard body != storeBody, let host else { return }
        if dirty {
            flush()
            return
        }
        storeBody = body
        guard body != host.markdown else { return }
        let old = host.markdown as NSString, new = body as NSString
        let sel = host.selection
        // Keep the caret where it was relative to the unchanged prefix / suffix.
        var prefix = 0
        while prefix < min(old.length, new.length) && old.character(at: prefix) == new.character(at: prefix) { prefix += 1 }
        let delta = new.length - old.length
        let loc = sel.location <= prefix ? sel.location : max(prefix, min(new.length, sel.location + delta))
        applying = true
        host.load(body, selection: NSRange(location: loc, length: 0))
        applying = false
        restyle()
    }
}
