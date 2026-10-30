import SwiftUI
import VortexKit

/// The home screen: one field, focused on launch. Enter saves to today's note.
struct CaptureView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @FocusState private var focused: Bool
    @State private var justSaved = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                field
                today
            }
            .padding()
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Capture")
        .toolbar {
            ToolbarItem { SyncBadge() }
        }
    }

    private var field: some View {
        VStack(alignment: .trailing, spacing: 10) {
            TextField("What's on your mind?", text: $text, axis: .vertical)
                .lineLimit(3...10)
                .font(.title3)
                .focused($focused)
                .onSubmit(save)
                .padding(14)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.separator))
            HStack {
                if justSaved {
                    Label(model.dailyCaptures ? "Saved to today" : "Saved as a note", systemImage: "checkmark.circle.fill")
                        .font(.footnote).foregroundStyle(.tint)
                        .transition(.opacity)
                }
                Spacer()
                #if os(iOS)
                if focused {
                    // The keyboard stays up between captures; this is the way out to the tabs.
                    Button { focused = false } label: { Image(systemName: "keyboard.chevron.compact.down") }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Hide keyboard")
                }
                #endif
                Button(action: save) {
                    Label("Save", systemImage: "arrow.up.circle.fill").labelStyle(.titleAndIcon)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    @ViewBuilder
    private var today: some View {
        if model.dailyCaptures { dailyEntries } else { recent }
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent").font(.system(.headline, design: .serif))
            ForEach(model.recentNotes, id: \.path) { note in
                NavigationLink(value: note.path) { NoteRowView(note: note, sort: .created) }
                    .buttonStyle(.plain)
                Divider()
            }
        }
    }

    @ViewBuilder
    private var dailyEntries: some View {
        let entries = Self.entries(model.today?.content ?? "")
        VStack(alignment: .leading, spacing: 10) {
            Text("Today").font(.system(.headline, design: .serif))
            if entries.isEmpty {
                Text("Nothing captured yet today.").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(Array(entries.reversed().enumerated()), id: \.offset) { _, e in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(e.time).font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 40, alignment: .leading)
                        Text(MarkdownView.inline(e.text)).font(.body)
                    }
                    Divider()
                }
            }
        }
    }

    private func save() {
        model.capture(text)
        text = ""
        withAnimation { justSaved = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { justSaved = false }
        }
    }

    /// `- **HH:MM** text` lines from a daily note.
    static func entries(_ content: String) -> [(time: String, text: String)] {
        NoteText.splitFrontmatter(content).body.components(separatedBy: "\n").compactMap { line in
            guard let m = line.firstMatch(of: /^- \*\*(\d{2}:\d{2})\*\* (.*)$/) else { return nil }
            return (String(m.1), String(m.2))
        }
    }
}

/// Small sync status indicator; tap to sync now.
struct SyncBadge: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            Task { await model.sync() }
        } label: {
            switch model.syncState {
            case .syncing: ProgressView().controlSize(.small)
            case .offline: Image(systemName: "icloud.slash").foregroundStyle(.orange)
            case .synced: Image(systemName: "checkmark.icloud").foregroundStyle(.secondary)
            case .idle: Image(systemName: "icloud").foregroundStyle(.secondary)
            }
        }
        .help(helpText)
        .accessibilityLabel(helpText)
    }

    private var helpText: String {
        switch model.syncState {
        case .syncing: "Syncing…"
        case .offline(let why): "Offline, changes are saved on this device. \(why)"
        case .synced(let at): "Synced \(at.formatted(.relative(presentation: .named)))"
        case .idle: "Not synced yet"
        }
    }
}
