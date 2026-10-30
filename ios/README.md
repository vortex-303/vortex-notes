# Vortex Notes for iOS and macOS

Native SwiftUI clients. All logic lives in the `VortexKit` Swift package, and the apps are thin layers on top.
Plan: capture-first iPhone app plus a menu-bar Mac app from the same code
(see the planning notes in the vault / STATUS.md).

## VortexKit

Dependency-free: CryptoKit plus CommonCrypto. XChaCha20 is HChaCha20 combined with CryptoKit's ChaChaPoly, and scrypt is implemented in-package.

| Module | Ports |
|---|---|
| `Crypto/` | `src/crypto.ts`: BIP39, HKDF, Ed25519/X25519, sealBox (custom, not libsodium), XChaCha20-Poly1305 payloads, scrypt |
| `Identity/` | `src/account.ts`: account keys from the 12 words, device/agent certs over JS-canonical JSON |
| `Relay/` | `src/relay/client.ts`: request signing, strict doc-id encoding, `/ws` subscribe frame |
| `Notes/` | `src/textutil.ts`, `src/notelock.ts`: doc payloads, frontmatter/title/slug, v1/v2 note locks, daily append |
| `Store/` | SQLite (system lib) local vault; local writes are the outbox; `find()` matches NFC/NFD names |
| `Sync/` | `src/sync.ts` rules + node-diff3 port; pages past 500; `Relay/LiveSync` = `/ws` pokes |
| `Identity/Enrollment` | sign in with 12 words, create account, resume with the device seal |

## Interop check (both directions)

```sh
npx tsx scripts/gen-interop-vectors.ts      # TypeScript → test/vectors/interop.json
(cd ios/VortexKit && swift test)            # Swift checks the vectors, writes test/vectors/swift-out.json
npx tsx test/interop-verify.ts              # TypeScript opens what Swift made
```

Run all three whenever crypto, cert or payload formats change on either side.

## Live end-to-end (real relay + real CLI as the other machine)

```sh
cd ios/VortexKit && VORTEX_LIVE=1 swift test --filter LiveRelayTests
```

Starts `src/relay/server.ts` on a random port and drives the CLI through `test/ios-peer.ts`. Covers:
- sign-in, pull, capture, edit and delete
- diff3 merge, conflict files, and an edit beating a delete
- paging past 500 updates (620 notes)
- resuming with the device seal
- `/ws` pokes
- no plaintext in `relay.db`

## Apps (iPhone + Mac)

```sh
cd ios && xcodegen          # generates VortexNotes.xcodeproj from project.yml (not committed)
open VortexNotes.xcodeproj  # schemes VortexNotes-iOS, VortexNotes-macOS
```

- `App/Shared`: model, Keychain, onboarding (12 words / new account), capture, notes, reader, search, settings.
- `App/iOS`: tabs. `App/macOS`: three-column window, plus a menu-bar quick capture.
- Before signing for a device: set `DEVELOPMENT_TEAM` and the bundle ids in `project.yml`. The placeholders are
  `dev.vortex303.notes` / `group.dev.vortex303.notes`.
- Dev-only environment variables:
  - `VORTEX_RELAY=http://127.0.0.1:<port>`: use a local relay.
  - `VORTEX_TEST_PHRASE="…"`: Debug builds sign in automatically.

UI smoke test against a local relay (start one with `npx tsx test/ios-peer.ts relay /tmp/r.db`, then make an
account with `… init <home> <vault> <url>`):

```sh
TEST_RUNNER_VORTEX_RELAY=http://127.0.0.1:<port> TEST_RUNNER_VORTEX_TEST_PHRASE="<12 words>" \
  xcodebuild test -project VortexNotes.xcodeproj -scheme VortexNotes-iOS -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
