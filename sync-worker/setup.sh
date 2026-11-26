#!/bin/zsh
# Deploys the phone sync Worker (Cloudflare, free plan) and gives the Mac its access token.
#   ./setup.sh               deploy; make a token the first time
#   ./setup.sh --new-token   deploy and replace the token (pair the iPhone again afterwards)
# Uses WRANGLER from the data folder's local.env (mac-app/config.sh), else npx wrangler (npx wrangler login if it ran out).
# The token is kept in ~/Library/Application Support/Planner/sync-server.json (only you can read it); Cloudflare keeps
# only its SHA-256. The encryption key is separate: the Planner app makes it and keeps it in the Keychain.
set -e
cd "${0:A:h}"
ROOT=..
source ../mac-app/config.sh
[[ "$PLANNER_CLOUD" == "true" ]] || { echo "Phone sync through Cloudflare is off. Set PLANNER_CLOUD_SYNC=1 in $PLANNER_DATA/local.env to use your own Worker."; exit 1; }
W=(${=WRANGLER:-npx wrangler})
CFG="$HOME/Library/Application Support/Planner/sync-server.json"
out=$("${W[@]}" deploy 2>&1) || { echo "$out"; exit 1; }
url=$(echo "$out" | grep -oE 'https://planner-sync\.[a-z0-9-]+\.workers\.dev' | head -1)
[ -n "$url" ] || { echo "$out"; echo "Could not find the Worker address in the deploy output."; exit 1; }
mkdir -p "${CFG:h}"
if [[ ! -f "$CFG" || "$1" == "--new-token" ]]; then
  tok=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
  printf %s "$tok" | shasum -a 256 | cut -d' ' -f1 | tr -d '\n' | "${W[@]}" secret put TOKEN_HASH >/dev/null
else
  tok=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$CFG")
fi
umask 077
printf '%s\n%s\n' "$url" "$tok" | python3 -I -c 'import json,sys; u,t=sys.stdin.read().split(); json.dump({"url":u,"token":t}, open(sys.argv[1],"w"))' "$CFG"
chmod 600 "$CFG"
echo "Worker: $url"
echo "Token saved for the Mac app. In Planner, choose Planner › Pair iPhone… to show the code for the phone."
