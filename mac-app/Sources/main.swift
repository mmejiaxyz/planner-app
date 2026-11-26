// Planner — Mac app.
// A window that hosts page/index_v2.html, plus a small bridge for:
//   load / save      the plan, stored as JSON in ~/Library/Application Support/Planner/plan.json
//   calendar         events from Calendar.app (every account already set up on this Mac); read, add, change, delete
//   inbox / inboxDone  the "Planner" list in Reminders (add items from the iPhone; they sync over iCloud), plus notes from the Planner iPhone app
//   phoneOps / phoneOpsDone  changes made in the Planner iPhone app (PhoneSync.swift, SyncCore.swift, sync-worker/)
//   llm              turn typed notes into tasks: Claude Haiku via the Claude Code CLI (Pro login), Ollama, or Amp
//   prefs            which model to try first
//   help*            task help sessions: a context folder per course, redacted copies in a sandbox, Claude reads only those
// Build with build.sh. No Xcode needed.

import AppKit
import CoreServices   // Dictionary Services: Define in the reader
import WebKit
import EventKit
import ApplicationServices
import WidgetKit
import PDFKit
import Vision

// MARK: - Paths and store

enum Paths {
    static let support: URL = {
        if let t = ProcessInfo.processInfo.environment["PLANNER_DATA_DIR"], !t.isEmpty {   // for tests: a separate data folder
            let u = URL(fileURLWithPath: t, isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let u = base.appendingPathComponent("Planner", isDirectory: true)
        let old = base.appendingPathComponent("Winter Term Tracker", isDirectory: true)
        if !FileManager.default.fileExists(atPath: u.path), FileManager.default.fileExists(atPath: old.path) { try? FileManager.default.moveItem(at: old, to: u) }
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static let plan = support.appendingPathComponent("plan.json")
    static let backups: URL = {
        let u = support.appendingPathComponent("backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
}

/// Usage log (24 Nov 2026, the user's request: data on how he uses the app, to fit it to him). Mac only, never synced.
/// One JSON object a line in Application Support/Planner/usage/<YYYY-MM>.jsonl: the page sends its events (op `usage`,
/// usage.js), the app adds launch, quit, focus and sleep. Read with `node tools/usage.js`.
enum Usage {
    private static let q = DispatchQueue(label: "planner.usage", qos: .utility)
    static let dir: URL = {
        let u = Paths.support.appendingPathComponent("usage", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static func log(_ k: String, _ data: [String: Any] = [:]) {
        var e = data; e["k"] = k; e["t"] = ISO8601DateFormatter().string(from: Date()); e["by"] = "app"
        append([e])
    }
    static func append(_ events: [[String: Any]]) {
        let lines = events.compactMap { e -> Data? in
            guard JSONSerialization.isValidJSONObject(e), var d = try? JSONSerialization.data(withJSONObject: e, options: [.sortedKeys]) else { return nil }
            d.append(0x0A); return d
        }
        guard !lines.isEmpty else { return }
        q.async {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.locale = Locale(identifier: "en_US_POSIX")
            let url = dir.appendingPathComponent(f.string(from: Date()) + ".jsonl")
            if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
            guard let h = try? FileHandle(forWritingTo: url) else { return }
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            lines.forEach { try? h.write(contentsOf: $0) }
        }
    }
    /// quitting: wait for the queue so the last lines are on disk
    static func flush() { q.sync {} }
}

final class Store {
    private(set) var courses: [[String: Any]] = []
    private(set) var flags: [[String: Any]] = []
    private var extra: [String: Any] = [:]   // other top-level keys (groups, ...) kept as they are
    private var lastBackup = Date.distantPast
    var onWrite: (() -> Void)?                // phone sync: upload a new snapshot

    init() {
        if !FileManager.default.fileExists(atPath: Paths.plan.path),
           let seed = Bundle.main.url(forResource: "seed", withExtension: "json") {
            try? FileManager.default.copyItem(at: seed, to: Paths.plan)
        }
        if let d = try? Data(contentsOf: Paths.plan),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            courses = o["courses"] as? [[String: Any]] ?? []
            flags = o["flags"] as? [[String: Any]] ?? []
            extra = o.filter { $0.key != "courses" && $0.key != "flags" }
        }
        // The profile (who and where, term, rules, colours, timetable) is data, not code. A plan without one gets the
        // profile.json bundled at build time, once, before anything is saved; a build without one runs on the page's defaults.
        if extra["profile"] == nil, FileManager.default.fileExists(atPath: Paths.plan.path),
           let u = Bundle.main.url(forResource: "profile", withExtension: "json"),
           let d = try? Data(contentsOf: u), var p = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            p["id"] = "me"
            extra["profile"] = [p]
            try? write()
        }
    }

    func snapshot() -> [String: Any] { extra.merging(["courses": courses, "flags": flags]) { $1 } }

    func save(path: String, data: [String: Any]) throws {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 2 else { throw NSError(domain: "store", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad path \(path)"]) }
        var doc = data; doc["id"] = parts[1]
        if parts[0] == "courses" {
            if let i = courses.firstIndex(where: { ($0["id"] as? String) == parts[1] }) { courses[i] = doc } else { courses.append(doc) }
        } else if parts[0] == "flags" {
            if let i = flags.firstIndex(where: { ($0["id"] as? String) == parts[1] }) { flags[i] = doc } else { flags.append(doc) }
        } else if parts[0] == "days" || parts[0] == "profile" || parts[0] == "reads" {
            // busy times per day, the profile and reading time per PDF (reads), kept as top-level lists next to courses and flags (older apps keep them untouched)
            var list = extra[parts[0]] as? [[String: Any]] ?? []
            if let i = list.firstIndex(where: { ($0["id"] as? String) == parts[1] }) { list[i] = doc } else { list.append(doc) }
            extra[parts[0]] = list
        } else { throw NSError(domain: "store", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown collection \(parts[0])"]) }
        try write()
    }

    private func write() throws {
        let d = try JSONSerialization.data(withJSONObject: snapshot(), options: [.prettyPrinted, .sortedKeys])
        if Date().timeIntervalSince(lastBackup) > 600, FileManager.default.fileExists(atPath: Paths.plan.path) {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HHmmss"
            try? FileManager.default.copyItem(at: Paths.plan, to: Paths.backups.appendingPathComponent("plan-\(f.string(from: Date())).json"))
            lastBackup = Date()
            pruneBackups()
        }
        try d.write(to: Paths.plan, options: .atomic)
        onWrite?()
    }

    private func pruneBackups() {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: Paths.backups, includingPropertiesForKeys: nil) else { return }
        let sorted = items.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        for u in sorted.dropFirst(60) { try? fm.removeItem(at: u) }
    }
}

// MARK: - Calendar and Reminders (EventKit)

final class Cal {
    let store = EKEventStore()

    func access(_ type: EKEntityType) async -> String {
        let s = EKEventStore.authorizationStatus(for: type)
        switch s {
        case .fullAccess, .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .writeOnly: return "denied"
        case .notDetermined:
            do {
                let ok = type == .event ? try await store.requestFullAccessToEvents() : try await store.requestFullAccessToReminders()
                return ok ? "granted" : "denied"
            } catch { return "denied" }
        @unknown default: return "denied"
        }
    }

    func events(from: String, to: String) async -> [String: Any] {
        let status = await access(.event)
        guard status == "granted" else { return ["status": status, "events": []] }
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = .current
        guard let a = df.date(from: from), let b0 = df.date(from: to) else { return ["status": "error", "events": []] }
        let b = Calendar.current.date(byAdding: .day, value: 1, to: b0)!
        let pred = store.predicateForEvents(withStart: a, end: b, calendars: nil)
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime]; iso.timeZone = .current
        let out: [[String: Any]] = store.events(matching: pred).map { e in
            [
                "id": e.eventIdentifier ?? "",
                "editable": canEdit(e),
                "recurring": e.hasRecurrenceRules,
                "calendarId": e.calendar?.calendarIdentifier ?? "",
                "title": e.title ?? "(no title)",
                "start": iso.string(from: e.startDate),
                "end": iso.string(from: e.endDate),
                "allDay": e.isAllDay,
                "calendar": e.calendar?.title ?? "",
                "account": e.calendar?.source?.title ?? "",
                "location": e.location ?? "",
                "url": e.url?.absoluteString ?? "",
                "notes": String((e.notes ?? "").prefix(3000)),
            ]
        }
        return ["status": "granted", "events": out]
    }

    /// Events he can change here: a writable calendar, and not an invitation from someone else (changing those would only fork his copy).
    func canEdit(_ e: EKEvent) -> Bool {
        guard e.calendar?.allowsContentModifications == true else { return false }
        if e.hasAttendees, let org = e.organizer, !org.isCurrentUser { return false }
        return true
    }

    /// Calendars that can take new or moved events.
    func calendars() async -> [String: Any] {
        guard await access(.event) == "granted" else { return ["status": "denied", "calendars": []] }
        let def = store.defaultCalendarForNewEvents?.calendarIdentifier ?? ""
        let list: [[String: Any]] = store.calendars(for: .event).filter { $0.allowsContentModifications }.map {
            ["id": $0.calendarIdentifier, "title": $0.title, "account": $0.source?.title ?? "", "default": $0.calendarIdentifier == def]
        }
        return ["status": "granted", "calendars": list, "default": def]
    }

    private let local: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm"; f.timeZone = .current; f.locale = Locale(identifier: "en_US_POSIX"); return f }()
    private func when(_ s: String) -> Date? {
        if let d = local.date(from: String(s.prefix(16))) { return d }
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: s)
    }

    /// One occurrence of an event: `id` is the event identifier, `occ` the start of the occurrence (repeating events share an id).
    private func find(_ id: String, occ: String) -> EKEvent? {
        guard !id.isEmpty else { return nil }
        if let at = when(occ) {
            let pred = store.predicateForEvents(withStart: at.addingTimeInterval(-60), end: at.addingTimeInterval(86400 * 2), calendars: nil)
            if let e = store.events(matching: pred).first(where: { $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(at)) < 60 }) { return e }
        }
        return store.event(withIdentifier: id)
    }

    /// Create (no id) or change an event. Times are local "YYYY-MM-DDTHH:MM". span "future" changes this and later repeats.
    func save(_ a: [String: Any]) async throws -> [String: Any] {
        guard await access(.event) == "granted" else { throw NSError(domain: "cal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Calendar access is off"]) }
        let id = a["id"] as? String ?? ""
        let e: EKEvent
        if id.isEmpty { e = EKEvent(eventStore: store) }
        else {
            guard let f = find(id, occ: a["occ"] as? String ?? "") else { throw NSError(domain: "cal", code: 2, userInfo: [NSLocalizedDescriptionKey: "That event is no longer in your calendar"]) }
            guard canEdit(f) else { throw NSError(domain: "cal", code: 3, userInfo: [NSLocalizedDescriptionKey: "This event can only be changed by its organizer"]) }
            e = f
        }
        if let t = a["title"] as? String { e.title = t.trimmingCharacters(in: .whitespaces).isEmpty ? "(no title)" : t }
        if let allDay = a["allDay"] as? Bool { e.isAllDay = allDay }
        if let s = a["start"] as? String, let d = when(s) { e.startDate = d }
        if let s = a["end"] as? String, let d = when(s) { e.endDate = d }
        if e.endDate == nil || e.endDate < e.startDate { e.endDate = e.startDate.addingTimeInterval(3600) }
        if let l = a["location"] as? String { e.location = l.isEmpty ? nil : l }
        if let n = a["notes"] as? String { e.notes = n.isEmpty ? nil : n }
        let cid = a["calendarId"] as? String ?? ""
        if !cid.isEmpty, let c = store.calendar(withIdentifier: cid), c.allowsContentModifications { e.calendar = c }
        if e.calendar == nil { e.calendar = store.defaultCalendarForNewEvents }
        try store.save(e, span: (a["span"] as? String) == "future" ? .futureEvents : .thisEvent, commit: true)
        return ["ok": true, "id": e.eventIdentifier ?? ""]
    }

    func delete(_ a: [String: Any]) async throws -> [String: Any] {
        guard await access(.event) == "granted" else { throw NSError(domain: "cal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Calendar access is off"]) }
        guard let e = find(a["id"] as? String ?? "", occ: a["occ"] as? String ?? "") else { return ["ok": true] }
        guard canEdit(e) else { throw NSError(domain: "cal", code: 3, userInfo: [NSLocalizedDescriptionKey: "This event can only be changed by its organizer"]) }
        try store.remove(e, span: (a["span"] as? String) == "future" ? .futureEvents : .thisEvent, commit: true)
        return ["ok": true]
    }

    private func plannerList() -> EKCalendar? {
        store.calendars(for: .reminder).first { $0.title.trimmingCharacters(in: .whitespaces).lowercased() == "planner" }
    }

    func inbox() async -> [String: Any] {
        let status = await access(.reminder)
        guard status == "granted" else { return ["status": status, "items": []] }
        guard let list = plannerList() else { return ["status": "nolist", "items": []] }
        let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [list])
        let items: [EKReminder] = await withCheckedContinuation { c in
            store.fetchReminders(matching: pred) { c.resume(returning: $0 ?? []) }
        }
        let iso = ISO8601DateFormatter()
        let out: [[String: Any]] = items.map { r in
            var d: [String: Any] = ["id": r.calendarItemIdentifier, "title": r.title ?? "", "notes": r.notes ?? ""]
            if let c = r.creationDate { d["created"] = iso.string(from: c) }
            if let due = r.dueDateComponents, let dd = Calendar.current.date(from: due) { d["due"] = iso.string(from: dd) }
            return d
        }
        return ["status": "granted", "items": out]
    }

    func inboxDone(id: String) throws {
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return }
        r.isCompleted = true
        try store.save(r, commit: true)
    }
}

// MARK: - Models

final class Models {
    let home = FileManager.default.homeDirectoryForCurrentUser.path

    func find(_ name: String) -> String? {
        for d in ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.npm-global/bin", "/usr/bin"] {
            let p = "\(d)/\(name)"
            if FileManager.default.isExecutableFile(atPath: p) { return p }
        }
        return nil
    }

    /// Collects a child process's output and resumes the caller exactly once.
    final class RunState: @unchecked Sendable {
        private let lock = NSLock()
        private var out = Data(), err = Data(), done = false
        func append(_ d: Data, toErr: Bool) { lock.lock(); if toErr { err.append(d) } else { out.append(d) }; lock.unlock() }
        func text() -> (String, String) { lock.lock(); defer { lock.unlock() }; return (String(decoding: out, as: UTF8.self), String(decoding: err, as: UTF8.self)) }
        /// Returns true the first time only.
        func finish() -> Bool { lock.lock(); defer { lock.unlock() }; if done { return false }; done = true; return true }
    }

    func run(_ exe: String, _ args: [String], stdin: String, timeout: TimeInterval, background: Bool = false, cwd: URL? = nil, onText: (@Sendable (String) -> Void)? = nil) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            let p = Process()
            if background { p.qualityOfService = .utility }   // ffmpeg and Whisper: never take time from the Mac's audio (crackling after Stop)
            p.executableURL = URL(fileURLWithPath: exe)
            p.arguments = args
            p.currentDirectoryURL = cwd ?? Paths.support
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
            p.environment = env
            let out = Pipe(), err = Pipe(), inp = Pipe()
            p.standardOutput = out; p.standardError = err; p.standardInput = inp
            let st = RunState()
            out.fileHandleForReading.readabilityHandler = { h in let d = h.availableData; st.append(d, toErr: false); onText?(String(decoding: d, as: UTF8.self)) }
            err.fileHandleForReading.readabilityHandler = { h in let d = h.availableData; st.append(d, toErr: true); onText?(String(decoding: d, as: UTF8.self)) }
            p.terminationHandler = { proc in
                out.fileHandleForReading.readabilityHandler = nil
                err.fileHandleForReading.readabilityHandler = nil
                st.append(out.fileHandleForReading.readDataToEndOfFile(), toErr: false)
                st.append(err.fileHandleForReading.readDataToEndOfFile(), toErr: true)
                guard st.finish() else { return }
                let (o, e) = st.text()
                if proc.terminationStatus == 0 { cont.resume(returning: o) }   // success even when the tool prints nothing
                else { cont.resume(throwing: NSError(domain: "llm", code: Int(proc.terminationStatus), userInfo: [NSLocalizedDescriptionKey: String((e + o).trimmingCharacters(in: .whitespacesAndNewlines).suffix(300))])) }
            }
            do { try p.run() } catch { if st.finish() { cont.resume(throwing: error) }; return }
            inp.fileHandleForWriting.write(Data(stdin.utf8))
            try? inp.fileHandleForWriting.close()
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if st.finish() { p.terminate(); cont.resume(throwing: NSError(domain: "llm", code: -1, userInfo: [NSLocalizedDescriptionKey: "Timed out after \(Int(timeout)) s"])) }
            }
        }
    }

    /// Lean headless run: no tools, MCP servers, plugins, skills, settings or saved session. Starts about 3 s faster.
    static let claudeLean = ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--setting-sources", ""]

    /// `model`: "haiku" (default), "sonnet" (planner notes that fit nothing in the plan, and its second look; 19 Nov 2026)
    /// or "opus" (setting up a course from its documents, 24 Nov 2026: rare, long documents, worth the better reading).
    static func lean(_ model: String) -> [String] { model == "sonnet" || model == "opus" ? claudeLean.map { $0 == "haiku" ? model : $0 } : claudeLean }

    func claude(_ prompt: String, model: String = "haiku") async throws -> String {
        guard let exe = find("claude") else { throw NSError(domain: "llm", code: 10, userInfo: [NSLocalizedDescriptionKey: "Claude Code CLI not found"]) }
        return try await run(exe, Models.lean(model) + ["--output-format", "text"], stdin: prompt, timeout: model == "opus" ? 300 : model == "sonnet" ? 180 : 120)
    }

    /// Same as `claude`, but streams: `chunk` gets each piece of text as Claude writes it.
    func claudeStream(_ prompt: String, model: String = "haiku", chunk: @escaping @Sendable (String) -> Void) async throws -> String {
        guard let exe = find("claude") else { throw NSError(domain: "llm", code: 10, userInfo: [NSLocalizedDescriptionKey: "Claude Code CLI not found"]) }
        final class Buf: @unchecked Sendable { var pending = ""; var text = ""; var result: String?; let lock = NSLock() }
        let b = Buf()
        _ = try await run(exe, Models.lean(model) + ["--output-format", "stream-json", "--verbose", "--include-partial-messages"], stdin: prompt, timeout: model == "opus" ? 300 : model == "sonnet" ? 180 : 120, onText: { piece in
            b.lock.lock(); b.pending += piece
            var lines = b.pending.components(separatedBy: "\n"); b.pending = lines.removeLast()
            var out: [String] = []
            for l in lines {
                guard let d = l.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
                if o["type"] as? String == "stream_event", let ev = o["event"] as? [String: Any], ev["type"] as? String == "content_block_delta",
                   let delta = ev["delta"] as? [String: Any], let t = delta["text"] as? String { b.text += t; out.append(t) }
                if o["type"] as? String == "result", let r = o["result"] as? String { b.result = r }
            }
            b.lock.unlock()
            out.forEach(chunk)
        })
        b.lock.lock(); defer { b.lock.unlock() }
        return b.result ?? b.text
    }

    /// Task help: Claude (Haiku by default, Sonnet for hard tasks) that can only read, search and list files in `dir` (redacted copies). `session` continues an earlier turn.
    /// Our short system prompt replaces Claude Code's own (about 3,000 tokens a message, measured 3 Nov 2026). Each message has a cost limit; when it is hit the text so far comes back with `stopped`.
    func claudeHelp(_ prompt: String, dir: URL, session: String, model: String, reading: Bool = false, web: [String] = [], chunk: @escaping @Sendable (String) -> Void) async throws -> [String: Any] {
        guard let exe = find("claude") else { throw NSError(domain: "llm", code: 10, userInfo: [NSLocalizedDescriptionKey: "Claude Code CLI not found"]) }
        final class Buf: @unchecked Sendable { var pending = ""; var text = ""; var result: String?; var session = ""; var tokens = 0; var cost = 0.0; var stopped = ""; let lock = NSLock() }
        let b = Buf()
        let sonnet = model == "sonnet"
        let sys = reading ? "You are a reading partner for a student working through one document. The folder holds its text page by page (pages/), and the student's marks (marks.md). You can only Read, Grep and Glob files in the current folder; never read files outside it. Read as little as you need. Placeholders like [Person 1], [Link 2] stand for hidden names and links: keep them exactly as written. Answer in plain, short language." : "You help a student with one task from their study planner. You can only Read, Grep and Glob files in the current folder; never read files outside it. Read as little as you need. Placeholders like [Person 1], [Link 2], [Email 1] stand for hidden names and links: keep them exactly as written and never guess who they are. Answer in plain, short language."
        // Links he typed in this message: WebFetch for their sites only; dontAsk denies every other site (tested 4 Nov 2026).
        let hosts = web.filter { $0.range(of: "^[a-z0-9.-]+\\.[a-z]{2,}$", options: .regularExpression) != nil }
        let webSys = hosts.isEmpty ? "" : " For this message you may also use WebFetch, only on the links the student gave."
        var args = ["-p", "--model", sonnet ? "sonnet" : "haiku", "--effort", sonnet ? "medium" : "low", "--max-budget-usd", sonnet ? "0.60" : "0.15",
                    "--tools", hosts.isEmpty ? "Read,Grep,Glob" : "Read,Grep,Glob,WebFetch", "--permission-mode", "dontAsk",   // dontAsk: reads inside the sandbox work, anything outside is denied (tested 3 Nov 2026)
                    "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--system-prompt", sys + webSys,
                    "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
        if !hosts.isEmpty { args += ["--allowedTools", hosts.map { "WebFetch(domain:\($0))" }.joined(separator: ",")] }
        if !session.isEmpty { args += ["--resume", session] }
        do { _ = try await run(exe, args, stdin: prompt, timeout: 600, cwd: dir, onText: { piece in
            b.lock.lock(); b.pending += piece
            var lines = b.pending.components(separatedBy: "\n"); b.pending = lines.removeLast()
            var out: [String] = []
            for l in lines {
                guard let d = l.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
                if let sid = o["session_id"] as? String, !sid.isEmpty { b.session = sid }
                if o["type"] as? String == "stream_event", let ev = o["event"] as? [String: Any] {
                    if ev["type"] as? String == "content_block_delta", let delta = ev["delta"] as? [String: Any], let t = delta["text"] as? String { b.text += t; out.append(t) }
                    if ev["type"] as? String == "content_block_start", let cb = ev["content_block"] as? [String: Any], cb["type"] as? String == "tool_use" { out.append("\u{1}" + (cb["name"] as? String ?? "")) }
                }
                if o["type"] as? String == "result" {
                    if let r = o["result"] as? String { b.result = r }
                    b.cost = o["total_cost_usd"] as? Double ?? 0
                    if let u = o["usage"] as? [String: Any] { b.tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce(0) { $0 + (u[$1] as? Int ?? 0) } }
                    if let st = o["subtype"] as? String, st.hasPrefix("error") { b.stopped = st }
                }
            }
            b.lock.unlock()
            out.forEach(chunk)
        }) } catch {
            b.lock.lock(); let budget = b.stopped == "error_max_budget_usd"; b.lock.unlock()
            if !budget { throw error }
        }
        b.lock.lock(); defer { b.lock.unlock() }
        return ["text": b.result ?? b.text, "session": b.session, "tokens": b.tokens, "cost": b.cost, "stopped": b.stopped == "error_max_budget_usd" ? "budget" : ""]
    }

    func amp(_ prompt: String) async throws -> String {
        guard let exe = find("amp") else { throw NSError(domain: "llm", code: 11, userInfo: [NSLocalizedDescriptionKey: "Amp CLI not found"]) }
        return try await run(exe, ["-x"], stdin: prompt, timeout: 180)
    }

    /// True if the Ollama server answers.
    func ollamaUp() async -> Bool {
        var r = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/tags")!); r.timeoutInterval = 2
        return ((try? await URLSession.shared.data(for: r))?.1 as? HTTPURLResponse)?.statusCode == 200
    }
    /// Start Ollama if it is not running: the Ollama app if installed, otherwise `ollama serve`. Waits up to 30 s.
    func ensureOllama() async throws {
        if await ollamaUp() { return }
        if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.electron.ollama") ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: "ai.ollama.Ollama") {
            let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = false; cfg.hides = true
            _ = try? await NSWorkspace.shared.openApplication(at: app, configuration: cfg)
        } else if let exe = find("ollama") {
            let p = Process(); p.executableURL = URL(fileURLWithPath: exe); p.arguments = ["serve"]
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            try p.run()
        } else { throw NSError(domain: "llm", code: 14, userInfo: [NSLocalizedDescriptionKey: "Ollama is not installed"]) }
        for _ in 0..<60 { if await ollamaUp() { return }; try await Task.sleep(nanoseconds: 500_000_000) }
        throw NSError(domain: "llm", code: 15, userInfo: [NSLocalizedDescriptionKey: "Ollama did not start in 30 s"])
    }

    /// `format`: a JSON Schema the answer must follow (Ollama structured output), or plain "json".
    func ollama(_ prompt: String, model: String, format: Any = "json") async throws -> String {
        try await ensureOllama()
        var req = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/generate")!)
        req.httpMethod = "POST"; req.timeoutInterval = 300
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model, "prompt": prompt, "stream": false, "format": format, "think": false,
            "keep_alive": "10m",
            "options": ["temperature": 0.1, "num_ctx": 16384],
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        let o = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let e = o?["error"] as? String { throw NSError(domain: "llm", code: 12, userInfo: [NSLocalizedDescriptionKey: e]) }
        guard let r = o?["response"] as? String, !r.isEmpty else { throw NSError(domain: "llm", code: 13, userInfo: [NSLocalizedDescriptionKey: "Ollama gave no answer. Is it running?"]) }
        return r
    }

    /// Plain-text answer from Ollama, streamed: `chunk` gets each new piece as the model writes it.
    func ollamaStream(_ prompt: String, model: String, chunk: @escaping (String) async -> Void) async throws -> String {
        try await ensureOllama()
        var req = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/generate")!)
        req.httpMethod = "POST"; req.timeoutInterval = 300
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model, "prompt": prompt, "stream": true, "think": false,
            "keep_alive": "10m",
            "options": ["temperature": 0.2, "num_ctx": 16384],
        ])
        let (bytes, _) = try await URLSession.shared.bytes(for: req)
        var out = ""
        for try await line in bytes.lines {
            guard let o = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { continue }
            if let e = o["error"] as? String { throw NSError(domain: "llm", code: 12, userInfo: [NSLocalizedDescriptionKey: e]) }
            if let r = o["response"] as? String, !r.isEmpty { out += r; await chunk(r) }
            if o["done"] as? Bool == true { break }
        }
        if out.isEmpty { throw NSError(domain: "llm", code: 13, userInfo: [NSLocalizedDescriptionKey: "Ollama gave no answer. Is it running?"]) }
        return out
    }

    /// Load the model into memory ahead of a question, so the first answer does not wait for it.
    /// Load the model; with `prefix`, also read that text now so a later prompt starting with it only has to read the rest.
    func ollamaWarm(model: String, prefix: String = "") async {
        guard (try? await ensureOllama()) != nil else { return }
        var req = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/generate")!)
        req.httpMethod = "POST"; req.timeoutInterval = 300
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: prefix.isEmpty ? ["model": model, "keep_alive": "10m"] as [String: Any] :
            ["model": model, "prompt": prefix, "stream": false, "format": "json", "think": false, "keep_alive": "10m",
             "options": ["temperature": 0.1, "num_ctx": 16384, "num_predict": 1]] as [String: Any])
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Try providers in order; return the first answer.
    /// `remote` is the redacted prompt (names, links, emails, numbers replaced) used for Claude and Amp; Ollama gets `prompt`.
    func ask(_ prompt: String, remote: String, order: [String], ollamaModel: String, schema: [String: Any]? = nil, claudeModel: String = "haiku", chunk: (@Sendable (String) -> Void)? = nil) async -> [String: Any] {
        var errors: [String] = []
        for prov in order {
            do {
                let text: String
                switch prov {
                case "claude": text = chunk != nil ? try await claudeStream(remote, model: claudeModel, chunk: chunk!) : try await claude(remote, model: claudeModel)
                case "amp": text = try await amp(remote)
                case "ollama": text = try await ollama(prompt, model: ollamaModel, format: schema.map { $0 as Any } ?? "json")
                default: continue
                }
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("\(prov): empty answer"); continue }
                return ["provider": prov, "text": text, "errors": errors]
            } catch {
                errors.append("\(prov): \(error.localizedDescription)")
            }
        }
        return ["provider": "", "text": "", "errors": errors]
    }
}

// MARK: - Meetings: record, transcribe, store (fully local)

import AVFoundation
import ScreenCaptureKit
import CoreAudio
import UniformTypeIdentifiers

enum BrainPaths {
    static let root: URL = { let u = Paths.support.appendingPathComponent("brain", isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u }()
    static let audio: URL = { let u = root.appendingPathComponent("audio", isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u }()
    static let work: URL = { let u = root.appendingPathComponent("work", isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u }()
    static let models: URL = { let u = Paths.support.appendingPathComponent("models", isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u }()
    static func meeting(_ id: String) -> URL { root.appendingPathComponent("\(id).json") }
}

/// Task help. Each course has a context folder in Documents/Planner/<course> (files he drops in, saved sessions).
/// Claude never sees those originals: the page redacts the text and the app writes copies to a sandbox it runs Claude in.
enum Help {
    /// Where new course files go: the course's own folder when the page names one (in Documents), else the context
    /// folder Documents/Planner/<course> (a group's courses: Documents/<group>/<course>).
    static func dest(_ a: [String: Any]) -> URL {
        var isDir: ObjCBool = false
        if let p = a["dest"] as? String, !p.isEmpty, let u = inDocs(p), FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir), isDir.boolValue { return u }
        return folder(a["name"] as? String ?? "")
    }
    static let docs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents")
    static let root = docs.appendingPathComponent("Planner", isDirectory: true)
    static let readable = ["pdf", "docx", "doc", "rtf", "md", "txt", "html", "odt"]
    static func safeName(_ s: String) -> String {
        let t = s.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || t.hasPrefix(".") { return "Course" }
        if t.count <= 80 { return t }
        // a long file name keeps its extension (9 Nov 2026: a book name was cut to 80 characters and lost ".pdf", so the Files list never showed it)
        let ext = (t as NSString).pathExtension
        guard !ext.isEmpty, ext.count <= 6, !ext.contains(" ") else { return String(t.prefix(80)).trimmingCharacters(in: .whitespaces) }
        let base = String((t as NSString).deletingPathExtension.prefix(79 - ext.count)).trimmingCharacters(in: .whitespaces)
        return base + "." + ext
    }
    static func folder(_ name: String) -> URL {
        let u = root.appendingPathComponent(safeName(name), isDirectory: true)
        try? FileManager.default.createDirectory(at: u.appendingPathComponent("Sessions", isDirectory: true), withIntermediateDirectories: true)
        return u
    }
    /// Opens Terminal in ~/Documents/Planner/<course>[/<project>] with Claude Code. A new project folder is made on the spot.
    /// `claude --continue` when Claude Code already has a conversation for that folder, so the work picks up where it stopped.
    /// Done with a .command file opened in Terminal, so no Automation permission is needed.
    static func terminal(course: String, project: String, claude: String?) throws -> [String: Any] {
        let fm = FileManager.default
        var dir = folder(course)
        let raw = project.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = raw.isEmpty ? "" : safeName(raw)
        if !p.isEmpty {
            // The volume is case-insensitive: "sessions" is the Sessions folder.
            guard !raw.contains("/"), !raw.hasPrefix("."), !["sessions", "reading notes"].contains(p.lowercased()) else { throw NSError(domain: "term", code: 1, userInfo: [NSLocalizedDescriptionKey: "Pick another project name"]) }
            dir = dir.appendingPathComponent(p, isDirectory: true)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        // Claude Code keeps conversations in ~/.claude/projects/<path with every other character as ->.
        // It replaces UTF-16 code units (JavaScript), so an umlaut or emoji is counted the same way here.
        let key = String(String.UnicodeScalarView(dir.path.utf16.map { u -> Unicode.Scalar in
            let s = Unicode.Scalar(UInt8(truncatingIfNeeded: u))
            return u < 128 && (s.properties.isAlphabetic || ("0"..."9").contains(s)) ? s : "-"
        }))
        let convos = fm.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects/" + key)
        let resume = ((try? fm.contentsOfDirectory(atPath: convos.path)) ?? []).contains { $0.hasSuffix(".jsonl") }
        let q = { (s: String) in "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let exe = claude.map(q) ?? "claude"
        let script = "#!/bin/zsh -l\ncd \(q(dir.path)) || exit 1\nclear\n" + (resume ? "\(exe) --continue || \(exe)\n" : "\(exe)\n") + "exec /bin/zsh -l\n"
        let runDir = Paths.support.appendingPathComponent("terminal", isDirectory: true)
        try fm.createDirectory(at: runDir, withIntermediateDirectories: true)
        let file = runDir.appendingPathComponent(safeName(course + (p.isEmpty ? "" : " - " + p)) + ".command")
        try script.write(to: file, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
        guard let term = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else { throw NSError(domain: "term", code: 2, userInfo: [NSLocalizedDescriptionKey: "Terminal not found"]) }
        NSWorkspace.shared.open([file], withApplicationAt: term, configuration: NSWorkspace.OpenConfiguration())
        return ["ok": true, "path": dir.path, "project": p, "resumed": resume]
    }
    static func sandbox(_ course: String) -> URL { Paths.support.appendingPathComponent("help", isDirectory: true).appendingPathComponent(safeName(course), isDirectory: true) }
    static let cache: URL = { let u = Paths.support.appendingPathComponent("help-cache", isDirectory: true); try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true); return u }()
    static func inDocs(_ path: String) -> URL? {
        let full = (path as NSString).standardizingPath
        return full.hasPrefix(docs.path + "/") ? URL(fileURLWithPath: full) : nil
    }
    /// Readable files in a folder and its subfolders (three levels), relative paths. Code projects, asset folders and
    /// big runs of text files are left out (see `scan`): they are named in the index, never read.
    static func list(_ dir: URL) -> [String] { Array(scan(dir).docs.prefix(300)) }

    // MARK: Folder index (24 Nov 2026, the user's request: "I also organize my project files there, like Unreal, coding, etc. … make an
    // index that tells Claude what exists so it does not consume context unnecessarily"). Built in code, no model: documents
    // are listed one by one; a code or 3D project is one line (kind, size, last change, its README's first line, what is at
    // its top); everything else is counted per folder. Before, every md/txt/html inside a project (a Python venv's
    // knowledge base, scraped data) was read, copied for Get help and listed in its first prompt.
    struct Scan { var docs: [String] = []; var projects: [[String: Any]] = []; var other: [String: [String: Int]] = [:]; var otherBytes: [String: Int] = [:] }
    static let skipDirs: Set<String> = ["node_modules", "__pycache__", "venv", "env", "site-packages", "Intermediate", "Saved", "DerivedDataCache", "Binaries", "DerivedData", "Pods", "build", "dist", "target"]
    static let codeExt: Set<String> = ["py", "js", "ts", "tsx", "jsx", "swift", "c", "cpp", "h", "hpp", "cs", "rs", "go", "java", "ino", "ipynb", "glsl", "frag", "vert", "sh"]
    /// What kind of project a folder is, from what sits at its top; nil for an ordinary folder.
    static func projectKind(_ names: [String]) -> String? {
        let s = Set(names), ext = names.map { ($0 as NSString).pathExtension.lowercased() }, e = Set(ext)
        if e.contains("uproject") { return "Unreal project" }
        if s.contains("project.godot") { return "Godot project" }
        if s.contains("ProjectSettings") && s.contains("Assets") { return "Unity project" }
        if e.contains("xcodeproj") || s.contains("Package.swift") { return "Xcode / Swift project" }
        if e.contains("toe") { return "TouchDesigner project" }
        if s.contains("platformio.ini") || e.contains("ino") { return "Arduino / ESP32 project" }
        if s.contains("Cargo.toml") { return "Rust project" }
        if s.contains("package.json") { return "Node / web project" }
        if s.contains("pyproject.toml") || s.contains("requirements.txt") || s.contains("setup.py") || s.contains(".venv") { return "Python project" }
        if e.contains("sln") || e.contains("csproj") { return ".NET project" }
        if s.contains(".git") { return "Code repository" }
        let code = ext.filter { codeExt.contains($0) }
        if code.count >= 3 { let top = Dictionary(grouping: code, by: { $0 }).max { $0.value.count < $1.value.count }?.key ?? ""; return "Code folder (" + top + ")" }
        return nil
    }
    static func project(_ u: URL, _ rel: String, _ kind: String, _ items: [String]) -> [String: Any] {
        var files = 0, bytes = 0, newest = 0.0
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        if let en = FileManager.default.enumerator(at: u, includingPropertiesForKeys: keys, options: []) {
            for case let f as URL in en {
                if files >= 50_000 { break }
                let n = f.lastPathComponent
                guard let v = try? f.resourceValues(forKeys: Set(keys)) else { continue }
                if v.isRegularFile != true { if n.hasPrefix(".") || skipDirs.contains(n) { en.skipDescendants() }; continue }
                files += 1; bytes += v.fileSize ?? 0; newest = max(newest, v.contentModificationDate?.timeIntervalSince1970 ?? 0)
            }
        }
        var readme = ""
        if let r = items.first(where: { $0.lowercased().hasPrefix("readme") }), let t = try? String(contentsOf: u.appendingPathComponent(r), encoding: .utf8) {
            readme = t.split(separator: "\n").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "#*= \t")) }.first { $0.count > 3 } ?? ""
            if readme.count > 160 { readme = String(readme.prefix(158)) + "…" }
        }
        let top = items.filter { !$0.hasPrefix(".") && !skipDirs.contains($0) }.sorted().prefix(10)
        return ["path": rel, "kind": kind, "files": files, "bytes": bytes, "modified": newest, "readme": readme, "top": Array(top)]
    }
    /// One pass over a course folder: documents to read, projects as one line each, other files counted per folder.
    static func scan(_ dir: URL) -> Scan {
        var s = Scan(), seen = 0
        let fm = FileManager.default
        // inside a project only real documents count (papers a scraper collected, a brief): its md, txt and html are code
        // notes or data, and its other files are summed up in the project's line
        let paper: Set<String> = ["pdf", "docx", "doc", "odt", "rtf", "epub"]
        func walk(_ u: URL, _ rel: String, _ depth: Int, _ inProject: Bool = false) {
            guard seen < 40_000, let items = try? fm.contentsOfDirectory(atPath: u.path) else { return }
            var inProject = inProject
            if depth > 0, !inProject, let kind = projectKind(items) { s.projects.append(project(u, rel, kind, items)); inProject = true }
            for n in items.sorted() where !n.hasPrefix(".") {
                seen += 1
                let c = u.appendingPathComponent(n), r = rel.isEmpty ? n : rel + "/" + n
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: c.path, isDirectory: &isDir) else { continue }
                if isDir.boolValue {
                    if skipDirs.contains(n) || ["app", "photoslibrary", "fcpbundle", "xcodeproj"].contains((n as NSString).pathExtension.lowercased()) { continue }
                    if depth < 6 { walk(c, r, depth + 1, inProject) }
                    continue
                }
                let ext = (n as NSString).pathExtension.lowercased()
                if inProject { if paper.contains(ext) && readable.contains(ext) && depth <= 5 { s.docs.append(r) }; continue }
                if readable.contains(ext) && depth <= 3 { s.docs.append(r); continue }
                if r.hasPrefix("Sessions/") || r.hasPrefix("Reading notes/") { continue }   // the planner's own (help sessions, notes)
                let group = r.split(separator: "/").dropLast().prefix(2).joined(separator: "/")
                s.other[group, default: [:]][ext.isEmpty ? "other" : ext, default: 0] += 1
                s.otherBytes[group, default: 0] += (try? c.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) ?? 0
            }
        }
        walk(dir, "", 0)
        // a folder with more than 30 documents of its own is data (scraped pages, exports), not readings: counted, not read
        let byDir = Dictionary(grouping: s.docs) { ($0 as NSString).deletingLastPathComponent }
        for (d, list) in byDir where list.count > 30 && !d.isEmpty {
            s.docs.removeAll { ($0 as NSString).deletingLastPathComponent == d }
            for f in list { let ext = (f as NSString).pathExtension.lowercased(); s.other[d, default: [:]][ext, default: 0] += 1 }
        }
        return s
    }
    nonisolated(unsafe) static var pageCache: [String: (Double, Int)] = [:]   // touched from one index pass at a time
    static func pages(_ u: URL) -> Int {
        let mod = (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0
        if let c = pageCache[u.path], c.0 == mod { return c.1 }
        let n = PDFDocument(url: u)?.pageCount ?? 0
        pageCache[u.path] = (mod, n); return n
    }
    /// The index of several folders for the page (Get help, Set up, the planner): plain data, the page writes the text.
    static func index(_ folders: [String]) -> [[String: Any]] {
        folders.compactMap { f -> [String: Any]? in
            guard let dir = inDocs(f) else { return nil }
            let s = scan(dir)
            let docs: [[String: Any]] = s.docs.prefix(300).map { r in
                let u = dir.appendingPathComponent(r)
                var d: [String: Any] = ["path": r]
                if u.pathExtension.lowercased() == "pdf" { d["pages"] = pages(u) }
                return d
            }
            let other: [[String: Any]] = s.other.map { ["path": $0.key, "counts": $0.value, "bytes": s.otherBytes[$0.key] ?? 0] }
                .sorted { ($0["path"] as? String ?? "") < ($1["path"] as? String ?? "") }
            return ["folder": dir.lastPathComponent, "path": dir.path, "docs": docs, "projects": s.projects, "other": other]
        }
    }
    /// Stable key for the text cache (String.hashValue changes every launch).
    static func key(_ u: URL, _ tag: String) -> URL {
        let mod = (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0
        var h: UInt64 = 0xcbf29ce484222325
        for b in u.path.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return cache.appendingPathComponent(String(h, radix: 16) + "-" + String(Int(mod)) + tag + ".txt")
    }
    /// Plain text of a file, cached by path and modification date. At most 1.5 MB of text per file.
    /// A scanned PDF gives no text here; its OCR text is used once `ocr` has made it.
    static func text(_ u: URL) -> String {
        if let t = try? String(contentsOf: key(u, "-ocr"), encoding: .utf8) { return t }
        let c = key(u, "")
        if let t = try? String(contentsOf: c, encoding: .utf8) { return t }
        var t = ""
        switch u.pathExtension.lowercased() {
        case "pdf": t = PDFDocument(url: u)?.string ?? ""
        case "md", "txt": t = (try? String(contentsOf: u, encoding: .utf8)) ?? ""
        default: t = (try? NSAttributedString(url: u, options: [:], documentAttributes: nil))?.string ?? ""
        }
        if t.count > 1_500_000 { t = String(t.prefix(1_500_000)) }
        try? t.write(to: c, atomically: true, encoding: .utf8)
        return t
    }
    /// On-device OCR (Vision) of a scanned PDF, page by page, in English, German and Spanish. Slow: run it off the main thread.
    static func ocr(_ u: URL, progress: (Int, Int) -> Void) -> String {
        guard let doc = PDFDocument(url: u) else { return "" }
        var out: [String] = []
        let n = doc.pageCount
        for i in 0..<n {
            autoreleasepool {
                guard let page = doc.page(at: i) else { return }
                let box = page.bounds(for: .mediaBox), scale = 2200 / max(box.width, box.height, 1)
                let img = page.thumbnail(of: NSSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
                guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
                let req = VNRecognizeTextRequest()
                req.recognitionLevel = .accurate; req.usesLanguageCorrection = true
                req.recognitionLanguages = ["en-US", "de-DE", "es-ES"]
                try? VNImageRequestHandler(cgImage: cg).perform([req])
                let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                out.append("[page \(i + 1)]\n" + lines.joined(separator: "\n"))
            }
            if i % 5 == 0 || i == n - 1 { progress(i + 1, n) }
        }
        var t = out.joined(separator: "\n\n")
        if t.count > 1_500_000 { t = String(t.prefix(1_500_000)) }
        try? t.write(to: key(u, "-ocr"), atomically: true, encoding: .utf8)
        return t
    }
    @MainActor static var ocrRunning = Set<String>()
    /// A book's shape for sizing a reading (9 Nov 2026): its built-in contents (outline) with PDF page numbers, the printed page
    /// label of every page, the first and last lines of every page (printed page numbers sit there when there are no labels), and
    /// the text of the first pages (the contents pages) for when there is no outline. Scanned PDFs use their OCR text when it exists.
    static func pdfInfo(_ u: URL) -> [String: Any] {
        guard let doc = PDFDocument(url: u) else { return ["error": "Not a PDF"] }
        var outline: [[String: Any]] = []
        func walk(_ o: PDFOutline, _ level: Int) {
            for i in 0..<o.numberOfChildren {
                guard let ch = o.child(at: i) else { continue }
                if let pg = ch.destination?.page { outline.append(["title": ch.label ?? "", "page": doc.index(for: pg) + 1, "level": level]) }
                if level < 3 && outline.count < 600 { walk(ch, level + 1) }
            }
        }
        if let root = doc.outlineRoot { walk(root, 1) }
        var texts: [String] = (0..<doc.pageCount).map { doc.page(at: $0)?.string ?? "" }
        if texts.joined().trimmingCharacters(in: .whitespacesAndNewlines).count < 200, let t = try? String(contentsOf: key(u, "-ocr"), encoding: .utf8) {
            texts = Array(repeating: "", count: doc.pageCount)
            for part in t.components(separatedBy: "[page ").dropFirst() {
                let n = Int(part.prefix { $0.isNumber }) ?? 0
                if n >= 1 && n <= texts.count { texts[n - 1] = String(part.drop { $0 != "\n" }) }
            }
        }
        let edges: [String] = texts.map { t in
            let lines = t.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            return (Array(lines.prefix(2)) + Array(lines.suffix(2))).map { String($0.prefix(60)) }.joined(separator: " | ")
        }
        let labels: [String] = (0..<doc.pageCount).map { doc.page(at: $0)?.label ?? "" }
        var front = ""
        for (i, t) in texts.prefix(24).enumerated() { if front.count > 40_000 { break }; front += "[page \(i + 1)]\n" + t + "\n\n" }
        return ["pages": doc.pageCount, "outline": outline, "labels": labels, "edges": edges, "front": front]
    }
}

// MARK: - Reader

/// PDF reader: a native PDFView laid over the page where the page leaves room for it (the reading partner sits beside it).
/// Underlines and highlights are saved into the PDF itself, so Preview shows them too.
final class MarkPDFView: PDFView {
    weak var reader: Reader?
    override func performKeyEquivalent(with e: NSEvent) -> Bool {
        let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask), k = e.charactersIgnoringModifiers?.lowercased() ?? ""
        // Highlight, not underline, everywhere (reader redesign, 25 Nov 2026); ⌘U highlights too.
        if (f == .command && k == "u") || (f == [.command, .shift] && k == "h") { reader?.mark("highlight"); return true }
        return super.performKeyEquivalent(with: e)
    }
    /// The page's keys while the original page has the focus: E, D, H act on the selection (the page shows the three
    /// choices under the page), Esc, ⌥P back to the text, ⌥N reading notes, arrows turn pages as before.
    override func keyDown(with e: NSEvent) {
        let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask), k = e.charactersIgnoringModifiers?.lowercased() ?? ""
        let sel = !(currentSelection?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if f.isEmpty && sel && ["e", "d", "h"].contains(k) { reader?.send(["type": "readerKey", "key": k]); return }
        if f == .option && (k == "p" || k == "n") { reader?.send(["type": "readerKey", "key": "alt" + k]); return }
        if e.keyCode == 53 {   // Esc: first what is open (bubble, card, selection), then the page closes its own layers, then the reader
            var had = reader?.hideOverlays() ?? false
            if sel { clearSelection(); had = true }
            reader?.send(["type": "readerKey", "key": "escape", "had": had]); return
        }
        // arrows, space, page up and down turn a whole spread (the user's request, 25 Nov 2026); ⇧space goes back
        let turn: Int? = f.subtracting([.numericPad, .function]).isEmpty ? [124: 1, 125: 1, 121: 1, 123: -1, 126: -1, 116: -1][e.keyCode] : nil
        if let d = turn { reader?.turn(d); return }
        if e.keyCode == 49 && (f.isEmpty || f == .shift) { reader?.turn(f == .shift ? -1 : 1); return }
        super.keyDown(with: e)
    }
    override func mouseDown(with e: NSEvent) { reader?.hideOverlays(); super.mouseDown(with: e) }
    /// A selection that stops (mouse up) tells the page, which offers Explain · Define · Highlight.
    override func mouseUp(with e: NSEvent) {
        super.mouseUp(with: e)
        guard let r = reader, let s = currentSelection?.string, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let k = r.pen { r.mark(k); return }
        r.sendSel(end: true)
        r.showBubble()
    }
    override func menu(for e: NSEvent) -> NSMenu? {
        let m = super.menu(for: e) ?? NSMenu()
        var items: [NSMenuItem] = []
        if let s = currentSelection?.string, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(NSMenuItem(title: "Highlight", action: #selector(highlightSel), keyEquivalent: ""))
            items.append(NSMenuItem(title: "Explain", action: #selector(askSel), keyEquivalent: ""))
        }
        items.append(NSMenuItem(title: "Add note", action: #selector(noteSel), keyEquivalent: ""))
        let pt = convert(e.locationInWindow, from: nil)
        if let page = page(for: pt, nearest: false), let a = page.annotation(at: convert(pt, to: page)), Reader.isMark(a) {
            let it = NSMenuItem(title: "Remove mark", action: #selector(removeMark(_:)), keyEquivalent: ""); it.representedObject = a
            items.append(it)
        }
        if !items.isEmpty { items.reversed().forEach { $0.target = self; m.insertItem($0, at: 0) }; m.insertItem(.separator(), at: items.count) }
        return m
    }
    @objc func underlineSel() { reader?.mark("underline") }
    @objc func highlightSel() { reader?.mark("highlight") }
    @objc func askSel() { reader?.send(["type": "readerAsk"]) }
    @objc func noteSel() { reader?.send(["type": "readerNoteStart"]) }
    @objc func removeMark(_ i: NSMenuItem) { if let a = i.representedObject as? PDFAnnotation { reader?.unmark(a) } }
}

@MainActor
final class Reader: NSObject {
    weak var container: NSView?
    weak var bridge: Bridge?
    let view = MarkPDFView()
    var url: URL?
    var allowed = Set<String>()   // PDFs outside Documents he picked himself
    var saveTimer: Timer?
    var selTimer: Timer?
    var pen: String?              // "highlight" or "underline" while that pen is on
    var noteSel: PDFSelection?    // the passage a note being written is about
    var notePage = 1
    static let markKey = "PlannerMark"
    let bubble = SelBubble(frame: NSRect(origin: .zero, size: SelBubble.size))   // at the selection (ReaderOverlay.swift)
    let card = DefCard(frame: .zero)
    private var scrollWatch: NSObjectProtocol?

    override init() {
        super.init()
        view.reader = self
        view.autoScales = true
        view.displayMode = .twoUpContinuous   // the original page as a spread (reader redesign B7)
        view.displaysAsBook = true
        view.displaysPageBreaks = true
        view.backgroundColor = NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0x15/255, green: 0x15/255, blue: 0x15/255, alpha: 1) : NSColor(srgbRed: 0xF1/255, green: 0xF0/255, blue: 0xEB/255, alpha: 1) }
        NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: view)
        NotificationCenter.default.addObserver(self, selector: #selector(selChanged), name: .PDFViewSelectionChanged, object: view)
        NotificationCenter.default.addObserver(self, selector: #selector(follow), name: .PDFViewScaleChanged, object: view)
        bubble.onPick = { [weak self] k in
            guard let self else { return }
            self.bubble.removeFromSuperview()
            if k == "h" { self.mark("highlight") } else { self.send(["type": "readerKey", "key": k]) }
        }
    }
    static func isMark(_ a: PDFAnnotation) -> Bool { [PDFAnnotationSubtype.underline.rawValue, PDFAnnotationSubtype.highlight.rawValue].contains(a.type ?? "") || a.type == "Underline" || a.type == "Highlight" || isNote(a) }
    static func isNote(_ a: PDFAnnotation) -> Bool { a.type == PDFAnnotationSubtype.text.rawValue || a.type == "Text" }
    /// A note written in the reader (27 Nov 2026): a highlight over the passage whose comment is the note, so it shows in the
    /// reading view and Preview shows it as a highlight with a comment. Older notes are sticky-note icons (isNote).
    static let noteAuthor = "Planner note"
    static func isTextNote(_ a: PDFAnnotation) -> Bool { a.userName == noteAuthor }
    static func textNote(_ t: String, _ r: NSRect, name: String) -> PDFAnnotation {
        let a = PDFAnnotation(bounds: r, forType: .highlight, withProperties: nil)
        a.color = NSColor(srgbRed: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 0.55)
        a.contents = t; a.userName = noteAuthor
        if !name.isEmpty { a.setValue(name, forAnnotationKey: .name) }
        return a
    }
    func send(_ ev: [String: Any]) { bridge?.event(ev) }
    func allowedURL(_ path: String) -> URL? {
        let full = (path as NSString).standardizingPath
        guard full.lowercased().hasSuffix(".pdf"), FileManager.default.fileExists(atPath: full) else { return nil }
        return Help.inDocs(full) != nil || allowed.contains(full) ? URL(fileURLWithPath: full) : nil
    }
    /// rect is in page (CSS) pixels from the top left of the web view.
    func place(_ r: [String: Any]) {
        guard let c = container else { return }
        let x = r["x"] as? Double ?? 0, y = r["y"] as? Double ?? 0, w = r["w"] as? Double ?? 0, h = r["h"] as? Double ?? 0
        view.frame = NSRect(x: x, y: Double(c.bounds.height) - y - h, width: max(w, 0), height: max(h, 0))
        if view.superview == nil { c.addSubview(view) }
        if scrollWatch == nil, let cv = view.documentView?.enclosingScrollView?.contentView {
            cv.postsBoundsChangedNotifications = true
            scrollWatch = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: cv, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.follow() } }
        }
        follow()
    }
    func open(_ path: String, rect: [String: Any], page: Int) throws -> [String: Any] {
        guard let u = allowedURL(path), let doc = PDFDocument(url: u) else { throw NSError(domain: "reader", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not open this PDF"]) }
        flush()
        url = u; view.document = doc
        place(rect)
        if page > 1, let p = doc.page(at: min(page, doc.pageCount) - 1) { view.go(to: p) }
        view.window?.makeFirstResponder(view)
        let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
        return ["pages": doc.pageCount, "title": title, "page": current(), "name": u.lastPathComponent]
    }
    func close() { flush(); hideOverlays(); view.removeFromSuperview(); view.document = nil; url = nil }
    /// Back to the text: the page gets the keys again (arrows and space turn its pages).
    func hide() { hideOverlays(); view.removeFromSuperview(); if let c = container { c.window?.makeFirstResponder(c) } }
    /// One spread on (two pages, as a book: the first page alone), or one page in single page mode.
    func turn(_ d: Int) {
        guard let doc = view.document, let p = view.currentPage else { return }
        hideOverlays()
        let i = doc.index(for: p), two = view.displayMode == .twoUp || view.displayMode == .twoUpContinuous
        var to = i + d * (two ? 2 : 1)
        if two && view.displaysAsBook { to = d > 0 ? (i == 0 ? 1 : i + (i % 2 == 1 ? 2 : 1)) : max(0, i - (i % 2 == 1 ? 2 : 3)) }
        to = max(0, min(doc.pageCount - 1, to))
        if let t = doc.page(at: to) { view.go(to: t) }
    }
    /// Hides the selection bubble and the definition card; true when one of them was showing.
    @discardableResult func hideOverlays() -> Bool { let had = bubble.superview != nil || card.superview != nil; bubble.removeFromSuperview(); card.removeFromSuperview(); return had }
    /// The first and last line of the selection, in the container's (web view's) coordinates.
    private func selLines() -> (first: NSRect, last: NSRect)? {
        guard let c = container, view.superview != nil, let s = view.currentSelection, !(s.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let lines = s.selectionsByLine().compactMap { l -> NSRect? in guard let p = l.pages.first else { return nil }; let r = l.bounds(for: p); return r.width > 0.5 ? view.convert(view.convert(r, from: p), to: c) : nil }
        guard let f = lines.first, let l = lines.last else { return nil }
        return (f, l)
    }
    /// Explain · Define · Highlight above the selection's first line (below its last line when there is no room above).
    func showBubble() {
        guard let c = container, let (f, l) = selLines() else { bubble.removeFromSuperview(); return }
        let vis = view.frame, sz = SelBubble.size
        guard f.maxY > vis.minY, l.minY < vis.maxY else { bubble.removeFromSuperview(); return }
        let x = min(max(f.midX - sz.width / 2, vis.minX + 8), vis.maxX - sz.width - 8)
        var y = f.maxY + 2
        bubble.tailUp = y + sz.height > vis.maxY - 4
        if bubble.tailUp { y = l.minY - 2 - sz.height }
        bubble.tailX = min(max((bubble.tailUp ? l.midX : f.midX) - x, 14), sz.width - 14)
        bubble.frame = NSRect(x: x, y: y, width: sz.width, height: sz.height)
        bubble.needsDisplay = true
        if bubble.superview == nil { c.addSubview(bubble, positioned: .above, relativeTo: view) }
    }
    /// The Define card (op readerCard): under the selection, or above it when there is no room below.
    func showCard(_ a: [String: Any]) {
        if a["hide"] as? Bool == true { card.removeFromSuperview(); return }
        guard let c = container, view.superview != nil else { return }
        card.word = a["word"] as? String ?? ""; card.pos = a["pos"] as? String ?? ""; card.def = a["def"] as? String ?? ""
        card.here = a["here"] as? String ?? ""; card.note = a["note"] as? String ?? ""
        placeCard(in: c)
        if card.superview == nil { c.addSubview(card, positioned: .above, relativeTo: view) }
        bubble.removeFromSuperview()
    }
    private func placeCard(in c: NSView) {
        let vis = view.frame, h = card.fit(), w = DefCard.width
        var x = vis.midX - w / 2, y = vis.maxY - h - 16
        if let (f, l) = selLines() {
            x = min(max(l.minX - 20, vis.minX + 8), vis.maxX - w - 8)
            y = l.minY - 8 - h
            if y < vis.minY + 4 { y = min(f.maxY + 8, vis.maxY - h - 4) }
        }
        card.frame = NSRect(x: x, y: y, width: w, height: h)
        card.needsDisplay = true
    }
    /// The PDF scrolled or zoomed: the bubble and the card stay at the selection.
    @objc func follow() {
        if bubble.superview != nil { showBubble() }
        if card.superview != nil, let c = container { placeCard(in: c) }
    }
    func current() -> Int { guard let d = view.document, let p = view.currentPage else { return 1 }; return d.index(for: p) + 1 }
    func go(_ n: Int) { guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1) else { return }; view.go(to: p) }
    @objc func pageChanged() { send(["type": "readerPage", "page": current()]) }
    @objc func selChanged() {
        if (view.currentSelection?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { hideOverlays() }
        selTimer?.invalidate()
        selTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.sendSel() } }
    }
    func sendSel(end: Bool = false) {
        let s = view.currentSelection, t = (s?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pg = s?.pages.first.flatMap { view.document?.index(for: $0) }.map { $0 + 1 } ?? current()
        send(["type": "readerSel", "text": String(t.prefix(3000)), "page": pg, "end": end])
    }
    /// Rects in the reading version's page space ([x0, y0, x1, y1] from the page's top left, `size` its page size) as PDF
    /// rects on the page, snapped to the characters under them when the page has a text layer (a scan keeps them as they are).
    /// Used for marks made in the text on the Mac and, since 25 Nov 2026, for marks the phone makes without a copy of the PDF.
    static func readingBoxes(_ p: PDFPage, rects: [[Double]], size: [Double]) -> [NSRect] {
        guard size.count == 2, size[0] > 0, size[1] > 0 else { return [] }
        let crop = p.bounds(for: .cropBox), sx = crop.width / size[0], sy = crop.height / size[1]
        let hasText = !(p.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var out: [NSRect] = []
        for r in rects where r.count == 4 {
            let box = NSRect(x: crop.minX + r[0] * sx, y: crop.maxY - r[3] * sy, width: (r[2] - r[0]) * sx, height: (r[3] - r[1]) * sy)
            guard box.width > 0.5, box.height > 0.5 else { continue }
            if hasText {
                let i0 = p.characterIndex(at: NSPoint(x: box.minX + 1, y: box.midY)), i1 = p.characterIndex(at: NSPoint(x: box.maxX - 1, y: box.midY))
                if i0 >= 0, i1 >= i0, let sel = p.selection(for: NSRange(location: i0, length: i1 - i0 + 1)) {
                    let lines = sel.selectionsByLine().map { $0.bounds(for: p) }.filter { $0.width > 0.5 && abs($0.midY - box.midY) < box.height }
                    if !lines.isEmpty { out += lines; continue }
                }
            }
            out.append(box)
        }
        return out
    }
    /// A mark made in the reading version: rects are [x0, y0, x1, y1] in the reading version's page space (points from the
    /// page's top left, `size` = its page size). On a page with a text layer each rect is snapped to the characters under it,
    /// so the PDF mark covers whole words as in Preview; on a scan the rects are used as they are. kind: highlight or note.
    func markRects(page n: Int, rects: [[Double]], size: [Double], text: String, kind: String) -> [String: Any] {
        guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1), size.count == 2, size[0] > 0, size[1] > 0 else { return ["error": "No such page"] }
        let crop = p.bounds(for: .cropBox), sx = crop.width / size[0], sy = crop.height / size[1]
        let out = Reader.readingBoxes(p, rects: rects, size: size)
        guard !out.isEmpty else { return ["error": "Nothing to mark"] }
        let name = "pl-" + UUID().uuidString.prefix(8).lowercased()
        if kind == "note" {
            for b in out { p.addAnnotation(Reader.textNote(text, b, name: name)) }
        } else {
            for b in out {
                let a = PDFAnnotation(bounds: b, forType: .highlight, withProperties: nil)
                a.color = NSColor(srgbRed: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 0.55)
                a.contents = text; a.userName = "Planner"
                a.setValue(name, forAnnotationKey: .name)
                p.addAnnotation(a)
            }
        }
        dirty()
        let back = out.map { [($0.minX - crop.minX) / sx, (crop.maxY - $0.maxY) / sy, ($0.maxX - crop.minX) / sx, (crop.maxY - $0.minY) / sy] }
        return ["name": name, "page": n, "rects": back]
    }
    /// Removes a mark made in the reading version (by its name), or an older one at those rects (same space as markRects).
    func unmarkName(page n: Int, name: String, rects: [[Double]], size: [Double]) -> [String: Any] {
        guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1) else { return ["removed": 0] }
        let crop = p.bounds(for: .cropBox), sx = size.count == 2 && size[0] > 0 ? crop.width / size[0] : 1, sy = size.count == 2 && size[1] > 0 ? crop.height / size[1] : 1
        let boxes = rects.filter { $0.count == 4 }.map { NSRect(x: crop.minX + $0[0] * sx, y: crop.maxY - $0[3] * sy, width: ($0[2] - $0[0]) * sx, height: ($0[3] - $0[1]) * sy) }
        var removed = 0
        for a in p.annotations where Reader.isMark(a) && !Reader.isNote(a) {
            let an = a.value(forAnnotationKey: .name) as? String ?? ""
            let hit = (!name.isEmpty && an == name) || (name.isEmpty && boxes.contains { $0.insetBy(dx: -2, dy: -2).intersects(a.bounds) && abs($0.midY - a.bounds.midY) < max($0.height, 4) })
            if hit { p.removeAnnotation(a); removed += 1 }
        }
        if removed > 0 { dirty() }
        return ["removed": removed]
    }
    /// Every highlight and underline with its line rects in the reading version's page space (sizes: the page sizes),
    /// so the page can show them in the text. Preview's marks keep one rect per line in their quadrilateral points.
    func markList(sizes: [[Double]]) -> [[String: Any]] {
        guard let d = view.document else { return [] }
        return Reader.marks(in: d, sizes: sizes)
    }
    /// The same list for any document, with each mark's text; notes too when asked (the phone's reading versions carry them,
    /// so the phone shows the Mac's marks without a copy of the PDF).
    static func marks(in d: PDFDocument, sizes: [[Double]], notes: Bool = false) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for i in 0..<d.pageCount {
            guard let p = d.page(at: i), i < sizes.count, sizes[i].count == 2, sizes[i][0] > 0 else { continue }
            let crop = p.bounds(for: .cropBox), sx = crop.width / sizes[i][0], sy = crop.height / sizes[i][1]
            for a in p.annotations where Reader.isMark(a) && (notes || !Reader.isNote(a)) {
                let text = String((a.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(1500))
                if Reader.isNote(a) {
                    let b = a.bounds
                    out.append(["page": i + 1, "kind": "note", "name": a.value(forAnnotationKey: .name) as? String ?? "", "text": text,
                                "rects": [[(b.minX - crop.minX) / sx, (crop.maxY - b.maxY) / sy, (b.maxX - crop.minX) / sx, (crop.maxY - b.minY) / sy]]])
                    continue
                }
                var boxes: [NSRect] = []
                if let q = a.quadrilateralPoints as? [NSValue], q.count >= 4, q.count % 4 == 0 {
                    for j in stride(from: 0, to: q.count, by: 4) {
                        let pts = q[j..<j + 4].map { $0.pointValue }
                        let xs = pts.map { $0.x + a.bounds.minX }, ys = pts.map { $0.y + a.bounds.minY }
                        boxes.append(NSRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!))
                    }
                    if boxes.contains(where: { !a.bounds.insetBy(dx: -2, dy: -2).contains($0) }) { boxes = [a.bounds] }   // absolute points (some writers)
                } else { boxes = [a.bounds] }
                let kind = Reader.isTextNote(a) ? "note" : (a.type ?? "").lowercased().contains("high") ? "highlight" : "underline"
                let rects = boxes.map { [($0.minX - crop.minX) / sx, (crop.maxY - $0.maxY) / sy, ($0.maxX - crop.minX) / sx, (crop.maxY - $0.minY) / sy] }
                var m: [String: Any] = ["page": i + 1, "kind": kind, "name": a.value(forAnnotationKey: .name) as? String ?? "", "rects": rects]
                if kind == "note" { m["text"] = text }
                else if notes { m["text"] = text.isEmpty ? (p.selection(for: a.bounds)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : text }
                out.append(m)
            }
        }
        return out
    }
    /// Text of each page. A scanned PDF has none: its OCR text (made in the background, cached) is split by its [page n] lines.
    func pages() -> [String: Any] {
        guard let u = url, let d = view.document else { return ["pages": []] }
        var out: [String] = (0..<d.pageCount).map { d.page(at: $0)?.string ?? "" }
        if out.joined().trimmingCharacters(in: .whitespacesAndNewlines).count >= 200 { return ["pages": out] }
        if let t = try? String(contentsOf: Help.key(u, "-ocr"), encoding: .utf8) {
            out = Array(repeating: "", count: d.pageCount)
            for part in t.components(separatedBy: "[page ").dropFirst() {
                let n = Int(part.prefix { $0.isNumber }) ?? 0
                if n >= 1 && n <= out.count { out[n - 1] = part.drop { $0 != "\n" }.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
            return ["pages": out, "ocr": true]
        }
        if !Help.ocrRunning.contains(u.path) {
            Help.ocrRunning.insert(u.path)
            weak var me = self
            Task.detached(priority: .utility) {
                let t = Help.ocr(u) { done, total in DispatchQueue.main.async { MainActor.assumeIsolated { me?.send(["type": "readerOcr", "page": done, "pages": total]) } } }
                await MainActor.run { Help.ocrRunning.remove(u.path); me?.send(["type": "readerOcr", "done": true, "chars": t.count]) }
            }
        }
        return ["pages": out, "scanning": true]
    }
    func mark(_ kind: String, quiet: Bool = false) {
        guard let s = view.currentSelection, let d = view.document, !(s.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { send(["type": "readerNote", "text": "Select text in the PDF first."]); return }
        let color = kind == "highlight" ? NSColor(srgbRed: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 0.55) : NSColor(srgbRed: 0x75/255, green: 0x5A/255, blue: 0x9C/255, alpha: 1)
        for line in s.selectionsByLine() {
            for p in line.pages {
                let b = line.bounds(for: p); guard b.width > 0.5 else { continue }
                let a = PDFAnnotation(bounds: b, forType: kind == "highlight" ? .highlight : .underline, withProperties: nil)
                a.color = color
                a.contents = line.string ?? ""
                a.userName = "Planner"
                p.addAnnotation(a)
            }
        }
        let pg = s.pages.first.map { d.index(for: $0) + 1 } ?? current()
        view.clearSelection()
        if quiet { return }
        send(["type": "readerMark", "kind": kind, "text": String((s.string ?? "").prefix(1500)), "page": pg])
        dirty()
    }
    /// Keeps the selected passage (if any) while he writes the note in the side panel.
    func noteStart() -> [String: Any] {
        let s = view.currentSelection, t = (s?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        noteSel = t.isEmpty ? nil : s
        notePage = s?.pages.first.flatMap { view.document?.index(for: $0) }.map { $0 + 1 } ?? current()
        return ["page": notePage, "quote": String(t.prefix(600))]
    }
    /// A note is a PDF sticky note (Preview shows it); the passage it is about is highlighted too.
    func noteAdd(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let d = view.document, let p = d.page(at: notePage - 1) ?? view.currentPage else { return }
        var at: NSRect
        if let s = noteSel, let first = s.selectionsByLine().first, let fp = first.pages.first {
            view.setCurrentSelection(s, animate: false); mark("highlight", quiet: true)
            let b = first.bounds(for: fp); at = NSRect(x: max(b.minX - 22, 4), y: b.maxY - 18, width: 18, height: 18)
            fp.addAnnotation(note(t, at))
        } else {
            let box = p.bounds(for: .cropBox)
            var y = box.maxY - 40
            if p == view.currentPage { let v = view.convert(view.bounds, to: p); y = min(box.maxY - 40, v.maxY - 40) }
            at = NSRect(x: box.minX + 12, y: max(y, box.minY + 12), width: 18, height: 18)
            p.addAnnotation(note(t, at))
        }
        noteSel = nil
        send(["type": "readerMark", "kind": "note", "text": String(t.prefix(1500)), "page": notePage])
        dirty()
    }
    private func note(_ t: String, _ r: NSRect) -> PDFAnnotation {
        let a = PDFAnnotation(bounds: r, forType: .text, withProperties: nil)
        a.contents = t; a.userName = "Planner"; a.iconType = .note
        a.color = NSColor(srgbRed: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 1)
        return a
    }
    func unmark(_ a: PDFAnnotation) { a.page?.removeAnnotation(a); send(["type": "readerMark", "removed": true]); dirty() }
    /// Every underline and highlight in the PDF (his earlier ones from Preview too), lines of one mark joined.
    func marks() -> [[String: Any]] {
        guard let d = view.document else { return [] }
        var out: [[String: Any]] = []
        for i in 0..<d.pageCount {
            guard let p = d.page(at: i) else { continue }
            var last: (String, CGFloat)? = nil
            for a in p.annotations where Reader.isMark(a) {
                if Reader.isNote(a) {
                    let t = (a.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty { out.append(["page": i + 1, "kind": "note", "text": t]) }
                    last = nil; continue
                }
                let kind = (a.type ?? "").lowercased().contains("high") ? "highlight" : "underline"
                var t = (a.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if t.isEmpty { t = p.selection(for: a.bounds)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
                if t.isEmpty { continue }
                if let l = last, l.0 == kind, abs(l.1 - a.bounds.maxY) < a.bounds.height * 2.2, var prev = out.last { prev["text"] = (prev["text"] as? String ?? "") + " " + t; out[out.count - 1] = prev }
                else { out.append(["page": i + 1, "kind": kind, "text": t]) }
                last = (kind, a.bounds.minY)
            }
        }
        return out
    }
    func dirty() {
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
    }
    /// Writes the marks into the file: to a copy first, then swapped in. The OCR text cache is kept (its key changes with the file date).
    func flush() {
        guard saveTimer != nil else { return }
        saveTimer?.invalidate(); saveTimer = nil
        guard let u = url, let d = view.document else { return }
        let oldOcr = Help.key(u, "-ocr"), tmp = u.deletingLastPathComponent().appendingPathComponent(".planner-" + u.lastPathComponent)
        let before = Reading.stamp(u.path)
        guard d.write(to: tmp) else { send(["type": "readerNote", "text": "Could not save the marks into the PDF."]); return }
        do { _ = try FileManager.default.replaceItemAt(u, withItemAt: tmp) } catch { try? FileManager.default.removeItem(at: tmp); send(["type": "readerNote", "text": "Could not save the marks: \(error.localizedDescription)"]); return }
        if FileManager.default.fileExists(atPath: oldOcr.path) { try? FileManager.default.moveItem(at: oldOcr, to: Help.key(u, "-ocr")) }
        Reading.shared.carry(u.path, before: before)
    }
    /// Marks made on the iPhone (PhoneSync "marks" changes), written into the file. If the reader has this file open they
    /// go into the open document and are saved right away. add: {name, kind, page, rects: [[x, y, w, h]], text};
    /// remove: {name, kind, page, rect}: by the name the phone gave it, else the mark of that kind at that place.
    func applyPhoneMarks(_ u: URL, add: [[String: Any]], remove: [[String: Any]]) throws {
        let open = url?.standardizedFileURL.path == u.standardizedFileURL.path ? view.document : nil
        guard let doc = open ?? PDFDocument(url: u) else { throw NSError(domain: "reader", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not open the PDF"]) }
        let rect = { (v: Any?) -> NSRect? in
            guard let a = v as? [Double], a.count == 4, a[2] > 0, a[3] > 0 else { return nil }
            return NSRect(x: a[0], y: a[1], width: a[2], height: a[3])
        }
        var first = 0
        for m in add {
            let kind = m["kind"] as? String ?? "underline", n = m["page"] as? Int ?? 0, name = m["name"] as? String ?? ""
            guard n >= 1, n <= doc.pageCount, let p = doc.page(at: n - 1) else { continue }
            if first == 0 { first = n }
            // made in the phone's text view without a copy of the PDF: rects in the reading version's page space
            var boxes = (m["rects"] as? [Any] ?? []).compactMap(rect)
            if let size = m["size"] as? [Double] {
                boxes = Reader.readingBoxes(p, rects: m["rects"] as? [[Double]] ?? [], size: size)
                if kind == "note" {   // a note from the phone's text view: over the passage, like the Mac's (Reader.textNote)
                    for r in boxes { p.addAnnotation(Reader.textNote(m["text"] as? String ?? "", r, name: name)) }
                    continue
                }
            }
            for r in boxes {
                let a: PDFAnnotation
                if kind == "note" { a = note(m["text"] as? String ?? "", r) }
                else {
                    a = PDFAnnotation(bounds: r, forType: kind == "highlight" ? .highlight : .underline, withProperties: nil)
                    a.color = kind == "highlight" ? NSColor(srgbRed: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 0.55) : NSColor(srgbRed: 0x75/255, green: 0x5A/255, blue: 0x9C/255, alpha: 1)
                    a.contents = m["text"] as? String ?? ""; a.userName = "Planner"
                }
                if !name.isEmpty { a.setValue(name, forAnnotationKey: .name) }
                p.addAnnotation(a)
            }
        }
        for m in remove {
            let n = m["page"] as? Int ?? 0, name = m["name"] as? String ?? "", kind = m["kind"] as? String ?? ""
            guard n >= 1, n <= doc.pageCount, let p = doc.page(at: n - 1) else { continue }
            let r = rect(m["rect"])
            // from the phone's text view: an unnamed mark (Preview's) at these rects in the reading version's page space
            var over: [NSRect] = []
            if name.isEmpty, let size = m["size"] as? [Double], size.count == 2, size[0] > 0, size[1] > 0 {
                let crop = p.bounds(for: .cropBox), sx = crop.width / size[0], sy = crop.height / size[1]
                over = (m["rects"] as? [[Double]] ?? []).filter { $0.count == 4 }.map { NSRect(x: crop.minX + $0[0] * sx, y: crop.maxY - $0[3] * sy, width: ($0[2] - $0[0]) * sx, height: ($0[3] - $0[1]) * sy) }
            }
            for a in p.annotations where Reader.isMark(a) {
                let an = a.value(forAnnotationKey: .name) as? String ?? ""
                let k = Reader.isNote(a) ? "note" : (a.type ?? "").lowercased().contains("high") ? "highlight" : "underline"
                let same = !name.isEmpty && an == name
                let near = r.map { k == kind && abs(a.bounds.minX - $0.minX) < 1.5 && abs(a.bounds.minY - $0.minY) < 1.5 && abs(a.bounds.width - $0.width) < 2 } ?? false
                let under = !Reader.isNote(a) && over.contains { $0.insetBy(dx: -2, dy: -2).intersects(a.bounds) && abs($0.midY - a.bounds.midY) < max($0.height, 4) }
                if same || near || under { p.removeAnnotation(a) }
            }
            if first == 0 { first = n }
        }
        if open != nil {
            dirty(); flush()
            send(["type": "readerMark", "kind": "phone", "page": max(first, 1)])
        } else {
            try Reader.write(doc, to: u)
        }
    }
    /// Saves a document over its file: to a copy first, then swapped in; the OCR text cache is kept.
    static func write(_ d: PDFDocument, to u: URL) throws {
        let oldOcr = Help.key(u, "-ocr"), tmp = u.deletingLastPathComponent().appendingPathComponent(".planner-" + u.lastPathComponent)
        let before = Reading.stamp(u.path)
        guard d.write(to: tmp) else { throw NSError(domain: "reader", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not write the PDF"]) }
        do { _ = try FileManager.default.replaceItemAt(u, withItemAt: tmp) } catch { try? FileManager.default.removeItem(at: tmp); throw error }
        if FileManager.default.fileExists(atPath: oldOcr.path) { try? FileManager.default.moveItem(at: oldOcr, to: Help.key(u, "-ocr")) }
        Reading.shared.carry(u.path, before: before)
    }
    func pick() -> [String: Any] {
        let panel = NSOpenPanel()
        panel.title = "Open a PDF"; panel.allowedContentTypes = [.pdf]; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let u = panel.url else { return [:] }
        allowed.insert(u.standardizedFileURL.path)
        return ["path": u.standardizedFileURL.path]
    }
}

final class Brain {
    func list() -> [[String: Any]] {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: BrainPaths.root, includingPropertiesForKeys: nil) else { return [] }
        return items.filter { $0.pathExtension == "json" && !$0.lastPathComponent.hasPrefix("_") && !$0.lastPathComponent.contains(".rec-") }.compactMap { u in
            guard let d = try? Data(contentsOf: u), var o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
            // light copy for the list; segments can be large
            if let segs = o["segments"] as? [Any] { o["segmentCount"] = segs.count }
            o.removeValue(forKey: "segments")
            return o
        }.sorted { ($0["created"] as? String ?? "") > ($1["created"] as? String ?? "") }
    }
    func get(_ id: String) throws -> [String: Any] {
        let d = try Data(contentsOf: BrainPaths.meeting(id))
        return try JSONSerialization.jsonObject(with: d) as? [String: Any] ?? [:]
    }
    func save(_ m: [String: Any]) throws {
        guard let id = m["id"] as? String, !id.isEmpty, !id.contains("/") else { throw NSError(domain: "brain", code: 1, userInfo: [NSLocalizedDescriptionKey: "Meeting needs an id"]) }
        var m = m
        // keep segments if the caller sent a light copy
        if m["segments"] == nil, let old = try? get(id), let segs = old["segments"] { m["segments"] = segs }
        let d = try JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted, .sortedKeys])
        try d.write(to: BrainPaths.meeting(id), options: .atomic)
    }
    func delete(_ id: String) throws {
        let m = (try? get(id)) ?? [:]
        if let a = m["audio"] as? String { try? FileManager.default.removeItem(at: BrainPaths.audio.appendingPathComponent(a)) }
        try FileManager.default.removeItem(at: BrainPaths.meeting(id))
    }
}

/// Reads Zoom's mute state from its menu bar ("Mute audio" means you are unmuted). Needs Accessibility access.
enum ZoomMute {
    static let bundleID = "us.zoom.xos"
    static var titles: (mute: String, unmute: String) = {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID), let b = Bundle(url: url) {
            return (b.localizedString(forKey: "Mute Audio", value: "Mute audio", table: "Localizable").lowercased(),
                    b.localizedString(forKey: "Unmute Audio", value: "Unmute audio", table: "Localizable").lowercased())
        }
        return ("mute audio", "unmute audio")
    }()
    static func trusted(prompt: Bool) -> Bool {
        AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)
    }
    static var running: NSRunningApplication? { NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first }
    private static func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
    /// true = muted, false = unmuted, nil = not in a meeting or cannot tell.
    static func muted() -> Bool? {
        guard let app = running, trusted(prompt: false) else { return nil }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        guard let bar = attr(root, kAXMenuBarAttribute) else { return nil }
        let (mute, unmute) = titles
        for item in (attr(bar as! AXUIElement, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
            for menu in (attr(item, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
                for mi in (attr(menu, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
                    guard let t = (attr(mi, kAXTitleAttribute) as? String)?.lowercased() else { continue }
                    if t == unmute { return true }
                    if t == mute { return false }
                }
            }
        }
        return nil
    }
}

/// Records the microphone and, optionally, the computer's own audio (online calls) to two files.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    // Mic through an input-only capture session. AVAudioEngine also opened the speakers, which made other apps' sound crackle.
    private var session: AVCaptureSession?
    private let micQ = DispatchQueue(label: "rec.mic", qos: .userInitiated)
    private(set) var micUsed = false
    private var micFile: AVAudioFile?
    private var sysFile: AVAudioFile?
    private var stream: SCStream?
    private(set) var id: String?
    private(set) var started: Date?
    private(set) var withSystem = false
    private let q = DispatchQueue(label: "rec.sys")
    /// Called about 12 times a second with the mic level (RMS), for the live waveform strip.
    var onLevel: ((Double) -> Void)?
    /// The same for the computer's audio, so the strip shows the meeting is really being heard.
    var onSysLevel: ((Double) -> Void)?
    private var lastLevel = Date.distantPast
    private var lastSysLevel = Date.distantPast

    var micURL: URL? { id.map { BrainPaths.work.appendingPathComponent("\($0)-mic.caf") } }
    var sysURL: URL? { id.map { BrainPaths.work.appendingPathComponent("\($0)-sys.caf") } }

    /// Call apps that mean "online meeting": record the computer's audio, and the mic only when you speak.
    static let callApps = ["us.zoom.xos", "com.microsoft.teams2", "com.microsoft.teams", "com.cisco.webexmeetingsapp", "Cisco-Systems.Spark", "com.apple.FaceTime", "com.hnc.Discord"]
    static func callAppRunning() -> String? {
        for a in NSWorkspace.shared.runningApplications { if let b = a.bundleIdentifier, callApps.contains(b) { return a.localizedName ?? b } }
        return nil
    }
    private(set) var online = false
    enum MicPolicy: String { case on, off, zoom }
    private(set) var micPolicy = MicPolicy.on
    private let micLock = NSLock()
    private var micOpenFlag = true
    var micOpen: Bool { get { micLock.lock(); defer { micLock.unlock() }; return micOpenFlag } set { micLock.lock(); micOpenFlag = newValue; micLock.unlock() } }
    private var muteTimer: Timer?
    var onMicState: ((Bool) -> Void)?
    // Headphones connected or removed mid-call (8 Nov 2026: the call went silent after switching to Bluetooth while recording).
    // On any change of the Mac's audio devices the recorder lets go of the mic and the computer's audio at once,
    // waits until macOS has settled on the new route, then comes back. The gap is filled with silence so mic and call stay aligned.
    private var routeListeners: [(AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []
    private var resumeWork: DispatchWorkItem?
    private var micErrObs: NSObjectProtocol?
    private var micFrames: Int64 = 0, sysFrames: Int64 = 0   // frames written (micQ / q)
    private var micT0: Date?, sysT0: Date?                   // first buffer written (micQ / q)
    private var micPad = false, sysPad = false               // pad up to the clock at the next buffer (micQ / q)

    func start(system: Bool) async throws -> String {
        guard id == nil else { throw NSError(domain: "rec", code: 1, userInfo: [NSLocalizedDescriptionKey: "Already recording"]) }
        let ok = await AVCaptureDevice.requestAccess(for: .audio)
        guard ok else { throw NSError(domain: "rec", code: 2, userInfo: [NSLocalizedDescriptionKey: "Microphone access is off. Turn it on in System Settings > Privacy & Security > Microphone."]) }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HHmmss"
        let newId = "m-" + f.string(from: Date())
        id = newId
        withSystem = false
        online = system
        if !system { micPolicy = .on }
        else if ZoomMute.running != nil && ZoomMute.trusted(prompt: true) { micPolicy = .zoom }
        else { micPolicy = .on }   // Meet in a browser, Teams…: mute can't be read, so your mic is recorded the whole call
        micOpen = micPolicy == .on || (micPolicy == .zoom && ZoomMute.muted() == false)
        // The capture session only reads the mic; the call app keeps using it at the same time.
        micUsed = micPolicy != .off
        if micUsed {
            do { try startMic() }
            catch { id = nil; throw error }
        }
        if micPolicy == .zoom {
            DispatchQueue.main.async {
                self.muteTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                    guard let self = self else { return }
                    let open = ZoomMute.muted() == false   // unknown counts as muted
                    if open != self.micOpen { self.micOpen = open; self.onMicState?(open) }
                }
            }
        }
        if system {
            do { try await startSystem(); withSystem = true }
            catch {
                NSLog("System audio not available: \(error)")
                // Without the computer's audio the mic is the only source: open it so the meeting isn't lost.
                if !micUsed { micPolicy = .on; micOpen = true; micUsed = true; do { try startMic() } catch { id = nil; throw error } }
            }
        }
        started = Date()
        DispatchQueue.main.async { self.watchRoute() }
        return newId
    }

    /// Never the headset's mic: opening a Bluetooth mic switches the headphones to call mode, which can cut the sound of the call.
    /// The Mac's own mic is used instead (it hears you through the headphones too).
    static func isBluetooth(_ d: AVCaptureDevice) -> Bool {
        let t = UInt32(bitPattern: d.transportType)
        return t == kAudioDeviceTransportTypeBluetooth || t == kAudioDeviceTransportTypeBluetoothLE
    }
    static func pickMic() -> AVCaptureDevice? {
        let def = AVCaptureDevice.default(for: .audio)
        guard let d = def, isBluetooth(d) else { return def }
        let all = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices
        return all.first { UInt32(bitPattern: $0.transportType) == kAudioDeviceTransportTypeBuiltIn } ?? all.first { !isBluetooth($0) } ?? d
    }

    private func watchRoute() {
        guard id != nil, routeListeners.isEmpty else { return }
        for sel in [kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDevices] {
            var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.routeChanged() }
            if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, DispatchQueue.main, block) == noErr { routeListeners.append((addr, block)) }
        }
    }
    private func unwatchRoute() {
        for (a, b) in routeListeners { var a = a; AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &a, DispatchQueue.main, b) }
        routeListeners = []
    }
    /// Main queue. Let go of both captures now; come back 2 s after the last change.
    private func routeChanged() {
        guard id != nil else { return }
        NSLog("Audio devices changed while recording: pausing capture")
        if let ses = session { session = nil; micQ.async { ses.stopRunning() } }
        if let s = stream { stream = nil; Task { try? await s.stopCapture() } }
        scheduleResume()
    }
    private func scheduleResume() {
        resumeWork?.cancel()
        let w = DispatchWorkItem { [weak self] in Task { await self?.resumeCapture() } }
        resumeWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: w)
    }
    private func resumeCapture() async {
        guard id != nil else { return }
        if micUsed && session == nil {
            micQ.sync { micPad = true }
            do { try startMic() } catch { NSLog("Mic after device change: \(error)") }
        }
        if withSystem && stream == nil {
            q.sync { sysPad = true }
            do { try await startSystem() } catch { NSLog("System audio after device change: \(error)"); scheduleResume() }
        }
        if id == nil {   // stopped meanwhile
            session?.stopRunning(); session = nil
            if let s = stream { stream = nil; try? await s.stopCapture() }
        }
    }
    /// The capture stopped on its own (device gone, route change): come back on the new route.
    func stream(_ s: SCStream, didStopWithError error: Error) {
        NSLog("System audio stopped: \(error)")
        DispatchQueue.main.async { if self.stream === s { self.stream = nil }; if self.id != nil { self.scheduleResume() } }
    }
    /// Writes silence from the last written frame up to the clock, so a pause does not shift this file against the other.
    private static func pad(_ f: AVAudioFile, t0: Date?, written: inout Int64, next: AVAudioPCMBuffer) {
        guard let t0 = t0 else { return }
        let rate = next.format.sampleRate
        var left = min(Int64(Date().timeIntervalSince(t0) * rate) - written - Int64(next.frameLength), Int64(rate * 600))
        guard left > Int64(rate * 0.2), let z = AVAudioPCMBuffer(pcmFormat: next.format, frameCapacity: AVAudioFrameCount(rate)) else { return }
        while left > 0 {
            z.frameLength = AVAudioFrameCount(min(left, Int64(rate)))
            for b in UnsafeMutableAudioBufferListPointer(z.mutableAudioBufferList) { if let p = b.mData { memset(p, 0, Int(b.mDataByteSize)) } }
            do { try f.write(from: z) } catch { return }
            written += Int64(z.frameLength); left -= Int64(z.frameLength)
        }
    }

    private func startMic() throws {
        guard let dev = Recorder.pickMic() else { throw NSError(domain: "rec", code: 4, userInfo: [NSLocalizedDescriptionKey: "No microphone found."]) }
        let ses = AVCaptureSession()
        let inp = try AVCaptureDeviceInput(device: dev)
        guard ses.canAddInput(inp) else { throw NSError(domain: "rec", code: 4, userInfo: [NSLocalizedDescriptionKey: "The microphone is busy."]) }
        ses.addInput(inp)
        let out = AVCaptureAudioDataOutput()
        // Fixed format, so the file stays writable when the mic changes mid-recording.
        out.audioSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: true,
                             AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1]
        out.setSampleBufferDelegate(self, queue: micQ)
        guard ses.canAddOutput(out) else { throw NSError(domain: "rec", code: 4, userInfo: [NSLocalizedDescriptionKey: "Can't read the microphone."]) }
        ses.addOutput(out)
        if let o = micErrObs { NotificationCenter.default.removeObserver(o) }
        micErrObs = NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: ses, queue: .main) { [weak self] n in
            guard let self = self, self.session === ses else { return }
            NSLog("Mic capture error: \(String(describing: n.userInfo?[AVCaptureSessionErrorKey]))")
            self.session = nil; self.micQ.async { ses.stopRunning() }; self.scheduleResume()
        }
        ses.startRunning()
        session = ses
    }

    private static func pcm(_ sb: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let desc = sb.formatDescription, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return nil }
        var a = asbd.pointee
        guard let fmt = AVAudioFormat(streamDescription: &a) else { return nil }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(frames), into: buf.mutableAudioBufferList) == noErr else { return nil }
        return buf
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buf = Recorder.pcm(sb) else { return }
        // Online calls: your mic only goes in while you are unmuted in Zoom; otherwise silence keeps the timeline aligned.
        if !micOpen, let chans = buf.floatChannelData {
            for c in 0..<Int(buf.format.channelCount) { memset(chans[c], 0, Int(buf.frameLength) * MemoryLayout<Float>.size) }
        }
        if micFile == nil, let u = micURL { micFile = try? AVAudioFile(forWriting: u, settings: buf.format.settings); micT0 = Date(); micFrames = 0 }
        if micPad, let f = micFile { micPad = false; Recorder.pad(f, t0: micT0, written: &micFrames, next: buf) }
        if (try? micFile?.write(from: buf)) != nil { micFrames += Int64(buf.frameLength) }
        if Date().timeIntervalSince(lastLevel) > 0.08, let ch = buf.floatChannelData?[0] {
            lastLevel = Date()
            var sum: Float = 0
            for i in 0..<Int(buf.frameLength) { sum += ch[i] * ch[i] }
            onLevel?(Double(sqrt(sum / Float(buf.frameLength))))
        }
    }

    private func startSystem() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else { throw NSError(domain: "rec", code: 3) }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
        cfg.width = 2; cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: q)
        try await s.startCapture()
        stream = s
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let buf = Recorder.pcm(sb) else { return }
        let fmt = buf.format
        if sysFile == nil, let u = sysURL { sysFile = try? AVAudioFile(forWriting: u, settings: fmt.settings); sysT0 = Date(); sysFrames = 0 }
        if sysPad, let f = sysFile { sysPad = false; Recorder.pad(f, t0: sysT0, written: &sysFrames, next: buf) }
        if (try? sysFile?.write(from: buf)) != nil { sysFrames += Int64(buf.frameLength) }
        if Date().timeIntervalSince(lastSysLevel) > 0.08, let chans = buf.floatChannelData {
            lastSysLevel = Date()
            var sum: Float = 0
            let n = Int(buf.frameLength), ch = Int(buf.format.channelCount)
            for c in 0..<ch { for i in 0..<n { sum += chans[c][i] * chans[c][i] } }
            onSysLevel?(Double(sqrt(sum / Float(max(1, n * ch)))))
        }
    }

    /// Stops and returns (id, mic file, system file or nil, seconds).
    func stop() async -> (String, URL, URL?, Double)? {
        guard let id = id, let mic = micURL else { return nil }
        DispatchQueue.main.async {
            self.muteTimer?.invalidate(); self.muteTimer = nil
            self.resumeWork?.cancel(); self.resumeWork = nil; self.unwatchRoute()
            if let o = self.micErrObs { NotificationCenter.default.removeObserver(o); self.micErrObs = nil }
        }
        session?.stopRunning(); session = nil
        if let s = stream { try? await s.stopCapture() }
        stream = nil
        let secs = Date().timeIntervalSince(started ?? Date())
        micQ.sync { micFile = nil; micT0 = nil; micPad = false }
        let sys = q.sync { () -> URL? in let u = sysFile != nil ? sysURL : nil; sysFile = nil; sysT0 = nil; sysPad = false; return u }
        self.id = nil; started = nil
        return (id, mic, sys, secs)
    }
}

final class Meetings {
    let brain = Brain()
    let rec = Recorder()
    let models: Models
    weak var bridge: Bridge? {
        didSet {
            rec.onLevel = { [weak self] v in DispatchQueue.main.async { self?.bridge?.event(["type": "level", "v": v]) } }
            rec.onSysLevel = { [weak self] v in DispatchQueue.main.async { self?.bridge?.event(["type": "sysLevel", "v": v]) } }
            rec.onMicState = { [weak self] open in DispatchQueue.main.async { self?.bridge?.event(["type": "mic", "open": open]) } }
        }
    }
    init(models: Models) { self.models = models }

    /// Loudness per slice of the recording, 0…1, for the waveform strip.
    func peaks(of file: URL, n: Int = 180) throws -> [Double] {
        let f = try AVAudioFile(forReading: file)
        let total = Int(f.length); guard total > 0 else { return [] }
        let per = max(1, total / n)
        guard let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(per)) else { return [] }
        var out: [Double] = []
        while out.count < n {
            try f.read(into: buf, frameCount: AVAudioFrameCount(per))
            if buf.frameLength == 0 { break }
            guard let ch = buf.floatChannelData?[0] else { break }
            var sum: Float = 0
            for i in 0..<Int(buf.frameLength) { sum += ch[i] * ch[i] }
            out.append(Double(sqrt(sum / Float(buf.frameLength))))
        }
        let mx = out.max() ?? 1
        return out.map { mx > 0 ? (($0 / mx) * 100).rounded() / 100 : 0 }
    }

    private var whisperFiles: [URL] {
        let items = (try? FileManager.default.contentsOfDirectory(at: BrainPaths.models.resolvingSymlinksInPath(), includingPropertiesForKeys: nil)) ?? []
        return items.filter { $0.lastPathComponent.hasPrefix("ggml-") && $0.pathExtension == "bin" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
    private static let quick = ["tiny", "base", "small"]
    private static func isQuick(_ u: URL) -> Bool { quick.contains { u.lastPathComponent.hasPrefix("ggml-\($0)") } }
    /// The accurate model for the full pass after a recording: turbo first (nearly large-v3 accuracy, several times faster,
    /// a much shorter load after Stop), then large or medium, else whatever is there.
    var whisperModel: URL? { let f = whisperFiles; return f.first(where: { $0.lastPathComponent.contains("turbo") }) ?? f.first(where: { !Self.isQuick($0) }) ?? f.last }
    /// A small, fast model for spotting the spoken language; falls back to the accurate one.
    var liveWhisperModel: URL? { let f = whisperFiles; return Self.quick.reversed().lazy.compactMap { q in f.first { $0.lastPathComponent.hasPrefix("ggml-\(q)") } }.first ?? whisperModel }

    /// Silero voice activity detection (about 0.9 MB). It keeps Whisper from inventing lines during silence
    /// ("Thank you." every 30 s) and skips the quiet parts, so a 2 h meeting transcribes much faster.
    /// The app carries it in its bundle; a newer model in models/ wins.
    var vadModel: URL? {
        let f = (try? FileManager.default.contentsOfDirectory(at: BrainPaths.models.resolvingSymlinksInPath(), includingPropertiesForKeys: nil)) ?? []
        return f.first { $0.lastPathComponent.hasPrefix("ggml-silero") && $0.pathExtension == "bin" }
            ?? Bundle.main.url(forResource: "ggml-silero-v6.2.0", withExtension: "bin")
    }

    func status() -> [String: Any] {
        [
            "recording": rec.id != nil, "id": rec.id ?? "", "withSystem": rec.withSystem,
            "seconds": rec.started.map { Date().timeIntervalSince($0) } ?? 0,
            "callApp": Recorder.callAppRunning() ?? "",
            "micPolicy": rec.micPolicy.rawValue, "micOpen": rec.micOpen,
            "zoomAccess": ZoomMute.trusted(prompt: false),
            "whisper": models.find("whisper-cli") != nil, "ffmpeg": models.find("ffmpeg") != nil,
            "vad": vadModel != nil,
            "model": whisperModel?.lastPathComponent ?? "", "liveModel": liveWhisperModel?.lastPathComponent ?? "",
        ]
    }

    /// Mix to 16 kHz mono WAV for Whisper, keep an m4a copy, then transcribe. Progress goes to the page as events.
    static func writeWav(_ s: [Float], to url: URL) throws {
        var d = Data(); let n = s.count
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + n * 2)); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(UInt32(n * 2))
        var pcm = [Int16](repeating: 0, count: n)
        for i in 0..<n { pcm[i] = Int16(max(-1, min(1, s[i])) * 32767) }
        pcm.withUnsafeBytes { d.append(contentsOf: $0) }
        try d.write(to: url)
    }
    static func parseWhisper(_ url: URL, offset: Double) -> [[String: Any]] {
        guard let d = try? Data(contentsOf: url), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [] }
        return (o["transcription"] as? [[String: Any]] ?? []).compactMap { it in
            let text = (it["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text != "[BLANK_AUDIO]", !text.hasPrefix("[") else { return nil }
            return ["t": offset + ((it["offsets"] as? [String: Any])?["from"] as? Double ?? 0) / 1000, "text": text]
        }
    }

    /// Bring in an audio or video file: convert, keep a small copy, transcribe.
    @MainActor
    func importMedia(course: String) async throws -> [String: Any] {
        let panel = NSOpenPanel()
        panel.title = "Import audio or video"; panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
        panel.allowedContentTypes = [.audio, .movie, .audiovisualContent]
        guard panel.runModal() == .OK, let src = panel.url else { return [:] }
        let created = (try? src.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date()
        return try await importFile(src, course: course, title: src.deletingPathExtension().lastPathComponent, created: created, source: "import")
    }

    /// An audio or video file into Brain: converted for Whisper (16 kHz WAV) and to a small m4a, then transcribed.
    /// Used by Import and by recordings from the Planner iPhone app (source "iphone", PhoneSync.swift).
    func importFile(_ src: URL, course: String, title: String, created: Date, source: String) async throws -> [String: Any] {
        guard let ffmpeg = models.find("ffmpeg") else { throw NSError(domain: "rec", code: 5, userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found"]) }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HHmmss"
        var id = (source == "iphone" ? "p-" : "f-") + f.string(from: Date())
        if FileManager.default.fileExists(atPath: BrainPaths.audio.appendingPathComponent("\(id).m4a").path) { id += "-" + UUID().uuidString.prefix(4).lowercased() }
        let wav = BrainPaths.work.appendingPathComponent("\(id).wav"), m4a = BrainPaths.audio.appendingPathComponent("\(id).m4a")
        await bridge?.event(["type": "meeting", "id": id, "stage": "converting"])
        setJob(id, ["stage": "converting", "title": title, "pct": 0])
        do {
            _ = try await models.run(ffmpeg, ["-y", "-i", src.path, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav.path, "-loglevel", "error"], stdin: "", timeout: 3600, background: true)
            _ = try await models.run(ffmpeg, ["-y", "-i", wav.path, "-c:a", "aac_at", "-profile:a", "4", "-b:a", "16k", m4a.path, "-loglevel", "error"], stdin: "", timeout: 3600, background: true)
        } catch { failJob(id, error); throw error }
        let dur = Double((try? AVAudioFile(forReading: wav).length) ?? 0) / 16000
        var m: [String: Any] = ["id": id, "title": title, "created": ISO8601DateFormatter().string(from: created),
                                "duration": dur, "course": course, "audio": m4a.lastPathComponent, "source": source, "status": "transcribing"]
        try brain.save(m)
        m["peaks"] = (try? peaks(of: m4a)) ?? []
        m["segments"] = try await transcribe(id: id, wav: wav)
        try? FileManager.default.removeItem(at: wav)
        m["status"] = "transcribed"
        try brain.save(m)
        return m
    }

    // MARK: job status (what is being processed, how far, and what failed)
    private let jobLock = NSLock()
    private var jobs: [String: [String: Any]] = [:]
    func setJob(_ id: String, _ change: [String: Any]) {
        jobLock.lock()
        var j = jobs[id] ?? ["id": id, "started": Date().timeIntervalSince1970 * 1000]
        for (k, v) in change { j[k] = v }
        j["updated"] = Date().timeIntervalSince1970 * 1000
        if change["stage"] != nil && change["stageStarted"] == nil { j["stageStarted"] = Date().timeIntervalSince1970 * 1000 }
        jobs[id] = j
        jobLock.unlock()
        let snap = j
        Task { @MainActor [weak self] in self?.bridge?.event(["type": "job", "job": snap]) }
    }
    func jobList() -> [[String: Any]] {
        jobLock.lock(); defer { jobLock.unlock() }
        let now = Date().timeIntervalSince1970 * 1000
        // keep finished jobs for 10 minutes, failed ones until retried
        jobs = jobs.filter { ($0.value["stage"] as? String) != "done" || now - ($0.value["updated"] as? Double ?? 0) < 600_000 }
        return Array(jobs.values)
    }
    func failJob(_ id: String, _ error: Error) { setJob(id, ["stage": "failed", "error": error.localizedDescription]) }

    // MARK: crash safety
    // Every recording has a manifest in brain/work/<id>.rec.json (title, course, notes, live transcript, files).
    // It is removed only when the meeting is safely saved. At launch, leftover manifests are processed.
    static func manifestURL(_ id: String) -> URL { BrainPaths.work.appendingPathComponent("\(id).rec.json") }
    private let manLock = NSLock()
    func readManifest(_ id: String) -> [String: Any] {
        guard let d = try? Data(contentsOf: Meetings.manifestURL(id)), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return o
    }
    func updateManifest(_ id: String, _ change: (inout [String: Any]) -> Void) {
        manLock.lock(); defer { manLock.unlock() }
        var m = readManifest(id); if m.isEmpty { m["id"] = id }
        change(&m); m["saved"] = ISO8601DateFormatter().string(from: Date())
        if let d = try? JSONSerialization.data(withJSONObject: m, options: [.sortedKeys]) { try? d.write(to: Meetings.manifestURL(id), options: .atomic) }
    }
    func dropManifest(_ id: String) { try? FileManager.default.removeItem(at: Meetings.manifestURL(id)) }

    /// Stop the recording (closing the audio files) and keep everything on disk for processing.
    func stopKeeping() async -> (String, URL, URL?, Double)? {
        guard let r = await rec.stop() else { return nil }
        updateManifest(r.0) { $0["state"] = "stopped"; $0["seconds"] = r.3; $0["mic"] = r.1.lastPathComponent; $0["sys"] = r.2?.lastPathComponent ?? "" }
        return r
    }

    /// Process recordings and meetings that a crash or quit left unfinished. Runs once at launch.
    func recover() async -> [String] {
        var done: [String] = []
        let fm = FileManager.default
        var items = (try? fm.contentsOfDirectory(at: BrainPaths.work, includingPropertiesForKeys: nil)) ?? []
        // Audio left without a manifest (older versions, or a crash before it was written): give it one.
        for u in items where u.lastPathComponent.hasSuffix("-mic.caf") || u.lastPathComponent.hasSuffix("-sys.caf") {
            let id = String(u.lastPathComponent.dropLast("-mic.caf".count))
            guard id != rec.id, !fm.fileExists(atPath: Meetings.manifestURL(id).path) else { continue }
            let made = (try? fm.attributesOfItem(atPath: u.path)[.creationDate] as? Date) ?? Date()
            updateManifest(id) { $0["started"] = ISO8601DateFormatter().string(from: made); $0["title"] = "Recovered recording"; $0["state"] = "orphan" }
        }
        items = (try? fm.contentsOfDirectory(at: BrainPaths.work, includingPropertiesForKeys: nil)) ?? []
        for u in items where u.lastPathComponent.hasSuffix(".rec.json") {
            let id = String(u.lastPathComponent.dropLast(".rec.json".count))
            if rec.id == id { continue }
            let man = readManifest(id)
            if man.isEmpty, let raw = try? Data(contentsOf: u), !raw.isEmpty {
                // Unreadable manifest: keep it next to the audio for a person to look at; recover the audio anyway.
                try? fm.copyItem(at: u, to: BrainPaths.root.appendingPathComponent("\(id).rec-unreadable.json"))
            }
            let mic = BrainPaths.work.appendingPathComponent("\(id)-mic.caf"), sysU = BrainPaths.work.appendingPathComponent("\(id)-sys.caf")
            let title = man["title"] as? String ?? "", notes = man["notes"] as? String ?? "", course = man["course"] as? String ?? ""
            await bridge?.event(["type": "meeting", "id": id, "stage": "recovering"])
            setJob(id, ["stage": "recovering", "title": title.isEmpty ? "Unfinished recording" : title, "pct": 0])
            let big = { (u: URL) in ((try? fm.attributesOfItem(atPath: u.path)[.size] as? Int) ?? 0) ?? 0 > 4096 }
            if big(mic) || big(sysU) {
                let main = big(mic) ? mic : sysU
                let secs = (man["seconds"] as? Double) ?? Double((try? AVAudioFile(forReading: main).length) ?? 0) / ((try? AVAudioFile(forReading: main).fileFormat.sampleRate) ?? 48000)
                do { _ = try await process(id: id, mic: mic, sys: fm.fileExists(atPath: sysU.path) ? sysU : nil, secs: secs, course: course, title: title, notes: notes, withSystem: man["withSystem"] as? Bool ?? false, live: man["live"] as? [[String: Any]] ?? []); done.append(id) }
                catch { NSLog("recover \(id): \(error)"); failJob(id, error) }
            } else {
                // No usable audio: keep what was typed and heard.
                let live = man["live"] as? [[String: Any]] ?? []
                if !notes.isEmpty || !live.isEmpty || !title.isEmpty {
                    try? brain.save(["id": id, "title": title.isEmpty ? "Recovered notes" : title, "notes": notes, "segments": live, "course": course,
                                     "created": man["started"] as? String ?? ISO8601DateFormatter().string(from: Date()), "source": "app", "status": live.isEmpty ? "notes" : "transcribed", "recovered": true])
                    done.append(id)
                }
                dropManifest(id)
            }
        }
        // Meetings saved but never transcribed (the app stopped during transcription): redo it from the kept audio.
        for meta in brain.list() where (meta["status"] as? String) == "transcribing" {
            guard let id = meta["id"] as? String, var m = try? brain.get(id), let a = m["audio"] as? String,
                  let ffmpeg = models.find("ffmpeg") else { continue }
            let wav = BrainPaths.work.appendingPathComponent("\(id).wav")
            do {
                _ = try await models.run(ffmpeg, ["-y", "-i", BrainPaths.audio.appendingPathComponent(a).path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav.path, "-loglevel", "error"], stdin: "", timeout: 1800, background: true)
                m["segments"] = try await transcribe(id: id, wav: wav); m["status"] = "transcribed"; m["recovered"] = true
                try brain.save(m); done.append(id)
            } catch { NSLog("retranscribe \(id): \(error)"); failJob(id, error) }
            try? fm.removeItem(at: wav)
        }
        // Old leftovers in work/ (temporary wav/json older than a day, no manifest) are cleared.
        for u in items where !u.lastPathComponent.hasSuffix(".rec.json") && !u.lastPathComponent.hasSuffix(".caf") {
            if let d = (try? fm.attributesOfItem(atPath: u.path))?[.modificationDate] as? Date, Date().timeIntervalSince(d) > 86400 { try? fm.removeItem(at: u) }
        }
        return done
    }

    func finish(course: String, title: String = "", notes: String = "") async throws -> [String: Any] {
        guard let (id, mic, sys, secs) = await stopKeeping() else { throw NSError(domain: "rec", code: 4, userInfo: [NSLocalizedDescriptionKey: "Not recording"]) }
        updateManifest(id) { $0["title"] = title; $0["notes"] = notes; $0["course"] = course }
        return try await process(id: id, mic: mic, sys: sys, secs: secs, course: course, title: title, notes: notes, withSystem: rec.withSystem, live: readManifest(id)["live"] as? [[String: Any]] ?? [])
    }

    /// A file with actual audio in it (a capture that never started leaves an empty or tiny file).
    static func usable(_ u: URL) -> Bool {
        guard let n = (try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? Int else { return false }
        return n > 4096
    }
    static func seconds(_ u: URL) -> Double {
        guard let f = try? AVAudioFile(forReading: u), f.fileFormat.sampleRate > 0 else { return 0 }
        return Double(f.length) / f.fileFormat.sampleRate
    }

    /// Separate, archive and transcribe a recording. The two tracks are never mixed for Whisper: your microphone
    /// and the computer's audio are transcribed on their own and then joined with speaker labels, so overlapping
    /// speech no longer blurs together and your own voice is not buried under the call. The listening copy is mixed
    /// once without a gate (so a crash keeps something to play) and again with the mic gated to the lines the speech
    /// detector actually heard from you. The source files and manifest are removed only when everything is saved.
    func process(id: String, mic: URL, sys: URL?, secs: Double, course: String, title: String, notes: String, withSystem: Bool, live: [[String: Any]]) async throws -> [String: Any] {
        guard let ffmpeg = models.find("ffmpeg") else { throw NSError(domain: "rec", code: 5, userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found"]) }
        let fm = FileManager.default
        let hasMic = Meetings.usable(mic)
        let sysURL = sys.flatMap { Meetings.usable($0) ? $0 : nil }
        let hasSys = sysURL != nil
        guard hasMic || hasSys else { throw NSError(domain: "rec", code: 8, userInfo: [NSLocalizedDescriptionKey: "Nothing was recorded."]) }
        let m4a = BrainPaths.audio.appendingPathComponent("\(id).m4a")   // minimal archive: HE-AAC 16 kbps, about 7 MB per hour
        let youWav = BrainPaths.work.appendingPathComponent("\(id)-you.wav")
        let themWav = BrainPaths.work.appendingPathComponent("\(id)-them.wav")
        await bridge?.event(["type": "meeting", "id": id, "stage": "separating"])
        setJob(id, ["stage": "separating", "title": title, "audioSeconds": secs, "pct": 0])

        // 1. One 16 kHz mono WAV per track, for Whisper. One voice per file is what Whisper is built for.
        do {
            if hasMic {
                _ = try await models.run(ffmpeg, ["-y", "-i", mic.path, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", youWav.path, "-loglevel", "error", "-nostats"], stdin: "", timeout: 900, background: true)
            }
            if let s = sysURL {
                _ = try await models.run(ffmpeg, ["-y", "-i", s.path, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", themWav.path, "-loglevel", "error", "-nostats"], stdin: "", timeout: 900, background: true)
            }
        } catch {
            try? fm.removeItem(at: youWav); try? fm.removeItem(at: themWav)
            failJob(id, error); throw error
        }

        // 2. The listening copy, without a gate yet: both tracks at their real level. The old filter summed two
        //    channels of a mono mic at half gain, so your voice was 6 dB too quiet against the call.
        let youSecs = hasMic ? Meetings.seconds(youWav) : 0
        let themSecs = hasSys ? Meetings.seconds(themWav) : 0
        let total = max(0.01, youSecs + themSecs)
        let first = hasMic ? mic : sysURL!
        do {
            try await mixArchive(first: first, second: hasMic ? sysURL : nil, gate: nil, to: m4a)
        } catch {
            try? fm.removeItem(at: youWav); try? fm.removeItem(at: themWav)
            failJob(id, error); throw error
        }

        // 3. The meeting exists now, with notes and the ungated mix. The sources and manifest stay until the gated
        //    mix is saved, so a crash during transcription can recover the two tracks instead of the mixed file.
        let started = (readManifest(id)["started"] as? String) ?? ISO8601DateFormatter().string(from: Date().addingTimeInterval(-secs))
        var m: [String: Any] = [
            "id": id, "title": title, "notes": notes, "created": started, "duration": secs,
            "course": course, "audio": m4a.lastPathComponent, "source": "app", "status": "transcribing",
            "withSystem": withSystem, "separated": hasMic && hasSys,
        ]
        if !live.isEmpty { m["segments"] = live }        // the live lines stand in until the full transcript is ready
        m["peaks"] = (try? peaks(of: m4a)) ?? []
        try brain.save(m)

        // 4. Transcribe the meeting first (the main content), then your voice. Progress covers both tracks.
        var youSegs: [[String: Any]] = [], themSegs: [[String: Any]] = []
        do {
            if hasSys {
                themSegs = try await transcribe(id: id, wav: themWav, speaker: "them", part: hasMic ? "the meeting" : "", base: 0, span: themSecs / total)
            }
            if hasMic {
                youSegs = try await transcribe(id: id, wav: youWav, speaker: hasSys ? "you" : nil, part: hasSys ? "your voice" : "", base: themSecs / total, span: youSecs / total)
            }
        } catch {
            // Keep what was transcribed; status stays "transcribing" so the next launch retries from the kept audio.
            m["segments"] = hasSys ? Tracks.merge(you: youSegs, them: themSegs) : youSegs
            try? brain.save(m)
            try? fm.removeItem(at: mic)
            if let s = sysURL { try? fm.removeItem(at: s) }
            try? fm.removeItem(at: youWav); try? fm.removeItem(at: themWav)
            dropManifest(id)
            throw error
        }
        let merged = hasSys ? Tracks.merge(you: youSegs, them: themSegs) : youSegs
        m["segments"] = merged
        m["status"] = "transcribed"

        // 5. Gate the mic in the listening copy with the speech the detector actually gave you. The echo lines were
        //    dropped from `merged` already, so the gate closes while the meeting plays and you are quiet.
        var gate: URL?
        if hasMic && hasSys && youSecs > 0.5 {
            let yourLines = merged.filter { ($0["sp"] as? String) == "you" }
            let regions = yourLines.compactMap { s -> (Double, Double)? in
                guard let t = s["t"] as? Double else { return nil }
                let e = (s["e"] as? Double) ?? (t + 1.0)
                return e > t ? (t, e) : nil
            }
            let g = BrainPaths.work.appendingPathComponent("\(id)-gate.wav")
            do {
                try Tracks.writeGate(to: g, seconds: youSecs, regions: Tracks.gateRegions(regions, seconds: youSecs))
                gate = g
            } catch { NSLog("Gate: \(error)") }
        }
        if let g = gate {
            await bridge?.event(["type": "meeting", "id": id, "stage": "mixing"])
            setJob(id, ["stage": "mixing", "pct": 100])
            let gated = BrainPaths.work.appendingPathComponent("\(id)-gated.m4a")
            do {
                try await mixArchive(first: mic, second: sysURL, gate: g, to: gated)
                do {
                    _ = try fm.replaceItemAt(m4a, withItemAt: gated)
                    m["peaks"] = (try? peaks(of: m4a)) ?? m["peaks"] ?? []
                } catch {
                    NSLog("Gated mix swap: \(error)")   // keep the ungated copy
                    try? fm.removeItem(at: gated)
                }
            } catch {
                NSLog("Gated mix: \(error)")   // keep the ungated copy; the transcript is unaffected
                try? fm.removeItem(at: gated)
            }
            try? fm.removeItem(at: g)
        }

        // 6. Everything is saved: drop the sources and the manifest.
        try? fm.removeItem(at: mic)
        if let s = sysURL { try? fm.removeItem(at: s) }
        try? fm.removeItem(at: youWav); try? fm.removeItem(at: themWav)
        dropManifest(id)
        setJob(id, ["stage": "done", "pct": 100])
        try brain.save(m)
        return m
    }

    /// Encode the listening copy. `first` is the microphone (or the computer's audio when there is no mic), `second`
    /// the other track. With a gate, the first track is multiplied by the speech control track before the mix.
    private func mixArchive(first: URL, second: URL?, gate: URL?, to out: URL) async throws {
        guard let ffmpeg = models.find("ffmpeg") else { throw NSError(domain: "rec", code: 5, userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found"]) }
        var inArgs = ["-y", "-i", first.path]
        if let s = second { inArgs += ["-i", s.path] }
        if let g = gate { inArgs += ["-i", g.path] }
        let filter: String
        if gate != nil, second != nil {
            filter = "[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[m];[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[g];[m][g]amultiply[mg];[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[s];[mg][s]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]"
        } else if second != nil {
            filter = "[0:a]aresample=48000,aformat=channel_layouts=mono[m];[1:a]aresample=48000,aformat=channel_layouts=mono[s];[m][s]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]"
        } else {
            filter = "[0:a]aresample=48000,aformat=channel_layouts=mono[a]"
        }
        _ = try await models.run(ffmpeg, inArgs + ["-filter_complex", filter, "-map", "[a]", "-ar", "16000", "-c:a", "aac_at", "-profile:a", "4", "-b:a", "16k", out.path, "-loglevel", "error", "-nostats", "-progress", "pipe:1"], stdin: "", timeout: 900, background: true)
    }

    /// Whisper's "auto" only listens to the first 30 s, so a Spanish session that opens with silence or a few English words
    /// came out in English. Listen to 30 s at five points across the recording and take the language heard most (weighted by confidence).
    /// Sessions are only ever English or Spanish: the answer is always "en" or "es", never auto or a third language.
    func spokenLanguage(id: String, wav: URL, secs: Double, exe: String) async -> String {
        guard let ffmpeg = models.find("ffmpeg"), let model = liveWhisperModel else { return "en" }
        final class Log: @unchecked Sendable { private var s = ""; private let l = NSLock()
            func add(_ t: String) { l.lock(); s += t; l.unlock() }
            func take() -> String { l.lock(); defer { s = ""; l.unlock() }; return s } }
        let log = Log()
        var score: [String: Double] = [:]
        // Short recordings: one listen from the start covers it.
        let points = secs > 90 ? [0.1, 0.3, 0.5, 0.7, 0.9] : [0.0]
        for (i, f) in points.enumerated() {
            let cut = BrainPaths.work.appendingPathComponent("\(id)-lang\(i).wav")
            defer { try? FileManager.default.removeItem(at: cut) }
            guard (try? await models.run(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(Int(secs * f)), "-t", "30", "-i", wav.path, cut.path], stdin: "", timeout: 60, background: true)) != nil,
                  (try? await models.run(exe, ["-m", model.path, "-f", cut.path, "-dl", "-t", "4"], stdin: "", timeout: 120, background: true, onText: { log.add($0) })) != nil else { continue }
            // On stderr: "whisper_full_with_state: auto-detected language: es (p = 0.93)"
            for line in log.take().split(separator: "\n") where line.contains("auto-detected language:") {
                let rest = line.components(separatedBy: "auto-detected language:")[1].trimmingCharacters(in: .whitespaces)
                let code = String(rest.prefix { $0.isLetter })
                let pVal = Double(rest.components(separatedBy: "p = ").last?.trimmingCharacters(in: CharacterSet(charactersIn: " )\r")) ?? "") ?? 0.5
                // Only English or Spanish. Close Romance guesses (Portuguese, Galician, Catalan, Italian) are Spanish heard badly.
                let lang = code == "en" ? "en" : ["es", "pt", "gl", "ca", "it"].contains(code) ? "es" : ""
                if !lang.isEmpty { score[lang, default: 0] += pVal }
            }
        }
        let best = score.max { $0.value < $1.value }?.key ?? "en"
        NSLog("language \(id): \(score) → \(best)")
        return best
    }

    /// Transcribe one track. `speaker` labels every line ("you", "them"); `part`, `base` and `span` let a two-track
    /// meeting show one progress bar across both tracks. With a VAD model, silence is skipped instead of being
    /// "heard" as words ("Thank you." every 30 s in the old transcripts).
    func transcribe(id: String, wav: URL, speaker: String? = nil, part: String = "", base: Double = 0, span: Double = 1, lang: String? = nil) async throws -> [[String: Any]] {
        guard let exe = models.find("whisper-cli") else { throw NSError(domain: "rec", code: 6, userInfo: [NSLocalizedDescriptionKey: "whisper-cli not found. Install with: brew install whisper-cpp"]) }
        guard let model = whisperModel else { throw NSError(domain: "rec", code: 7, userInfo: [NSLocalizedDescriptionKey: "No Whisper model in \(BrainPaths.models.path)"]) }
        await bridge?.event(["type": "meeting", "id": id, "stage": "transcribing"])
        let out = wav.deletingPathExtension()
        let threads = max(2, ProcessInfo.processInfo.activeProcessorCount / 2)   // half the cores: all but 2 made other apps' sound crackle
        let audioSecs = Meetings.seconds(wav)
        if part.isEmpty { setJob(id, ["stage": "transcribing", "pct": 0, "audioSeconds": audioSecs]) }
        let lg: String
        if let given = lang { lg = given } else { lg = await spokenLanguage(id: out.lastPathComponent, wav: wav, secs: audioSecs, exe: exe) }
        var args = ["-m", model.path, "-f", wav.path, "-l", lg, "-t", "\(threads)", "-pp", "-oj", "-of", out.path, "-np", "-sns"]
        if let vad = vadModel { args += ["--vad", "-vm", vad.path, "-vsd", "500", "-vp", "100"] }
        do {
            _ = try await models.run(exe, args, stdin: "",
                                     timeout: max(7200, audioSecs * 4), background: true, onText: { [weak self] text in
                // "whisper_print_progress_callback: progress =  42%"
                for line in text.split(separator: "\n") where line.contains("progress =") {
                    if let n = Int(line.split(separator: "=").last?.trimmingCharacters(in: CharacterSet(charactersIn: " %\r")) ?? "") {
                        if part.isEmpty { self?.setJob(id, ["pct": n]) }
                        else { self?.setJob(id, ["pct": Int((base + Double(n) / 100 * span) * 100)]) }
                    }
                }
            })
        } catch { failJob(id, error); throw error }
        if part.isEmpty { setJob(id, ["stage": "done", "pct": 100]) }
        let jsonURL = out.appendingPathExtension("json")
        let d = try Data(contentsOf: jsonURL)
        try? FileManager.default.removeItem(at: jsonURL)
        let o = try JSONSerialization.jsonObject(with: d) as? [String: Any] ?? [:]
        let items = o["transcription"] as? [[String: Any]] ?? []
        return items.compactMap { it in
            let text = (it["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text != "[BLANK_AUDIO]" else { return nil }
            let from = ((it["offsets"] as? [String: Any])?["from"] as? Double ?? 0) / 1000
            let to = ((it["offsets"] as? [String: Any])?["to"] as? Double ?? 0) / 1000
            var seg: [String: Any] = ["t": from, "e": to, "text": text]
            if let sp = speaker { seg["sp"] = sp }
            return seg
        }
    }
}

/// https://…zoom.us/j/123?pwd=x  →  zoommtg://zoom.us/join?confno=123&pwd=x, if the Zoom app is installed.
func meetingAppURL(_ u: URL) -> URL? {
    guard let host = u.host, host.hasSuffix("zoom.us"), u.path.hasPrefix("/j/") else { return nil }
    let conf = u.path.dropFirst(3).split(separator: "/").first.map(String.init) ?? ""
    guard !conf.isEmpty else { return nil }
    var q = "confno=\(conf)"
    if let pwd = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "pwd" })?.value { q += "&pwd=\(pwd)" }
    guard let z = URL(string: "zoommtg://zoom.us/join?\(q)"), NSWorkspace.shared.urlForApplication(toOpen: z) != nil else { return nil }
    return z
}

// MARK: - Updates (from the GitHub repo the app was built from)

enum Updater {
    static var repo: String? { Bundle.main.object(forInfoDictionaryKey: "PlannerRepo") as? String }
    static var script: String? { Bundle.main.path(forResource: "update", ofType: "sh") }
    static func run(_ mode: String, timeout: TimeInterval) async -> (Int32, String) {
        guard let repo = repo, let sh = script, FileManager.default.fileExists(atPath: repo) else { return (9, "This build does not know where its code lives.") }
        return await withCheckedContinuation { c in
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/zsh"); p.arguments = [sh, repo, mode]
            let out = Pipe(); p.standardOutput = out; p.standardError = out
            p.terminationHandler = { pr in c.resume(returning: (pr.terminationStatus, String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))) }
            do { try p.run() } catch { c.resume(returning: (8, error.localizedDescription)) }
        }
    }
    static func check() async -> [String: Any] {
        let (code, out) = await run("check", timeout: 60)
        guard code == 0 else { return ["ok": false, "message": out] }
        var r: [String: Any] = ["ok": true]
        for kv in out.split(separator: " ") { let p = kv.split(separator: "="); if p.count == 2 { r[String(p[0])] = Int(p[1]) ?? 0 } }
        return r
    }
    static func apply() async -> [String: Any] {
        let (code, out) = await run("apply", timeout: 900)
        return ["ok": code == 0, "message": out, "restart": code == 0 && out.contains("Restarting")]
    }
}

// MARK: - Window and bridge

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var web: WKWebView?
    let store = Store()
    let cal = Cal()
    let models = Models()
    @MainActor lazy var phone = PhoneSync(store: store, cal: cal)
    @MainActor lazy var backup = CloudBackup(phone: phone)
    lazy var meetings: Meetings = { let m = Meetings(models: models); m.bridge = self; return m }()
    @MainActor lazy var reader: Reader = { let r = Reader(); r.bridge = self; return r }()
    let defaults = UserDefaults.standard

    var order: [String] { defaults.stringArray(forKey: "modelOrder") ?? ["claude", "ollama"] }
    var ollamaModel: String { defaults.string(forKey: "ollamaModel") ?? "gemma4:12b" }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let id = body["id"] as? Int, let op = body["op"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            let result: Any
            do { result = try await self.handle(op, args) }
            catch { result = ["error": error.localizedDescription] }
            self.reply(id, result)
        }
    }

    @MainActor
    func handle(_ op: String, _ a: [String: Any]) async throws -> Any {
        switch op {
        case "load": return store.snapshot()
        case "hardcover": return try await Hardcover.call(query: a["query"] as? String ?? "", variables: a["variables"] as? [String: Any] ?? [:])
        case "hardcoverStatus": return ["key": Hardcover.token != nil]
        case "usage": Usage.append((a["events"] as? [[String: Any]] ?? []).prefix(500).map { $0 }); return ["ok": true]
        case "save":
            try store.save(path: a["path"] as? String ?? "", data: a["data"] as? [String: Any] ?? [:])
            return ["ok": true]
        case "calendar": return await cal.events(from: a["from"] as? String ?? "", to: a["to"] as? String ?? "")
        case "calendars": return await cal.calendars()
        case "eventSave": return try await cal.save(a)
        case "eventDelete": return try await cal.delete(a)
        case "inbox":
            var r = await cal.inbox()
            let mine = phone.inboxItems
            if !mine.isEmpty { r["items"] = mine + (r["items"] as? [[String: Any]] ?? []) }
            return r
        case "inboxDone":
            let id = a["id"] as? String ?? ""
            if id.hasPrefix("phone:") { phone.noteDone(id) } else { try cal.inboxDone(id: id) }
            return ["ok": true]
        case "phoneOps": return await phone.pull()
        case "phoneOpsDone": await phone.done(a["ids"] as? [String] ?? []); return ["ok": true]
        case "phoneHelpTaken": phone.helpTaken(a["id"] as? String ?? ""); return ["ok": true]
        case "phoneNames": phone.setNames(a["names"] as? [String] ?? []); return ["ok": true]
        case "llm":
            let ord = (a["order"] as? [String]) ?? order
            let local = a["prompt"] as? String ?? ""
            let sid = a["sid"] as? String ?? ""
            var onChunk: (@Sendable (String) -> Void)? = nil
            if !sid.isEmpty {
                weak var me = self
                onChunk = { piece in
                    DispatchQueue.main.async {
                        let payload: [String: Any] = ["type": "llmChunk", "sid": sid, "text": piece]
                        MainActor.assumeIsolated { me?.event(payload) }
                    }
                }
            }
            let cm = ["sonnet", "opus"].contains(a["model"] as? String ?? "") ? (a["model"] as! String) : "haiku"
            var res = await models.ask(local, remote: a["remotePrompt"] as? String ?? local, order: ord, ollamaModel: ollamaModel, schema: a["schema"] as? [String: Any], claudeModel: cm, chunk: onChunk)
            if res["provider"] as? String == "claude" { res["model"] = cm }
            return res
        case "llmStream":
            let sid = a["sid"] as? String ?? ""
            let text = try await models.ollamaStream(a["prompt"] as? String ?? "", model: ollamaModel) { [weak self] piece in
                await MainActor.run { self?.event(["type": "llmChunk", "sid": sid, "text": piece]) }
            }
            return ["text": text, "provider": "ollama"]
        case "llmWarm":
            let m = ollamaModel
            let pre = a["prefix"] as? String ?? ""
            Task.detached { [models] in await models.ollamaWarm(model: m, prefix: pre) }
            return ["ok": true]
        case "prefs":
            if let o = a["order"] as? [String] { defaults.set(o, forKey: "modelOrder") }
            if let m = a["ollamaModel"] as? String { defaults.set(m, forKey: "ollamaModel") }
            if let w = a["privateWords"] as? String { defaults.set(w, forKey: "privateWords") }
            return ["order": order, "ollamaModel": ollamaModel, "dataFile": Paths.plan.path, "privateWords": defaults.string(forKey: "privateWords") ?? "",
                    "available": ["claude": models.find("claude") != nil, "amp": models.find("amp") != nil, "ollama": true]]
        case "updateCheck": return await Updater.check()
        case "updateApply":
            let r = await Updater.apply()
            if r["restart"] as? Bool == true { DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { NSApp.terminate(nil) } }
            return r
        case "version":
            let info = Bundle.main.infoDictionary ?? [:]
            return ["version": info["CFBundleShortVersionString"] as? String ?? "", "repo": info["PlannerRepo"] as? String ?? ""]
        case "widget":
            // Summary for the desktop widgets; reload them only when it changed.
            guard let snap = a["snap"] else { return ["ok": false] }
            let url = Paths.support.appendingPathComponent("widget.json")
            let d = try JSONSerialization.data(withJSONObject: snap, options: [.sortedKeys])
            if (try? Data(contentsOf: url)) != d { try d.write(to: url, options: .atomic); WidgetCenter.shared.reloadAllTimelines() }
            return ["ok": true]
        case "reveal":
            NSWorkspace.shared.activateFileViewerSelecting([Paths.plan]); return ["ok": true]
        // meetings / second brain (all local)
        case "recStatus": return meetings.status()
        case "recStart":
            let id = try await meetings.rec.start(system: a["system"] as? Bool ?? false)
            meetings.updateManifest(id) { m in
                m["started"] = ISO8601DateFormatter().string(from: Date()); m["state"] = "recording"; m["withSystem"] = meetings.rec.withSystem
                m["title"] = a["title"] as? String ?? ""; m["course"] = a["course"] as? String ?? ""; m["notes"] = ""
            }
            return ["id": id, "withSystem": meetings.rec.withSystem, "micPolicy": meetings.rec.micPolicy.rawValue, "micOpen": meetings.rec.micOpen]
        case "recStop": return try await meetings.finish(course: a["course"] as? String ?? "", title: a["title"] as? String ?? "", notes: a["notes"] as? String ?? "")
        case "importMedia": return try await meetings.importMedia(course: a["course"] as? String ?? "")
        case "recCancel":
            if let (id, mic, sys, _) = await meetings.rec.stop() { try? FileManager.default.removeItem(at: mic); if let s = sys { try? FileManager.default.removeItem(at: s) }; meetings.dropManifest(id) }
            return ["ok": true]
        case "recDraft":
            // Title, course and notes typed during the recording, saved to its manifest on every change (debounced by the page).
            guard let id = meetings.rec.id else { return ["ok": false] }
            meetings.updateManifest(id) { m in
                if let t = a["title"] as? String { m["title"] = t }
                if let n = a["notes"] as? String { m["notes"] = n }
                if let c = a["course"] as? String { m["course"] = c }
            }
            return ["ok": true]
        case "jobs": return meetings.jobList()
        case "retry":
            // Transcribe one saved meeting again from its kept audio (after a failure).
            let id = a["id"] as? String ?? ""
            var m = try meetings.brain.get(id)
            guard let au = m["audio"] as? String, let ffmpeg = models.find("ffmpeg") else { throw NSError(domain: "brain", code: 4, userInfo: [NSLocalizedDescriptionKey: "No audio kept for this meeting."]) }
            meetings.setJob(id, ["stage": "converting", "title": m["title"] as? String ?? "", "pct": 0, "error": ""])
            let wav = BrainPaths.work.appendingPathComponent("\(id).wav")
            do { _ = try await models.run(ffmpeg, ["-y", "-i", BrainPaths.audio.appendingPathComponent(au).path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav.path, "-loglevel", "error"], stdin: "", timeout: 3600, background: true) }
            catch { meetings.failJob(id, error); throw error }
            defer { try? FileManager.default.removeItem(at: wav) }
            m["segments"] = try await meetings.transcribe(id: id, wav: wav); m["status"] = "transcribed"
            try meetings.brain.save(m); return m
        case "recover":
            return ["recovered": await meetings.recover()]
        case "brainList": return meetings.brain.list()
        case "brainGet": return try meetings.brain.get(a["id"] as? String ?? "")
        case "brainSave": try meetings.brain.save(a["meeting"] as? [String: Any] ?? [:]); return ["ok": true]
        case "brainDelete": try meetings.brain.delete(a["id"] as? String ?? ""); return ["ok": true]
        case "brainDropAudio":
            let id = a["id"] as? String ?? ""
            var m = try meetings.brain.get(id)
            if let f = m["audio"] as? String { try? FileManager.default.removeItem(at: BrainPaths.audio.appendingPathComponent(f)) }
            m.removeValue(forKey: "audio"); try meetings.brain.save(m); return ["ok": true]
        case "brainPeaks":
            let id = a["id"] as? String ?? ""
            var m = try meetings.brain.get(id)
            guard let f = m["audio"] as? String else { return ["peaks": []] }
            let p = try meetings.peaks(of: BrainPaths.audio.appendingPathComponent(f))
            m["peaks"] = p; try meetings.brain.save(m)
            return ["peaks": p]
        case "brainFile":
            let name = (a["name"] as? String ?? "").filter { $0.isLetter || $0.isNumber || $0 == "-" }
            guard !name.isEmpty else { throw NSError(domain: "brain", code: 3, userInfo: [NSLocalizedDescriptionKey: "Bad file name"]) }
            let url = BrainPaths.root.appendingPathComponent("_\(name).json")
            if let data = a["data"] {
                try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
                return ["ok": true]
            }
            guard let d = try? Data(contentsOf: url) else { return [:] }
            return (try? JSONSerialization.jsonObject(with: d)) ?? [:]
        case "pdfInfo":
            guard let u = Help.inDocs(a["path"] as? String ?? "") else { throw NSError(domain: "files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Only files in Documents"]) }
            return await Task.detached(priority: .utility) { Help.pdfInfo(u) }.value
        case "listFiles":
            let path = a["path"] as? String ?? ""
            let docs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents").path
            guard path.hasPrefix(docs + "/") else { throw NSError(domain: "files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Only folders in Documents"]) }
            let fm = FileManager.default, kinds = ["pdf", "epub", "docx", "md", "txt"]
            let ok = { (n: String) in !n.hasPrefix(".") && kinds.contains((n as NSString).pathExtension.lowercased()) }
            let items = (try? fm.contentsOfDirectory(atPath: path)) ?? []
            var out = items.filter(ok)
            // one level of subfolders too (Readings/x.pdf), so filed documents show up; Sessions and Reading notes are the planner's own
            for d in items where !d.hasPrefix(".") && !["Sessions", "Reading notes"].contains(d) && !Help.skipDirs.contains(d) {
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: path + "/" + d, isDirectory: &isDir), isDir.boolValue, !d.hasSuffix(".app") else { continue }
                let inner = (try? fm.contentsOfDirectory(atPath: path + "/" + d)) ?? []
                if Help.projectKind(inner) != nil { continue }   // a code or Unreal project's README is not a reading
                out += inner.filter(ok).prefix(200).map { d + "/" + $0 }
            }
            return ["files": out.sorted()]
        case "openFile":
            let path = (a["path"] as? String ?? "") as NSString
            let docs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents").path
            let full = path.standardizingPath
            guard full.hasPrefix(docs + "/"), FileManager.default.fileExists(atPath: full) else { throw NSError(domain: "files", code: 2, userInfo: [NSLocalizedDescriptionKey: "File not found"]) }
            if a["reveal"] as? Bool == true { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: full)]) } else { NSWorkspace.shared.open(URL(fileURLWithPath: full)) }
            return ["ok": true]
        case "appearance":   /* the page's light / dark toggle: the window, PDF view and native cards follow it; "auto" follows the Mac */
            let m = a["mode"] as? String ?? "auto"
            NSApp.appearance = m == "dark" ? NSAppearance(named: .darkAqua) : m == "light" ? NSAppearance(named: .aqua) : nil
            return ["ok": true]
        case "openURL":
            guard let s = a["url"] as? String, let u = URL(string: s), ["http", "https", "zoommtg", "msteams", "webex"].contains(u.scheme ?? "") else { throw NSError(domain: "bridge", code: 2, userInfo: [NSLocalizedDescriptionKey: "Link not allowed"]) }
            NSWorkspace.shared.open(meetingAppURL(u) ?? u); return ["ok": true]
        case "helpFolder":
            let u = Help.folder(a["name"] as? String ?? "")
            return ["path": u.path, "files": Help.list(u)]
        case "terminalOpen":   // Claude Code in Terminal, in the course folder or one of its projects; continues the last conversation there
            return try Help.terminal(course: a["name"] as? String ?? "", project: a["project"] as? String ?? "", claude: models.find("claude"))
        case "pickFiles":   // Add files… in the planner chat (24 Nov 2026): only the chosen paths; the page files them like a drop
            let panel = NSOpenPanel()
            panel.title = "Add files"; panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
            guard panel.runModal() == .OK else { return ["paths": [String]()] }
            return ["paths": panel.urls.map { $0.path }]
        case "helpAddFiles":
            let u = Help.dest(a)
            let panel = NSOpenPanel()
            panel.title = "Add files to this course"; panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
            guard panel.runModal() == .OK else { return ["path": u.path, "files": Help.list(u), "added": []] }
            var added: [String] = []
            for src in panel.urls { let dst = u.appendingPathComponent(src.lastPathComponent); if !FileManager.default.fileExists(atPath: dst.path), (try? FileManager.default.copyItem(at: src, to: dst)) != nil { added.append(dst.lastPathComponent) } }
            return ["path": u.path, "files": Help.list(u), "added": added]
        case "helpWrite":   // a dropped file (base64) or text, or a saved session, into the course folder
            let subName = a["sub"] as? String ?? "", own = ["Sessions", "Reading notes"].contains(subName)
            let u = own ? Help.folder(a["name"] as? String ?? "") : Help.dest(a)   // the planner's own notes stay in Documents/Planner
            let file = Help.safeName(a["file"] as? String ?? "")
            let sub = own ? u.appendingPathComponent(subName) : u
            try? FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
            var dst = sub.appendingPathComponent(file)
            let ext = dst.pathExtension, base = dst.deletingPathExtension().lastPathComponent
            var n = 2; while FileManager.default.fileExists(atPath: dst.path) { dst = sub.appendingPathComponent("\(base) \(n)" + (ext.isEmpty ? "" : ".\(ext)")); n += 1 }
            if let b64 = a["data"] as? String, let d = Data(base64Encoded: b64) { try d.write(to: dst) }
            else { try (a["text"] as? String ?? "").write(to: dst, atomically: true, encoding: .utf8) }
            return ["path": u.path, "files": Help.list(u)]
        case "folderIndex":  // what is in the course folders, without reading it (projects one line each)
            let folders = a["folders"] as? [String] ?? []
            return ["folders": await Task.detached(priority: .userInitiated) { Help.index(folders) }.value]
        case "helpSources":  // plain text of every readable file in the given folders (inside Documents only)
            var out: [[String: Any]] = [], scanned: [String] = []
            for f in a["folders"] as? [String] ?? [] {
                guard let dir = Help.inDocs(f) else { continue }
                for rel in Help.list(dir) {
                    let t = Help.text(dir.appendingPathComponent(rel))
                    if t.trimmingCharacters(in: .whitespacesAndNewlines).count >= 200 { out.append(["folder": dir.lastPathComponent, "name": rel, "text": t]); continue }
                    scanned.append(rel)   // scanned PDFs have no text layer: read them with OCR in the background
                    let u = dir.appendingPathComponent(rel)
                    guard u.pathExtension.lowercased() == "pdf", !Help.ocrRunning.contains(u.path) else { continue }
                    Help.ocrRunning.insert(u.path)
                    weak var me = self
                    let course = a["course"] as? String ?? ""
                    Task.detached(priority: .utility) {
                        let t = Help.ocr(u) { done, total in
                            DispatchQueue.main.async { MainActor.assumeIsolated { me?.event(["type": "helpOcr", "course": course, "name": rel, "page": done, "pages": total]) } }
                        }
                        await MainActor.run { Help.ocrRunning.remove(u.path); me?.event(["type": "helpOcr", "course": course, "name": rel, "done": true, "chars": t.count]) }
                    }
                }
            }
            return ["files": out, "scanned": scanned]
        case "helpMeetings":  // full Brain meetings for one course, segments included
            let c = a["course"] as? String ?? ""
            return ["meetings": meetings.brain.list().filter { ($0["course"] as? String) == c }.compactMap { try? meetings.brain.get($0["id"] as? String ?? "") }]
        case "helpSandbox":  // write the redacted copies Claude may read; the old copies are removed first
            let dir = Help.sandbox(a["course"] as? String ?? "")
            try? FileManager.default.removeItem(at: dir)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for f in a["files"] as? [[String: Any]] ?? [] {
                let rel = (f["path"] as? String ?? "").split(separator: "/").map { Help.safeName(String($0)) }.joined(separator: "/")
                guard !rel.isEmpty else { continue }
                let dst = dir.appendingPathComponent(rel)
                try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
                try (f["text"] as? String ?? "").write(to: dst, atomically: true, encoding: .utf8)
            }
            return ["ok": true]
        case "helpAsk":
            let dir = Help.sandbox(a["course"] as? String ?? "")
            guard FileManager.default.fileExists(atPath: dir.path) else { throw NSError(domain: "help", code: 1, userInfo: [NSLocalizedDescriptionKey: "Sources are not ready"]) }
            let sid = a["sid"] as? String ?? ""
            weak var me = self
            return try await models.claudeHelp(a["prompt"] as? String ?? "", dir: dir, session: a["session"] as? String ?? "", model: a["model"] as? String ?? "haiku", reading: a["reading"] as? Bool ?? false, web: a["web"] as? [String] ?? []) { piece in
                DispatchQueue.main.async { MainActor.assumeIsolated { me?.event(["type": "helpChunk", "sid": sid, "text": piece]) } }
            }
        case "fileMove":
            let src = URL(fileURLWithPath: ((a["src"] as? String ?? "") as NSString).standardizingPath)
            guard FileManager.default.fileExists(atPath: src.path) else { throw NSError(domain: "files", code: 3, userInfo: [NSLocalizedDescriptionKey: "The file is no longer there"]) }
            guard let dir = Help.inDocs(a["dir"] as? String ?? "") else { throw NSError(domain: "files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Only folders in Documents"]) }
            var name = Help.safeName(a["name"] as? String ?? src.lastPathComponent)
            if name == "Course" { name = src.lastPathComponent }
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dst = Filing.unique(dir, name)
            try FileManager.default.moveItem(at: src, to: dst)
            Filing.moved[dst.path] = src.path
            return ["path": dst.path]
        case "fileUndoMove":
            let path = a["path"] as? String ?? ""
            guard let back = Filing.moved[path] else { throw NSError(domain: "files", code: 4, userInfo: [NSLocalizedDescriptionKey: "Nothing to undo"]) }
            let dst = Filing.unique(URL(fileURLWithPath: back).deletingLastPathComponent(), URL(fileURLWithPath: back).lastPathComponent)
            try FileManager.default.moveItem(at: URL(fileURLWithPath: path), to: dst)
            Filing.moved[path] = nil
            return ["path": dst.path]
        case "makeFolder":   // a course's own folder (groupFolders in main.js), only inside Documents
            guard let u = Help.inDocs(a["path"] as? String ?? ""), !u.path.contains("/.") else { throw NSError(domain: "files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Only folders in Documents"]) }
            try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
            return ["path": u.path]
        case "pickFolder":   // Set up › Link a folder (24 Nov 2026): a course's own folder, picked by him, only inside Documents
            let panel = NSOpenPanel()
            panel.title = "Link a folder to this course"; panel.prompt = "Link"
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; panel.canCreateDirectories = true
            panel.directoryURL = Help.inDocs(a["start"] as? String ?? "") ?? Help.docs
            guard panel.runModal() == .OK, let picked = panel.url else { return [:] }
            guard let u = Help.inDocs(picked.standardizedFileURL.path), !u.path.contains("/.") else { throw NSError(domain: "files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Pick a folder inside Documents"]) }
            return ["path": u.path]
        case "listDirs": return ["dirs": Filing.dirs(a["path"] as? String ?? "")]
        case "helpAddPaths":   // files dropped on the help panel: copied into the course's folder (Help.dest)
            let u = Help.dest(a)
            var added: [String] = []
            for p in a["paths"] as? [String] ?? [] {
                let src = URL(fileURLWithPath: p); var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: src.path, isDirectory: &isDir), !isDir.boolValue else { continue }
                let dst = Filing.unique(u, src.lastPathComponent)
                if (try? FileManager.default.copyItem(at: src, to: dst)) != nil { added.append(dst.lastPathComponent) }
            }
            return ["path": u.path, "files": Help.list(u), "added": added]
        case "readerOpen": return try reader.open(a["path"] as? String ?? "", rect: a["rect"] as? [String: Any] ?? [:], page: a["page"] as? Int ?? 1)
        case "readerFrame": reader.place(a["rect"] as? [String: Any] ?? [:]); return ["ok": true]
        case "readerHide": reader.hide(); return ["ok": true]
        case "readerCard": reader.showCard(a); return ["ok": true]
        // Define in the reader: the Mac's own dictionaries (Dictionary.app), no AI (the user's choice, 25 Nov 2026)
        case "dictDefine":
            let term = (a["term"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty, term.count < 120 else { return ["text": ""] }
            let ns = term as NSString
            let def = DCSCopyTextDefinition(nil, ns, CFRange(location: 0, length: ns.length))?.takeRetainedValue() as String?
            return ["text": def ?? ""]
        case "dictOpen":
            let term = a["term"] as? String ?? ""
            if let q = term.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed), let u = URL(string: "dict://" + q) { NSWorkspace.shared.open(u) }
            return ["ok": true]
        case "readerClose": reader.close(); return ["ok": true]
        case "readerGo": reader.go(a["page"] as? Int ?? 1); return ["ok": true]
        case "readerPages": return reader.pages()
        case "readerMark": reader.mark(a["kind"] as? String ?? "underline"); return ["ok": true]
        case "readerPen": let k = a["kind"] as? String ?? ""; reader.pen = ["highlight", "underline"].contains(k) ? k : nil; return ["ok": true]
        case "readerNoteStart": return reader.noteStart()
        case "readerNoteAdd": reader.noteAdd(a["text"] as? String ?? ""); return ["ok": true]
        case "readerMarks": return ["marks": reader.marks()]
        case "readerPick": return reader.pick()
        case "readerPreview": if let u = reader.url { reader.flush(); NSWorkspace.shared.open(u) }; return ["ok": true]
        // reading versions and marks made in them (reader redesign, 25 Nov 2026; Reading.swift)
        case "readingGet":
            Reading.shared.bridge = self
            let path = a["path"] as? String ?? ""
            guard reader.allowedURL(path) != nil else { throw NSError(domain: "reader", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not open this PDF"]) }
            return Reading.shared.get((path as NSString).standardizingPath)
        case "readingAhead":
            Reading.shared.bridge = self
            return Reading.shared.ahead((a["paths"] as? [String] ?? []).map { ($0 as NSString).standardizingPath })
        case "readerMarkRects":
            return reader.markRects(page: a["page"] as? Int ?? 0, rects: a["rects"] as? [[Double]] ?? [], size: a["size"] as? [Double] ?? [], text: a["text"] as? String ?? "", kind: a["kind"] as? String ?? "highlight")
        case "readerUnmarkName":
            return reader.unmarkName(page: a["page"] as? Int ?? 0, name: a["name"] as? String ?? "", rects: a["rects"] as? [[Double]] ?? [], size: a["size"] as? [Double] ?? [])
        case "readerMarkList": return ["marks": reader.markList(sizes: a["sizes"] as? [[Double]] ?? [])]
        case "revealBrain": NSWorkspace.shared.activateFileViewerSelecting([BrainPaths.root]); return ["ok": true]
        default: throw NSError(domain: "bridge", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown op \(op)"])
        }
    }

    /// Push an event to the page (progress, stage changes).
    @MainActor
    func event(_ value: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: value), let s = String(data: d, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__appEvent && window.__appEvent(\(s))", completionHandler: nil)
    }

    @MainActor
    func reply(_ id: Int, _ value: Any) {
        guard let d = try? JSONSerialization.data(withJSONObject: value), let s = String(data: d, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__appReply(\(id), \(s))", completionHandler: nil)
    }
}

let shim = """
(function(){
  let n = 0; const pend = {};
  window.__appReply = (id, res) => { const p = pend[id]; if(!p) return; delete pend[id]; (res && res.error) ? p.rej(new Error(res.error)) : p.res(res); };
  window.APP = { call: (op, args) => new Promise((res, rej) => { const id = ++n; pend[id] = {res, rej}; window.webkit.messageHandlers.app.postMessage({id, op, args: args || {}}); }) };
  const snap = a => ({ docs: (a||[]).map(x => ({ id: x.id, data: () => x })) });
  const db = {
    collection: name => ({ onSnapshot: (cb, err) => { APP.call('load').then(d => cb(snap(d[name] || []))).catch(e => err && err(e)); } }),
    doc: path => ({ set: data => APP.call('save', { path, data }) })
  };
  window.claude = { use: async n => n === 'db' ? db : null };
})();
"""

/// File drops: the page cannot see where a dropped file lives, so files dropped on the window are caught here and their paths
/// go to the page (filesDropped), which asks where to file them. Text and other drags go to the page as before.
final class DropWebView: WKWebView {
    var onFiles: (([URL], NSPoint) -> Void)?
    static func files(_ s: NSDraggingInfo) -> [URL] {
        (s.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }
    override func draggingEntered(_ s: NSDraggingInfo) -> NSDragOperation { let r = super.draggingEntered(s); return Self.files(s).isEmpty ? r : .generic }
    override func draggingUpdated(_ s: NSDraggingInfo) -> NSDragOperation { let r = super.draggingUpdated(s); return Self.files(s).isEmpty ? r : .generic }
    override func performDragOperation(_ s: NSDraggingInfo) -> Bool {
        let fs = Self.files(s)
        guard !fs.isEmpty, let cb = onFiles else { return super.performDragOperation(s) }
        let p = convert(s.draggingLocation, from: nil)
        cb(fs, NSPoint(x: p.x, y: isFlipped ? p.y : bounds.height - p.y))
        return true
    }
}

/// Moving dropped files into course folders. Only into Documents; never over an existing file; undo moves it back.
enum Filing {
    @MainActor static var moved: [String: String] = [:]   // new path -> where it came from
    static func unique(_ dir: URL, _ name: String) -> URL {
        var dst = dir.appendingPathComponent(name)
        let ext = dst.pathExtension, base = dst.deletingPathExtension().lastPathComponent
        var n = 2; while FileManager.default.fileExists(atPath: dst.path) { dst = dir.appendingPathComponent("\(base) \(n)" + (ext.isEmpty ? "" : ".\(ext)")); n += 1 }
        return dst
    }
    static func dirs(_ path: String) -> [String] {
        guard let d = Help.inDocs(path) else { return [] }
        let items = (try? FileManager.default.contentsOfDirectory(at: d, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
        return items.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true && !$0.pathExtension.lowercased().hasSuffix("app") }.map { $0.lastPathComponent }.sorted()
    }
}

/// Serves recordings to the page as wtt-audio://<file> so they can be played back.
final class AudioScheme: NSObject, WKURLSchemeHandler {
    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let name = url.host, !name.contains("/") else { task.didFailWithError(NSError(domain: "audio", code: 1)); return }
        let f = BrainPaths.audio.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: f) else { task.didFailWithError(NSError(domain: "audio", code: 2)); return }
        let total = data.count
        var body = data, status = 200
        var headers = ["Content-Type": "audio/mp4", "Accept-Ranges": "bytes"]
        if let r = task.request.value(forHTTPHeaderField: "Range"), r.hasPrefix("bytes=") {
            let parts = r.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            let a = Int(parts.first ?? "0") ?? 0
            let b = parts.count > 1 && !parts[1].isEmpty ? min(Int(parts[1]) ?? total - 1, total - 1) : total - 1
            if a < total && a <= b { body = data.subdata(in: a..<(b + 1)); status = 206; headers["Content-Range"] = "bytes \(a)-\(b)/\(total)" }
        }
        headers["Content-Length"] = "\(body.count)"
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp); task.didReceive(body); task.didFinish()
    }
    func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let bridge = Bridge()

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let info = Bundle.main.infoDictionary ?? [:]
        Usage.log("launch", ["version": info["CFBundleShortVersionString"] as? String ?? "", "built": info["PlannerBuilt"] as? Int ?? 0])
        let nc = NotificationCenter.default, wc = NSWorkspace.shared.notificationCenter
        nc.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: nil) { _ in Usage.log("focus") }
        nc.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: nil) { _ in Usage.log("blur") }
        wc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: nil) { _ in Usage.log("sleep") }
        wc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { _ in Usage.log("wake") }
        wc.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: nil) { _ in Usage.log("screenOff") }
        wc.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: nil) { _ in Usage.log("screenOn") }
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(bridge, name: "app")
        cfg.setURLSchemeHandler(AudioScheme(), forURLScheme: "wtt-audio")
        cfg.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let dw = DropWebView(frame: .zero, configuration: cfg)
        dw.onFiles = { [weak self] urls, p in
            var items: [[String: Any]] = []
            for u in urls { var d: ObjCBool = false; if FileManager.default.fileExists(atPath: u.path, isDirectory: &d) { items.append(["path": u.path, "dir": d.boolValue]) } }
            self?.bridge.event(["type": "filesDropped", "items": items, "x": p.x, "y": p.y])
        }
        web = dw
        web.navigationDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        bridge.web = web
        let phone = bridge.phone
        phone.importAudio = { [weak bridge] url, course, title, at in
            guard let m = bridge?.meetings else { return }
            _ = try await m.importFile(url, course: course, title: title, created: at, source: "iphone")
        }
        phone.applyMarks = { [weak bridge] u, add, remove in try bridge?.reader.applyPhoneMarks(u, add: add, remove: remove) }
        phone.bridgeFlush = { [weak bridge] u in if let r = bridge?.reader, r.url?.standardizedFileURL.path == u.standardizedFileURL.path { r.flush() } }
        bridge.store.onWrite = { Task { @MainActor in phone.planChanged() } }
        phone.planChanged()
        Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { _ in Task { @MainActor in phone.planChanged() } }
        let backup = bridge.backup   // off-device copy on the Worker: checked every 30 minutes, sent when changed, at most every 6 h
        Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { _ in Task { @MainActor in await backup.runIfDue() } }
        Task { @MainActor in try? await Task.sleep(nanoseconds: 60_000_000_000); await backup.runIfDue() }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Planner"
        window.minSize = NSSize(width: 420, height: 500)
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900))   // the web page, with the PDF reader laid over it when open
        web.frame = box.bounds; web.autoresizingMask = [.width, .height]
        box.addSubview(web)
        window.contentView = box
        bridge.reader.container = box
        window.setFrameAutosaveName("main")
        window.center()
        window.makeKeyAndOrderFront(nil)
        loadPage()
        NSApp.activate(ignoringOtherApps: true)
    }

    func loadPage() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else { return }
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    // Links to other sites open in the browser.
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, a.navigationType == .linkActivated, u.scheme == "http" || u.scheme == "https" {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    /// Quitting while recording: close the audio files cleanly first. The recording is processed at the next launch.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Usage.log("quit", ["recording": bridge.meetings.rec.id != nil]); Usage.flush()
        guard bridge.meetings.rec.id != nil else { return .terminateNow }
        Task { _ = await bridge.meetings.stopKeeping(); NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }

    /// planner://today (from the widget) opens that tab.
    func application(_ app: NSApplication, open urls: [URL]) {
        guard let u = urls.first, u.scheme == "planner" else { return }
        let tab = (u.host ?? "today").filter { $0.isLetter || $0 == "-" }
        window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        web?.evaluateJavaScript("location.hash = '\(tab)'", completionHandler: nil)
    }

    @objc func reload() { bridge.reader.close(); web.reload() }
    @objc func openPDF() { web.evaluateJavaScript("window.readerPick && window.readerPick()", completionHandler: nil) }
    @objc func pairPhone() { bridge.phone.showPairing(window) }
    @objc func cloudBackup() { bridge.backup.showWindow(window) }
    @objc func hardcoverKey() { Hardcover.showKeyWindow(); web.evaluateJavaScript("window.hcChanged && window.hcChanged()", completionHandler: nil) }
    @objc func checkUpdates() { web.evaluateJavaScript("window.checkUpdates && window.checkUpdates(true)", completionHandler: nil) }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        let upd = NSMenuItem(title: "Check for Updates…", action: #selector(checkUpdates), keyEquivalent: ""); upd.target = self
        appMenu.addItem(upd)
        let pair = NSMenuItem(title: "Pair iPhone…", action: #selector(pairPhone), keyEquivalent: ""); pair.target = self
        if SyncCore.cloudAllowed {   // phone sync and the backup only in builds that turn Cloudflare on (config.sh)
            appMenu.addItem(pair)
            let bk = NSMenuItem(title: "Cloudflare Backup…", action: #selector(cloudBackup), keyEquivalent: ""); bk.target = self
            appMenu.addItem(bk)
        }
        let hc = NSMenuItem(title: "Hardcover API Key…", action: #selector(hardcoverKey), keyEquivalent: ""); hc.target = self
        appMenu.addItem(hc)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Planner", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Planner", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File")
        let op = NSMenuItem(title: "Open PDF…", action: #selector(openPDF), keyEquivalent: "o"); op.target = self
        file.addItem(op)
        fileItem.submenu = file
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let r = NSMenuItem(title: "Reload", action: #selector(reload), keyEquivalent: "r"); r.target = self
        view.addItem(r)
        viewItem.submenu = view
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
    }
}

@main
struct Main {
    static func main() {
        // Test / maintenance: process unfinished recordings without opening a window.
        if CommandLine.arguments.contains("--recover-only") {
            let m = Meetings(models: Models()); let sem = DispatchSemaphore(value: 0)
            Task.detached { let r = await m.recover(); print("recovered:", r.joined(separator: ", ")); sem.signal() }
            sem.wait(); exit(0)
        }
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.regular)
        app.run()
    }
}
