# Planner — Mac app

One standalone app: the planner, an input field that turns notes into tasks, your calendars, an iPhone inbox, and a second brain for meetings (record, transcribe, summarize, ask, update the planner).

## Build and install
```
./build.sh --install     # builds and copies to ~/Applications/Planner.app
```
Needs the Xcode command line tools (swiftc). No Xcode. The app shows `../page/index_v2.html` with its scripts from `../page/js/` and bundles the profile named in `config.sh` (the data folder's `profile.json`), which the app copies into a plan that has none. Build identity (bundle id, keychain service) comes from the data folder's `local.env`; see `config.sh`. Rebuild after changing the page.

Before a build: `node --test ../test/*.test.js` (organizer tests) and `node ../tools/dryrun.js` (what the organizer would move in your real plan, nothing written).

## Updates
- Planner › Check for Updates… (or the banner, checked quietly every 6 hours) runs `update.sh`: it fetches the GitHub repo the app was built from, backs up `plan.json` and the brain notes to `backups/update-<time>/`, pulls, builds, and swaps the app in place after it quits, then reopens it.
- Builds are signed with the local certificate "Planner Local Signing" (login keychain), so macOS keeps Calendar, Reminders, Microphone and Screen Recording permissions across updates. Without it, build.sh signs ad hoc and macOS asks again.
- Data in `~/Library/Application Support/Planner/` is never touched by a build or an update. New fields must stay backward compatible: the store keeps unknown top-level keys as they are.
- To ship a change: edit, commit, push. Any copy of the app then sees it under Check for Updates.

## Where things live
`~/Library/Application Support/Planner/`
- `plan.json`: courses, tasks, deadlines, heads-up, and busy times per day (`days`). A copy goes to `backups/` at most every 10 minutes (last 60 kept).
- `brain/<id>.json`: one file per meeting (title, course, transcript segments, summary, decisions, actions, notes). `brain/audio/`: recordings.
- `usage/<YYYY-MM>.jsonl`: the usage log (sessions, views, plan changes and who made them, AI calls, clicks, errors), Mac only. Summary: `node tools/usage.js`.
- `models/ggml-large-v3-q5_0.bin`: the Whisper model (moved over from Meetily).

## What runs where
| Feature | Runs on | Notes |
|---|---|---|
| Input field on Today | Claude Haiku through the Claude Code CLI (`claude -p`, your Pro login) | Needs the internet. Amp is listed but the account has no credit. |
| Recording | This Mac | Two tracks, never mixed while recording: your microphone and, for online calls, the computer's own audio (ScreenCaptureKit). They are transcribed on their own and joined with "You" / "Meeting" labels, so overlapping speech and your own voice stay clear. The kept audio is one mixed copy for listening; your mic is gated to the lines the speech detector heard, so it is silent between your lines instead of adding room noise. |
| Transcription | This Mac | `whisper-cli` from Homebrew (`brew install whisper-cpp`), Metal, with the bundled Silero voice activity detector (`vad/`) so silence is skipped instead of being "heard" as words. Nothing is transcribed while recording (saves CPU during calls); after Stop the accurate model transcribes each track (`ggml-large-v3-turbo*` if present, else the large one). A small model (`ggml-small*`, `ggml-base*` or `ggml-tiny*`), if present, only spots the spoken language. |
| Meeting summaries | Gemini 4 Hydrogen (XHigh) through the Antigravity CLI (`agy`, your Google AI plan), redacted | Runs as a custom agent with no tools (`Application Support/Planner/gemini`), deny rules on top. Claude Sonnet answers when Gemini does not. Model: `defaults write <bundle id> geminiModel <id>` (`agy models` lists them). |
| Ask your notes, Update the planner from a meeting | Claude Haiku, redacted | |
| Repeat check on suggested tasks | Claude Haiku, redacted | Only task titles and course names go out, never transcripts or summaries. Skipped when the Mac is offline. |
| Calendar | This Mac | Read only, through Calendar.app, so every mail account already set up there is included. |
| iPhone inbox | iCloud Reminders | A Reminders list called "Planner". Items are ticked off once planned. |

## Permissions it asks for
Calendars, Reminders, Microphone, and Screen Recording (only to capture call audio; no images are kept). An ad-hoc signed rebuild may ask again.

## Page bridge
The page talks to the app through `window.APP.call(op, args)`. Ops: `load`, `save`, `calendar`, `calendars`, `eventSave`, `eventDelete`, `inbox`, `inboxDone`, `llm` (order `claude`, `gemini`, `amp`; with `sid` Claude streams `llmChunk` events), `prefs`, `recStatus`, `recStart`, `recStop`, `recCancel`, `brainList`, `brainGet`, `brainSave`, `brainDelete`, `importMeetily`, `reveal`, `revealBrain`, `pickFolder` (Set up › Link a folder). A `window.claude` shim maps the artifact database API onto `load`/`save`, so the same page also works as the claude.ai artifact (where the app features stay hidden).
