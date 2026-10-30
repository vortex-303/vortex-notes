# Publishing Vortex on the App Store (iPhone + Mac)

What we have: Apple Developer team **K8YT3BZZAT** (Nicolas Ruggieri, individual, paid). On this Mac:
- Apple Development, Apple Distribution and Developer ID certificates
- the `dev.vortex303.*` prefix, already used by StickerGenie and RealtyAgent

The iPhone and Mac apps build from `ios/project.yml`.

## 1. Decisions (settled 2026-10-29)

| Decision | Settled |
|---|---|
| One listing for iPhone + Mac | **Yes**: both use `dev.vortex303.notes` (done in `project.yml`) |
| Store name | **Vortex Notes** (home-screen name "Vortex"). Reserve it by creating the App Store Connect record. |
| Devices | **iPhone only** (`TARGETED_DEVICE_FAMILY: 1`), using as many iPhone features as possible: Action Button, widgets (Home and Lock Screen), Control Center, Siri/Shortcuts, Dynamic Island / Live Activities, share sheet |
| Price | **Free** to start |
| Mac | **Mac App Store and a direct download.** One sandboxed build covers both. |
| Website | **Direct DMG download only**, no App Store badge. `ios/scripts/mac-dmg.sh` builds it; it needs `VORTEX_NOTARY_PROFILE` to notarize. |
| Daily note | **UTC for now.** Optional: chosen at sign-up, and changeable under Settings → Capture. When off, each capture becomes its own note. |

## 2. Blockers: things App Review requires that we don't have yet

1. **In-app account deletion (Guideline 5.1.1(v)).** Any app that lets people create an account must let them delete it in the app. The relay has no such endpoint today.
   - **Relay:** a signed `DELETE /v1/account`, allowed only for a device certified by the account. It deletes:
     - the account's devices and agents
     - its spaces and every update in them
     - its public pages
     - its connectors and OAuth tokens
     - its usage and admin rows

     Tests go in `test/relay.test.ts`.
   - **Apps:** Settings → "Delete account…". Confirm by typing the 12 words or the word DELETE, then sign out. Add the same option to the web app's Account menu.
2. **Privacy manifest** (`PrivacyInfo.xcprivacy`, in both apps). We use UserDefaults, which needs reason `CA92.1`. Tracking: none.
3. **Real app icon.** The current icon is the 512-px web icon scaled up, which is blurry. iOS needs a 1024×1024 PNG with no transparency; the Mac needs the full size set (or an Icon Composer `.icon` file).
4. ~~Mac App Sandbox~~ **Done**: `app-sandbox` + `network.client`. It runs sandboxed, and the store lives in the
   app's container. Still to do: the Keychain-sharing / App Group entitlements (M3).
5. **App Group** `group.dev.vortex303.notes`, registered for both platforms. The share extension, widgets and Siri intents (M3) all need it.
6. **Export compliance** (`ITSAppUsesNonExemptEncryption = NO` is already set in both Info.plists). The app uses encryption: E2EE with standard algorithms (XChaCha20-Poly1305, X25519, Ed25519, scrypt) that we implement ourselves, not only Apple's. In App Store Connect answer "uses encryption → standard algorithms, qualifies for exemption". Then set `ITSAppUsesNonExemptEncryption = NO` in Info.plist so each build stops asking. ⚠ Check whether a yearly US export self-classification report applies. That's a 10-minute form, but confirm it before the first submission.

## 3. App Store Connect setup (once, about an hour)

- **App IDs:** Xcode's automatic signing already registered `dev.vortex303.notes`. Turn on App Groups and Keychain Sharing for it on developer.apple.com.
- **New app record:**
  - platforms iOS + macOS
  - name "Vortex Notes"
  - bundle id `dev.vortex303.notes`
  - SKU `vortex-notes`
  - category Productivity
  - age rating 4+
- **URLs:**
  - Privacy policy: `https://vortex-notes.pages.dev/privacy` (already live)
  - Support: a page or email
  - Marketing: the landing page
- **App Privacy labels.** Draft, to check against what the relay stores:
  - *Data not collected* for note content: it's E2EE and we can't read it.
  - *Coarse location*, linked to the account, for analytics: the relay records the country of each signup.
  - *Identifiers*: the account's public key, used for app functionality.
  - Make sure the label matches the privacy page exactly.
- **App Review info.**
  - A demo account: 12 words for a test account that already has some notes.
  - A note explaining that the app is E2EE, so we can't see the reviewer's data, and that the words are the login (there is no password).
  - What "agents" means in the app.
- **Screenshots:**
  - iPhone 6.9" (1320×2868): Notes, Capture, Reader, Search, onboarding.
  - Mac (2880×1800): window and menu-bar capture.
  - The XCUITest flow can generate most of them.

## 4. Engineering before TestFlight

- Version 1.0.0 (build numbers auto-increment). `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` are set in `project.yml`.
- Release-build checks:
  - `VORTEX_TEST_PHRASE` only works in Debug builds (already the case).
  - Decide whether `VORTEX_RELAY` should keep working in Release. Recommendation: keep it, behind an "Advanced → custom relay" setting for self-hosters.
- Background refresh (`BGAppRefreshTask`, the `fetch` background mode, `BGTaskSchedulerPermittedIdentifiers`), so captures sync after the app goes to the background.
- Crash reporting: Xcode Organizer is free and needs no SDK. Keep it that way, in line with the brand.
- `NSAllowsLocalNetworking` stays in: it's allowed, and self-hosted relays on a LAN need it.
- Accessibility pass (VoiceOver labels, Dynamic Type), and a dark-mode screenshot check.

## 5. Build and upload

```sh
cd ios && xcodegen
# iPhone
xcodebuild -project VortexNotes.xcodeproj -scheme VortexNotes-iOS -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/VortexNotes-iOS.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/VortexNotes-iOS.xcarchive -exportPath build/export-ios \
  -exportOptionsPlist ExportOptions-AppStore.plist -allowProvisioningUpdates   # method: app-store-connect, destination: upload
# Mac: same, with -scheme VortexNotes-macOS -destination 'generic/platform=macOS'
```

- Uploading needs an App Store Connect API key (Users and Access → Integrations): `-authenticationKeyPath/-ID/-IssuerID`. Or upload from Xcode's Organizer.
- Add `scripts/ios-release.sh` to wrap the commands above, plus the DMG path: Developer ID export → `notarytool submit --wait` → `stapler staple`. That's the same pipeline MacKit Pro uses.

## 6. Rollout

1. **Internal TestFlight** (you plus up to 100 team members, no review): iPhone and Mac. Run TESTING.md-style checks on real devices against prod.
2. **External TestFlight** (a public link, up to 10k testers). Needs a light beta review, usually about a day. Good for the Show HN crowd.
3. **Submit 1.0** for iPhone and Mac together. Typical review takes 24–48 h. The likeliest rejection reasons:
   - account deletion (fixed in step 2)
   - the demo account not working
   - unclear wording on what "agents" do
4. **After launch:**
   - share sheet, widgets and Siri (M3)
   - semantic search (M4)
   - locked notes (M5)
   - iPad
   - subscriptions

## Order of work

1. Decisions (§1)
2. Account deletion (relay, web, apps)
3. Privacy manifest, icon, sandbox, App Group
4. Release script and internal TestFlight
5. Screenshots and listing
6. External beta
7. Submit

Steps 2–4 take about 2–3 focused days. Then it's mostly waiting on Apple.
