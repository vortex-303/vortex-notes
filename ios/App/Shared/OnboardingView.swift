import SwiftUI
import VortexKit

/// First run: sign in with the 12 words, or create a new account.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var mode: Mode = .welcome
    @State private var busy = false
    @State private var error: String?

    enum Mode { case welcome, phrase }

    var body: some View {
        NavigationStack {
            Group {
                switch mode {
                case .welcome: welcome
                case .phrase: PhraseEntryView(busy: $busy, error: $error)
                }
            }
            .animation(.snappy, value: mode)
        }
    }

    private var welcome: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 14) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 56)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text("Vortex Notes")
                    .font(.system(.largeTitle, design: .serif).weight(.semibold))
                Text("Your notes, end-to-end encrypted,\nand shared with the agents you choose.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                Button {
                    mode = .phrase
                } label: {
                    Text("Sign in with my 12 words").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button {
                    Task { await create() }
                } label: {
                    if busy { ProgressView().frame(maxWidth: .infinity) } else {
                        Text("Create a new account").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(busy)

                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
                RelayFooter()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .frame(maxWidth: 440)
        }
        .frame(maxWidth: .infinity)
    }

    private func create() async {
        busy = true
        error = nil
        do { try await model.createAccount() } catch { self.error = error.localizedDescription }
        busy = false
    }
}

/// Type or paste the 12 words, with word suggestions and a live validity check.
struct PhraseEntryView: View {
    @Environment(AppModel.self) private var model
    @Binding var busy: Bool
    @Binding var error: String?
    @State private var text = ""
    @FocusState private var focused: Bool

    private var words: [String] { BIP39.normalize(text).split(separator: " ").map(String.init) }
    private var valid: Bool { words.count == 12 && BIP39.isValid(text) }
    private var partial: String {
        guard let last = text.split(whereSeparator: \.isWhitespace).last, !text.hasSuffix(" ") else { return "" }
        return String(last).lowercased()
    }
    private var suggestions: [String] {
        let s = BIP39.suggestions(partial)
        return s == [partial] ? [] : s
    }
    private var unknownWords: [String] {
        words.dropLast(partial.isEmpty ? 0 : 1).filter { !BIP39.words.contains($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Enter your 12 words")
                .font(.system(.title2, design: .serif).weight(.semibold))
            Text("They're your account. They never leave this device; it uses them once to create its own keys.")
                .font(.callout).foregroundStyle(.secondary)

            TextField("legal winner thank year …", text: $text, axis: .vertical)
                .lineLimit(3...6)
                .font(.system(.body, design: .monospaced))
                .focused($focused)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.asciiCapable)
                #endif
                .privacySensitive()
                .padding(12)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))

            if !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(suggestions, id: \.self) { word in
                            Button(word) { complete(word) }.buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
            }

            HStack {
                Label("\(min(words.count, 12)) of 12", systemImage: valid ? "checkmark.seal.fill" : "seal")
                    .foregroundStyle(valid ? Color.accentColor : .secondary)
                Spacer()
                if !unknownWords.isEmpty {
                    Text("Not a recovery word: \(unknownWords.joined(separator: ", "))")
                        .foregroundStyle(.red)
                } else if words.count == 12 && !valid {
                    Text("Checksum doesn't match. One word is off.").foregroundStyle(.red)
                }
            }
            .font(.footnote)

            Button {
                Task { await submit() }
            } label: {
                if busy { ProgressView().frame(maxWidth: .infinity) } else { Text("Sign in").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!valid || busy)

            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            Spacer()
            RelayFooter()
        }
        .padding(24)
        .frame(maxWidth: 520)
        .onAppear { focused = true }
    }

    private func complete(_ word: String) {
        var parts = text.split(whereSeparator: \.isWhitespace).map(String.init)
        if !parts.isEmpty { parts.removeLast() }
        parts.append(word)
        text = parts.joined(separator: " ") + (parts.count < 12 ? " " : "")
    }

    private func submit() async {
        busy = true
        error = nil
        do { try await model.signIn(phrase: text) } catch { self.error = error.localizedDescription }
        busy = false
    }
}

/// Shown once after creating an account.
struct NewPhraseView: View {
    @Environment(AppModel.self) private var model
    let phrase: String
    @State private var saved = false
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Your 12 words")
                    .font(.system(.title, design: .serif).weight(.semibold))
                Text("These words ARE your account. Anyone who has them can read your notes, and nobody, including us, can recover them for you. Write them down or store them in a password manager.")
                    .font(.callout).foregroundStyle(.secondary)

                let words = phrase.split(separator: " ").map(String.init)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(Array(words.enumerated()), id: \.offset) { i, w in
                        HStack(spacing: 6) {
                            Text("\(i + 1)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary).frame(width: 18, alignment: .trailing)
                            Text(w).font(.system(.body, design: .monospaced))
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 10)
                        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .privacySensitive()

                Button {
                    Clipboard.copy(phrase)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy words", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.bordered)

                CaptureStylePicker()

                Toggle("I saved these words somewhere safe", isOn: $saved)

                Button {
                    model.confirmedPhrase()
                } label: {
                    Text("Continue").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!saved)
            }
            .padding(24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
    }
}

/// Sign-up choice; also in Settings → Capture.
struct CaptureStylePicker: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 8) {
            Text("Where should captures go?").font(.headline)
            Picker("Captures", selection: $model.dailyCaptures) {
                Text("Today's daily note").tag(true)
                Text("A new note each").tag(false)
            }
            .pickerStyle(.segmented)
            Text("You can change this anytime in Settings.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct RelayFooter: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Text("Relay: \(model.relayURL.host() ?? model.relayURL.absoluteString)")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity)
    }
}
