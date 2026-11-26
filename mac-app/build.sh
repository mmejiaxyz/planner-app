#!/bin/zsh
# Builds "Planner.app" into mac-app/build. With --install, updates ~/Applications/Planner.app in place.
# Signs with the local "Planner Local Signing" certificate when it exists, so macOS keeps
# Calendar, Reminders, Microphone and Screen Recording permissions across updates.
# Your data lives in ~/Library/Application Support/Planner and is never touched by a build.
set -e
cd "${0:A:h}"
ROOT=..
source ./config.sh
APP="build/Planner.app"
REPO="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
VERSION="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
xcrun swiftc -O -parse-as-library -target arm64-apple-macos14.0 -sdk "$(xcrun --show-sdk-path)" \
  -framework AppKit -framework WebKit -framework EventKit -framework WidgetKit -framework PDFKit -framework Vision \
  -o "$APP/Contents/MacOS/Planner" Sources/main.swift Sources/Tracks.swift Sources/SyncCore.swift Sources/PhoneSync.swift Sources/Reading.swift Sources/ReaderOverlay.swift Sources/Backup.swift Sources/Hardcover.swift
cp Info.plist "$APP/Contents/Info.plist"
# Voice activity detection: keeps Whisper from inventing lines in silence and skips quiet parts (see vad/README.md).
cp vad/ggml-silero-v6.2.0.bin "$APP/Contents/Resources/"
# Reading versions of PDFs for the book-style reader: run with Docling's own Python (uv tool install "docling[ocrmac]").
mkdir -p "$APP/Contents/Resources/reading" && cp reading/convert.py "$APP/Contents/Resources/reading/"
# Desktop widgets (WidgetKit extension), sandboxed, reading only ~/Library/Application Support/Planner
WX="$APP/Contents/PlugIns/PlannerWidgets.appex"
mkdir -p "$WX/Contents/MacOS"
xcrun swiftc -O -parse-as-library -application-extension -target arm64-apple-macos14.0 -sdk "$(xcrun --show-sdk-path)" \
  -framework WidgetKit -framework SwiftUI -Xlinker -e -Xlinker _NSExtensionMain \
  -o "$WX/Contents/MacOS/PlannerWidgets" Widgets/PlannerWidgets.swift   # Xcode links extensions with -e _NSExtensionMain
cp Widgets/Info.plist "$WX/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleVersion $VERSION" -c "Set :CFBundleShortVersionString 1.$VERSION ($COMMIT)" "$APP/Contents/Info.plist"
[ -n "$REPO" ] && $PB -c "Add :PlannerRepo string $REPO" "$APP/Contents/Info.plist"
$PB -c "Add :PlannerBuilt integer $(date +%s)" "$APP/Contents/Info.plist"   # build time: the phone compares pages by it
$PB -c "Set :CFBundleIdentifier $PLANNER_BUNDLE_ID" -c "Add :PlannerKeychain string $PLANNER_KEYCHAIN" -c "Add :PlannerCloudSync bool $PLANNER_CLOUD" "$APP/Contents/Info.plist"
[ -d "$PLANNER_DATA" ] && $PB -c "Add :PlannerData string $PLANNER_DATA" "$APP/Contents/Info.plist"   # its text files go in the Cloudflare backup
$PB -c "Set :CFBundleIdentifier $PLANNER_BUNDLE_ID.widgets" "$WX/Contents/Info.plist"
# The profile (who and where, term, rules, colours, timetable) is data (config.sh). Without one the app runs on the
# page's defaults. The app copies it into plan.json once, when the plan has no profile yet (Store.init).
if [ -f "$PLANNER_PROFILE" ]; then cp "$PLANNER_PROFILE" "$APP/Contents/Resources/profile.json"; else echo "Note: no profile at $PLANNER_PROFILE; the app uses its defaults."; fi
cp "$ROOT/page/index_v2.html" "$APP/Contents/Resources/index.html"
mkdir -p "$APP/Contents/Resources/js" && cp "$ROOT"/page/js/*.js "$APP/Contents/Resources/js/"
mkdir -p "$APP/Contents/Resources/fonts" && cp "$ROOT"/page/fonts/* "$APP/Contents/Resources/fonts/"   # Literata for the reader, offline too
cp update.sh "$APP/Contents/Resources/update.sh"
if [ -f AppIcon.icns ]; then cp AppIcon.icns "$APP/Contents/Resources/"; $PB -c "Add :CFBundleIconFile string AppIcon" "$APP/Contents/Info.plist"; fi
ID="-"
if security find-identity -p codesigning | grep -q "Planner Local Signing"; then ID="Planner Local Signing"
else echo "Note: no 'Planner Local Signing' certificate; signing ad hoc (macOS will ask for permissions again)."; fi
# Sign the widget with its sandbox entitlements first, then the app around it (no --deep, so the widget keeps them).
codesign --force -s "$ID" --entitlements Widgets/Widgets.entitlements "$WX"
codesign --force -s "$ID" "$APP"
echo "Built $APP (1.$VERSION, $COMMIT)"
if [[ "$1" == "--install" ]]; then
  mkdir -p ~/Applications
  # Never replace an installed app that has another bundle id: macOS would ask for every permission again.
  OLD=$($PB -c "Print :CFBundleIdentifier" ~/Applications/Planner.app/Contents/Info.plist 2>/dev/null || true)
  if [[ -n "$OLD" && "$OLD" != "$PLANNER_BUNDLE_ID" ]]; then echo "Not installed: ~/Applications/Planner.app is $OLD, this build is $PLANNER_BUNDLE_ID. Set PLANNER_BUNDLE_ID in $PLANNER_DATA/local.env."; exit 5; fi
  # Update in place: same path, same bundle id, same signing identity.
  rsync -a --delete "$APP/" ~/Applications/Planner.app/
  # Let macOS pick up the widget (it also does this when the app launches).
  /usr/bin/pluginkit -a ~/Applications/Planner.app/Contents/PlugIns/PlannerWidgets.appex 2>/dev/null || true
  echo "Installed to ~/Applications/Planner.app"
fi
