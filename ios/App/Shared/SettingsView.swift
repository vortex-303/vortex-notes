import SwiftUI
import VortexKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var usage: (Int64, Int64?)?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleteError: String?
    @State private var deleting = false

    var body: some View {
        Form {
            Section("Account") {
                LabeledContent("Fingerprint") {
                    Text(model.fingerprint).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                }
                LabeledContent("This device", value: model.identity?.cert.name ?? "")
            }
            Section {
                @Bindable var model = model
                Toggle("Daily note", isOn: $model.dailyCaptures)
            } header: {
                Text("Capture")
            } footer: {
                Text(model.dailyCaptures
                     ? "Captures are added to today's note (daily/YYYY-MM-DD), each with its time."
                     : "Each capture becomes its own note, titled by its first line.")
            }
            Section {
                @Bindable var model = model
                Toggle("Open notes as markdown", isOn: $model.markdownByDefault)
            } header: {
                Text("Editor")
            } footer: {
                Text("Notes open formatted, like Apple Notes. Turn this on to see the raw markdown instead; ⋯ → Edit markdown switches a single note.")
            }
            Section("Sync") {
                LabeledContent("Status", value: statusText)
                LabeledContent("Relay", value: model.relayURL.host() ?? model.relayURL.absoluteString)
                if let usage {
                    LabeledContent("Storage") {
                        Text(usage.1.map { "\(Self.mb(usage.0)) of \(Self.mb($0))" } ?? Self.mb(usage.0))
                    }
                }
                LabeledContent("Notes on this device", value: "\(model.notes.count)")
                Button("Sync now") { Task { await model.sync() } }
            }
            Section {
                Button("Sign out of this device", role: .destructive) { confirmSignOut = true }
            } footer: {
                Text("Removes this device's keys and its copy of your notes. Notes stay safe on your other devices. You'll need your 12 words to sign in again.")
            }
            Section {
                Button(deleting ? "Deleting…" : "Delete Account…", role: .destructive) { confirmDelete = true }
                    .disabled(deleting)
                    .accessibilityIdentifier("deleteAccount")
            } footer: {
                Text(deleteError ?? "Permanently deletes your notes, devices, agents and chat connectors from the server, on every device. This can't be undone.")
                    .foregroundStyle(deleteError == nil ? Color.secondary : Color.red)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .task { usage = await model.usage() }
        .confirmationDialog("Sign out of this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { model.signOut() }
        }
        .confirmationDialog("Delete your account and all of your notes?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Account", role: .destructive) {
                deleting = true
                deleteError = nil
                Task {
                    do {
                        try await model.deleteAccount()
                    } catch {
                        deleteError = "Couldn't delete the account: \(error.localizedDescription). Nothing was removed; try again when you're online."
                    }
                    deleting = false
                }
            }
        } message: {
            Text("Everything on the server is removed for good, on every device. Your 12 words will no longer open any notes.")
        }
    }

    private var statusText: String {
        switch model.syncState {
        case .syncing: "Syncing…"
        case .offline(let why): "Offline: \(why)"
        case .synced(let at): "Synced \(at.formatted(date: .omitted, time: .shortened))"
        case .idle: "Not synced yet"
        }
    }

    static func mb(_ bytes: Int64) -> String { ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) }
}
