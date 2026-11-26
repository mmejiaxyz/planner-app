# Settings that belong to one person's build, not to the app: read by mac-app/build.sh, ios-app/build.sh and
# sync-worker/setup.sh. They live in the private data folder (default: planner-data next to this repo), in local.env:
#   PLANNER_BUNDLE_ID   bundle id of the Mac app (the widget adds .widgets, the iPhone app .phone); never change it
#                       once installed, or macOS asks for every permission again and the iPhone loses its key
#   PLANNER_PHONE_ID    bundle id of the iPhone app (default: PLANNER_BUNDLE_ID.phone). It is in the public .ipa, so it
#                       should not name anyone; changing it makes a new app on the phone (pair again)
#   PLANNER_PROFILE     the profile copied into a new plan (default: profile.json in the data folder)
#   PLANNER_CLOUD_SYNC  1 turns on iPhone sync through your own Cloudflare Worker. Off by default: a build from the
#                       repo never contacts a Worker and has no Pair iPhone… menu (no local Wi-Fi sync exists yet)
#   WRANGLER            the wrangler command for the sync Worker (default: npx wrangler)
# The caller sets ROOT (the repo root, relative to its own folder).
PLANNER_DATA="${PLANNER_DATA:-${ROOT:A}/../planner-data}"
PLANNER_DATA="${PLANNER_DATA:A}"
[ -f "$PLANNER_DATA/local.env" ] && source "$PLANNER_DATA/local.env"
PLANNER_BUNDLE_ID="${PLANNER_BUNDLE_ID:-local.planner}"
PLANNER_PROFILE="${PLANNER_PROFILE:-$PLANNER_DATA/profile.json}"
PLANNER_KEYCHAIN="$PLANNER_BUNDLE_ID.sync"
PLANNER_PHONE_ID="${PLANNER_PHONE_ID:-$PLANNER_BUNDLE_ID.phone}"
PLANNER_PHONE_KEYCHAIN="$PLANNER_PHONE_ID.sync"
[[ "$PLANNER_CLOUD_SYNC" == "1" ]] && PLANNER_CLOUD=true || PLANNER_CLOUD=false
