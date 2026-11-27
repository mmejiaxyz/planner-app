// Planner for iPhone: a simple companion to the Mac app.
// It shows page/index_v2.html (the same page as on the Mac) with the plan and calendar the Mac last sent, lets you tick
// tasks (with the time they took) and send notes to the Mac. It never plans: the Mac applies every change and sends a
// new snapshot. Sync goes through a private Cloudflare Worker (sync-worker/) and is end-to-end encrypted (SyncCore.swift).
//
// Bridge ops (shim.js): load, pushOp, note, syncStatus, syncNow, pair, calendar, recordings, and since 21 Nov 2026 the
// reader (PhoneReader.swift: phoneFiles, fileGet, reader*, ds*, readNotes) and helpPhone (a Get help question for the Mac).
// Anything else: "Only on the Mac".
// Page updates (Pages): when the snapshot names a page from a Mac build newer than this app (by build time), it is
// downloaded once (encrypted with the pairing key, so only the Mac can make one), used right away unless something is
// being typed (else when the app goes to the background), and dropped for the built-in page if it does not start
// within 15 s. A newer .ipa always wins. Native changes need a new .ipa.
// Request budget: one snapshot check when the app opens and every 60 s while it is open, one upload per change.
// Build with ios-app/build.sh (an .ipa for AltStore).

import UIKit
import WebKit
import AVFoundation
import CryptoKit

// MARK: - App and scene

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting s: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: s.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

@objc(SceneDelegate)
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo s: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = WebController()
        w.makeKeyAndVisible()
        window = w
    }
    func sceneDidBecomeActive(_ scene: UIScene) { Task { await Sync.shared.sync(force: false) } }
    func sceneDidEnterBackground(_ scene: UIScene) { (window?.rootViewController as? WebController)?.switchPageIfReady() }
}

// MARK: - Sync engine

@MainActor
final class Sync {
    static let shared = Sync()
    weak var web: WKWebView?
    var onPageReady: (() -> Void)?                        // a newer page was downloaded

    private let dir: URL = {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Planner", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return u
    }()
    private var snapURL: URL { dir.appendingPathComponent("snapshot.bin") }      // kept encrypted, as downloaded
    private var pendingURL: URL { dir.appendingPathComponent("pending.json") }
    private let defaults = UserDefaults.standard

    private(set) var pending: [[String: Any]] = []        // changes not yet applied by the Mac (with "written" once uploaded)
    private var snapshot: [String: Any]?                  // decrypted cache
    private var lastSync = Date.distantPast
    private var running = false
    private(set) var error = ""
    var snap: [String: Any]? { snapshot }

    /// An event for the page (reader, files, streamed answers), like Bridge.event on the Mac.
    func event(_ value: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: value), let s = String(data: d, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__appEvent && window.__appEvent(\(s))", completionHandler: nil)
    }

    static let minGap: TimeInterval = 20

    init() {
        if let d = try? Data(contentsOf: pendingURL), let a = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] { pending = a }
        loadCache()
    }

    var key: SymmetricKey? { SyncCore.loadKey() }
    var server: SyncCore.Server? { SyncCore.loadServer() }
    var paired: Bool { key != nil && server != nil }

    private func loadCache() {
        guard let key, let d = try? Data(contentsOf: snapURL) else { snapshot = nil; return }
        snapshot = (try? SyncCore.open(d, kind: .snapshot, key: key)) as? [String: Any]
    }

    private func savePending() {
        if let d = try? JSONSerialization.data(withJSONObject: pending) { try? d.write(to: pendingURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }

    // MARK: what the page asks for

    func load() -> [String: Any] {
        let plan = snapshot?["plan"] as? [String: Any] ?? ["courses": [], "flags": [], "days": []]
        return ["plan": plan, "pending": pending.filter { ($0["kind"] as? String) == "set" }]
    }

    func events(from: String, to: String) -> [String: Any] {
        let all = snapshot?["events"] as? [[String: Any]] ?? []
        let ev = all.filter { e in
            let s = String((e["start"] as? String ?? "").prefix(10)), en = String((e["end"] as? String ?? "").prefix(10))
            return en >= from && s <= to
        }.map { e -> [String: Any] in var x = e; x["editable"] = false; return x }   // events change only on the Mac
        return ["status": snapshot == nil ? "none" : "granted", "events": ev]
    }

    func status() -> [String: Any] {
        let notes = pending.filter { ($0["kind"] as? String) == "note" }.map { ["text": $0["text"] as? String ?? ""] }
        return ["paired": paired, "snapshotAt": snapshot?["at"] as? String ?? "",
                "waiting": pending.filter { ($0["kind"] as? String) == "set" }.count, "notes": notes,
                "error": error, "check": key.map(SyncCore.fingerprint) ?? "", "page": Pages.activeVersion,
                "names": snapshot?["names"] as? [String] ?? []]
    }

    @discardableResult
    func push(_ op: [String: Any]) async -> String {
        var o = op
        let id = String(SyncCore.newOpName().dropLast(4))
        o["id"] = id; if o["at"] == nil { o["at"] = ISO8601DateFormatter().string(from: Date()) }; o["written"] = false
        pending.append(o); savePending()
        await sync(force: true, snapshotToo: false)
        return id
    }

    // MARK: sync

    /// Uploads changes not sent yet, then fetches the snapshot if it changed. Automatic syncs at most every 20 s.
    func sync(force: Bool, snapshotToo: Bool = true) async {
        guard paired, let key, let server, !running else { return }
        if !force && Date().timeIntervalSince(lastSync) < Self.minGap { return }
        running = true; defer { running = false }
        lastSync = Date()
        do {
            for i in pending.indices where (pending[i]["written"] as? Bool) != true {
                var body = pending[i]; body["written"] = nil
                let name = (body["id"] as? String ?? "") + ".bin"
                try await server.putOp(name, try SyncCore.seal(body, kind: .op, key: key))
                pending[i]["written"] = true; savePending()
            }
            if snapshotToo {
                let tag = FileManager.default.fileExists(atPath: snapURL.path) ? defaults.string(forKey: "snapTag") : nil
                let r = try await server.snapshot(etag: tag)
                if let d = r.data {
                    guard let s = try SyncCore.open(d, kind: .snapshot, key: key) as? [String: Any] else { throw SyncCore.Failure(message: "The snapshot could not be read") }
                    try d.write(to: snapURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    defaults.set(r.etag, forKey: "snapTag")
                    snapshot = s
                    let applied = Set(s["applied"] as? [String] ?? [])
                    pending.removeAll { applied.contains($0["id"] as? String ?? "") && ($0["written"] as? Bool) == true }
                    savePending()
                    web?.evaluateJavaScript("window.__planChanged && window.__planChanged()", completionHandler: nil)
                }
                PhoneFiles.shared.check()
                if let w = snapshot?["web"] as? [String: Any], try await Pages.fetchIfNewer(w, server: server, key: key) { onPageReady?() }
            }
            error = ""
        } catch {
            self.error = (error as? URLError) != nil ? "Offline: changes are kept and sent later" : error.localizedDescription
        }
        Recordings.shared.applied(Set(snapshot?["applied"] as? [String] ?? []))
        Recordings.shared.pump()
        web?.evaluateJavaScript("window.__syncChanged && window.__syncChanged()", completionHandler: nil)
    }

    func pair(_ p: SyncCore.Pairing) throws {
        try SyncCore.saveKey(p.key)
        try SyncCore.saveServer(SyncCore.Server(url: p.url, token: p.token))
        try? FileManager.default.removeItem(at: snapURL); defaults.removeObject(forKey: "snapTag")
        snapshot = nil
        pending.removeAll { ($0["written"] as? Bool) == true }   // sent under the old pairing; the Mac has them or never will
        savePending()
    }
}

// MARK: - Recordings

/// Record on the phone, send to the Mac for Brain. AAC in a CAF file (still readable if iOS ends the app mid-recording),
/// mono 22 kHz 32 kbps, about 14 MB an hour. After Stop the file goes up in encrypted parts of 90 KB (SyncCore.audioPart),
/// resuming where it stopped, then one "audio" change names it; the Mac imports it into Brain and lists the change as
/// applied, and the file here is deleted. Recording keeps going with the screen locked (UIBackgroundModes audio).
@MainActor
final class Recordings: NSObject, AVAudioRecorderDelegate {
    static let shared = Recordings()
    private let dir: URL = {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Planner/rec", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private var stateURL: URL { dir.appendingPathComponent("recordings.json") }
    private var recorder: AVAudioRecorder?
    private var current: [String: Any]?                 // {id, course, title, at}
    private var uploads: [[String: Any]] = []           // {id, course, title, at, seconds, size, parts, sent, sha256, state, op}
    private var pumping = false
    var lastError = ""

    override init() {
        super.init()
        if let d = try? Data(contentsOf: stateURL), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            current = o["current"] as? [String: Any]; uploads = o["uploads"] as? [[String: Any]] ?? []
        }
        if let c = current { current = nil; finish(c, seconds: 0) }   // the app was ended while recording: keep what was saved
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { n in
            let ended = (n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.ended.rawValue
            MainActor.assumeIsolated { if ended, let r = Recordings.shared.recorder, !r.isRecording { try? AVAudioSession.sharedInstance().setActive(true); r.record() } }
        }
    }

    private func save() {
        var o: [String: Any] = ["uploads": uploads]; if let c = current { o["current"] = c }
        if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
    private func file(_ id: String) -> URL { dir.appendingPathComponent(id + ".caf") }

    func state() -> [String: Any] {
        var o: [String: Any] = ["uploads": uploads.map { u in u.filter { ["id", "course", "title", "at", "seconds", "parts", "sent", "state"].contains($0.key) } }, "error": lastError]
        if let c = current { o["recording"] = c.merging(["seconds": recorder?.currentTime ?? 0]) { $1 } }
        return o
    }

    func start(course: String, title: String) async throws {
        guard current == nil else { return }
        guard await AVAudioApplication.requestRecordPermission() else { throw SyncCore.Failure(message: "Microphone access is off: Settings › Planner › Microphone") }
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.record, mode: .default, options: [.allowBluetoothHFP])
        try s.setActive(true)
        let id = String(SyncCore.newOpName().dropLast(4))
        let r = try AVAudioRecorder(url: file(id), settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000])
        r.delegate = self
        guard r.record() else { throw SyncCore.Failure(message: "Recording could not start") }
        recorder = r; lastError = ""
        current = ["id": id, "course": course, "title": title, "at": ISO8601DateFormatter().string(from: Date())]
        save()
    }

    func stop() async {
        guard let c = current, let r = recorder else { return }
        let secs = r.currentTime
        r.stop(); recorder = nil; current = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        finish(c, seconds: secs)
        pump()
    }

    func cancel() {
        guard let c = current else { return }
        recorder?.stop(); recorder?.deleteRecording(); recorder = nil; current = nil
        try? FileManager.default.removeItem(at: file(c["id"] as? String ?? ""))
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        save()
    }

    /// A finished recording joins the queue: size, parts and the SHA-256 the Mac checks the joined file against.
    private func finish(_ c: [String: Any], seconds: Double) {
        let id = c["id"] as? String ?? "", f = file(id)
        guard let size = (try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? Int, size > 0, let h = try? FileHandle(forReadingFrom: f) else { save(); return }
        var hasher = SHA256()
        while let d = try? h.read(upToCount: 1 << 20), !d.isEmpty { hasher.update(data: d) }
        try? h.close()
        var u = c
        u["seconds"] = seconds; u["size"] = size; u["parts"] = (size + SyncCore.audioPart - 1) / SyncCore.audioPart; u["sent"] = 0
        u["sha256"] = hasher.finalize().map { String(format: "%02x", $0) }.joined(); u["state"] = "sending"
        uploads.append(u); save()
    }

    /// Send what is waiting, part by part (also a little while after the app goes to the background).
    func pump() {
        guard !pumping, Sync.shared.paired, uploads.contains(where: { ($0["state"] as? String) == "sending" }) else { return }
        pumping = true
        let bg = UIApplication.shared.beginBackgroundTask(withName: "Send recording", expirationHandler: nil)
        Task { @MainActor in
            defer { pumping = false; UIApplication.shared.endBackgroundTask(bg) }
            guard let key = Sync.shared.key, let server = Sync.shared.server else { return }
            for i in uploads.indices where (uploads[i]["state"] as? String) == "sending" {
                let id = uploads[i]["id"] as? String ?? "", parts = uploads[i]["parts"] as? Int ?? 0
                do {
                    let h = try FileHandle(forReadingFrom: file(id)); defer { try? h.close() }
                    var n = uploads[i]["sent"] as? Int ?? 0
                    while n < parts {
                        try h.seek(toOffset: UInt64(n * SyncCore.audioPart))
                        let d = try h.read(upToCount: SyncCore.audioPart) ?? Data()
                        try await server.putAudio(id, n, try SyncCore.sealData(d, kind: .audio, context: "\(id):\(n)", key: key))
                        n += 1; uploads[i]["sent"] = n; save()
                        Sync.shared.web?.evaluateJavaScript("window.__recChanged && window.__recChanged()", completionHandler: nil)
                    }
                    let u = uploads[i]
                    let op = await Sync.shared.push(["kind": "audio", "rec": id, "parts": parts, "sha256": u["sha256"] ?? "", "ext": "caf",
                                                     "course": u["course"] ?? "", "title": u["title"] ?? "", "at": u["at"] ?? "", "seconds": u["seconds"] ?? 0])
                    uploads[i]["op"] = op; uploads[i]["state"] = "sent"; save()
                    lastError = ""
                } catch {
                    lastError = (error as? URLError) != nil ? "Offline: the recording is sent later" : error.localizedDescription
                    break
                }
            }
            Sync.shared.web?.evaluateJavaScript("window.__recChanged && window.__recChanged()", completionHandler: nil)
        }
    }

    /// The Mac has imported these: delete the file; keep the line for two days so it shows as done.
    func applied(_ ids: Set<String>) {
        var changed = false
        for i in uploads.indices where (uploads[i]["state"] as? String) == "sent" && ids.contains(uploads[i]["op"] as? String ?? "") {
            uploads[i]["state"] = "done"; uploads[i]["doneAt"] = Date().timeIntervalSince1970
            try? FileManager.default.removeItem(at: file(uploads[i]["id"] as? String ?? "")); changed = true
        }
        let before = uploads.count
        if !pumping { uploads.removeAll { ($0["state"] as? String) == "done" && Date().timeIntervalSince1970 - ($0["doneAt"] as? Double ?? 0) > 2 * 86400 } }
        if changed || uploads.count != before { save() }
    }
}

// MARK: - Page updates

@MainActor
enum Pages {
    static let root: URL = {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Planner/web", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static let d = UserDefaults.standard
    /// When this app was built (build.sh writes PlannerBuilt, seconds since 1970). Pages are compared by build time,
    /// not by version number: the version is the commit count, which does not change between uncommitted builds.
    static var builtIn: Int { (Bundle.main.infoDictionary?["PlannerBuilt"] as? NSNumber)?.intValue ?? 0 }
    static var active: String? { d.string(forKey: "webActive") }
    static var activeDir: URL? {
        guard let t = active else { return nil }
        if d.integer(forKey: "webActiveBuild") <= builtIn { d.removeObject(forKey: "webActive"); return nil }   // a newer .ipa was installed
        let u = root.appendingPathComponent(t, isDirectory: true)
        return FileManager.default.fileExists(atPath: u.appendingPathComponent("index.html").path) ? u : nil
    }
    static var activeVersion: String { active != nil ? (d.string(forKey: "webActiveVersion") ?? "") : "built in" }
    private static var startedOK = false

    /// Download the page the snapshot names, if it is newer than what the phone shows and not known to be broken.
    @discardableResult
    static func fetchIfNewer(_ w: [String: Any], server: SyncCore.Server, key: SymmetricKey) async throws -> Bool {
        guard let tag = w["tag"] as? String, tag.range(of: "^[a-f0-9]{24}$", options: .regularExpression) != nil else { return false }
        let build = w["built"] as? Int ?? 0
        let current = active != nil ? d.integer(forKey: "webActiveBuild") : builtIn
        guard build > builtIn, build >= current, tag != active, tag != d.string(forKey: "webReady"),
              !(d.stringArray(forKey: "webBad") ?? []).contains(tag), let data = try await server.web() else { return false }
        guard let o = try SyncCore.open(data, kind: .web, key: key) as? [String: Any], o["tag"] as? String == tag,
              let files = o["files"] as? [String: String], files["index.html"] != nil else { throw SyncCore.Failure(message: "The page update could not be read") }
        let dir = root.appendingPathComponent(tag, isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("js"), withIntermediateDirectories: true)
        for (path, text) in files {
            guard path == "index.html" || path.range(of: "^js/[A-Za-z0-9_-]+\\.js$", options: .regularExpression) != nil else { continue }
            try Data(text.utf8).write(to: dir.appendingPathComponent(path), options: .atomic)
        }
        d.set(tag, forKey: "webReady"); d.set(build, forKey: "webReadyBuild"); d.set(o["version"] as? String ?? "", forKey: "webReadyVersion")
        return true
    }

    /// Make a downloaded page the active one. True when something changed (the caller reloads).
    @discardableResult
    static func promoteReady() -> Bool {
        guard let t = d.string(forKey: "webReady") else { return false }
        if d.integer(forKey: "webReadyBuild") <= builtIn { d.removeObject(forKey: "webReady"); return false }
        d.set(t, forKey: "webActive"); d.set(d.integer(forKey: "webReadyBuild"), forKey: "webActiveBuild")
        d.set(d.string(forKey: "webReadyVersion"), forKey: "webActiveVersion")
        d.removeObject(forKey: "webReady")
        for n in (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? [] where n != t { try? FileManager.default.removeItem(at: root.appendingPathComponent(n)) }
        return true
    }

    static func started() { startedOK = true }

    static func watch(fallback: @escaping () -> Void) {
        startedOK = false
        let t = active
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !startedOK, let t, active == t else { return }
            d.set((d.stringArray(forKey: "webBad") ?? []) + [t], forKey: "webBad")
            d.removeObject(forKey: "webActive")
            try? FileManager.default.removeItem(at: root.appendingPathComponent(t))
            fallback()
        }
    }
}

// MARK: - Web view and bridge

final class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    var web: WKWebView!
    var timer: Timer?
    var fast: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "bg") ?? UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.08, alpha: 1) : UIColor(red: 0.98, green: 0.97, blue: 0.95, alpha: 1) }
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(WeakHandler(self), name: "app")
        if let u = Bundle.main.url(forResource: "shim", withExtension: "js"), let js = try? String(contentsOf: u, encoding: .utf8) {
            cfg.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = PlannerWeb(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.isOpaque = false; web.backgroundColor = view.backgroundColor; web.scrollView.backgroundColor = view.backgroundColor
        web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.contentInsetAdjustmentBehavior = .never   // the page uses env(safe-area-inset-*) (viewport-fit=cover); no second inset from iOS
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),   // the whole screen (27 Nov 2026): the page keeps clear of the island itself
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        let rc = UIRefreshControl()
        rc.addAction(UIAction { [weak rc] _ in Task { await Sync.shared.sync(force: true); rc?.endRefreshing() } }, for: .valueChanged)
        web.scrollView.refreshControl = rc
        Sync.shared.web = web
        PhoneReader.shared.host = view; PhoneReader.shared.web = web
        Sync.shared.onPageReady = { [weak self] in self?.switchNowIfIdle() }
        Pages.promoteReady()
        loadPage()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
            Task { @MainActor in if UIApplication.shared.applicationState == .active { await Sync.shared.sync(force: false) } }
        }
        // a PDF asked for from the Mac: check every 10 s until it arrives (at most 10 minutes, PhoneFiles.askWait)
        fast = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            Task { @MainActor in if UIApplication.shared.applicationState == .active && PhoneFiles.shared.waiting { await Sync.shared.sync(force: true) } }
        }
    }

    /// The downloaded page if there is one, else the page built into the app. A downloaded page that does not ask for
    /// the plan within 15 s is dropped (never used again) and the built-in page is loaded.
    func loadPage() {
        if let dir = Pages.activeDir {
            web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
            Pages.watch { [weak self] in self?.loadPage() }
        } else if let u = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            web.loadFileURL(u, allowingReadAccessTo: u.deletingLastPathComponent())
        }
    }

    func switchPageIfReady() { if Pages.promoteReady() { loadPage() } }

    /// Use a page that just arrived now, unless something is being typed (then when the app goes to the background).
    func switchNowIfIdle() {
        web.evaluateJavaScript("(()=>{const a=document.activeElement;return !!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))})()") { [weak self] r, _ in
            if (r as? Bool) != true { self?.switchPageIfReady() }
        }
    }

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, a.navigationType == .linkActivated, u.scheme == "http" || u.scheme == "https" {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let id = body["id"] as? Int, let op = body["op"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            let result: Any
            do { result = try await self.handle(op, args) } catch { result = ["error": error.localizedDescription] }
            guard let d = try? JSONSerialization.data(withJSONObject: result), let s = String(data: d, encoding: .utf8) else { return }
            self.web.evaluateJavaScript("window.__appReply(\(id), \(s))", completionHandler: nil)
        }
    }

    @MainActor
    func handle(_ op: String, _ a: [String: Any]) async throws -> Any {
        let sync = Sync.shared
        switch op {
        case "load": Pages.started(); return sync.load()
        case "pushOp":
            guard let o = a["op"] as? [String: Any], (o["kind"] as? String) == "set" else { throw SyncCore.Failure(message: "Bad change") }
            await sync.push(o); return ["ok": true]
        case "note":
            let t = (a["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { throw SyncCore.Failure(message: "Write a note first") }
            guard t.count <= 4000 else { throw SyncCore.Failure(message: "The note is too long") }
            await sync.push(["kind": "note", "text": t]); return ["ok": true]
        case "syncStatus": return sync.status()
        case "syncNow": await sync.sync(force: true); return sync.status()
        case "calendar": return sync.events(from: a["from"] as? String ?? "", to: a["to"] as? String ?? "")
        case "recState": return Recordings.shared.state()
        case "recStart": try await Recordings.shared.start(course: a["course"] as? String ?? "", title: a["title"] as? String ?? ""); return Recordings.shared.state()
        case "recStop": await Recordings.shared.stop(); return Recordings.shared.state()
        case "recCancel": Recordings.shared.cancel(); return Recordings.shared.state()
        case "pair": return try await scanAndPair()
        // PDFs and the reader (PhoneReader.swift)
        case "phoneFiles": return PhoneFiles.shared.state()
        case "fileGet": await PhoneFiles.shared.request(cid: a["cid"] as? String ?? "", file: a["file"] as? String ?? ""); return PhoneFiles.shared.state()
        case "readerOpen": return try PhoneReader.shared.open(cid: a["cid"] as? String ?? "", file: a["file"] as? String ?? "", rect: a["rect"] as? [String: Any] ?? [:], page: a["page"] as? Int ?? 1)
        case "readerFrame": PhoneReader.shared.place(a["rect"] as? [String: Any] ?? [:]); return ["ok": true]
        case "readerClose": PhoneReader.shared.close(); return ["ok": true]
        case "readerGo": PhoneReader.shared.go(a["page"] as? Int ?? 1); return ["ok": true]
        case "readerOpenText": return PhoneReader.shared.openText(cid: a["cid"] as? String ?? "", file: a["file"] as? String ?? "")
        case "readerPages": return await PhoneReader.shared.pages()
        case "readerOcr": return ["text": await PhoneReader.shared.ocr(a["page"] as? Int ?? 1)]
        case "readerMark": _ = PhoneReader.shared.mark(a["kind"] as? String == "highlight" ? "highlight" : "underline"); return ["ok": true]
        case "readerNoteStart": return PhoneReader.shared.noteStart()
        case "readerNoteAdd": PhoneReader.shared.noteAdd(a["text"] as? String ?? ""); return ["ok": true]
        case "readerUnmark": PhoneReader.shared.unmark(); return ["ok": true]
        case "readerMarks": return ["marks": PhoneReader.shared.marks()]
        // the book reader (reader redesign, 25 Nov 2026)
        case "readingGet":
            let k = PhoneFiles.key(a["cid"] as? String ?? "", a["file"] as? String ?? "")
            if let t = PhoneFiles.shared.reading(k) { return ["ready": true, "data": t] }
            return ["ready": false, "state": "phone"]
        case "readerHide": PhoneReader.shared.hide(); return ["ok": true]
        case "readerQuiet": PlannerWeb.quiet = a["on"] as? Bool ?? false; return ["ok": true]
        // Define in the reader: Apple's dictionary page (on the phone, offline; "Manage" adds Spanish or German), no AI
        case "dictShow":
            let term = (a["term"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty else { return ["ok": false] }
            let vc = UIReferenceLibraryViewController(term: term)
            (presentedViewController ?? self).present(vc, animated: true)
            return ["ok": true, "has": UIReferenceLibraryViewController.dictionaryHasDefinition(forTerm: term)]
        case "readerMarkRects":
            return PhoneReader.shared.markRects(page: a["page"] as? Int ?? 0, rects: a["rects"] as? [[Double]] ?? [], size: a["size"] as? [Double] ?? [], text: a["text"] as? String ?? "", kind: a["kind"] as? String ?? "highlight")
        case "readerUnmarkName":
            return PhoneReader.shared.unmarkName(page: a["page"] as? Int ?? 0, name: a["name"] as? String ?? "", rects: a["rects"] as? [[Double]] ?? [], size: a["size"] as? [Double] ?? [])
        case "readerMarkList": return ["marks": PhoneReader.shared.markList(sizes: a["sizes"] as? [[Double]] ?? [])]
        case "dsStatus": return ["key": DeepSeek.key != nil]
        case "dsKey": try DeepSeek.setKey(a["key"] as? String ?? ""); return ["key": DeepSeek.key != nil]
        case "dsAsk": return try await DeepSeek.ask(messages: a["messages"] as? [[String: Any]] ?? [], model: a["model"] as? String ?? "chat", sid: a["sid"] as? String ?? "")
        case "dsStop": DeepSeek.stop(a["sid"] as? String ?? ""); return ["ok": true]
        case "readNotes":   // saved by the Mac into Documents/Planner/<course>/Reading notes
            let t = a["text"] as? String ?? ""
            guard !t.isEmpty, t.utf8.count < 80_000 else { throw SyncCore.Failure(message: "The notes are too long to send") }
            await sync.push(["kind": "readNotes", "cid": a["cid"] as? String ?? "", "name": a["name"] as? String ?? "", "text": t]); return ["ok": true]
        case "helpPhone":   // waits on the task's Get help button on the Mac
            let t = (a["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { throw SyncCore.Failure(message: "Write your question first") }
            guard t.count <= 4000 else { throw SyncCore.Failure(message: "The question is too long") }
            await sync.push(["kind": "help", "cid": a["cid"] as? String ?? "", "tid": a["tid"] as? String ?? "", "text": t]); return ["ok": true]
        case "prefs": return [:]
        default: throw SyncCore.Failure(message: "Only on the Mac")
        }
    }

    // MARK: pairing

    @MainActor
    func scanAndPair() async throws -> Any {
        let text: String? = await withCheckedContinuation { c in
            let sheet = UIAlertController(title: "Pair with the Mac", message: "On the Mac: Planner › Pair iPhone…", preferredStyle: .actionSheet)
            sheet.addAction(UIAlertAction(title: "Scan the code", style: .default) { _ in
                let s = ScanController { c.resume(returning: $0) }
                self.present(s, animated: true)
            })
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in c.resume(returning: nil) })
            sheet.popoverPresentationController?.sourceView = self.view
            self.present(sheet, animated: true)
        }
        guard let text else { return ["ok": false] }
        guard let p = SyncCore.pairingFromQR(text) else { throw SyncCore.Failure(message: "That is not a Planner pairing code") }
        try Sync.shared.pair(p)
        await Sync.shared.sync(force: true)
        let done = UIAlertController(title: "Paired", message: "Check code \(SyncCore.fingerprint(p.key)). It should match the one on the Mac.", preferredStyle: .alert)
        done.addAction(UIAlertAction(title: "OK", style: .default))
        present(done, animated: true)
        return ["ok": true]
    }
}

/// WKUserContentController keeps its handler strongly; this breaks the cycle.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(uc, didReceive: m) }
}

// MARK: - QR scanner

final class ScanController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private var finish: ((String?) -> Void)?

    init(_ finish: @escaping (String?) -> Void) { self.finish = finish; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let close = UIButton(type: .system, primaryAction: UIAction(title: "Cancel") { [weak self] _ in self?.done(nil) })
        close.tintColor = .white; close.translatesAutoresizingMaskIntoConstraints = false
        guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam), session.canAddInput(input) else {
            let l = UILabel(); l.text = "No camera access. Allow it in Settings › Planner, then try again."; l.textColor = .white; l.numberOfLines = 0
            l.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(l); view.addSubview(close)
            NSLayoutConstraint.activate([l.centerYAnchor.constraint(equalTo: view.centerYAnchor), l.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), l.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
                                         close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12), close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)])
            return
        }
        session.addInput(input)
        let out = AVCaptureMetadataOutput()
        if session.canAddOutput(out) { session.addOutput(out); out.setMetadataObjectsDelegate(self, queue: .main); out.metadataObjectTypes = [.qr] }
        let layer = AVCaptureVideoPreviewLayer(session: session); layer.videoGravity = .resizeAspectFill; layer.frame = view.bounds
        view.layer.addSublayer(layer)
        view.addSubview(close)
        NSLayoutConstraint.activate([close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12), close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)])
        let s = session
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    }

    func metadataOutput(_ o: AVCaptureMetadataOutput, didOutput objs: [AVMetadataObject], from c: AVCaptureConnection) {
        guard let t = (objs.first as? AVMetadataMachineReadableCodeObject)?.stringValue, t.hasPrefix(SyncCore.qrPrefix) else { return }
        done(t)
    }

    private func done(_ t: String?) {
        guard let f = finish else { return }
        finish = nil
        let s = session
        DispatchQueue.global(qos: .userInitiated).async { s.stopRunning() }
        dismiss(animated: true) { f(t) }
    }
}


/// The page's web view. While the book reader shows its text, iOS's own selection menu (Copy, Look Up…) stays away:
/// the page shows Explain · Define · Highlight at the selection instead (reader redesign, 25 Nov 2026).
final class PlannerWeb: WKWebView {
    static var quiet = false
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        PlannerWeb.quiet ? false : super.canPerformAction(action, withSender: sender)
    }
    override func buildMenu(with builder: UIMenuBuilder) {
        if PlannerWeb.quiet {
            for m: UIMenu.Identifier in [.standardEdit, .lookup, .share, .replace, .format, .learn, .speech, .spelling, .transformations] { builder.remove(menu: m) }
            return
        }
        super.buildMenu(with: builder)
    }
}
