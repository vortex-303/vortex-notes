import SwiftUI
import VortexKit

@main
struct VortexNotesApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.launch() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.sync() } }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.phase {
        case .loading: ProgressView()
        case .onboarding: OnboardingView()
        case .newPhrase(let phrase): NewPhraseView(phrase: phrase)
        case .ready: MainTabs()
        }
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var tab = 0
    @State private var notesPath: [String] = []

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $notesPath) {
                NotesListView()
                    .navigationTitle("Notes")
                    .navigationDestination(for: String.self) { NoteView(path: $0) }
            }
            .tabItem { Label("Notes", systemImage: "folder") }
            .tag(0)

            NavigationStack {
                CaptureView().navigationDestination(for: String.self) { NoteView(path: $0) }
            }
            .tabItem { Label("Capture", systemImage: "tray.and.arrow.down") }
            .tag(1)

            NavigationStack {
                Group {
                    if query.isEmpty {
                        ContentUnavailableView("Search your notes", systemImage: "magnifyingglass",
                                               description: Text("Titles, folders and text. Search runs on this device; nothing is sent anywhere."))
                    } else {
                        SearchResultsView(query: query)
                    }
                }
                .navigationTitle("Search")
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
                .navigationDestination(for: String.self) { NoteView(path: $0) }
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }
            .tag(2)

            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(3)
        }
        // New Note (from any tab): show Notes and open the blank note.
        .onChange(of: model.openRequest) { _, path in
            guard let path else { return }
            tab = 0
            notesPath = [path]
            model.openRequest = nil
        }
    }
}
