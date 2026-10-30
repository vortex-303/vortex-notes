import SwiftUI
import VortexKit

enum NoteSort: String, CaseIterable, Identifiable {
    case modified, created
    var id: String { rawValue }
    var label: String { self == .modified ? "Last modified" : "Date created" }
}

/// All notes, newest first (by modification or creation), pinned notes on top.
struct NotesListView: View {
    @Environment(AppModel.self) private var model
    var selection: Binding<String?>? = nil
    @AppStorage("noteSort") private var sort: NoteSort = .modified

    var body: some View {
        let pinned = model.pinnedNotes
        let others = model.sortedNotes(sort).filter { !model.isPinned($0.path) }
        List(selection: selection) {
            if model.notes.isEmpty {
                ContentUnavailableView("No notes yet", systemImage: "note.text",
                                       description: Text("Tap the pencil for a new note, capture something, or wait for your other devices to sync."))
            }
            if !pinned.isEmpty {
                Section {
                    ForEach(pinned, id: \.path) { row($0, pinned: true) }
                }
            }
            Section {
                ForEach(others, id: \.path) { row($0, pinned: false) }
            } header: {
                if !pinned.isEmpty { Text(sort.label) }
            }
        }
        .refreshable { await model.sync() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { model.newNote() } label: { Label("New Note", systemImage: "square.and.pencil") }
                    .accessibilityIdentifier("newNote")
            }
            ToolbarItem {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(NoteSort.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ note: NoteRow, pinned: Bool) -> some View {
        Group {
            if selection == nil {
                NavigationLink(value: note.path) { NoteRowView(note: note, pinned: pinned, sort: sort) }
            } else {
                NoteRowView(note: note, pinned: pinned, sort: sort).tag(note.path)
            }
        }
        .contextMenu { PinButton(path: note.path) }
        #if os(iOS)
        .swipeActions(edge: .leading) { PinButton(path: note.path).tint(.accentColor) }
        #endif
    }
}

/// Pin / Unpin, disabled once 6 notes are pinned.
struct PinButton: View {
    @Environment(AppModel.self) private var model
    let path: String

    var body: some View {
        if model.isPinned(path) {
            Button { model.togglePin(path) } label: { Label("Unpin", systemImage: "pin.slash") }
        } else {
            Button { model.togglePin(path) } label: {
                Label(model.canPin ? "Pin to top" : "Pin (max \(AppModel.maxPins))", systemImage: "pin")
            }
            .disabled(!model.canPin)
        }
    }
}

struct NoteRowView: View {
    let note: NoteRow
    var pinned = false
    var sort: NoteSort = .modified

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(note.title).lineLimit(1)
                Text(Self.snippet(note.content)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(meta).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if NoteLock.isLocked(note.content) { Image(systemName: "lock.fill").font(.caption).foregroundStyle(.secondary) }
            if note.path.contains(".conflict-") { Image(systemName: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
            if pinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(45))
                    .accessibilityLabel("Pinned")
            }
        }
    }

    private var meta: String {
        let date = Date(timeIntervalSince1970: Double(sort == .created ? note.createdMs : note.mtimeMs) / 1000)
        let when = date.formatted(.relative(presentation: .named))
        let folder = note.path.contains("/") ? String(note.path[..<note.path.lastIndex(of: "/")!]) : ""
        return folder.isEmpty ? when : "\(folder) · \(when)"
    }

    static func snippet(_ content: String) -> String {
        let body = NoteText.splitFrontmatter(content).body
        return body.split(separator: "\n").first { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("#") && !$0.isEmpty }
            .map { line in
                String(line).replacingOccurrences(of: "**", with: "")
                    .replacingOccurrences(of: #"^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?"#, with: "", options: .regularExpression)
            } ?? ""
    }
}

/// A note opens straight into the live editor (Apple Notes style): formatted text you type
/// into; the keyboard comes up only when you tap. ⋯ → Edit markdown shows the raw text.
struct NoteView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let path: String
    @State private var core = EditorCore(body: "", raw: false)
    @State private var confirmDelete = false
    @State private var linkedPath: String?
    @State private var toast: String?
    @State private var linkPrompt: LinkPrompt?

    struct LinkPrompt: Identifiable {
        let id = UUID()
        var url: String
        let done: (String) -> Void
    }

    var body: some View {
        Group {
            if let note = model.notes.first(where: { $0.path == path }) {
                content(note)
            } else {
                ContentUnavailableView("Note not found", systemImage: "questionmark.folder")
            }
        }
        .confirmationDialog("Delete this note on every device?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                model.delete(path: path)
                dismiss()
            }
        }
        .navigationDestination(item: $linkedPath) { NoteView(path: $0) }
        .alert("Link", isPresented: Binding(get: { linkPrompt != nil }, set: { if !$0 { linkPrompt = nil } })) {
            TextField("https://", text: Binding(get: { linkPrompt?.url ?? "" }, set: { linkPrompt?.url = $0 }))
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) { linkPrompt = nil }
            Button("Add Link") {
                if let p = linkPrompt { p.done(p.url) }
                linkPrompt = nil
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.footnote).padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule()).padding(.bottom, 24)
                    .transition(.opacity)
            }
        }
        .onAppear(perform: wire)
        .onDisappear {
            core.flush()
            model.discardIfEmpty(path)
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { core.flush() } }
    }

    @ViewBuilder
    private func content(_ note: NoteRow) -> some View {
        let locked = NoteLock.isLocked(note.content)
        let raw = model.isRaw(path)
        Group {
            if locked {
                ContentUnavailableView("Password-protected", systemImage: "lock.fill",
                                       description: Text("Unlocking on this device is coming soon. Open it in the web app for now."))
            } else {
                LiveMarkdownEditor(body: AppModel.noteParts(note.content).body, raw: raw, core: core, autofocus: path == model.freshNote)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                    .ignoresSafeArea(.container, edges: .bottom)
            }
        }
        .navigationTitle(note.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if os(macOS)
            if !locked && !raw {
                ToolbarItem {
                    Menu {
                        ForEach(FormatKind.allCases) { kind in
                            Button { core.format(kind) } label: { Label(kind.label, systemImage: kind.symbol) }
                        }
                    } label: { Text("Aa").font(.system(.body, design: .serif).weight(.semibold)) }
                    .help("Format")
                }
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if !locked {
                        Button {
                            core.flush()
                            model.setRaw(path, !raw)
                        } label: {
                            raw ? Label("Rich text", systemImage: "textformat") : Label("Edit markdown", systemImage: "chevron.left.forwardslash.chevron.right")
                        }
                    }
                    PinButton(path: path)
                    Button { Clipboard.copy(note.content) } label: { Label("Copy content", systemImage: "doc.on.doc") }
                    ShareLink(item: note.content) { Label("Share", systemImage: "square.and.arrow.up") }
                    Divider()
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Note menu")
            }
        }
    }

    private func wire() {
        let path = path
        core.onSave = { [model] body in model.saveBody(path: path, body: body) }
        core.onWikilink = { target in
            if let p = model.resolveWikilink(target) {
                core.flush()
                linkedPath = p
            } else {
                show("No note named \"\(target)\"")
            }
        }
        core.onRequestLink = { current, done in linkPrompt = LinkPrompt(url: current.hasPrefix("wikilink:") ? "" : current, done: done) }
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            withAnimation { toast = nil }
        }
    }
}

struct SearchResultsView: View {
    @Environment(AppModel.self) private var model
    let query: String

    var body: some View {
        let results = model.search(query)
        List {
            if results.isEmpty {
                ContentUnavailableView.search(text: query)
            }
            ForEach(results, id: \.path) { note in
                NavigationLink(value: note.path) { NoteRowView(note: note) }
            }
        }
    }
}

enum Clipboard {
    @MainActor static func copy(_ s: String) {
        #if os(iOS)
        UIPasteboard.general.string = s
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #endif
    }
}
