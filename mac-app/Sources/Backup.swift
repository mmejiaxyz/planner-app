import AppKit
import CryptoKit
import Foundation

/// The off-device copy of one person's data, on their own Cloudflare Worker (it replaced a private GitHub repo for it).
/// What goes: plan.json (the profile included), Brain notes and transcripts (never audio), and the text files of the
/// private data folder (profile, local.env, notes; `PlannerData` in Info.plist, set by build.sh). Never PDFs, project
/// files, images or recordings. Sealed with the sync key (kind `backup`, so it cannot pass for a snapshot), at most
/// 200 MB, uploaded in 4 MB chunks under a new generation that becomes current only when complete (worker.js), so a
/// broken upload never replaces a good backup. Sent when its contents changed, at most every 6 hours.
/// Only in builds with Cloudflare on (SyncCore.cloudAllowed) and once the key exists (paired, or a recovery code).
/// The recovery code is the pairing text (key, token, Worker): kept by the person, it brings everything back on a new Mac.
/// Restore never overwrites data: it writes into a new folder in Documents; only on a Mac with an empty plan it then
/// puts the plan and Brain notes in place and restarts Planner.
@MainActor
final class CloudBackup {
    let phone: PhoneSync
    static let minGap: TimeInterval = 6 * 3600
    static let maxFile = 16 << 20
    static let maxBackup = 200 << 20
    static let chunk = 4 << 20
    static let textExt: Set<String> = ["json", "md", "txt", "env"]
    private var stateURL: URL { Paths.support.appendingPathComponent("cloud-backup.json") }
    private(set) var lastAt: Date?
    private(set) var lastSize = 0
    private(set) var lastError = ""
    private var lastHash = ""
    private var busy = false

    init(phone: PhoneSync) {
        self.phone = phone
        if let d = try? Data(contentsOf: stateURL), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            lastHash = o["hash"] as? String ?? ""
            lastSize = o["size"] as? Int ?? 0
            if let t = o["at"] as? Double { lastAt = Date(timeIntervalSince1970: t) }
        }
    }

    private func saveState() {
        var o: [String: Any] = ["hash": lastHash, "size": lastSize]
        if let a = lastAt { o["at"] = a.timeIntervalSince1970 }
        if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: stateURL, options: .atomic) }
    }

    var available: Bool { SyncCore.cloudAllowed && phone.active }

    /// The private data folder this build was made with, if it is there.
    static var dataFolder: URL? {
        guard let p = Bundle.main.object(forInfoDictionaryKey: "PlannerData") as? String, !p.isEmpty else { return nil }
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: p, isDirectory: &isDir) && isDir.boolValue ? URL(fileURLWithPath: p, isDirectory: true) : nil
    }

    /// Path in the backup -> text. Text files only.
    func contents() -> [String: String] {
        var out: [String: String] = [:]
        let fm = FileManager.default
        func add(_ u: URL, as name: String) {
            guard let a = try? fm.attributesOfItem(atPath: u.path), (a[.size] as? Int ?? 0) <= Self.maxFile,
                  let s = try? String(contentsOf: u, encoding: .utf8) else { return }
            out[name] = s
        }
        add(Paths.plan, as: "plan.json")
        for u in (try? fm.contentsOfDirectory(at: BrainPaths.root, includingPropertiesForKeys: nil)) ?? [] where u.pathExtension == "json" {
            add(u, as: "brain/" + u.lastPathComponent)
        }
        if let dir = Self.dataFolder, let en = fm.enumerator(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
            for case let u as URL in en {
                let rel = String(u.path.dropFirst(dir.path.count + 1))
                if (try? u.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
                    if ["design", "archive"].contains(rel.split(separator: "/").first.map(String.init) ?? "") { en.skipDescendants() }
                    continue
                }
                if Self.textExt.contains(u.pathExtension.lowercased()) { add(u, as: "data/" + rel) }
            }
        }
        return out
    }

    /// Uploads when the contents changed and the last upload is older than minGap (or `force`).
    func runIfDue(force: Bool = false) async {
        guard available, !busy, let key = phone.key, let server = phone.server else { return }
        if !force, let a = lastAt, Date().timeIntervalSince(a) < Self.minGap { return }
        busy = true; defer { busy = false }
        let files = contents()
        guard let plain = try? JSONSerialization.data(withJSONObject: files, options: [.sortedKeys]) else { return }
        let hash = SHA256.hash(data: plain).map { String(format: "%02x", $0) }.joined()
        if hash == lastHash && !force { return }
        Activity.shared.start("backup", "send", "Backing up to Cloudflare")
        do {
            let sealed = try SyncCore.seal(["v": 1, "at": ISO8601DateFormatter().string(from: Date()), "files": files], kind: .backup, key: key)
            guard sealed.count <= Self.maxBackup else { throw SyncCore.Failure(message: "The backup is over 200 MB (\(sealed.count >> 20) MB); nothing was replaced.") }
            let gen = String(Int(Date().timeIntervalSince1970 * 1000)) + "-" + (0..<4).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
            let n = (sealed.count + Self.chunk - 1) / Self.chunk
            for i in 0..<n {
                let part = sealed.subdata(in: (i * Self.chunk)..<min(sealed.count, (i + 1) * Self.chunk))
                try await server.putBackupPart(gen: gen, n: i, part)
            }
            try await server.commitBackup(gen: gen, chunks: n, size: sealed.count)
            lastHash = hash; lastAt = Date(); lastSize = sealed.count; lastError = ""; saveState()
            Activity.shared.finish("backup", note: "\(max(1, sealed.count >> 20)) MB")
        } catch { lastError = error.localizedDescription; Activity.shared.finish("backup", ok: false, note: lastError) }
    }

    /// Downloads the backup and writes its files into a new folder in Documents. Live data is never touched.
    func restore() async throws -> URL {
        guard let key = phone.key, let server = phone.server else { throw SyncCore.Failure(message: "Phone sync is not set up on this Mac, so the backup cannot be opened.") }
        guard let info = try await server.backupInfo(), let n = info["chunks"] as? Int, let size = info["size"] as? Int, n > 0 else {
            throw SyncCore.Failure(message: "There is no backup on the sync server yet.")
        }
        var d = Data(capacity: size)
        for i in 0..<n { d.append(try await server.backupPart(i)) }
        guard d.count == size else { throw SyncCore.Failure(message: "The backup came back incomplete.") }
        guard let o = try SyncCore.open(d, kind: .backup, key: key) as? [String: Any], let files = o["files"] as? [String: String] else {
            throw SyncCore.Failure(message: "The backup could not be read.")
        }
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd HHmm"
        let root = Help.docs.appendingPathComponent("Planner backup \(df.string(from: Date()))", isDirectory: true)
        let fm = FileManager.default
        for (name, text) in files {
            let parts = name.split(separator: "/").map(String.init)
            guard !parts.isEmpty, !parts.contains(".."), !parts.contains(where: { $0.isEmpty || $0.hasPrefix(".") }) else { continue }
            let u = parts.reduce(root) { $0.appendingPathComponent($1) }
            try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: u, options: .atomic)
        }
        return root
    }

    /// On a Mac whose plan is empty: after Planner quits, the restored plan and Brain notes go into Application Support
    /// and Planner opens again (like update.sh). Never on a Mac that has a plan.
    private func putInPlaceAndRestart(_ folder: URL) {
        let sup = Paths.support.path, app = Bundle.main.bundlePath
        let script = "while pgrep -xq Planner; do sleep 0.5; done; "
            + "cp '\(folder.path)/plan.json' '\(sup)/plan.json'; mkdir -p '\(sup)/brain'; "
            + "[ -d '\(folder.path)/brain' ] && cp '\(folder.path)'/brain/*.json '\(sup)/brain/' 2>/dev/null; "
            + "open '\(app)'"
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/zsh"); p.arguments = ["-c", script]
        try? p.run()
        NSApp.terminate(nil)
    }

    // MARK: window

    func showWindow(_ window: NSWindow?) {
        let alert = NSAlert()
        alert.messageText = "Cloudflare backup"
        guard SyncCore.cloudAllowed else { alert.informativeText = SyncCore.cloudOff; alert.addButton(withTitle: "OK"); alert.runModal(); return }
        guard available else {
            alert.informativeText = "This Mac has no sync key yet. On a new Mac, paste your recovery code to bring back your plan, Brain notes and data folder from your Worker, and to keep syncing with your iPhone. Otherwise pair your iPhone first (Planner › Pair iPhone…)."
            alert.addButton(withTitle: "Restore with a Recovery Code…")
            alert.addButton(withTitle: "Close")
            if alert.runModal() == .alertFirstButtonReturn { restoreWithCode() }
            return
        }
        let when = lastAt.map { DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .short) } ?? "never"
        alert.informativeText = "Your plan, Brain notes and transcripts, and the text files of your data folder are kept encrypted on your Worker (at most 200 MB), at most every 6 hours when they change. PDFs, project files, images and recordings stay on this Mac.\n\nLast backup: \(when)" + (lastSize > 0 ? " (\(max(1, lastSize / 1024)) KB)" : "") + (lastError.isEmpty ? "" : "\nLast problem: \(lastError)") + "\n\nKeep your recovery code somewhere safe: with it, a new Mac gets everything back."
        alert.addButton(withTitle: "Back Up Now")
        alert.addButton(withTitle: "Restore to a Folder…")
        alert.addButton(withTitle: "Recovery Code…")
        alert.addButton(withTitle: "Close")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            Task { @MainActor in await self.runIfDue(force: true); self.done(self.lastError.isEmpty ? "Backed up." : "Backup failed: \(self.lastError)") }
        case .alertSecondButtonReturn:
            Task { @MainActor in
                do { let u = try await self.restore(); NSWorkspace.shared.activateFileViewerSelecting([u]); self.done("Restored into \(u.lastPathComponent) in Documents. Nothing in the app was changed.") }
                catch { self.done(error.localizedDescription) }
            }
        case .alertThirdButtonReturn: showRecoveryCode()
        default: break
        }
    }

    /// The recovery code: the pairing text (key, Worker token, Worker address). Shown only here, selectable to copy into a
    /// password manager. Copy clears the clipboard after 60 seconds.
    private func showRecoveryCode() {
        guard let key = phone.key, let s = phone.server else { return }
        let code = SyncCore.qrText(SyncCore.Pairing(key: key, url: s.url, token: s.token))
        let bundle = Bundle.main.bundleIdentifier ?? ""
        let a = NSAlert()
        a.messageText = "Your recovery code"
        a.informativeText = "Save it in your password manager, not in a note or a photo. Anyone with it can read your backup and your synced plan.\n\nOn a new Mac:\n1. Clone planner-app into ~/Documents/GitHub.\n2. Make ~/Documents/GitHub/planner-data/local.env with two lines:\n   PLANNER_BUNDLE_ID=\(bundle)\n   PLANNER_CLOUD_SYNC=1\n3. Run mac-app/build.sh --install and open Planner.\n4. Planner › Cloudflare Backup… › Restore with a Recovery Code…, paste the code.\n\nIf you stop syncing, this code stops working; pair again and save the new one."
        let f = NSTextField(wrappingLabelWithString: code)
        f.isSelectable = true; f.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        f.frame = NSRect(x: 0, y: 0, width: 420, height: 60)
        a.accessoryView = f
        a.addButton(withTitle: "Copy"); a.addButton(withTitle: "Close")
        if a.runModal() == .alertFirstButtonReturn {
            let pb = NSPasteboard.general; pb.clearContents()
            pb.declareTypes([.string, NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")], owner: nil)
            pb.setString(code, forType: .string); pb.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
            let count = pb.changeCount
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() } }
        }
    }

    private func restoreWithCode() {
        let a = NSAlert()
        a.messageText = "Restore with a recovery code"
        a.informativeText = "Paste the code you saved. Your files are written to a new folder in Documents first."
        let f = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        a.accessoryView = f
        a.addButton(withTitle: "Restore"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = f
        guard a.runModal() == .alertFirstButtonReturn else { return }
        guard let p = SyncCore.pairingFromQR(f.stringValue) else { done("That is not a recovery code."); return }
        do { try phone.adopt(p) } catch { done(error.localizedDescription); return }
        Task { @MainActor in
            do {
                let u = try await self.restore()
                if self.phone.store.courses.isEmpty {
                    let c = NSAlert()
                    c.messageText = "Your backup is here"
                    c.informativeText = "It is in \(u.lastPathComponent) in Documents. This Mac has no plan yet: put the plan and Brain notes in place and restart Planner?"
                    c.addButton(withTitle: "Put in Place and Restart"); c.addButton(withTitle: "Not Now")
                    if c.runModal() == .alertFirstButtonReturn { self.putInPlaceAndRestart(u); return }
                }
                NSWorkspace.shared.activateFileViewerSelecting([u])
                self.done("Restored into \(u.lastPathComponent) in Documents. This Mac now syncs with your iPhone again.")
            } catch { self.done(error.localizedDescription) }
        }
    }

    private func done(_ text: String) {
        let a = NSAlert(); a.messageText = "Cloudflare backup"; a.informativeText = text; a.addButton(withTitle: "OK"); a.runModal()
    }
}
