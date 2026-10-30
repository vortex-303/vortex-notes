import SwiftUI
import VortexKit

/// The note editor: a system text view holding the raw markdown, styled to look rendered.
struct LiveMarkdownEditor {
    /// The note body as stored (frontmatter excluded).
    let body: String
    let raw: Bool
    let core: EditorCore
    /// New Note: put the caret in right away (otherwise the keyboard waits for a tap).
    var autofocus = false
}

#if os(iOS)
import UIKit

final class LiveTextView: UITextView, EditorHost {
    weak var core: EditorCore?

    var markdown: String { text ?? "" }
    var selection: NSRange {
        get { selectedRange }
        set { selectedRange = newValue }
    }
    var storage: NSTextStorage { textStorage }
    var layoutManager2: NSTextLayoutManager? { textLayoutManager }

    func perform(_ edit: TextEdit) {
        guard let start = position(from: beginningOfDocument, offset: edit.range.location),
              let end = position(from: start, offset: edit.range.length),
              let range = textRange(from: start, to: end) else { return }
        replace(range, withText: edit.replacement) // through the input system: undoable
    }

    func load(_ text: String, selection: NSRange) {
        textStorage.replaceCharacters(in: NSRange(location: 0, length: textStorage.length), with: text)
        selectedRange = selection
    }

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(title: "Bold", action: #selector(fmtBold), input: "b", modifierFlags: .command),
            UIKeyCommand(title: "Italic", action: #selector(fmtItalic), input: "i", modifierFlags: .command),
            UIKeyCommand(title: "Link", action: #selector(fmtLink), input: "k", modifierFlags: .command),
            UIKeyCommand(title: "Checklist", action: #selector(fmtChecklist), input: "l", modifierFlags: [.command, .shift]),
        ]
    }
    @objc func fmtBold() { core?.format(.bold) }
    @objc func fmtItalic() { core?.format(.italic) }
    @objc func fmtLink() { core?.format(.link) }
    @objc func fmtChecklist() { core?.format(.checklist) }
}

extension LiveMarkdownEditor: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator(core: core) }

    func makeUIView(context: Context) -> LiveTextView {
        let tv = LiveTextView(usingTextLayoutManager: true)
        tv.core = core
        core.host = tv
        tv.delegate = context.coordinator
        tv.textLayoutManager?.delegate = context.coordinator.fragments
        tv.backgroundColor = .clear
        tv.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 40, right: 12)
        tv.alwaysBounceVertical = true
        tv.keyboardDismissMode = .interactive
        tv.allowsEditingTextAttributes = false // paste stays plain text: the file is markdown
        tv.smartQuotesType = .no               // curly quotes would break markdown links
        tv.smartDashesType = .no
        tv.smartInsertDeleteType = .no
        tv.autocapitalizationType = .sentences
        tv.adjustsFontForContentSizeCategory = true
        tv.inputAccessoryView = context.coordinator.formatBar(for: core)
        tv.accessibilityIdentifier = "noteEditor"

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        tv.addGestureRecognizer(tap)
        context.coordinator.tap = tap

        tv.text = body
        core.start(body)
        if autofocus { DispatchQueue.main.async { tv.becomeFirstResponder() } }
        return tv
    }

    func updateUIView(_ tv: LiveTextView, context: Context) {
        if core.raw != raw {
            core.raw = raw
            core.restyle()
        }
        core.storeChanged(body)
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        let core: EditorCore
        let fragments = BlockFragmentProvider()
        weak var tap: UITapGestureRecognizer?

        init(core: EditorCore) { self.core = core }

        @MainActor func formatBar(for core: EditorCore) -> UIView {
            let host = UIHostingController(rootView: FormatBar(core: core))
            host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 46)
            host.view.backgroundColor = .clear
            host.view.autoresizingMask = [.flexibleWidth]
            host.sizingOptions = []
            return host.view
        }

        func textViewDidChange(_ textView: UITextView) {
            MainActor.assumeIsolated { core.textDidChange() }
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            MainActor.assumeIsolated { core.shouldChange(range, text) }
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            MainActor.assumeIsolated { core.selectionDidChange() }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            MainActor.assumeIsolated { core.flush() }
        }

        // Link / checkbox taps win over the text view's own taps (no caret, no keyboard).
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard g === tap, let tv = g.view as? UITextView else { return true }
            let p = containerPoint(g.location(in: tv), tv)
            return MainActor.assumeIsolated { core.isTappable(at: p) }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            g === tap && other !== tap
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = g.view as? UITextView else { return }
            let p = containerPoint(g.location(in: tv), tv)
            _ = MainActor.assumeIsolated { core.handleTap(at: p) }
        }

        private func containerPoint(_ p: CGPoint, _ tv: UITextView) -> CGPoint {
            CGPoint(x: p.x - tv.textContainerInset.left, y: p.y - tv.textContainerInset.top)
        }

        // Long-press a link → Open / Copy / Edit / Remove in the edit menu.
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            MainActor.assumeIsolated {
                guard let link = core.linkURL(at: range.location) else { return nil }
                var actions: [UIMenuElement] = []
                if link.hasPrefix("wikilink:") || EditorCore.safeURL(link) != nil {
                    actions.append(UIAction(title: "Open Link", image: UIImage(systemName: "arrow.up.right.square")) { [core] _ in core.open(link) })
                }
                if !link.hasPrefix("wikilink:") {
                    actions.append(UIAction(title: "Copy Link", image: UIImage(systemName: "link")) { _ in UIPasteboard.general.string = link })
                    actions.append(UIAction(title: "Edit Link…", image: UIImage(systemName: "pencil")) { [core] _ in
                        if let r = core.linkRange(at: range.location) { core.host?.selection = r }
                        core.format(.link)
                    })
                    actions.append(UIAction(title: "Remove Link", image: UIImage(systemName: "link.badge.minus")) { [core] _ in core.unlink(at: range.location) })
                }
                return UIMenu(children: [UIMenu(options: .displayInline, children: actions)] + suggestedActions)
            }
        }
    }
}

/// Above the keyboard: Aa formats, checklist, bullets, hide keyboard.
struct FormatBar: View {
    let core: EditorCore

    var body: some View {
        HStack(spacing: 18) {
            Menu {
                ForEach(FormatKind.allCases) { kind in
                    Button { core.format(kind) } label: { Label(kind.label, systemImage: kind.symbol) }
                }
            } label: {
                Text("Aa").font(.system(.body, design: .serif).weight(.semibold)).frame(minWidth: 32, minHeight: 32)
            }
            .accessibilityLabel("Format")
            Button { core.format(.checklist) } label: { Image(systemName: "checklist") }.accessibilityLabel("Checklist")
            Button { core.format(.bullets) } label: { Image(systemName: "list.bullet") }.accessibilityLabel("Bulleted list")
            Button { core.format(.bold) } label: { Image(systemName: "bold") }.accessibilityLabel("Bold")
            Spacer()
            Button {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            } label: { Image(systemName: "keyboard.chevron.compact.down") }
            .accessibilityLabel("Hide keyboard")
        }
        .font(.title3)
        .padding(.horizontal, 16)
        .frame(height: 46)
        .background(.bar)
    }
}

#else
import AppKit

final class LiveNSTextView: NSTextView, EditorHost {
    weak var core: EditorCore?

    var markdown: String { string }
    var selection: NSRange {
        get { selectedRange() }
        set { setSelectedRange(newValue) }
    }
    var storage: NSTextStorage { textStorage! }
    var layoutManager2: NSTextLayoutManager? { textLayoutManager }

    func perform(_ edit: TextEdit) {
        if shouldChangeText(in: edit.range, replacementString: edit.replacement) { // registers undo
            textStorage?.replaceCharacters(in: edit.range, with: edit.replacement)
            didChangeText()
        }
    }

    func load(_ text: String, selection: NSRange) {
        textStorage?.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: text)
        setSelectedRange(selection)
    }

    private func containerPoint(_ event: NSEvent) -> CGPoint {
        let p = convert(event.locationInWindow, from: nil)
        return CGPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 1, let core, core.handleTap(at: containerPoint(event)) { return }
        super.mouseDown(with: event)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        guard let core, let link = core.link(at: containerPoint(event)) else { return menu }
        let offset = core.characterOffset(at: containerPoint(event)) ?? 0
        let items: [NSMenuItem] = [
            ClosureMenuItem("Open Link") { core.open(link) },
        ] + (link.hasPrefix("wikilink:") ? [] : [
            ClosureMenuItem("Copy Link") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(link, forType: .string)
            },
            ClosureMenuItem("Edit Link…") { [weak self] in
                if let r = core.linkRange(at: offset) { self?.selection = r }
                core.format(.link)
            },
            ClosureMenuItem("Remove Link") { core.unlink(at: offset) },
        ])
        for (i, item) in items.enumerated() { menu.insertItem(item, at: i) }
        menu.insertItem(.separator(), at: items.count)
        return menu
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard window?.firstResponder === self, event.modifierFlags.contains(.command), let core else {
            return super.performKeyEquivalent(with: event)
        }
        let shift = event.modifierFlags.contains(.shift)
        switch (event.charactersIgnoringModifiers?.lowercased(), shift) {
        case ("b", false): core.format(.bold)
        case ("i", false): core.format(.italic)
        case ("k", false): core.format(.link)
        case ("l", true): core.format(.checklist)
        case ("s", false): core.flush()
        default: return super.performKeyEquivalent(with: event)
        }
        return true
    }

    override func paste(_ sender: Any?) { pasteAsPlainText(sender) } // the file is markdown
}

final class ClosureMenuItem: NSMenuItem {
    private let run: () -> Void
    init(_ title: String, _ run: @escaping () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }
    required init(coder: NSCoder) { fatalError("not used") }
    @objc private func fire() { run() }
}

extension LiveMarkdownEditor: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator(core: core) }

    func makeNSView(context: Context) -> NSScrollView {
        let tv = LiveNSTextView(usingTextLayoutManager: true)
        tv.core = core
        core.host = tv
        tv.delegate = context.coordinator
        tv.textLayoutManager?.delegate = context.coordinator.fragments
        tv.isRichText = true
        tv.importsGraphics = false
        tv.usesFontPanel = false
        tv.usesRuler = false
        tv.allowsUndo = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isContinuousSpellCheckingEnabled = true
        tv.drawsBackground = false
        tv.textContainerInset = NSSize(width: 28, height: 22)
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.minSize = .zero
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.textContainer?.widthTracksTextView = true
        tv.string = body
        core.start(body)

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = tv
        if autofocus { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { tv.window?.makeFirstResponder(tv) } }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        if core.raw != raw {
            core.raw = raw
            core.restyle()
        }
        core.storeChanged(body)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        let core: EditorCore
        let fragments = BlockFragmentProvider()
        init(core: EditorCore) { self.core = core }

        func textDidChange(_ notification: Notification) {
            MainActor.assumeIsolated { core.textDidChange() }
        }

        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
            MainActor.assumeIsolated { core.shouldChange(range, text ?? "") }
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            MainActor.assumeIsolated { core.selectionDidChange() }
        }

        func textDidEndEditing(_ notification: Notification) {
            MainActor.assumeIsolated { core.flush() }
        }
    }
}
#endif
