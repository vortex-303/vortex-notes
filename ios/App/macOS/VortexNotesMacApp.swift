import SwiftUI
import VortexKit

@main
struct VortexNotesMacApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup("Vortex") {
            MacRootView()
                .environment(model)
                .task { await model.launch() }
                .frame(minWidth: 760, minHeight: 480)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Note") { model.newNote() }.keyboardShortcut("n")
                    .disabled(model.phase != .ready)
                Button("Sync Now") { Task { await model.sync() } }.keyboardShortcut("r")
            }
        }

        Settings {
            SettingsView().environment(model).frame(width: 460, height: 420)
        }

        // Quick capture from anywhere. The global hotkey comes in M6.
        MenuBarExtra {
            QuickCaptureView().environment(model)
        } label: {
            Image("MenuBarLogo").renderingMode(.template).accessibilityLabel("Vortex")
        }
        .menuBarExtraStyle(.window)
    }
}

struct MacRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.phase {
        case .loading: ProgressView()
        case .onboarding: OnboardingView()
        case .newPhrase(let phrase): NewPhraseView(phrase: phrase)
        case .ready: MacMainView()
        }
    }
}

struct MacMainView: View {
    @Environment(AppModel.self) private var model
    @State private var selection: String?
    @State private var query = ""
    static let captureTag = "__capture__"

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                List(selection: $selection) {
                    Label("Capture", systemImage: "square.and.pencil").tag(Self.captureTag)
                }
                .frame(height: 44)
                .scrollDisabled(true)
                if query.isEmpty {
                    NotesListView(selection: $selection)
                } else {
                    List(model.search(query), id: \.path, selection: $selection) { NoteRowView(note: $0).tag($0.path) }
                }
            }
            .searchable(text: $query, placement: .sidebar, prompt: "Search notes")
            .navigationSplitViewColumnWidth(min: 220, ideal: 260)
            .toolbar { ToolbarItem { SyncBadge() } }
            .onChange(of: model.openRequest) { _, path in
                guard let path else { return }
                query = ""
                selection = path
                model.openRequest = nil
            }
        } detail: {
            NavigationStack {
                if selection == nil {
                    ContentUnavailableView("Select a note", systemImage: "note.text",
                                           description: Text("Press ⌘N for a new note, or choose Capture to jot something into today's note."))
                } else if selection == Self.captureTag {
                    CaptureView()
                } else {
                    NoteView(path: selection!).id(selection)
                }
            }
        }
    }
}

/// The menu-bar panel: type, Return, gone.
struct QuickCaptureView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.phase != .ready {
                Text("Open Vortex to sign in first.").foregroundStyle(.secondary)
            } else {
                Text("Capture to today").font(.headline)
                TextField("What's on your mind?", text: $text, axis: .vertical)
                    .lineLimit(2...6)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit(save)
                HStack {
                    SyncBadge()
                    Spacer()
                    Button("Save", action: save).keyboardShortcut(.return, modifiers: .command).buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(14)
        .frame(width: 340)
        .onAppear { focused = true }
    }

    private func save() {
        model.capture(text)
        text = ""
    }
}
