import Foundation

/// Joining the two recordings of a meeting: your microphone ("you") and the computer's own audio ("them").
/// Pure functions, so the rules can be checked on their own.
enum Tracks {
    /// The words of a line, lowercase, for comparing two lines. "There's an audio, right?" -> [there, an, audio, right]
    static func words(_ s: String) -> [String] {
        s.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init).filter { $0.count > 1 }
    }

    /// How much two lines say the same thing, 0…1 (shared words over all words).
    static func overlap(_ a: [String], _ b: [String]) -> Double {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        let sa = Set(a), sb = Set(b)
        return Double(sa.intersection(sb).count) / Double(sa.union(sb).count)
    }

    /// Merge the microphone lines and the meeting lines in time order. The mic also hears the call through the
    /// speakers: a mic line that repeats a meeting line within `window` seconds is that echo, not you, and is dropped.
    /// Short backchannels ("Yeah.") are kept: at least two words must match, so a real "yes" is never mistaken for echo.
    static func merge(you: [[String: Any]], them: [[String: Any]], window: Double = 4) -> [[String: Any]] {
        let themT = them.map { ($0["t"] as? Double) ?? 0 }
        let themW = them.map { words($0["text"] as? String ?? "") }
        var out: [[String: Any]] = []
        var lo = 0
        for var seg in you {
            let t = (seg["t"] as? Double) ?? 0
            while lo < them.count && themT[lo] < t - window { lo += 1 }
            let w = words(seg["text"] as? String ?? "")
            var echo = false
            var i = lo
            while i < them.count && themT[i] <= t + window {
                if w.count >= 2 && overlap(w, themW[i]) >= 0.6 { echo = true; break }
                i += 1
            }
            if !echo {
                if !them.isEmpty { seg["sp"] = "you" }   // in person there is one track: no label needed
                out.append(seg)
            }
        }
        out.append(contentsOf: them)
        return out.sorted { ((($0["t"] as? Double) ?? 0) < (($1["t"] as? Double) ?? 0)) }
    }

    /// Pad each speech region a little, join regions that are close, and keep them inside the recording.
    /// The padding keeps the first and last word of a line from being cut by the gate.
    static func gateRegions(_ regions: [(Double, Double)], seconds: Double, pad: Double = 0.15, gap: Double = 0.25) -> [(Double, Double)] {
        var out: [(Double, Double)] = []
        let sorted = regions.map { (max(0, $0.0 - pad), min(seconds, $0.1 + pad)) }.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        for r in sorted {
            if let last = out.last, r.0 <= last.1 + gap {
                var merged = out.removeLast()
                merged.1 = max(merged.1, r.1)
                out.append(merged)
            } else {
                out.append(r)
            }
        }
        return out
    }

    /// A control track for the listening mix: 1 while you speak, 0 between your lines, with a short ramp so the
    /// gate does not click. Written in blocks at a low rate (the gate is a slow signal), so a long meeting does not
    /// need its samples in memory. Used with ffmpeg's amultiply: the mic is multiplied by this before the mix.
    static func writeGate(to url: URL, seconds: Double, regions: [(Double, Double)], rate: Int = 1000, ramp: Double = 0.015) throws {
        let total = max(0, Int((seconds * Double(rate)).rounded()))
        let rampFrames = max(1, Int(ramp * Double(rate)))
        var header = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; header.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; header.append(Data(bytes: &x, count: 2)) }
        header.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + total * 2)); header.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        header.append("data".data(using: .ascii)!); u32(UInt32(total * 2))
        try? FileManager.default.removeItem(at: url)
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw NSError(domain: "tracks", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not write the gate"])
        }
        let fh = try FileHandle(forWritingTo: url)
        defer { try? fh.close() }
        try fh.write(contentsOf: header)
        var buf = [Int16](); buf.reserveCapacity(4096)
        func flush() throws {
            guard !buf.isEmpty else { return }
            let d = buf.withUnsafeBytes { Data($0) }
            try fh.write(contentsOf: d)
            buf.removeAll(keepingCapacity: true)
        }
        func emit(_ v: Int16, _ count: Int) throws {
            var left = count
            while left > 0 {
                if buf.count >= 4096 { try flush() }
                let n = min(left, 4096 - buf.count)
                buf.append(contentsOf: repeatElement(v, count: n))
                left -= n
            }
        }
        var cursor = 0
        for r in regions {
            let s = max(cursor, min(total, Int((r.0 * Double(rate)).rounded())))
            let e = max(s, min(total, Int((r.1 * Double(rate)).rounded())))
            guard e > s else { continue }
            if s > cursor { try emit(0, s - cursor) }
            let len = e - s
            let rampLen = min(rampFrames, len / 2)
            if rampLen > 0 {
                for i in 0..<rampLen { buf.append(Int16(Double(i) / Double(rampLen) * 32767)) }
                if buf.count >= 4096 { try flush() }
            }
            if len > rampLen * 2 { try emit(32767, len - rampLen * 2) }
            if rampLen > 0 {
                for i in 0..<rampLen { buf.append(Int16(Double(rampLen - 1 - i) / Double(rampLen) * 32767)) }
                if buf.count >= 4096 { try flush() }
            }
            cursor = e
        }
        if cursor < total { try emit(0, total - cursor) }
        try flush()
    }
}
