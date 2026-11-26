"""Write altstore/source.json for the iPhone app just built by ios-app/build.sh.

AltStore reads that file from the repo's raw URL and offers Update when the version in it is newer than the installed
one; the .ipa itself is a GitHub Release asset (tag v<version>, file Planner.ipa).

Usage: python3 tools/altstore.py            (after ios-app/build.sh; prints the release tag to create)
"""
import json, os, plistlib, re, subprocess, datetime

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = os.path.join(root, 'ios-app', 'build', 'Payload', 'Planner.app')
ipa = os.path.join(root, 'ios-app', 'build', 'Planner.ipa')
info = plistlib.load(open(os.path.join(app, 'Info.plist'), 'rb'))
remote = subprocess.run(['git', '-C', root, 'remote', 'get-url', 'origin'], capture_output=True, text=True).stdout.strip()
m = re.search(r'github\.com[:/](.+?)/(.+?)(?:\.git)?$', remote)
if not m:
    raise SystemExit('origin is not a GitHub repo')
owner, repo = m.group(1), m.group(2)
version, build = info['CFBundleShortVersionString'], info['CFBundleVersion']
tag = 'v' + version
url = f'https://github.com/{owner}/{repo}/releases/download/{tag}/Planner.ipa'
today = datetime.date.today().isoformat()
size = os.path.getsize(ipa)
entry = {'version': version, 'buildVersion': build, 'date': today, 'downloadURL': url, 'size': size,
         'minOSVersion': info.get('MinimumOSVersion', '17.0'), 'localizedDescription': 'Update.'}
source = {
    'name': 'Planner', 'identifier': 'planner.app.source', 'website': f'https://github.com/{owner}/{repo}',
    'apps': [{
        'name': 'Planner', 'bundleIdentifier': info['CFBundleIdentifier'], 'developerName': 'Planner',
        'localizedDescription': 'Personal software.', 'iconURL': f'https://raw.githubusercontent.com/{owner}/{repo}/main/mac-app/AppIcon.png',
        'tintColor': '#9579BF', 'versions': [entry],
        # the older single-version fields, for AltStore versions that read those
        'version': version, 'versionDate': today, 'downloadURL': url, 'size': size,
    }],
    'news': [],
}
out = os.path.join(root, 'altstore', 'source.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(source, open(out, 'w'), indent=2)
print('wrote', out, '·', info['CFBundleIdentifier'], version, f'({size // 1024} KB)')
print('release tag:', tag)
print('AltStore source:', f'https://raw.githubusercontent.com/{owner}/{repo}/main/altstore/source.json')
