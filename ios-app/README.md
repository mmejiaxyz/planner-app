# Planner for iPhone

A simple companion to the Mac app: Today, Calendar, Courses and All tasks from the plan the Mac last sent. Tick tasks
(with the time they took), move them to another day, add tasks with a short form, send notes and Get help questions to
the Mac, record, and read course PDFs with underlines, highlights, notes and a DeepSeek reading partner. The phone never
plans; the Mac applies every change and sends the new plan back.

## Reading partner (DeepSeek)
Open any PDF (Courses › Files, or Open PDF on a task; the Mac must be open the first time to send it). Under the chat,
paste a DeepSeek API key from platform.deepseek.com (pay as you go). It is kept in this phone's Keychain and sent only to
DeepSeek. Marks made on the phone are written into the PDF on the Mac; Wrap up sends reading notes to the course's
Reading notes folder on the Mac.

## Install (AltStore, free Apple ID)
1. On the Mac: install AltServer from altstore.io, then use it to install AltStore on the iPhone (same Wi-Fi).
2. Build the app: `ios-app/build.sh` → `ios-app/build/Planner.ipa`.
3. Get the .ipa to the phone (AirDrop to Files), open AltStore › My Apps › + and pick `Planner.ipa`.
4. AltStore re-signs the app every 7 days when the phone and the Mac (with AltServer running) are on the same Wi-Fi.
   With a free Apple ID you can have 3 apps from AltStore at once (AltStore counts as one).

## Pair (once)
1. Sync server: `sync-worker/setup.sh` (already done on 8 Nov 2026).
2. On the Mac: Planner › Pair iPhone… shows a QR code.
3. On the phone: open Planner, tap Scan the code. Both show the same check code.

## How it syncs
See the "iPhone app and phone sync" section in `../CLAUDE.md`. In short: end-to-end encrypted files through a private
Cloudflare Worker on the free plan; the key exists only on the two devices; the Mac must be open to apply changes.

## Updating
- Page changes (views, layout, rules): rebuild the Mac app. It uploads its page, encrypted, and the phone switches to
  it the next time Planner goes to the background.
- Native changes (Swift, `shim.js`): rebuild the .ipa and install it again from AltStore (same bundle id, data and
  pairing are kept).
