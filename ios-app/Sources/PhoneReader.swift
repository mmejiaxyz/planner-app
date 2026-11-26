// Planner for iPhone: PDFs from the Mac, the reader with marks, and the DeepSeek reading partner (since 21 Nov 2026).
//
// The user's request: "fully capable of reading pdfs, underlining and explaining concepts with AI, must be sync". He chose:
//   - PDFs come from the Mac's course folders (the same list as Courses › Files). The Mac sends every one on its own while
//     it is open, so they can be read with the Mac off ("i need it to work without the mac on"); asking for one (a
//     "fileReq" change) puts it first. The Mac uploads it encrypted in parts (SyncCore kind "file") and names it in the snapshot; the phone
//     downloads it (two at a time, asked-for ones first), checks its SHA-256, keeps a copy, deletes the parts on the
//     server and tells the Mac ("fileGot").
//   - Underlines, highlights and notes made here are saved into the phone's copy right away and sent as "marks" changes,
//     which the Mac writes into the real file (Reader.applyPhoneMarks). Marks made on the Mac reach the phone as a newer
//     copy of the file. The snapshot's "marked" says which file dates came from the phone's own marks, so those are not
//     downloaded again.
//   - The reading partner on the phone is DeepSeek, called straight from the phone with his own API key (kept in this
//     phone's Keychain, never synced, never sent anywhere else). It is the only AI on the phone ("Ai on phone only answers
//     to pdf, all the other features with AI must need a computer"); the Mac stays on Claude. The page redacts what it
//     sends (reader.js), as on the Mac.
// Request budget (Worker): one change per mark, one per file asked for, the file's parts once (90 KB each, a 20 MB PDF is
// about 230), one delete. While a file is being waited for, the snapshot is checked every 10 s, for at most 10 minutes.

import UIKit
import WebKit
import PDFKit
import Vision
import CryptoKit

private func hex(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }

// MARK: - PDFs from the Mac

@MainActor
final class PhoneFiles {
    static let shared = PhoneFiles()
    static let askWait: Double = 600                       // stop checking fast after 10 minutes without an answer

    private let dir: URL = {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Planner/files", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return u
    }()
    private var indexURL: URL { dir.appendingPathComponent("index.json") }
    private var index: [String: [String: Any]] = [:]       // "cid/file" -> {m (the Mac's file date of this copy), size, id}
    private var asked: [String: Double] = [:]              // "cid/file" -> when it was asked for
    private var status: [String: [String: Any]] = [:]      // "cid/file" -> {state: asking|downloading|error, progress, error}
    private var busy = Set<String>()
    private var rindex: [String: String] = [:]             // "cid/file" -> sha256 of the reading version kept here
    private var rbusy = false
    // Marks made in the text without a copy of the PDF (25 Nov 2026: the Mac sends the text, the PDF only when there is
    // none). "add": marks made here, "gone": marks removed here, both in the reading version's page space, kept until a
    // reading version from the Mac shows them applied (the Mac writes them into the real PDF and sends the text again).
    private var lmarks: [String: [String: [[String: Any]]]] = [:]
    private var bmarks: [String: [[String: Any]]] = [:]    // "cid/file" -> the marks in the reading version kept here (cache)

    init() {
        if let d = try? Data(contentsOf: indexURL), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            index = o["files"] as? [String: [String: Any]] ?? [:]; asked = o["asked"] as? [String: Double] ?? [:]
            rindex = o["reading"] as? [String: String] ?? [:]
            lmarks = o["lmarks"] as? [String: [String: [[String: Any]]]] ?? [:]
        }
    }
    private func save() {
        if let d = try? JSONSerialization.data(withJSONObject: ["files": index, "asked": asked, "reading": rindex, "lmarks": lmarks]) { try? d.write(to: indexURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
    /// The reading version of a PDF (the Mac's Docling text for the book reader), when it has arrived.
    func rurl(_ k: String) -> URL { dir.appendingPathComponent(String(hex(Data(k.utf8)).prefix(24)) + ".reading.json") }
    func reading(_ k: String) -> String? { rindex[k] != nil ? try? String(contentsOf: rurl(k), encoding: .utf8) : nil }
    /// Reading versions the Mac sent (snapshot "readSends"), one at a time: small, so no progress is shown.
    private func checkReading(_ snap: [String: Any]) {
        guard !rbusy else { return }
        for e in snap["readSends"] as? [[String: Any]] ?? [] {
            let k = Self.key(e["cid"] as? String ?? "", e["file"] as? String ?? "")
            guard let sha = e["sha256"] as? String, rindex[k] != sha else { continue }
            rbusy = true
            Task { await downloadReading(e, k, sha); rbusy = false; check() }
            return
        }
    }
    private func downloadReading(_ e: [String: Any], _ k: String, _ sha: String) async {
        guard let key = Sync.shared.key, let server = Sync.shared.server, let id = e["id"] as? String, let parts = e["parts"] as? Int, parts > 0, parts <= 400 else { return }
        do {
            var packed = Data()
            for n in 0..<parts {
                guard let d = try await server.filePart(id, n) else { return }
                packed.append(try SyncCore.openData(d, kind: .file, context: "\(id):\(n)", key: key))
            }
            let json = try (packed as NSData).decompressed(using: .zlib) as Data
            guard hex(json) == sha else { return }
            try json.write(to: rurl(k), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            rindex[k] = sha; bmarks[k] = nil; prune(k); save()
            try? await server.deleteFile(id, parts: parts)
            Sync.shared.event(["type": "readerReading", "key": k, "ready": true])
            await Sync.shared.push(["kind": "readGot", "cid": e["cid"] ?? "", "file": e["file"] ?? "", "sha256": sha, "rid": id])
        } catch {}
    }

    /// The marks in the reading version kept here; nil when it came from an older Mac build without them.
    func bundleMarks(_ k: String) -> [[String: Any]]? {
        if let m = bmarks[k] { return m }
        guard rindex[k] != nil, let d = try? Data(contentsOf: rurl(k)), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let m = o["marks"] as? [[String: Any]] else { return nil }
        bmarks[k] = m; return m
    }
    private static func rects(_ m: [String: Any]) -> [[Double]] { (m["rects"] as? [[Any]] ?? []).map { $0.compactMap { ($0 as? NSNumber)?.doubleValue } }.filter { $0.count == 4 } }
    private static func overlaps(_ a: [[Double]], _ b: [[Double]]) -> Bool {
        a.contains { r in b.contains { q in min(r[2], q[2]) - max(r[0], q[0]) > 1 && min(r[3], q[3]) - max(r[1], q[1]) > 1 } }
    }
    /// Whether a removed mark is the one in the list: by name, else (Preview's marks have none) by page and place.
    static func same(_ m: [String: Any], _ g: [String: Any]) -> Bool {
        let n = g["name"] as? String ?? ""
        if !n.isEmpty { return (m["name"] as? String ?? "") == n }
        return (m["page"] as? Int) == (g["page"] as? Int) && (m["kind"] as? String) != "note" && overlaps(rects(m), rects(g))
    }
    /// Marks the newest reading version already shows (added) or no longer shows (removed) are the Mac's now.
    private func prune(_ k: String) {
        guard var l = lmarks[k], let b = bundleMarks(k) else { return }
        l["add"] = (l["add"] ?? []).filter { a in !b.contains { ($0["name"] as? String) == (a["name"] as? String) } }
        l["gone"] = (l["gone"] ?? []).filter { g in b.contains { Self.same($0, g) } }
        lmarks[k] = (l["add"] ?? []).isEmpty && (l["gone"] ?? []).isEmpty ? nil : l
    }
    /// Every mark for the text view: the reading version's, less those removed here, plus those made here.
    func textMarks(_ k: String) -> [[String: Any]] {
        let gone = lmarks[k]?["gone"] ?? []
        return (bundleMarks(k) ?? []).filter { m in !gone.contains { Self.same(m, $0) } } + (lmarks[k]?["add"] ?? [])
    }
    func addMark(_ k: String, _ m: [String: Any]) { lmarks[k, default: [:]]["add", default: []].append(m); save() }
    /// Removes a mark: one made here goes (true when it was only here), one from the Mac is remembered as removed.
    func dropMark(_ k: String, _ g: [String: Any]) -> Bool {
        if let i = lmarks[k]?["add"]?.firstIndex(where: { Self.same($0, g) }) {
            lmarks[k]?["add"]?.remove(at: i); prune(k); save(); return true
        }
        lmarks[k, default: [:]]["gone", default: []].append(g); save(); return false
    }

    static func key(_ cid: String, _ file: String) -> String { cid + "/" + file }
    func url(_ k: String) -> URL { dir.appendingPathComponent(String(hex(Data(k.utf8)).prefix(24)) + ".pdf") }
    func cached(_ k: String) -> Bool { index[k] != nil && FileManager.default.fileExists(atPath: url(k).path) }
    private var listing: [String: [[String: Any]]] { Sync.shared.snap?["files"] as? [String: [[String: Any]]] ?? [:] }
    private func macDate(_ k: String) -> Int? {
        guard let s = k.firstIndex(of: "/") else { return nil }
        let cid = String(k[..<s]), f = String(k[k.index(after: s)...])
        return listing[cid]?.first { ($0["f"] as? String) == f }?["m"] as? Int
    }
    /// The copy here is as new as the Mac's file (or the Mac no longer lists it).
    func current(_ k: String) -> Bool { guard let m = macDate(k) else { return true }; return (index[k]?["m"] as? Int ?? 0) >= m }
    var waiting: Bool { let now = Date().timeIntervalSince1970; return asked.values.contains { now - $0 < Self.askWait } }
    private func pendingMarks(_ k: String) -> Bool {
        Sync.shared.pending.contains { ($0["kind"] as? String) == "marks" && Self.key($0["cid"] as? String ?? "", $0["file"] as? String ?? "") == k }
    }

    /// What the page shows: every course's PDFs with whether a copy is here.
    func state() -> [String: Any] {
        var out: [String: Any] = [:]
        let now = Date().timeIntervalSince1970
        for (cid, list) in listing {
            out[cid] = list.map { e -> [String: Any] in
                let f = e["f"] as? String ?? "", k = Self.key(cid, f)
                var o: [String: Any] = ["f": f, "s": e["s"] ?? 0, "cached": cached(k), "current": cached(k) && current(k), "reading": rindex[k] != nil]
                if let st = status[k] { o.merge(st) { $1 } }
                else if let t = asked[k] { o["state"] = now - t < Self.askWait ? "asking" : "late" }
                return o
            }
        }
        return ["files": out]
    }

    func request(cid: String, file: String) async {
        let k = Self.key(cid, file)
        asked[k] = Date().timeIntervalSince1970; status[k] = ["state": "asking"]; save()
        let open = Sync.shared.pending.contains { ($0["kind"] as? String) == "fileReq" && Self.key($0["cid"] as? String ?? "", $0["file"] as? String ?? "") == k }
        if !open { await Sync.shared.push(["kind": "fileReq", "cid": cid, "file": file]) }
        changed(k)
    }

    private func changed(_ k: String, ready: Bool = false) {
        var ev: [String: Any] = ["type": "fileState", "key": k]
        if ready { ev["ready"] = true }
        if let st = status[k] { ev.merge(st) { $1 } }
        Sync.shared.event(ev)
    }

    /// After each sync: our own marks' file dates count as current; download what the Mac sent that is not here yet,
    /// asked-for files first, two at a time.
    func check() {
        guard let snap = Sync.shared.snap else { return }
        checkReading(snap)
        var dirty = false
        for (k, e) in snap["marked"] as? [String: [String: Int]] ?? [:] {
            guard index[k] != nil, !pendingMarks(k), let from = e["from"], let to = e["to"], (index[k]?["m"] as? Int) == from else { continue }
            index[k]?["m"] = to; dirty = true
        }
        if dirty { save() }
        let sends = (snap["fileSends"] as? [[String: Any]] ?? []).sorted { a, b in
            (asked[Self.key(a["cid"] as? String ?? "", a["file"] as? String ?? "")] != nil) && (asked[Self.key(b["cid"] as? String ?? "", b["file"] as? String ?? "")] == nil)
        }
        for e in sends {
            let k = Self.key(e["cid"] as? String ?? "", e["file"] as? String ?? "")
            if let err = e["error"] as? String {
                if asked[k] != nil { asked[k] = nil; status[k] = ["state": "error", "error": err]; save(); changed(k) }
                continue
            }
            guard let id = e["id"] as? String, let m = e["m"] as? Int, !busy.contains(k), index[k]?["id"] as? String != id else { continue }
            if cached(k) && (index[k]?["m"] as? Int ?? 0) >= m { continue }
            guard !pendingMarks(k), busy.count < 2 else { continue }
            busy.insert(k)
            Task { await download(e, k) }
        }
    }

    private func download(_ e: [String: Any], _ k: String) async {
        guard let key = Sync.shared.key, let server = Sync.shared.server, let id = e["id"] as? String, let parts = e["parts"] as? Int, parts > 0, parts <= 4000,
              let sha = e["sha256"] as? String, let m = e["m"] as? Int else { busy.remove(k); return }
        busy.insert(k); defer { busy.remove(k); check() }
        status[k] = ["state": "downloading", "progress": 0]; changed(k)
        let bg = UIApplication.shared.beginBackgroundTask(withName: "Get PDF", expirationHandler: nil)
        defer { UIApplication.shared.endBackgroundTask(bg) }
        do {
            var data = Data()
            for n in 0..<parts {
                guard let d = try await server.filePart(id, n) else { throw SyncCore.Failure(message: "The PDF is no longer on the sync server. Ask for it again.") }
                data.append(try SyncCore.openData(d, kind: .file, context: "\(id):\(n)", key: key))
                if n % 4 == 3 || n == parts - 1 { status[k] = ["state": "downloading", "progress": Double(n + 1) / Double(parts)]; changed(k) }
            }
            guard hex(data) == sha else { throw SyncCore.Failure(message: "The PDF did not arrive complete. Ask for it again.") }
            try data.write(to: url(k), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            index[k] = ["m": m, "size": data.count, "id": id]; asked[k] = nil; status[k] = nil; save()
            try? await server.deleteFile(id, parts: parts)
            changed(k, ready: true)
            await Sync.shared.push(["kind": "fileGot", "cid": e["cid"] ?? "", "file": e["file"] ?? "", "m": m, "fid": id])
        } catch {
            status[k] = ["state": "error", "error": (error as? URLError) != nil ? "Offline: try again when you are online" : error.localizedDescription]
            asked[k] = nil; save(); changed(k)
        }
    }

    /// The phone's copy changed by its own marks: still the version the Mac knows about (the Mac applies the same marks).
    func touched(_ k: String) { if index[k] != nil { index[k]?["marks"] = true; save() } }
}

// MARK: - Reader

@MainActor
final class PhoneReader: NSObject, UIGestureRecognizerDelegate {
    static let shared = PhoneReader()
    weak var host: UIView?
    weak var web: WKWebView?
    let view = MenuPDFView()
    private(set) var cid = "", file = ""
    private var url: URL?
    private var saveTimer: Timer?
    private var selTimer: Timer?
    private var noteSel: PDFSelection?
    private var notePage = 1
    private var hit: PDFAnnotation?

    static let lilac = UIColor(red: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 0.55)
    static let plum = UIColor(red: 0x75/255, green: 0x5A/255, blue: 0x9C/255, alpha: 1)

    override init() {
        super.init()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        view.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0x15/255, alpha: 1) : UIColor(red: 0xF1/255, green: 0xF0/255, blue: 0xEB/255, alpha: 1) }
        NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: view)
        NotificationCenter.default.addObserver(self, selector: #selector(selChanged), name: .PDFViewSelectionChanged, object: view)
        view.onPick = { [weak self] k in
            guard let self else { return }
            if k == "h" { _ = self.mark("highlight") } else { self.send(["type": "readerKey", "key": k]) }
        }
        // Explain · Define · Highlight in iOS's selection menu on the original page (the items show only where a view
        // answers their actions: this PDF view)
        UIMenuController.shared.menuItems = [UIMenuItem(title: "Explain", action: #selector(MenuPDFView.plannerExplain)),
                                             UIMenuItem(title: "Define", action: #selector(MenuPDFView.plannerDefine)),
                                             UIMenuItem(title: "Highlight", action: #selector(MenuPDFView.plannerHighlight))]
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.cancelsTouchesInView = false; tap.delegate = self
        view.addGestureRecognizer(tap)
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith o: UIGestureRecognizer) -> Bool { true }

    static func isMark(_ a: PDFAnnotation) -> Bool { ["Underline", "Highlight", "Text"].contains(a.type ?? "") }
    static func kind(_ a: PDFAnnotation) -> String { a.type == "Text" ? "note" : a.type == "Highlight" ? "highlight" : "underline" }
    private func send(_ ev: [String: Any]) { Sync.shared.event(ev) }
    private var k: String { PhoneFiles.key(cid, file) }

    /// rect: CSS pixels from the top left of the web view (the page's #reader-pdf box).
    func place(_ r: [String: Any]) {
        guard let host, let web else { return }
        let x = r["x"] as? Double ?? 0, y = r["y"] as? Double ?? 0, w = r["w"] as? Double ?? 0, h = r["h"] as? Double ?? 0
        view.frame = CGRect(x: web.frame.minX + x, y: web.frame.minY + y, width: max(w, 0), height: max(h, 0))
        if view.superview == nil { host.addSubview(view) }
    }

    func open(cid: String, file: String, rect: [String: Any], page: Int) throws -> [String: Any] {
        let key = PhoneFiles.key(cid, file)
        guard PhoneFiles.shared.cached(key) else { throw SyncCore.Failure(message: "This PDF is not on the phone yet") }
        flush()
        guard let doc = PDFDocument(url: PhoneFiles.shared.url(key)) else { throw SyncCore.Failure(message: "Could not open this PDF") }
        self.cid = cid; self.file = file; url = PhoneFiles.shared.url(key); hit = nil
        view.document = doc
        place(rect)
        if page > 1, let p = doc.page(at: min(page, doc.pageCount) - 1) { view.go(to: p) }
        let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
        return ["pages": doc.pageCount, "title": title, "page": current(), "current": PhoneFiles.shared.current(key)]
    }
    /// The book reader with only the reading version (the PDF is not on the phone): no PDF view, marks go through
    /// PhoneFiles' text marks.
    func openText(cid: String, file: String) -> [String: Any] {
        flush(); view.removeFromSuperview(); view.document = nil
        self.cid = cid; self.file = file; url = nil; hit = nil
        return ["ok": true, "marks": PhoneFiles.shared.bundleMarks(PhoneFiles.key(cid, file)) != nil]
    }
    /// Marks in the text go through the reading version when it carries the Mac's marks (always, once the Mac sent it).
    private var inText: Bool { PhoneFiles.shared.bundleMarks(k) != nil }
    func close() { flush(); view.removeFromSuperview(); view.document = nil; url = nil; cid = ""; file = ""; hit = nil; PlannerWeb.quiet = false }
    func hide() { view.clearSelection(); view.removeFromSuperview() }
    func current() -> Int { guard let d = view.document, let p = view.currentPage else { return 1 }; return d.index(for: p) + 1 }
    func go(_ n: Int) { guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1) else { return }; view.go(to: p) }
    @objc func pageChanged() { send(["type": "readerPage", "page": current()]) }
    @objc func selChanged() {
        selTimer?.invalidate()
        selTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.sendSel() } }
    }
    private func sendSel() {
        let s = view.currentSelection, t = (s?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pg = s?.pages.first.flatMap { view.document?.index(for: $0) }.map { $0 + 1 } ?? current()
        send(["type": "readerSel", "text": String(t.prefix(3000)), "page": pg])
    }
    /// A tap on a mark selects it (the page then offers Remove mark); a tap elsewhere lets it go.
    @objc func tapped(_ g: UITapGestureRecognizer) {
        let pt = g.location(in: view)
        guard let p = view.page(for: pt, nearest: false), let d = view.document else { return }
        if let a = p.annotation(at: view.convert(pt, to: p)), Self.isMark(a) {
            hit = a
            let t = a.contents?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            send(["type": "readerHit", "page": d.index(for: p) + 1, "kind": Self.kind(a), "text": String((t.isEmpty ? (p.selection(for: a.bounds)?.string ?? "") : t).prefix(300))])
        } else if hit != nil { hit = nil; send(["type": "readerHit"]) }
    }

    /// Text of each page (read off the main thread; a large book takes a moment).
    func pages() async -> [String: Any] {
        guard let u = url else { return ["pages": []] }
        let out: [String] = await Task.detached(priority: .userInitiated) {
            guard let d = PDFDocument(url: u) else { return [] }
            return (0..<d.pageCount).map { d.page(at: $0)?.string ?? "" }
        }.value
        return ["pages": out]
    }
    /// A scanned page has no text: read it on the phone (Vision, English, German, Spanish).
    func ocr(_ n: Int) async -> String {
        guard let u = url else { return "" }
        return await Task.detached(priority: .userInitiated) { () -> String in
            guard let d = PDFDocument(url: u), let p = d.page(at: n - 1) else { return "" }
            let b = p.bounds(for: .mediaBox), scale = min(3, 2200 / max(b.width, b.height, 1))
            guard let img = p.thumbnail(of: CGSize(width: b.width * scale, height: b.height * scale), for: .mediaBox).cgImage else { return "" }
            let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.recognitionLanguages = ["en-US", "de-DE", "es-ES"]; req.usesLanguageCorrection = true
            try? VNImageRequestHandler(cgImage: img).perform([req])
            return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }.value
    }

    // MARK: marks

    private func describe(_ a: PDFAnnotation, page: Int) -> [String: Any] {
        ["name": a.value(forAnnotationKey: .name) as? String ?? "", "kind": Self.kind(a), "page": page,
         "rect": [a.bounds.minX, a.bounds.minY, a.bounds.width, a.bounds.height].map { Double($0) }]
    }
    private func pushMarks(add: [[String: Any]] = [], remove: [[String: Any]] = []) {
        let op: [String: Any] = ["kind": "marks", "cid": cid, "file": file, "add": add, "remove": remove]
        PhoneFiles.shared.touched(k)
        Task { await Sync.shared.push(op) }
    }

    /// Underline or highlight the selection: into the phone's copy now, and to the Mac's file through a change.
    func mark(_ kind: String, quiet: Bool = false) -> [String: Any]? {
        guard let s = view.currentSelection, let d = view.document, !(s.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            if !quiet { send(["type": "readerNote", "text": "Select text in the PDF first: press and hold a word, then drag the handles."]) }
            return nil
        }
        let name = "planner-" + UUID().uuidString.prefix(12).lowercased()
        var rectsByPage: [Int: [[Double]]] = [:]
        for line in s.selectionsByLine() {
            for p in line.pages {
                let b = line.bounds(for: p); guard b.width > 0.5 else { continue }
                let a = PDFAnnotation(bounds: b, forType: kind == "highlight" ? .highlight : .underline, withProperties: nil)
                a.color = kind == "highlight" ? Self.lilac : Self.plum
                a.contents = line.string ?? ""; a.userName = "Planner"
                a.setValue(name, forAnnotationKey: .name)
                p.addAnnotation(a)
                rectsByPage[d.index(for: p) + 1, default: []].append([b.minX, b.minY, b.width, b.height].map { Double($0) })
            }
        }
        let text = String((s.string ?? "").prefix(1500))
        let pg = s.pages.first.map { d.index(for: $0) + 1 } ?? current()
        view.clearSelection()
        let add = rectsByPage.keys.sorted().map { ["name": name, "kind": kind, "page": $0, "rects": rectsByPage[$0]!, "text": text] as [String: Any] }
        if quiet { return ["add": add] }
        pushMarks(add: add); dirty()
        send(["type": "readerMark", "kind": kind, "text": text, "page": pg])
        return nil
    }

    func noteStart() -> [String: Any] {
        let s = view.currentSelection, t = (s?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        noteSel = t.isEmpty ? nil : s
        notePage = s?.pages.first.flatMap { view.document?.index(for: $0) }.map { $0 + 1 } ?? current()
        return ["page": notePage, "quote": String(t.prefix(600))]
    }
    func noteAdd(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let d = view.document, let p = d.page(at: notePage - 1) ?? view.currentPage else { return }
        var add: [[String: Any]] = []
        var at: CGRect, onPage = p
        if let s = noteSel, let first = s.selectionsByLine().first, let fp = first.pages.first {
            view.setCurrentSelection(s, animate: false)
            add += (mark("highlight", quiet: true)?["add"] as? [[String: Any]]) ?? []
            let b = first.bounds(for: fp); at = CGRect(x: max(b.minX - 22, 4), y: b.maxY - 18, width: 18, height: 18); onPage = fp
        } else {
            let box = p.bounds(for: .cropBox)
            at = CGRect(x: box.minX + 12, y: box.maxY - 40, width: 18, height: 18)
        }
        let a = PDFAnnotation(bounds: at, forType: .text, withProperties: nil)
        a.contents = t; a.userName = "Planner"; a.iconType = .note; a.color = UIColor(red: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 1)
        let name = "planner-" + UUID().uuidString.prefix(12).lowercased()
        a.setValue(name, forAnnotationKey: .name)
        onPage.addAnnotation(a)
        add.append(["name": name, "kind": "note", "page": d.index(for: onPage) + 1, "rects": [[at.minX, at.minY, at.width, at.height].map { Double($0) }], "text": t])
        noteSel = nil
        pushMarks(add: add); dirty()
        send(["type": "readerMark", "kind": "note", "text": String(t.prefix(1500)), "page": notePage])
    }

    /// Removes the mark he tapped (every line of it: lines of one mark share its name).
    func unmark() {
        guard let a = hit, let p = a.page, let d = view.document else { return }
        let n = d.index(for: p) + 1, name = a.value(forAnnotationKey: .name) as? String ?? ""
        var remove: [[String: Any]] = []
        for i in 0..<d.pageCount {
            guard let pg = d.page(at: i) else { continue }
            for x in pg.annotations where Self.isMark(x) && (x === a || (!name.isEmpty && (x.value(forAnnotationKey: .name) as? String) == name)) {
                remove.append(describe(x, page: i + 1)); pg.removeAnnotation(x)
            }
        }
        hit = nil
        pushMarks(remove: remove); dirty()
        send(["type": "readerMark", "removed": true, "page": n])
    }

    /// A highlight (or a note) made in the reading version: rects [x0, y0, x1, y1] from the page's top left in the reading
    /// version's page space (size). Snapped to the characters on pages with a text layer; saved here and sent to the Mac
    /// as a "marks" change like every other mark. The same as Reader.markRects on the Mac.
    func markRects(page n: Int, rects: [[Double]], size: [Double], text: String, kind: String) -> [String: Any] {
        if inText {
            let rs = rects.filter { $0.count == 4 && $0[2] - $0[0] > 0.5 && $0[3] - $0[1] > 0.5 }
            guard !rs.isEmpty, size.count == 2, size[0] > 0, size[1] > 0 else { return ["error": "Nothing to mark"] }
            let name = "planner-" + UUID().uuidString.prefix(12).lowercased(), t = String(text.prefix(1500))
            let m: [String: Any] = ["name": name, "kind": kind == "note" ? "note" : "highlight", "page": n, "rects": rs, "text": t]   // a note covers the passage too (Reader.textNote on the Mac)
            PhoneFiles.shared.addMark(k, m)
            var op = m; op["size"] = size
            pushMarks(add: [op])
            return ["name": name, "page": n, "rects": rs]
        }
        guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1), size.count == 2, size[0] > 0, size[1] > 0 else { return ["error": "No such page"] }
        let crop = p.bounds(for: .cropBox), sx = crop.width / size[0], sy = crop.height / size[1]
        let hasText = !(p.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var out: [CGRect] = []
        for r in rects where r.count == 4 {
            let box = CGRect(x: crop.minX + r[0] * sx, y: crop.maxY - r[3] * sy, width: (r[2] - r[0]) * sx, height: (r[3] - r[1]) * sy)
            guard box.width > 0.5, box.height > 0.5 else { continue }
            if hasText {
                let i0 = p.characterIndex(at: CGPoint(x: box.minX + 1, y: box.midY)), i1 = p.characterIndex(at: CGPoint(x: box.maxX - 1, y: box.midY))
                if i0 >= 0, i1 >= i0, let sel = p.selection(for: NSRange(location: i0, length: i1 - i0 + 1)) {
                    let lines = sel.selectionsByLine().map { $0.bounds(for: p) }.filter { $0.width > 0.5 && abs($0.midY - box.midY) < box.height }
                    if !lines.isEmpty { out += lines; continue }
                }
            }
            out.append(box)
        }
        guard !out.isEmpty else { return ["error": "Nothing to mark"] }
        let name = "planner-" + UUID().uuidString.prefix(12).lowercased()
        let t = String(text.prefix(1500))
        if kind == "note" {
            let b = out[0], at = CGRect(x: max(b.minX - 22, crop.minX + 2), y: b.maxY - 18, width: 18, height: 18)
            let a = PDFAnnotation(bounds: at, forType: .text, withProperties: nil)
            a.contents = t; a.userName = "Planner"; a.iconType = .note; a.color = UIColor(red: 0xCC/255, green: 0xB6/255, blue: 0xEB/255, alpha: 1)
            a.setValue(name, forAnnotationKey: .name); p.addAnnotation(a)
            pushMarks(add: [["name": name, "kind": "note", "page": n, "rects": [[at.minX, at.minY, at.width, at.height].map { Double($0) }], "text": t]])
        } else {
            for b in out {
                let a = PDFAnnotation(bounds: b, forType: .highlight, withProperties: nil)
                a.color = Self.lilac; a.contents = t; a.userName = "Planner"
                a.setValue(name, forAnnotationKey: .name); p.addAnnotation(a)
            }
            pushMarks(add: [["name": name, "kind": "highlight", "page": n, "rects": out.map { [$0.minX, $0.minY, $0.width, $0.height].map { Double($0) } }, "text": t]])
        }
        dirty()
        let back = out.map { [($0.minX - crop.minX) / sx, (crop.maxY - $0.maxY) / sy, ($0.maxX - crop.minX) / sx, (crop.maxY - $0.minY) / sy].map { Double($0) } }
        return ["name": name, "page": n, "rects": back]
    }
    /// Removes a mark made in the reading version by its name, or an older one at those rects.
    func unmarkName(page n: Int, name: String, rects: [[Double]], size: [Double]) -> [String: Any] {
        if inText {
            let g: [String: Any] = ["name": name, "page": n, "rects": rects]
            let hit = PhoneFiles.shared.textMarks(k).first { ($0["kind"] as? String) != "note" && PhoneFiles.same($0, g) }
            guard let hit else { return ["removed": 0] }
            _ = PhoneFiles.shared.dropMark(k, g)
            // the Mac removes it from the real PDF by name, or (Preview's marks) by place in the reading version
            var op: [String: Any] = ["name": name, "kind": hit["kind"] ?? "highlight", "page": n]
            if name.isEmpty { op["rects"] = rects; op["size"] = size }
            pushMarks(remove: [op])
            return ["removed": 1]
        }
        guard let d = view.document, n >= 1, n <= d.pageCount, let p = d.page(at: n - 1) else { return ["removed": 0] }
        let crop = p.bounds(for: .cropBox), sx = size.count == 2 && size[0] > 0 ? crop.width / size[0] : 1, sy = size.count == 2 && size[1] > 0 ? crop.height / size[1] : 1
        let boxes = rects.filter { $0.count == 4 }.map { CGRect(x: crop.minX + $0[0] * sx, y: crop.maxY - $0[3] * sy, width: ($0[2] - $0[0]) * sx, height: ($0[3] - $0[1]) * sy) }
        var remove: [[String: Any]] = []
        for a in p.annotations where Self.isMark(a) && a.type != "Text" {
            let an = a.value(forAnnotationKey: .name) as? String ?? ""
            let hit = (!name.isEmpty && an == name) || (name.isEmpty && boxes.contains { $0.insetBy(dx: -2, dy: -2).intersects(a.bounds) && abs($0.midY - a.bounds.midY) < max($0.height, 4) })
            if hit { remove.append(describe(a, page: n)); p.removeAnnotation(a) }
        }
        if !remove.isEmpty { pushMarks(remove: remove); dirty() }
        return ["removed": remove.count]
    }
    /// Every highlight and underline with its line rects in the reading version's page space, for the text view.
    func markList(sizes: [[Double]]) -> [[String: Any]] {
        if inText { return PhoneFiles.shared.textMarks(k).filter { ($0["kind"] as? String) != "note" } }
        guard let d = view.document else { return [] }
        var out: [[String: Any]] = []
        for i in 0..<d.pageCount {
            guard let p = d.page(at: i), i < sizes.count, sizes[i].count == 2, sizes[i][0] > 0 else { continue }
            let crop = p.bounds(for: .cropBox), sx = crop.width / sizes[i][0], sy = crop.height / sizes[i][1]
            for a in p.annotations where Self.isMark(a) && a.type != "Text" {
                var boxes: [CGRect] = []
                if let q = a.quadrilateralPoints, q.count >= 4, q.count % 4 == 0 {
                    for j in stride(from: 0, to: q.count, by: 4) {
                        let pts = q[j..<j + 4].map { $0.cgPointValue }
                        let xs = pts.map { $0.x + a.bounds.minX }, ys = pts.map { $0.y + a.bounds.minY }
                        boxes.append(CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!))
                    }
                    if boxes.contains(where: { !a.bounds.insetBy(dx: -2, dy: -2).contains($0) }) { boxes = [a.bounds] }
                } else { boxes = [a.bounds] }
                let rects = boxes.map { [($0.minX - crop.minX) / sx, (crop.maxY - $0.maxY) / sy, ($0.maxX - crop.minX) / sx, (crop.maxY - $0.minY) / sy].map { Double($0) } }
                out.append(["page": i + 1, "kind": Self.kind(a), "name": a.value(forAnnotationKey: .name) as? String ?? "", "rects": rects])
            }
        }
        return out
    }

    /// Every underline, highlight and note in the PDF, lines of one mark joined (as on the Mac).
    func marks() -> [[String: Any]] {
        if inText {   // for Wrap up and the reading partner: page, kind, text
            return PhoneFiles.shared.textMarks(k).compactMap { m in
                let t = (m["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : ["page": m["page"] ?? 1, "kind": m["kind"] ?? "highlight", "text": t]
            }
        }
        guard let d = view.document else { return [] }
        var out: [[String: Any]] = []
        for i in 0..<d.pageCount {
            guard let p = d.page(at: i) else { continue }
            var last: (String, CGFloat)? = nil
            for a in p.annotations where Self.isMark(a) {
                if a.type == "Text" {
                    let t = (a.contents ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty { out.append(["page": i + 1, "kind": "note", "text": t]) }
                    last = nil; continue
                }
                let kind = Self.kind(a)
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

    private func dirty() {
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
    }
    /// The phone's copy, written to a temporary file and swapped in.
    func flush() {
        guard saveTimer != nil else { return }
        saveTimer?.invalidate(); saveTimer = nil
        guard let u = url, let d = view.document else { return }
        let tmp = u.deletingLastPathComponent().appendingPathComponent(".tmp-" + u.lastPathComponent)
        guard d.write(to: tmp) else { send(["type": "readerNote", "text": "Could not save the marks on the phone."]); return }
        do { _ = try FileManager.default.replaceItemAt(u, withItemAt: tmp) } catch { try? FileManager.default.removeItem(at: tmp) }
    }
}

/// The original page's PDF view: its selection menu gets Explain · Define · Highlight.
final class MenuPDFView: PDFView {
    var onPick: ((String) -> Void)?
    @objc func plannerExplain() { onPick?("e") }
    @objc func plannerDefine() { onPick?("d") }
    @objc func plannerHighlight() { onPick?("h") }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if [#selector(plannerExplain), #selector(plannerDefine), #selector(plannerHighlight)].contains(action) {
            return !(currentSelection?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return super.canPerformAction(action, withSender: sender)
    }
}

// MARK: - DeepSeek (the reading partner on the phone)

@MainActor
enum DeepSeek {
    static let endpoint = URL(string: "https://api.deepseek.com/chat/completions")!
    static var key: String? { SyncCore.keychainGet("deepseek").flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 } }
    static func setKey(_ k: String) throws {
        let t = k.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { SyncCore.keychainDelete("deepseek"); return }
        guard t.count < 300, !t.contains(" ") else { throw SyncCore.Failure(message: "That does not look like a DeepSeek API key") }
        try SyncCore.keychainSet("deepseek", Data(t.utf8))
    }
    private static var running: [String: Task<[String: Any], Error>] = [:]

    /// One answer, streamed to the page as helpChunk events (the same events the Mac's reader gets from Claude).
    /// model: "chat" (deepseek-chat, the default) or "think" (deepseek-reasoner, slower, for hard passages).
    static func ask(messages: [[String: Any]], model: String, sid: String) async throws -> [String: Any] {
        guard let key else { throw SyncCore.Failure(message: "Add your DeepSeek API key first (in the reader, under the chat).") }
        let t = Task { () -> [String: Any] in
            var r = URLRequest(url: endpoint)
            r.httpMethod = "POST"; r.timeoutInterval = model == "think" ? 300 : 120
            r.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: [
                "model": model == "think" ? "deepseek-reasoner" : "deepseek-chat", "messages": messages, "stream": true,
                "stream_options": ["include_usage": true], "max_tokens": model == "think" ? 6000 : 1800] as [String: Any])
            let (bytes, resp) = try await URLSession.shared.bytes(for: r)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code != 200 {
                var body = ""; for try await l in bytes.lines { body += l; if body.count > 1500 { break } }
                let msg = ((try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]).flatMap { ($0["error"] as? [String: Any])?["message"] as? String } ?? ""
                switch code {
                case 401: throw SyncCore.Failure(message: "DeepSeek did not accept the API key. Check it and add it again.")
                case 402: throw SyncCore.Failure(message: "Your DeepSeek balance is empty. Top it up at platform.deepseek.com.")
                case 429: throw SyncCore.Failure(message: "DeepSeek is busy right now. Try again in a moment.")
                default: throw SyncCore.Failure(message: "DeepSeek error \(code)" + (msg.isEmpty ? "" : ": " + msg))
                }
            }
            var text = "", buf = "", usage: [String: Any] = [:], last = Date()
            let emit = { (s: String) in Sync.shared.event(["type": "helpChunk", "sid": sid, "text": s]) }
            for try await line in bytes.lines {
                try Task.checkCancellation()
                guard line.hasPrefix("data:") else { continue }
                let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if payload == "[DONE]" { break }
                guard let o = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { continue }
                if let u = o["usage"] as? [String: Any] { usage = u }
                if let d = ((o["choices"] as? [[String: Any]])?.first?["delta"]) as? [String: Any] {
                    if let c = d["content"] as? String, !c.isEmpty { text += c; buf += c }
                    else if text.isEmpty, d["reasoning_content"] is String, buf.isEmpty, Date().timeIntervalSince(last) > 1 { emit("\u{1}Think"); last = Date() }
                }
                if !buf.isEmpty && Date().timeIntervalSince(last) > 0.08 { emit(buf); buf = ""; last = Date() }
            }
            if !buf.isEmpty { emit(buf) }
            return ["text": text, "tokens": usage["total_tokens"] as? Int ?? 0, "cached": usage["prompt_cache_hit_tokens"] as? Int ?? 0]
        }
        running[sid] = t
        defer { running[sid] = nil }
        do { return try await t.value }
        catch is CancellationError { return ["text": "", "stopped": "cancel"] }
        catch let e as URLError where e.code == .cancelled { return ["text": "", "stopped": "cancel"] }
        catch let e as URLError { throw SyncCore.Failure(message: e.code == .notConnectedToInternet ? "Offline: the reading partner needs the internet." : e.localizedDescription) }
    }
    static func stop(_ sid: String) { running[sid]?.cancel() }
}
