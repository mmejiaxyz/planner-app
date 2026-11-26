#!/bin/zsh
# Builds Planner for iPhone as an unsigned .ipa in ios-app/build/Planner.ipa, for AltStore (which signs it with your
# Apple ID when it installs it). No Xcode project; needs Xcode's iOS SDK.
#   ./build.sh          build the .ipa
#   ./build.sh --check  only compile, for the iPhone and the simulator SDKs (no bundle)
set -e
cd "${0:A:h}"
ROOT=..
source ../mac-app/config.sh
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
SRC=(Sources/PhoneApp.swift Sources/PhoneReader.swift "$ROOT/mac-app/Sources/SyncCore.swift")
FLAGS=(-O -parse-as-library -module-name Planner -framework UIKit -framework WebKit -framework AVFoundation -framework PDFKit -framework Vision)
if [[ "$1" == "--check" ]]; then
  xcrun swiftc -typecheck "${FLAGS[@]}" -target arm64-apple-ios17.0 -sdk "$SDK" "${SRC[@]}"
  xcrun swiftc -typecheck "${FLAGS[@]}" -target arm64-apple-ios17.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" "${SRC[@]}"
  echo "Compiles for iPhone and simulator."; exit 0
fi
VERSION="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"
rm -rf build; APP="build/Payload/Planner.app"; mkdir -p "$APP/web/js"
xcrun swiftc "${FLAGS[@]}" -target arm64-apple-ios17.0 -sdk "$SDK" -o "$APP/Planner" "${SRC[@]}"
cp Info.plist "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $PLANNER_PHONE_ID" -c "Add :PlannerKeychain string $PLANNER_PHONE_KEYCHAIN" -c "Add :PlannerCloudSync bool $PLANNER_CLOUD" "$APP/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleVersion $VERSION" -c "Set :CFBundleShortVersionString 1.$VERSION" "$APP/Info.plist"
$PB -c "Add :PlannerBuilt integer $(date +%s)" "$APP/Info.plist"   # build time: newer pages win, see Pages in PhoneApp.swift
$PB -c "Add :DTPlatformName string iphoneos" -c "Add :DTSDKName string iphoneos$(xcrun --sdk iphoneos --show-sdk-version)" "$APP/Info.plist"
plutil -convert binary1 "$APP/Info.plist"
# the profile (timetable, rules) comes from the Mac in the plan snapshot
cp "$ROOT/page/index_v2.html" "$APP/web/index.html"
cp "$ROOT"/page/js/*.js "$APP/web/js/"
mkdir -p "$APP/web/fonts" && cp "$ROOT"/page/fonts/* "$APP/web/fonts/"   # Literata for the book reader
cp shim.js "$APP/shim.js"
ICON="$ROOT/mac-app/AppIcon.png"
if [ -f "$ICON" ]; then
  sips -s format png -z 120 120 "$ICON" --out "$APP/AppIcon60x60@2x.png" >/dev/null
  sips -s format png -z 180 180 "$ICON" --out "$APP/AppIcon60x60@3x.png" >/dev/null
fi
(cd build && rm -f Planner.ipa && zip -qry Planner.ipa Payload)
echo "Built ios-app/build/Planner.ipa (1.$VERSION, $COMMIT). Install it with AltStore: My Apps › + › Planner.ipa."
