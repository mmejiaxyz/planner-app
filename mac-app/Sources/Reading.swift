import Foundation
import AppKit
import PDFKit

/// Reading versions of PDFs for the book-style reader (reader redesign, 25 Nov 2026).
/// The text is made by `reading/convert.py` with Docling (MIT, open source; installed with `uv tool install "docling[ocrmac]"`),
/// ahead of time for every course PDF the page names (`readingAhead`), the PDF he opens first (`readingGet`).
/// One converter process at a time, at utility priority on half the cores; it loads its models once for a run of files
/// and quits when the queue is empty. Stored in Application Support/Planner/reading: `<key>.json` (the reading version)
/// and `<key>.meta.json` ({path, s, m, v}: the file's size and date it was made from). Marks the app writes into a PDF change
/// its size and date but not its text, so `carry` moves the stamp along (as the OCR cache is carried over).
@MainActor
final class Reading {
    static let shared = Reading()
    static let version = 1
    weak var bridge: Bridge?
    /// a reading version was made (true) or could not be (false): the phone sync sends it at once when the phone asked
    var onDone: ((String, Bool) -> Void)?
    let dir: URL = {
        let u = Paths.support.appendingPathComponent("reading", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private var queue: [String] = []
    private var working: (path: String, stamp: [String: Int], at: Date)?
    private var proc: Process?
    private var input: FileHandle?
    private var buffer = ""
    private var failed: [String: String] = [:]       // "path@mtime" -> error; not tried again this run of the app
    private var timer: Timer?

    static var python: String? {
        let p = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/uv/tools/docling/bin/python").path
        return FileManager.default.isExecutableFile(atPath: p) ? p : nil
    }
    static var script: String? {
        if let r = Bundle.main.resourcePath, FileManager.default.fileExists(atPath: r + "/reading/convert.py") { return r + "/reading/convert.py" }
        if let repo = Bundle.main.object(forInfoDictionaryKey: "PlannerRepo") as? String {
            let p = repo + "/winter-term-tracker/mac-app/reading/convert.py"
            if FileManager.default.fileExists(atPath: p) { return p }
        }
        return nil
    }

    func key(_ path: String) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for b in path.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return String(h, radix: 16)
    }
    func json(_ path: String) -> URL { dir.appendingPathComponent(key(path) + ".json") }
    func meta(_ path: String) -> URL { dir.appendingPathComponent(key(path) + ".meta.json") }
    static func stamp(_ path: String) -> [String: Int] {
        let at = try? FileManager.default.attributesOfItem(atPath: path)
        return ["s": (at?[.size] as? Int) ?? 0, "m": Int(((at?[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)]
    }
    private func readMeta(_ path: String) -> [String: Any]? {
        guard let d = try? Data(contentsOf: meta(path)) else { return nil }
        return try? JSONSerialization.jsonObject(with: d) as? [String: Any]
    }
    func ready(_ path: String) -> Bool {
        guard let m = readMeta(path), (m["v"] as? Int) == Reading.version, FileManager.default.fileExists(atPath: json(path).path) else { return false }
        let st = Reading.stamp(path)
        return (m["s"] as? Int) == st["s"] && (m["m"] as? Int) == st["m"]
    }
    func state(_ path: String) -> String {
        if ready(path) { return "ready" }
        if Reading.python == nil || Reading.script == nil { return "missing" }
        if working?.path == path { return "working" }
        if queue.contains(path) { return "queued" }
        if failed[path + "@" + String(Reading.stamp(path)["m"] ?? 0)] != nil { return "failed" }
        return "none"
    }

    /// The reading version of one PDF, or its state. A PDF without one goes to the front of the queue.
    func get(_ path: String) -> [String: Any] {
        if ready(path), let t = try? String(contentsOf: json(path), encoding: .utf8) { return ["ready": true, "data": t] }
        var st = state(path)
        if st == "none" || st == "queued" {
            queue.removeAll { $0 == path }
            queue.insert(path, at: 0)
            pump()
            st = state(path)
        }
        var out: [String: Any] = ["ready": false, "state": st]
        if st == "failed" { out["error"] = failed[path + "@" + String(Reading.stamp(path)["m"] ?? 0)] ?? "" }
        if st == "queued" { out["ahead"] = (queue.firstIndex(of: path) ?? 0) + (working == nil ? 0 : 1) }
        if let w = working, w.path == path { out["secs"] = Int(Date().timeIntervalSince(w.at)) }
        return out
    }

    /// Course PDFs to make ahead of time, most wanted first (the page sends files linked to open tasks first).
    func ahead(_ paths: [String]) -> [String: Any] {
        figuresAll()
        guard Reading.python != nil, Reading.script != nil else { return ["state": "missing"] }
        var added = 0
        for p in paths where p.lowercased().hasSuffix(".pdf") && Help.inDocs(p) != nil && FileManager.default.fileExists(atPath: p) {
            if ready(p) || queue.contains(p) || working?.path == p { continue }
            if failed[p + "@" + String(Reading.stamp(p)["m"] ?? 0)] != nil { continue }
            queue.append(p); added += 1
        }
        pump()
        return ["queued": queue.count, "added": added, "working": working?.path ?? ""]
    }

    /// Figures as pictures (27 Nov 2026, the user's report: "no images appear unless asked for the mac"). Each figure block of a reading
    /// version gets `img`, a JPEG of that part of the page (base64), cut from the page as it is shown (rotation included), at most
    /// 900 px wide. Small marks (under 2 % of the page or 60 pt a side: logos, rules) are left out. Done once per version (meta
    /// `figs`), in the background; the new file date sends the text to the phone again (PhoneSync mirrorReading).
    private var figsStarted = false
    private var figsBusy = Set<String>()
    nonisolated static let figQueue = DispatchQueue(label: "planner.reading.figs", qos: .utility)
    func figures(_ path: String) {
        guard ready(path), (readMeta(path)?["figs"] as? Int) != 1, !figsBusy.contains(path) else { return }
        figsBusy.insert(path)
        let j = json(path), m = meta(path)
        Reading.figQueue.async {
            Reading.addFigures(pdf: path, json: j, meta: m)
            DispatchQueue.main.async { Reading.shared.figsBusy.remove(path) }
        }
    }
    /// every stored reading version without its figures yet, one after another in the background
    func figuresAll() {
        guard !figsStarted else { return }; figsStarted = true
        let metas = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []).filter { $0.lastPathComponent.hasSuffix(".meta.json") }
        for u in metas {
            guard let d = try? Data(contentsOf: u), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let path = o["path"] as? String else { continue }
            if (o["figs"] as? Int) != 1, FileManager.default.fileExists(atPath: path) { figures(path) }
        }
    }
    nonisolated static func addFigures(pdf: String, json: URL, meta: URL) {
        guard let raw = try? Data(contentsOf: json), var obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              var blocks = obj["blocks"] as? [[String: Any]], let sizes = obj["sizes"] as? [[Double]],
              let doc = PDFDocument(url: URL(fileURLWithPath: pdf)) else { return }
        var thumbs: [Int: CGImage] = [:]
        var added = 0
        for i in blocks.indices where (blocks[i]["k"] as? String) == "fig" && blocks[i]["img"] == nil {
            guard let r = (blocks[i]["r"] as? [[String: Any]])?.first, let pg = r["pg"] as? Int, let ln = (r["ln"] as? [[Double]])?.first, ln.count >= 5,
                  pg >= 1, pg <= sizes.count, sizes[pg-1].count >= 2, let page = doc.page(at: pg - 1) else { continue }
            let W = sizes[pg-1][0], H = sizes[pg-1][1], l = ln[1], t = ln[2], rr = ln[3], b = ln[4]
            let w = rr - l, h = b - t
            guard W > 0, H > 0, w >= 60, h >= 60, w * h >= 0.02 * W * H else { continue }
            let scale = min(2.0, 900.0 / w)
            let full: CGImage
            if let c = thumbs[pg] { full = c }
            else {
                let img = page.thumbnail(of: NSSize(width: W * scale, height: H * scale), for: .cropBox)
                guard let c = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
                thumbs = [pg: c]; full = c
            }
            let fx = Double(full.width) / W, fy = Double(full.height) / H
            let rect = CGRect(x: l * fx, y: t * fy, width: w * fx, height: h * fy).integral.intersection(CGRect(x: 0, y: 0, width: full.width, height: full.height))
            guard rect.width > 8, rect.height > 8, let cut = full.cropping(to: rect) else { continue }
            let rep = NSBitmapImageRep(cgImage: cut)
            guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.62]) else { continue }
            blocks[i]["img"] = jpg.base64EncodedString(); added += 1
        }
        if added > 0 {
            obj["blocks"] = blocks
            guard let out = try? JSONSerialization.data(withJSONObject: obj) else { return }
            try? out.write(to: json, options: .atomic)
        }
        if let md = try? Data(contentsOf: meta), var m = try? JSONSerialization.jsonObject(with: md) as? [String: Any] {
            m["figs"] = 1
            if let d = try? JSONSerialization.data(withJSONObject: m) { try? d.write(to: meta, options: .atomic) }
        }
    }

    /// The app wrote marks into a PDF: same text, new size and date. Keeps a reading version that matched the file before.
    func carry(_ path: String, before: [String: Int]) {
        guard var m = readMeta(path), (m["s"] as? Int) == before["s"], (m["m"] as? Int) == before["m"] else { return }
        let st = Reading.stamp(path)
        m["s"] = st["s"]; m["m"] = st["m"]
        if let d = try? JSONSerialization.data(withJSONObject: m) { try? d.write(to: meta(path), options: .atomic) }
    }

    private func pump() {
        guard working == nil, !queue.isEmpty, let py = Reading.python, let script = Reading.script else {
            if working == nil && queue.isEmpty { stop() }
            return
        }
        if proc == nil { start(py, script) }
        guard let input else { return }
        let path = queue.removeFirst()
        guard FileManager.default.fileExists(atPath: path) else { pump(); return }
        working = (path, Reading.stamp(path), Date())
        input.write(Data((path + "\t" + json(path).path + "\n").utf8))
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1200, repeats: false) { [weak self] _ in   // 20 minutes for one file at most
            MainActor.assumeIsolated { guard let self, let w = self.working else { return }; self.fail(w.path, "Took too long"); self.proc?.terminate() }
        }
    }

    private func start(_ py: String, _ script: String) {
        let p = Process()
        p.qualityOfService = .utility
        p.executableURL = URL(fileURLWithPath: py)
        p.arguments = ["-I", script, "--jobs"]
        p.currentDirectoryURL = dir
        var env = ProcessInfo.processInfo.environment
        let half = String(max(1, ProcessInfo.processInfo.activeProcessorCount / 2))
        env["OMP_NUM_THREADS"] = half; env["MKL_NUM_THREADS"] = half
        env["TOKENIZERS_PARALLELISM"] = "false"; env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        p.environment = env
        let out = Pipe(), inp = Pipe()
        p.standardOutput = out; p.standardInput = inp
        p.standardError = FileHandle.nullDevice
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let s = String(decoding: h.availableData, as: UTF8.self)
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.received(s) } }
        }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.ended() } }
        }
        do { try p.run() } catch { queue.removeAll(); return }
        proc = p; input = inp.fileHandleForWriting
    }

    private func received(_ s: String) {
        buffer += s
        while let nl = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<nl]); buffer = String(buffer[buffer.index(after: nl)...])
            guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let file = o["file"] as? String,
                  let w = working, w.path == file else { continue }
            timer?.invalidate()
            if o["ok"] as? Bool == true {
                var m: [String: Any] = ["path": file, "v": Reading.version, "pages": o["pages"] ?? 0, "secs": o["secs"] ?? 0]
                m["s"] = w.stamp["s"]; m["m"] = w.stamp["m"]
                if let md = try? JSONSerialization.data(withJSONObject: m) { try? md.write(to: meta(file), options: .atomic) }
                working = nil
                figures(file)
                bridge?.event(["type": "readerReading", "path": file, "ready": ready(file)])
                onDone?(file, ready(file))
            } else {
                fail(file, o["error"] as? String ?? "Could not make the reading version")
            }
            pump()
        }
    }

    private func fail(_ path: String, _ error: String) {
        failed[path + "@" + String(Reading.stamp(path)["m"] ?? 0)] = error
        if working?.path == path { working = nil }
        bridge?.event(["type": "readerReading", "path": path, "ready": false, "error": error])
        onDone?(path, false)
    }

    private func ended() {
        if let w = working { fail(w.path, "The converter stopped") }
        proc = nil; input = nil; buffer = ""
        pump()
    }

    private func stop() {
        timer?.invalidate()
        try? input?.close(); input = nil   // the converter quits when its input ends
    }
}
