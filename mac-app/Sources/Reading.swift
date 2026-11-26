import Foundation

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
                bridge?.event(["type": "readerReading", "path": file, "ready": ready(file)])
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
