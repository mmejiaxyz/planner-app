# Planner: project instructions

A study planner: a native Mac app (`mac-app/`, Swift around `page/index_v2.html`) and an iPhone companion (`ios-app/`)
that share the page. It turns deliverables into dated tasks, fits them around classes, commutes and the calendar, and
runs a background organizer.

The person's own notes, history and standing rules are in the private data repo and imported here (they win over
anything generic below). Paths in them like `HANDOFF.md` or `design/` are in that repo (`notes/`, `design/`):

@~/Documents/GitHub/planner-data/CLAUDE.personal.md

## The app and the data are apart (keep it that way)
- This repo never holds personal data: no names, schools, course ids or names, places, dates of a real term, paths
  in someone's home, keys or Worker addresses, in code, comments, tests or docs. Examples in prompts and placeholders
  use neutral names (Design, Lab, Seminar, Studio). Personal notes go in the data repo's `CLAUDE.personal.md`.
- The plan lives in `~/Library/Application Support/Planner/plan.json`. Everything about the person is its profile
  (`profile/me`, a top-level `profile` list): name, institution, country, tz, langs, term {start, end}, places
  [{id, name, short, commute, words}] (places[0] is the main place, a commute away), rules (overrides of `RULES_CFG`),
  hues {course id: colour}, timetable [{d, s, e, c, t, r, o?}].
- `page/js/rules.js` has the generic defaults; `page/js/profile.js` applies the profile (`applyProfile`, `rulesFor`,
  `onProfile` hooks for values other scripts derive) and gives the readers (`mainPlace`, `placeShort`, `profileTZ`,
  `profileName`, `profileInstitution`, `profileHue`, `atMainPlace`). main.js reads the profile before the first render.
  Rules attach to data: `rules.deskOnly` / `rules.waitsForWeek` / `rules.autoLink` / `rules.unsharedGroups`, or a
  course's own `deskOnly: true` / `fixed: true`. The stored meets value `thb` means "at the main place" (old plans).
- Build identity comes from the private data folder (`../planner-data`, `PLANNER_DATA`): `local.env` sets
  `PLANNER_BUNDLE_ID` (Mac app; `.widgets`, `.phone` and the keychain service `.sync` are derived) and `WRANGLER`;
  its `profile.json` is bundled and copied into a plan without a profile, once (`Store.init` in main.swift).
  See `mac-app/config.sh`. Never change an installed bundle id; `build.sh --install` and `update.sh` refuse a build
  whose id differs from the installed app.
- iPhone sync through Cloudflare is off unless the build's `local.env` sets `PLANNER_CLOUD_SYNC=1` (Info.plist
  `PlannerCloudSync`, `SyncCore.cloudAllowed`): a build from the repo never contacts a Worker, has no Pair iPhone… and
  `sync-worker/setup.sh` refuses to deploy. Keep every Worker call behind that check. Local Wi-Fi sync does not exist yet.
- Off-device copy of the data: `CloudBackup` (mac-app/Sources/Backup.swift), not a git repo. plan.json, Brain notes and
  transcripts, and the data folder's text files (`PlannerData` in Info.plist), sealed with the sync key (kind `backup`)
  on the Worker's `/backup` (200 MB cap, 4 MB chunks under a generation that becomes current only on commit); sent when
  changed, at most every 6 h; Planner › Cloudflare Backup… backs up now, restores into a new Documents folder (never over
  live data) and shows the recovery code (the pairing text: key, token, Worker). On a new Mac, Restore with a Recovery
  Code… adopts the key and, only when the plan is empty, puts plan and Brain notes in place and restarts. An empty plan is
  never uploaded as the phone's snapshot. Never add PDFs, project files, images or recordings.
- This repo is public (since 27 Nov 2026). Commits are authored as "Planner"; scan every change for personal data before
  pushing. The iPhone app's id is neutral (`PLANNER_PHONE_ID` in local.env) because the .ipa is public.
- iPhone updates go through AltStore, not by hand: `ios-app/build.sh`, then `python3 tools/altstore.py` (writes
  `altstore/source.json` and names the tag), `gh release create v<version> ios-app/build/Planner.ipa`, commit and push the
  source file. AltStore reads https://raw.githubusercontent.com/<owner>/<repo>/main/altstore/source.json.
- Never change plan.json in a way old data cannot load. Course documents carry `v` (`PLAN_VERSION`), upgraded by
  `MIGRATIONS` in main.js; the profile carries `v` (`PROFILE_V`).

## How it is built
- AI reads, code decides: models extract facts (course, deliverable, title, size, where, what changes); days, splits,
  estimates, rules and deletions are decided in code (`normalize()` in input.js, the organizer). Shared rules live in
  shared functions, never per view.
- The organizer is pure: `page/js/organize.js` (`organizePlan(courses, env)`, `organizeProblems`, `deadlineRisks`);
  the day and time come in through `env` (`orgEnv()` in organizer-run.js). Tests: `node --test test/*.test.js`.
  Before changing it, dry-run on a copy of the plan: `node tools/dryrun.js [plan.json] [YYYY-MM-DD] [HH:MM]`
  (it reads the plan's own profile).
- Page scripts are classic scripts loaded in order by `page/index_v2.html`: rules.js, profile.js, organize.js,
  core.js, views.js, … main.js. `mac-app/build.sh` copies the page, `page/js/` and the profile into the app.
- Ask before running `mac-app/build.sh` or `--install`. Ship by committing and pushing; the app updates itself from
  this repo (Check for Updates…, `mac-app/update.sh`), keeping data and permissions.
- Keep wording in the interface plain and short.
