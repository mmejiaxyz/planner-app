#!/bin/zsh
# Planner self-update. Called by the app (Check for updates) with the repo path.
#   update.sh <repo> check   -> prints "behind=<n> ahead=<n> dirty=<0|1>"
#   update.sh <repo> apply   -> backs up data, pulls, builds, swaps the app once Planner has quit, relaunches.
set -e
REPO="$1"; MODE="$2"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$REPO"
git fetch --quiet origin
BEHIND=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
# The installed app can be older than this folder (commits made here and pushed, 27 Nov 2026): compare the commit it was
# built from ("1.N (abc1234)") with GitHub too, so Check for updates builds it.
INST=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$HOME/Applications/Planner.app/Contents/Info.plist" 2>/dev/null | sed -n 's/.*(\([0-9a-f]\{7,\}\)).*/\1/p')
BUILD=0
if [[ -n "$INST" ]] && git cat-file -e "$INST^{commit}" 2>/dev/null; then
  NB=$(git rev-list --count "$INST"..@{u} 2>/dev/null || echo 0)
  if [[ "$NB" -gt "$BEHIND" ]]; then BEHIND=$NB; BUILD=1; fi
fi
AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
DIRTY=$([ -n "$(git status --porcelain --untracked-files=no)" ] && echo 1 || echo 0)
if [[ "$MODE" == "check" ]]; then echo "behind=$BEHIND ahead=$AHEAD dirty=$DIRTY"; exit 0; fi
[[ "$BEHIND" == "0" ]] && { echo "Already up to date."; exit 0; }
[[ "$DIRTY" == "1" ]] && { echo "The code folder has unsaved changes. Commit or discard them, then update."; exit 3; }
# Back up the plan and the brain notes (not audio or models) before anything changes.
DATA="$HOME/Library/Application Support/Planner"
STAMP=$(date +%Y-%m-%d_%H%M%S)
mkdir -p "$DATA/backups/update-$STAMP"
cp "$DATA/plan.json" "$DATA/backups/update-$STAMP/" 2>/dev/null || true
rsync -a --exclude audio --exclude work "$DATA/brain/" "$DATA/backups/update-$STAMP/brain/" 2>/dev/null || true
[[ "$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)" == "0" ]] || git pull --ff-only --quiet
# the app is at the repo root (since 26 Nov 2026) or in winter-term-tracker/ (older layout)
MAC="$REPO/mac-app"; [ -d "$MAC" ] || MAC="$REPO/winter-term-tracker/mac-app"
"$MAC/build.sh" > "$DATA/backups/update-$STAMP/build.log" 2>&1 || { echo "Build failed. The app was not changed. Log: backups/update-$STAMP/build.log"; exit 4; }
# Swap after the running app quits, then reopen it. Same path, bundle id and signature keep permissions.
APPSRC="$MAC/build/Planner.app"
PB=/usr/libexec/PlistBuddy
NEW=$($PB -c "Print :CFBundleIdentifier" "$APPSRC/Contents/Info.plist"); OLD=$($PB -c "Print :CFBundleIdentifier" "$HOME/Applications/Planner.app/Contents/Info.plist" 2>/dev/null || echo "$NEW")
[[ "$NEW" == "$OLD" ]] || { echo "Not updated: the new build is $NEW, the installed app is $OLD. Check PLANNER_BUNDLE_ID in the data folder's local.env."; exit 5; }
nohup /bin/zsh -c "while pgrep -xq Planner; do sleep 0.5; done; rsync -a --delete '$APPSRC/' \"\$HOME/Applications/Planner.app/\"; open \"\$HOME/Applications/Planner.app\"" >/dev/null 2>&1 &
echo "Updated to $(git rev-parse --short HEAD). Restarting."
