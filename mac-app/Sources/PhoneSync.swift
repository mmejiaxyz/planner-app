// Phone sync, Mac side. See SyncCore.swift for the format and sync-worker/ for the server.
//
// - After the plan is saved, upload an encrypted snapshot (the plan, calendar events for the phone, and the names of
//   the phone changes already applied). At most one upload every 2 minutes, and only when something changed.
// - The page asks for phone changes every 20 s (phoneOps); the server is asked at most every 30 s. Notes go straight into
//   the "From your iPhone" inbox; plan changes go to the page, which merges and saves them, then confirms (phoneOpsDone).
// - Page updates: the page in this app's bundle (index.html and js/) is uploaded, encrypted, when it differs from the one
//   last uploaded, so only after a rebuild. The snapshot names it ("web": tag, build); the phone downloads it once.
// - Recordings from the phone: an "audio" change names a recording uploaded in parts. The Mac downloads and decrypts
//   the parts, checks the whole file against the phone's SHA-256, imports it into Brain (Meetings.importFile, Whisper on
//   this Mac), then deletes it on the server and lists it as applied. Up to 3 tries, then it is left and reported.
// - PDFs for the phone's reader (since 21 Nov 2026): the snapshot lists each course's PDFs (name, size, date; the same
//   folders as Courses › Files). Every PDF goes to the phone on its own while the Mac is open (mirror(), the user's request:
//   "i need it to work without the mac on"), linked to open tasks first, then newest, keeping the part store under
//   mirrorBudget so recordings keep room; the phone says "fileGot" when it has a copy (onPhone). A "fileReq" change asks
//   for one first: it is uploaded encrypted in parts (kind "file", the
//   recording part store on the Worker) and named in the snapshot's "fileSends"; the phone downloads it and deletes the
//   parts. Unclaimed parts are deleted after 2 days. "marks" changes (underlines, highlights, notes made on the phone)
//   are written into the real file (Reader.applyPhoneMarks); "marked" tells the phone which file dates came from its own
//   marks, so it does not download the file again for them. "readNotes" are saved to the course's Reading notes folder.
//   "help" is a Get help question asked on the phone; it waits on that task's Get help button here (phoneOps "helps").
// - Text first (25 Nov 2026, the user's rule: "the post processed text is the one always sent to the iphone, only when missing
//   is the pdf sent"): every PDF linked to the app (course folders, linked folders) gets a reading version (Reading.swift)
//   and that goes to the phone, with the PDF's marks in it (mirrorReading). mirror() sends a PDF itself only when its
//   reading version cannot be made (no Docling, or it failed); while one is being made it waits. Since 26 Nov 2026 the
//   reading versions stay on the Worker as the phone's library (snapshot "texts"), so the phone gets any of them with the
//   Mac off, after a reinstall or on a new phone. A "fileReq" (the phone
//   opening the original page, or a PDF with no text yet) still sends the PDF.
// - Nothing is sent before pairing (Planner › Pair iPhone…) and without sync-server.json (sync-worker/setup.sh).
//
// Request budget per day (Worker free plan: 100,000): Mac polling ≤ 2,880 while open all day, uploads ≤ 720 plus one
// per batch of phone changes, phone ≤ 1,440 while open. The Worker refuses anything past 20,000.

import AppKit
import CoreImage
import CryptoKit
import PDFKit

@MainActor
final class PhoneSync {
    let store: Store
    let cal: Cal
    private(set) var key: SymmetricKey? = PhoneSync.loadMacKey()
    private var applied: [String] = []                  // phone changes applied, oldest first (last 300 kept)
    private(set) var notes: [[String: Any]] = []        // phone notes waiting in the inbox: {id, text, at}
    private var waiting: [String: [String: Any]] = [:]  // plan changes fetched, not yet confirmed by the page
    private var lastPull = Date.distantPast
    private var lastUpload = Date.distantPast
    private var lastHash = ""
    private var uploadTask: Task<Void, Never>?
    private(set) var lastError = ""
    private(set) var lastUploadAt: Date?
    private var webTag = ""                             // tag of the page last uploaded
    var importAudio: ((URL, String, String, Date) async throws -> Void)?   // file, course id, title, recorded at
    private var audioBusy = Set<String>()
    private var audioTries: [String: Int] = [:]
    private var fileSends: [[String: Any]] = []         // PDFs uploaded for the phone: {id, cid, file, parts, sha256, size, m, at} or {id, cid, file, error, at}
    private var marked: [String: [String: Int]] = [:]   // "cid/file" -> {from, to}: file dates (s) before and after the phone's marks were written
    private(set) var helps: [[String: Any]] = []        // Get help questions from the phone: {id, cid, tid, text, at}
    private var fileBusy = Set<String>()
    private var names: [String] = []
    private var onPhone: [String: Int] = [:]            // "cid/file" -> file date of the copy the phone has
    // Reading versions for the phone's book reader (reader redesign, 25 Nov 2026): the Mac's Docling text (Reading.swift),
    // zlib-compressed and sealed in parts. Since 26 Nov 2026 they are kept on the Worker (text/, 1 GB cap), the phone's
    // library: the snapshot's "texts" lists every one, and the phone fetches what it lacks, with the Mac off too. One is
    // replaced when its text or the PDF's marks change, and deleted when the PDF leaves the course folders.
    private var texts: [String: [String: Any]] = [:]    // "cid/file" -> {id, parts, size, sha256 (of the JSON), stamp (reading version date @ PDF date)}
    private var readSends: [[String: Any]] = []         // the transit sends before the library: their parts are deleted once
    private var mirroring = false
    /// Never a PDF to the phone (27 Nov 2026, the user's rule: "I dont want to ever send the pdf to the phone, only text
    /// version"): a phone request (fileReq) makes that file's reading version first and sends it as soon as it is ready.
    private var wanted: [String] = []                   // "cid/file" the phone asked for, sent first
    static let mirrorBudget = 120 << 20                 // PDFs waiting on the server at most (recordings share a 200 MB cap)                    // known names the phone's reader hides from DeepSeek (the page's helpNames)
    var applyMarks: (@MainActor (URL, [[String: Any]], [[String: Any]]) throws -> Void)?   // file, marks to add, marks to remove
    private var uploading = false
    private var uploadDue = Date.distantPast

    static let minUploadGap: TimeInterval = 120
    static let minPullGap: TimeInterval = 30

    private var stateURL: URL { Paths.support.appendingPathComponent("phone-sync.json") }
    private var serverURL: URL { Paths.support.appendingPathComponent("sync-server.json") }

    init(store: Store, cal: Cal) {
        self.store = store; self.cal = cal
        if let d = try? Data(contentsOf: stateURL), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            applied = o["applied"] as? [String] ?? []
            notes = o["notes"] as? [[String: Any]] ?? []
            webTag = o["webTag"] as? String ?? ""
            fileSends = o["fileSends"] as? [[String: Any]] ?? []
            marked = o["marked"] as? [String: [String: Int]] ?? [:]
            helps = o["helps"] as? [[String: Any]] ?? []
            names = o["names"] as? [String] ?? []
            onPhone = o["onPhone"] as? [String: Int] ?? [:]
            readSends = o["readSends"] as? [[String: Any]] ?? []
            texts = o["texts"] as? [String: [String: Any]] ?? [:]
        }
        // PDFs uploaded for the phone before the text-only rule are withdrawn: the phone no longer sees them in the snapshot
        // and their parts on the Worker are deleted (dropPDFs, on the first mirror)
    }

    var server: SyncCore.Server? {
        guard SyncCore.cloudAllowed, let d = try? Data(contentsOf: serverURL), let o = try? JSONSerialization.jsonObject(with: d) as? [String: String],
              let u = o["url"].flatMap(URL.init(string:)), let t = o["token"], !t.isEmpty else { return nil }
        return SyncCore.Server(url: u, token: t)
    }
    var active: Bool { key != nil && server != nil }

    private func saveState() {
        applied = Array(applied.suffix(300))
        if let d = try? JSONSerialization.data(withJSONObject: ["applied": applied, "notes": notes, "webTag": webTag, "fileSends": fileSends, "marked": marked, "helps": helps, "names": names, "onPhone": onPhone, "readSends": readSends, "texts": texts]) { try? d.write(to: stateURL, options: .atomic) }
    }

    // MARK: key (Mac)

    /// On the Mac the key is a file only this user can read (like sync-server.json), not a Keychain item: the app is
    /// signed with a self-made certificate, so macOS sees every rebuild as a new app and asked for the login password
    /// on each Keychain read (8 Nov 2026, three prompts after one rebuild). plan.json sits unencrypted in the same
    /// folder, so this does not lower local protection; the key keeps Cloudflare and the network out. The phone keeps
    /// its copy in its Keychain.
    static var keyFile: URL { Paths.support.appendingPathComponent("sync-key") }

    static func loadMacKey() -> SymmetricKey? {
        if let d = try? Data(contentsOf: keyFile), d.count == 32 { return SymmetricKey(data: d) }
        guard let k = SyncCore.loadKey() else { return nil }      // paired before 8 Nov 2026: move it out (one last prompt)
        try? saveMacKey(k)
        return k
    }

    static func saveMacKey(_ k: SymmetricKey) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: keyFile)
        guard fm.createFile(atPath: keyFile.path, contents: SyncCore.keyData(k), attributes: [.posixPermissions: 0o600]) else {
            throw SyncCore.Failure(message: "Could not save the sync key")
        }
    }

    // MARK: pairing

    /// Makes the key the first time (kept in the login keychain) and returns what the QR code carries.
    func pair() throws -> SyncCore.Pairing {
        guard let s = server else { throw SyncCore.Failure(message: "The sync server is not set up. Run sync-worker/setup.sh once.") }
        if key == nil { let k = SyncCore.newKey(); try PhoneSync.saveMacKey(k); key = k; webTag = ""; saveState() }
        lastHash = ""; planChanged(soon: true)
        return SyncCore.Pairing(key: key!, url: s.url, token: s.token)
    }

    /// A new Mac takes over with the recovery code (Cloudflare Backup… › Restore with a Recovery Code…): the same key
    /// and Worker as before, so the backup opens and the iPhone keeps syncing. Nothing is uploaded while the plan is empty.
    func adopt(_ p: SyncCore.Pairing) throws {
        try PhoneSync.saveMacKey(p.key); key = p.key
        let d = try JSONSerialization.data(withJSONObject: ["url": p.url.absoluteString, "token": p.token])
        try? FileManager.default.removeItem(at: serverURL)
        guard FileManager.default.createFile(atPath: serverURL.path, contents: d, attributes: [.posixPermissions: 0o600]) else {
            throw SyncCore.Failure(message: "Could not save the sync server")
        }
        webTag = ""; lastHash = ""; saveState()
    }

    /// Stops syncing: the key is deleted, so what is on the server can no longer be opened by anyone.
    func unpair() { try? FileManager.default.removeItem(at: PhoneSync.keyFile); SyncCore.keychainDelete("key"); key = nil; uploadTask?.cancel(); uploadTask = nil }

    // MARK: page

    /// The page as built into this app: {tag, built, version, files: {"index.html": …, "js/x.js": …}}.
    lazy var webBundle: [String: Any]? = {
        guard let res = Bundle.main.resourceURL, let index = try? String(contentsOf: res.appendingPathComponent("index.html"), encoding: .utf8) else { return nil }
        var files = ["index.html": index]
        let js = res.appendingPathComponent("js", isDirectory: true)
        for n in (try? FileManager.default.contentsOfDirectory(atPath: js.path)) ?? [] where n.hasSuffix(".js") {
            if let t = try? String(contentsOf: js.appendingPathComponent(n), encoding: .utf8) { files["js/" + n] = t }
        }
        guard let d = try? JSONSerialization.data(withJSONObject: files, options: [.sortedKeys]) else { return nil }
        let info = Bundle.main.infoDictionary ?? [:]
        return ["tag": SHA256.hash(data: d).prefix(12).map { String(format: "%02x", $0) }.joined(),
                "built": (info["PlannerBuilt"] as? NSNumber)?.intValue ?? 0,   // build time, written by build.sh
                "version": info["CFBundleShortVersionString"] as? String ?? "", "files": files]
    }()

    /// Upload the page if this build's page is not the one on the server yet. Returns what the snapshot should name.
    private func webForSnapshot(key: SymmetricKey, server: SyncCore.Server) async -> [String: Any]? {
        guard let w = webBundle, let tag = w["tag"] as? String else { return nil }
        if tag != webTag {
            do { try await server.putWeb(try SyncCore.seal(w, kind: .web, key: key)); webTag = tag; saveState() }
            catch { lastError = error.localizedDescription; return nil }
        }
        return ["tag": tag, "built": w["built"] ?? 0, "version": w["version"] ?? ""]
    }

    // MARK: snapshot

    /// Called after every save of the plan, after phone changes, and every 15 minutes (calendar changes).
    /// `soon`: something the phone is waiting for (its changes applied, a PDF ready) goes up in 5 s, also when a slower
    /// upload was already waiting.
    func planChanged(soon: Bool = false) {
        guard active else { return }
        let gap = soon ? 5 : max(10, Self.minUploadGap - Date().timeIntervalSince(lastUpload))
        if uploadTask != nil {
            guard soon, !uploading, uploadDue > Date().addingTimeInterval(gap + 1) else { return }
            uploadTask?.cancel()
        }
        uploadDue = Date().addingTimeInterval(gap)
        uploadTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(gap * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            self.uploading = true
            await self.upload()
            self.uploading = false
            self.uploadTask = nil
        }
    }

    private func upload() async {
        guard let key, let server else { return }
        guard !store.courses.isEmpty else { return }   // a fresh or empty plan never replaces the phone's (a new Mac before Restore)
        defer { Task { @MainActor [weak self] in await self?.mirror() } }   // also when the plan did not change (15-minute timer)
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        let from = df.string(from: Date().addingTimeInterval(-7 * 86400)), to = df.string(from: Date().addingTimeInterval(60 * 86400))
        let ev = await cal.events(from: from, to: to)
        let events = (ev["status"] as? String) == "granted" ? (ev["events"] as? [[String: Any]] ?? []) : []
        expireFiles()
        var plan = store.snapshot(); plan["textless"] = textless()   // files with no text version: the phone says so instead of waiting
        var body: [String: Any] = ["plan": plan, "events": events, "applied": Array(applied.suffix(300)),
                                   "files": coursePDFs(), "fileSends": fileSends.map { $0.filter { $0.key != "at" } }, "marked": marked, "names": names,
                                   "texts": textList()]
        if let web = await webForSnapshot(key: key, server: server) { body["web"] = web }
        guard let plain = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let hash = SHA256.hash(data: plain).map { String(format: "%02x", $0) }.joined()
        if hash == lastHash { return }
        do {
            var snap = body; snap["v"] = 1; snap["at"] = ISO8601DateFormatter().string(from: Date())
            Activity.shared.start("phone-plan", "send", "Sending the plan to the iPhone")
            try await server.putSnapshot(try SyncCore.seal(snap, kind: .snapshot, key: key))
            lastHash = hash; lastUpload = Date(); lastUploadAt = lastUpload; lastError = ""
            Activity.shared.finish("phone-plan")
        } catch { lastError = error.localizedDescription; Activity.shared.finish("phone-plan", ok: false, note: lastError) }
    }

    /// Sends the phone what it needs to read with the Mac off: the reading version of every course PDF (mirrorReading), and
    /// the PDF itself only when no reading version can be made (the phone does not have it, or has an older copy). PDFs
    /// still waiting for their reading version are queued for it here, so this does not depend on the page. Linked to
    /// open tasks first, then newest. Stops while the part store holds mirrorBudget.
    func mirror() async {
        guard active, !mirroring, let server else { return }
        mirroring = true; defer { mirroring = false }
        let old = fileSends.filter { $0["error"] == nil }
        if !fileSends.isEmpty {
            fileSends = []; saveState(); planChanged(soon: true)
            for o in old { if let p = o["parts"] as? Int, let id = o["id"] as? String { try? await server.deleteFile(id, parts: p) } }
        }
        await mirrorReading()
        var make: [(path: String, linked: Bool)] = []
        for c in store.courses {
            guard let cid = c["id"] as? String, let dir = courseFolder(cid) else { continue }
            let linked = Set((c["tasks"] as? [[String: Any]] ?? []).filter { ($0["status"] as? String) != "done" }.flatMap { $0["files"] as? [String] ?? [] })
            for e in Self.pdfList(dir) {
                let f = e["f"] as? String ?? "", path = dir.appendingPathComponent(f).path
                if Reading.shared.state(path) == "none", Help.inDocs(path) != nil { make.append((path, linked.contains(f))) }   // only the text ever goes
            }
        }
        if !make.isEmpty { _ = Reading.shared.ahead(make.filter { $0.linked }.map { $0.path } + make.filter { !$0.linked }.map { $0.path }) }
    }

    /// The phone asked for a file: its reading version goes first in line and is sent the moment it is made.
    func wantText(cid: String, file: String) {
        let k = cid + "/" + file
        if texts[k] != nil { recheck.insert(k) }               // asked again: its pieces may be gone, upload it again
        if !wanted.contains(k) { wanted.insert(k, at: 0) }
        if let u = pdfURL(cid: cid, file: file) { _ = Reading.shared.get(u.path) }
        Task { @MainActor [weak self] in await self?.mirror() }
    }
    /// Reading.onDone: a reading version the phone is waiting for is ready (or failed): send now, or tell the phone.
    func textDone(_ path: String, ok: Bool) {
        guard !wanted.isEmpty else { return }
        Task { @MainActor [weak self] in await self?.mirror() }
    }

    /// The library in the snapshot: one line per kept reading version.
    private func textList() -> [[String: Any]] {
        texts.keys.sorted().compactMap { k in
            guard let t = texts[k], let i = k.firstIndex(of: "/") else { return nil }
            return ["cid": String(k[..<i]), "file": String(k[k.index(after: i)...]), "id": t["id"] ?? "", "parts": t["parts"] ?? 0, "size": t["size"] ?? 0, "sha256": t["sha256"] ?? ""]
        }
    }
    private var recheck = Set<String>()                 // "cid/file" the phone asked for although the library has it

    /// Keeps the Worker's library in step with the reading versions here: uploads every one that is new or changed (its
    /// text, or the PDF's marks: a new date), the ones the phone asked for first, and deletes the ones whose PDF left the
    /// course folders. Each carries the PDF's marks ("marks": highlights, underlines and notes in the reading version's
    /// page space, Reader.marks), so the phone shows them without the PDF. About 6 MB for 53 books (Nov 2026).
    private func mirrorReading() async {
        guard let key, let server else { return }
        if !readSends.isEmpty {                                // the transit copies of before: their parts go
            for o in readSends { if let p = o["parts"] as? Int, let id = o["id"] as? String { try? await server.deleteFile(id, parts: p) } }
            readSends = []; saveState()
        }
        var changed = false
        var all: [(cid: String, dir: URL, f: String)] = []
        for c in store.courses {
            guard let cid = c["id"] as? String, let dir = courseFolder(cid) else { continue }
            for e in Self.pdfList(dir) { all.append((cid, dir, e["f"] as? String ?? "")) }
        }
        all.sort { wanted.contains($0.cid + "/" + $0.f) && !wanted.contains($1.cid + "/" + $1.f) }
        for (cid, dir, f) in all {
            let k = cid + "/" + f, path = dir.appendingPathComponent(f).path
            if Reading.shared.state(path) == "failed" { wanted.removeAll { $0 == k } }   // no text can be made: the phone says so
            guard Reading.shared.ready(path) else { continue }
            wanted.removeAll { $0 == k }
            bridgeFlush?(dir.appendingPathComponent(f))                 // marks still waiting to be written go in first
            let stamp = String(Self.mtime(Reading.shared.json(path))) + "@" + String(Self.mtime(dir.appendingPathComponent(f)))
            if (texts[k]?["stamp"] as? String) == stamp && !recheck.contains(k) { continue }
            guard let raw = try? Data(contentsOf: Reading.shared.json(path)), var obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { continue }
            let sizes = (obj["sizes"] as? [[Any]] ?? []).map { $0.compactMap { ($0 as? NSNumber)?.doubleValue } }
            obj["marks"] = PDFDocument(url: dir.appendingPathComponent(f)).map { Reader.marks(in: $0, sizes: sizes, notes: true) } ?? []
            guard let json = try? JSONSerialization.data(withJSONObject: obj) else { continue }
            let sha = SHA256.hash(data: json).map { String(format: "%02x", $0) }.joined()
            guard let packed = try? (json as NSData).compressed(using: .zlib) as Data else { continue }
            let rid = String(SyncCore.newOpName().dropLast(4))
            let parts = max(1, (packed.count + SyncCore.filePart - 1) / SyncCore.filePart)
            Activity.shared.start("phone-texts", "send", "Sending texts to the iPhone", detail: (f as NSString).lastPathComponent.replacingOccurrences(of: ".pdf", with: "", options: .caseInsensitive))
            do {
                for n in 0..<parts {
                    let chunk = packed.subdata(in: (n * SyncCore.filePart)..<min(packed.count, (n + 1) * SyncCore.filePart))
                    try await server.putTextPart(rid, n, try SyncCore.sealData(chunk, kind: .file, context: "\(rid):\(n)", key: key))
                }
            } catch {
                try? await server.deleteText(rid, parts: parts)
                lastError = "Text versions for the iPhone: " + error.localizedDescription
                Activity.shared.finish("phone-texts", ok: false, note: lastError); break
            }
            Activity.shared.finish("phone-texts", note: (f as NSString).lastPathComponent)
            if let old = texts[k], let oid = old["id"] as? String, let p = old["parts"] as? Int { try? await server.deleteText(oid, parts: p) }
            texts[k] = ["id": rid, "parts": parts, "size": packed.count, "sha256": sha, "stamp": stamp]
            recheck.remove(k); changed = true
            saveState()                                                 // after each upload, so a quit never loses track of one
        }
        // PDFs no longer in the course folders: their text goes from the library
        let here = Set(all.map { $0.cid + "/" + $0.f })
        for (k, t) in texts where !here.contains(k) {
            if let id = t["id"] as? String, let p = t["parts"] as? Int { try? await server.deleteText(id, parts: p) }
            texts[k] = nil; changed = true
        }
        if changed { saveState(); planChanged(soon: true) }
    }

    // MARK: changes from the phone

    /// Plan changes for the page to merge (oldest first) and whether new notes arrived.
    func pull() async -> [String: Any] {
        guard active, let key, let server else { return ["ops": []] }
        var newNotes = false
        if Date().timeIntervalSince(lastPull) >= Self.minPullGap {
            lastPull = Date()
            do {
                var drop: [String] = []
                for (name, data) in try await server.ops() {
                    let id = String(name.dropLast(4))
                    if applied.contains(id) || waiting[id] != nil { if applied.contains(id) { drop.append(name) }; continue }
                    guard let op = try? SyncCore.open(data, kind: .op, key: key) as? [String: Any] else {
                        drop.append(name); lastError = "A change from the iPhone could not be opened (made with an older pairing?). It was removed."
                        continue
                    }
                    if (op["kind"] as? String) == "note" {
                        let text = (op["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !text.isEmpty && !notes.contains(where: { ($0["id"] as? String) == id }) {
                            notes.append(["id": id, "text": text, "at": op["at"] as? String ?? ""]); newNotes = true
                        }
                        applied.append(id); drop.append(name)
                    } else if (op["kind"] as? String) == "audio" {
                        if !audioBusy.contains(id) && (audioTries[id] ?? 0) < 3 {
                            audioBusy.insert(id)
                            Task { @MainActor [weak self] in await self?.fetchAudio(op, id: id, name: name) }
                        }
                    } else if (op["kind"] as? String) == "set" {
                        var o = op; o["id"] = id; waiting[id] = o
                    } else if (op["kind"] as? String) == "fileReq" {   // never the PDF: its text version, made first
                        applied.append(id); drop.append(name)
                        wantText(cid: op["cid"] as? String ?? "", file: op["file"] as? String ?? "")
                    } else if (op["kind"] as? String) == "fileGot" {
                        let k = (op["cid"] as? String ?? "") + "/" + (op["file"] as? String ?? "")
                        if let m = op["m"] as? Int { onPhone[k] = m }
                        fileSends.removeAll { ($0["id"] as? String) == (op["fid"] as? String ?? "-") }
                        applied.append(id); drop.append(name)
                        Task { @MainActor [weak self] in await self?.mirror() }
                    } else if (op["kind"] as? String) == "readGot" {
                        applied.append(id); drop.append(name)
                    } else if (op["kind"] as? String) == "marks" {
                        applyPhoneMarks(op); applied.append(id); drop.append(name)
                    } else if (op["kind"] as? String) == "readNotes" {
                        saveReadingNotes(op); applied.append(id); drop.append(name)
                    } else if (op["kind"] as? String) == "help" {
                        let text = (op["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !text.isEmpty && !helps.contains(where: { ($0["id"] as? String) == id }) {
                            helps.append(["id": id, "cid": op["cid"] as? String ?? "", "tid": op["tid"] as? String ?? "", "text": String(text.prefix(4000)), "at": op["at"] as? String ?? ""])
                        }
                        applied.append(id); drop.append(name)
                    } else { applied.append(id); drop.append(name) }
                }
                if !drop.isEmpty { try await server.deleteOps(drop); saveState(); planChanged(soon: true); Activity.shared.done("get", "Got \(drop.count) change\(drop.count == 1 ? "" : "s") from the iPhone") }
            } catch { lastError = error.localizedDescription }
        }
        return ["ops": waiting.keys.sorted().compactMap { waiting[$0] }, "notes": newNotes, "helps": helps]
    }

    /// A recording from the phone into Brain. The change file stays on the server until this worked, so a failure is
    /// tried again at a later pull (at most 3 times).
    private func fetchAudio(_ op: [String: Any], id: String, name: String) async {
        defer { audioBusy.remove(id); Activity.shared.finish("audio-" + id) }
        guard let key, let server, let importAudio else { return }
        Activity.shared.start("audio-" + id, "get", "Getting a recording from the iPhone", detail: op["title"] as? String ?? "")
        let parts = op["parts"] as? Int ?? 0, sha = op["sha256"] as? String ?? "", rec = op["rec"] as? String ?? ""
        let ext = ["m4a", "caf", "wav"].contains(op["ext"] as? String ?? "") ? op["ext"] as! String : "m4a"
        let dir = Paths.support.appendingPathComponent("phone-audio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(rec + "." + ext)
        do {
            guard parts > 0, parts <= 4000, sha.count == 64, rec.range(of: "^[0-9]{13}-[a-f0-9]{8}$", options: .regularExpression) != nil else { throw SyncCore.Failure(message: "The recording description is not valid") }
            FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600])
            let h = try FileHandle(forWritingTo: file)
            var hasher = SHA256()
            do {
                for n in 0..<parts {
                    guard let d = try await server.audio(rec, n) else { throw SyncCore.Failure(message: "Part \(n + 1) of \(parts) is missing") }
                    let plain = try SyncCore.openData(d, kind: .audio, context: "\(rec):\(n)", key: key)
                    hasher.update(data: plain); try h.write(contentsOf: plain)
                }
                try h.close()
            } catch { try? h.close(); throw error }
            guard hasher.finalize().map({ String(format: "%02x", $0) }).joined() == sha else { throw SyncCore.Failure(message: "The recording did not arrive complete") }
            let created = ISO8601DateFormatter().date(from: op["at"] as? String ?? "") ?? Date()
            let title = (op["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            try await importAudio(file, op["course"] as? String ?? "", title.isEmpty ? "Recording from iPhone" : title, created)
            try? FileManager.default.removeItem(at: file)
            try? await server.deleteAudio(rec, parts: parts)
            applied.append(id); saveState()
            try? await server.deleteOps([name])
            planChanged(soon: true)
        } catch {
            try? FileManager.default.removeItem(at: file)
            audioTries[id, default: 0] += 1
            lastError = "Recording from the iPhone (try \(audioTries[id]!) of 3): " + error.localizedDescription
        }
    }

    /// The page merged and saved these: forget them on the server and tell the phone in the next snapshot.
    func done(_ ids: [String]) async {
        guard let server else { return }
        for id in ids { waiting[id] = nil; if !applied.contains(id) { applied.append(id) } }
        saveState()
        do { try await server.deleteOps(ids.map { $0 + ".bin" }) } catch { lastError = error.localizedDescription }
        planChanged(soon: true)
    }

    /// A Get help question from the phone was put into the help panel here.
    func setNames(_ n: [String]) {
        let clean = Array(n.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { $0.count > 1 && $0.count < 80 }.suffix(400))
        guard clean != names else { return }
        names = clean; saveState(); planChanged()
    }
    func helpTaken(_ id: String) { helps.removeAll { ($0["id"] as? String) == id }; saveState() }

    // MARK: PDFs for the phone's reader

    /// The folder Courses › Files lists for a course: its own `folder`, else its context folder in Documents/Planner.
    func courseFolder(_ cid: String) -> URL? {
        guard let c = store.courses.first(where: { ($0["id"] as? String) == cid }) else { return nil }
        if let f = c["folder"] as? String, !f.isEmpty, let u = Help.inDocs(f) { return u }
        let short = (c["short"] as? String) ?? (c["name"] as? String) ?? cid
        return Help.root.appendingPathComponent(Help.safeName(short), isDirectory: true)
    }

    /// PDFs in a course folder and one level of subfolders (as listFiles; not Sessions or Reading notes): {f, s, m}.
    static func pdfList(_ dir: URL) -> [[String: Any]] {
        let fm = FileManager.default
        var out: [[String: Any]] = []
        func add(_ rel: String) {
            guard let at = try? fm.attributesOfItem(atPath: dir.appendingPathComponent(rel).path) else { return }
            out.append(["f": rel, "s": (at[.size] as? Int) ?? 0, "m": Int(((at[.modificationDate] as? Date) ?? Date.distantPast).timeIntervalSince1970)])
        }
        let isPDF = { (n: String) in !n.hasPrefix(".") && (n as NSString).pathExtension.lowercased() == "pdf" }
        let items = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        items.filter(isPDF).forEach(add)
        for d in items where !d.hasPrefix(".") && !["Sessions", "Reading notes"].contains(d) && !d.hasSuffix(".app") {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: dir.appendingPathComponent(d).path, isDirectory: &isDir), isDir.boolValue else { continue }
            ((try? fm.contentsOfDirectory(atPath: dir.appendingPathComponent(d).path)) ?? []).filter(isPDF).prefix(200).forEach { add(d + "/" + $0) }
        }
        return out.sorted { ($0["f"] as? String ?? "") < ($1["f"] as? String ?? "") }
    }

    /// Course PDFs the Mac cannot make a reading version of (Docling missing, or it failed), as plan docs {id: "cid/file"}.
    private func textless() -> [[String: Any]] {
        var out: [[String: Any]] = []
        for c in store.courses {
            guard let id = c["id"] as? String, let dir = courseFolder(id) else { continue }
            for e in Self.pdfList(dir) {
                let f = e["f"] as? String ?? ""
                if ["failed", "missing"].contains(Reading.shared.state(dir.appendingPathComponent(f).path)) { out.append(["id": id + "/" + f]) }
            }
        }
        return out
    }

    private func coursePDFs() -> [String: Any] {
        var out: [String: Any] = [:]
        for c in store.courses {
            guard let id = c["id"] as? String, let dir = courseFolder(id) else { continue }
            let l = Self.pdfList(dir); if !l.isEmpty { out[id] = l }
        }
        return out
    }

    /// The real file for a phone request: only a PDF the snapshot lists for that course.
    private func pdfURL(cid: String, file: String) -> URL? {
        guard !file.contains(".."), !file.hasPrefix("/"), file.lowercased().hasSuffix(".pdf"), let dir = courseFolder(cid) else { return nil }
        guard Self.pdfList(dir).contains(where: { ($0["f"] as? String) == file }) else { return nil }
        return dir.appendingPathComponent(file)
    }

    private static func mtime(_ u: URL) -> Int {
        Int(((try? FileManager.default.attributesOfItem(atPath: u.path))?[.modificationDate] as? Date ?? Date.distantPast).timeIntervalSince1970)
    }

    /// Uploads one PDF for the phone, unless the same version is already waiting there.
    private func sendFile(cid: String, file: String) async {
        let k = cid + "/" + file
        guard let key, let server, !fileBusy.contains(k) else { return }
        fileBusy.insert(k); defer { fileBusy.remove(k) }
        let fid = String(SyncCore.newOpName().dropLast(4)), now = Date().timeIntervalSince1970
        func fail(_ m: String) {
            fileSends.removeAll { ($0["cid"] as? String) == cid && ($0["file"] as? String) == file }
            fileSends.append(["id": fid, "cid": cid, "file": file, "error": m, "at": now]); saveState(); planChanged(soon: true)
        }
        guard let u = pdfURL(cid: cid, file: file) else { return fail("This PDF is no longer in the course folder on the Mac.") }
        if bridgeFlush != nil { bridgeFlush?(u) }                      // marks still waiting to be written go in first
        let m = Self.mtime(u)
        if fileSends.contains(where: { ($0["cid"] as? String) == cid && ($0["file"] as? String) == file && ($0["m"] as? Int) == m && $0["error"] == nil }) { planChanged(soon: true); return }
        do {
            let d = try Data(contentsOf: u)
            guard d.count <= SyncCore.maxFile else { return fail("This PDF is over 60 MB, too big to send to the phone.") }
            let parts = max(1, (d.count + SyncCore.filePart - 1) / SyncCore.filePart)
            for n in 0..<parts {
                let chunk = d.subdata(in: (n * SyncCore.filePart)..<min(d.count, (n + 1) * SyncCore.filePart))
                try await server.putFilePart(fid, n, try SyncCore.sealData(chunk, kind: .file, context: "\(fid):\(n)", key: key))
            }
            // an older copy of the same file that is still waiting is replaced
            for old in fileSends where (old["cid"] as? String) == cid && (old["file"] as? String) == file {
                if let p = old["parts"] as? Int, let oid = old["id"] as? String { try? await server.deleteFile(oid, parts: p) }
            }
            fileSends.removeAll { ($0["cid"] as? String) == cid && ($0["file"] as? String) == file }
            fileSends.append(["id": fid, "cid": cid, "file": file, "parts": parts, "size": d.count, "m": m,
                              "sha256": SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined(), "at": now])
            saveState(); planChanged(soon: true)
        } catch {
            try? await server.deleteFile(fid, parts: max(1, (SyncCore.maxFile / SyncCore.filePart)))
            fail(error.localizedDescription)
        }
    }
    var bridgeFlush: (@MainActor (URL) -> Void)?

    /// PDFs the phone has not fetched within 14 days are deleted on the server (the phone deletes the ones it got) and
    /// sent again by the next mirror().
    private func expireFiles() {
        let cut = Date().timeIntervalSince1970 - 14 * 86400
        let old = fileSends.filter { ($0["at"] as? Double ?? 0) < cut }
        guard !old.isEmpty else { return }
        fileSends.removeAll { ($0["at"] as? Double ?? 0) < cut }; saveState()
        guard let server else { return }
        Task { for o in old { if let id = o["id"] as? String, let p = o["parts"] as? Int { try? await server.deleteFile(id, parts: p) } } }
    }

    /// Underlines, highlights and notes made on the phone, written into the real PDF.
    private func applyPhoneMarks(_ op: [String: Any]) {
        let cid = op["cid"] as? String ?? "", file = op["file"] as? String ?? ""
        guard let u = pdfURL(cid: cid, file: file) else { lastError = "Marks from the iPhone: \(file) is no longer in the course folder."; return }
        do {
            bridgeFlush?(u)                                     // marks made here first, so "from" is the file as it is
            let k = cid + "/" + file, before = Self.mtime(u)
            try applyMarks?(u, op["add"] as? [[String: Any]] ?? [], op["remove"] as? [[String: Any]] ?? [])
            // several changes in a row: the phone's copy was made from the first "from"
            let from = marked[k]?["to"] == before ? (marked[k]?["from"] ?? before) : before
            marked[k] = ["from": from, "to": Self.mtime(u)]
            if onPhone[k] == before { onPhone[k] = Self.mtime(u) }   // the phone already has these marks
            if marked.count > 300 { marked = Dictionary(uniqueKeysWithValues: Array(marked).suffix(300)) }
            saveState()
        } catch { lastError = "Marks from the iPhone could not be saved into \(file): " + error.localizedDescription }
    }

    /// Reading notes written with the phone's reading partner, into Documents/Planner/<course>/Reading notes.
    private func saveReadingNotes(_ op: [String: Any]) {
        guard let c = store.courses.first(where: { ($0["id"] as? String) == (op["cid"] as? String ?? "") }) else { lastError = "Reading notes from the iPhone had no course."; return }
        let text = op["text"] as? String ?? ""; guard !text.isEmpty else { return }
        let dir = Help.folder((c["short"] as? String) ?? (c["name"] as? String) ?? "Course").appendingPathComponent("Reading notes", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = Help.safeName((op["name"] as? String ?? "Reading notes").replacingOccurrences(of: ".md", with: "") + ".md")
        var dst = dir.appendingPathComponent(name)
        let base = dst.deletingPathExtension().lastPathComponent
        var n = 2; while FileManager.default.fileExists(atPath: dst.path) { dst = dir.appendingPathComponent("\(base) \(n).md"); n += 1 }
        do { try text.write(to: dst, atomically: true, encoding: .utf8) } catch { lastError = "Reading notes from the iPhone: " + error.localizedDescription }
    }

    // MARK: notes in the inbox

    var inboxItems: [[String: Any]] {
        notes.map { ["id": "phone:" + ($0["id"] as? String ?? ""), "title": $0["text"] as? String ?? "", "notes": "From the Planner app", "created": $0["at"] as? String ?? ""] }
    }
    func noteDone(_ id: String) {
        let raw = id.hasPrefix("phone:") ? String(id.dropFirst(6)) : id
        notes.removeAll { ($0["id"] as? String) == raw }; saveState()
    }

    // MARK: pairing window

    func showPairing(_ window: NSWindow?) {
        let alert = NSAlert()
        do {
            let p = try pair()
            alert.messageText = "Pair your iPhone"
            alert.informativeText = "1. Open Planner on the iPhone and tap Scan the code.\n2. Point it at this code.\n3. Both should show the check code \(SyncCore.fingerprint(p.key)).\n\nThe code holds the key that encrypts your plan. Do not share or photograph it."
                + (lastError.isEmpty ? "" : "\n\nLast sync problem: \(lastError)")
            let iv = NSImageView(frame: NSRect(x: 0, y: 0, width: 264, height: 264))
            iv.image = Self.qr(SyncCore.qrText(p), size: 264); iv.imageScaling = .scaleNone
            alert.accessoryView = iv
            alert.addButton(withTitle: "Done")
            alert.addButton(withTitle: "Stop syncing…")
        } catch {
            alert.messageText = "Phone sync is not set up"
            alert.informativeText = error.localizedDescription
            alert.addButton(withTitle: "OK")
            alert.runModal(); return
        }
        if alert.runModal() == .alertSecondButtonReturn {
            let c = NSAlert()
            c.messageText = "Stop syncing with the iPhone?"
            c.informativeText = "The key is deleted on this Mac. The phone keeps its last copy but gets no more updates, and its changes are not read. The Cloudflare backup can no longer be opened from this Mac. Pair again to start over."
            c.addButton(withTitle: "Stop syncing"); c.addButton(withTitle: "Cancel")
            if c.runModal() == .alertFirstButtonReturn { unpair() }
        }
    }

    static func qr(_ text: String, size: CGFloat) -> NSImage? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(text.utf8), forKey: "inputMessage"); f.setValue("M", forKey: "inputCorrectionLevel")
        guard let out = f.outputImage else { return nil }
        let scale = max(1, floor(size / out.extent.width))
        let img = out.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let rep = NSCIImageRep(ciImage: img)
        let n = NSImage(size: rep.size); n.addRepresentation(rep)
        return n
    }
}
