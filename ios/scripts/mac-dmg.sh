#!/usr/bin/env bash
# Direct-download Mac build: Developer ID signed, sandboxed, notarized DMG.
#
#   ios/scripts/mac-dmg.sh                  # build + sign (not notarized: Gatekeeper will warn)
#   VORTEX_NOTARY_PROFILE=<name> ios/scripts/mac-dmg.sh   # + notarize + staple (ready for the website)
#
# Create the profile once: xcrun notarytool store-credentials <name> --apple-id <id> --team-id K8YT3BZZAT
# Output: ios/build/release/VortexNotes.dmg (+ .sha256)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/release
ARCHIVE=$OUT/VortexNotes-macOS.xcarchive
DMG=$OUT/VortexNotes.dmg
IDENTITY="Developer ID Application: Nicolas Ruggieri (K8YT3BZZAT)"

rm -rf "$OUT" && mkdir -p "$OUT"
xcodegen generate >/dev/null
xcodebuild -project VortexNotes.xcodeproj -scheme VortexNotes-macOS -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" -allowProvisioningUpdates archive -quiet
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist ExportOptions-DeveloperID.plist -allowProvisioningUpdates -quiet

STAGE=$OUT/dmg
mkdir -p "$STAGE"
cp -R "$OUT/export/Vortex.app" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Vortex Notes" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
codesign --sign "$IDENTITY" --timestamp "$DMG"

if [[ -n "${VORTEX_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$VORTEX_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
else
  echo "Not notarized (set VORTEX_NOTARY_PROFILE). Fine for testing, not for the website."
fi
shasum -a 256 "$DMG" | tee "$DMG.sha256"
