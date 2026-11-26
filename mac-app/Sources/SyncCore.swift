// Phone sync, shared by the Mac app and the iPhone app (both compile this file).
//
// The Mac is the only device that writes the plan. It uploads an encrypted snapshot to a small private Worker on
// Cloudflare (sync-worker/); the phone downloads it and uploads each change it makes as "ops/<time>-<random>.bin", also
// encrypted. The Mac applies the changes, deletes them and uploads a new snapshot that lists which changes it applied.
//
// Encryption: AES-256-GCM (CryptoKit) over zlib-compressed JSON. The 32-byte key is made on the Mac, kept in each
// device's own Keychain (never synced to iCloud) and moved to the phone once, as a QR code. Cloudflare sees only
// encrypted bytes, sizes and times. Each file names its kind
// as authenticated data, so a change file cannot be passed off as a snapshot. A file that was altered fails to open.

import Foundation
import CryptoKit
import Security

enum SyncCore {
    static let magic = Data("PLS1".utf8)
    static let qrPrefix = "planner-sync:2:"
    /// Set by the build scripts from the bundle id (PlannerKeychain in Info.plist, mac-app/config.sh); must not change once paired.
    static let keychainService = (Bundle.main.object(forInfoDictionaryKey: "PlannerKeychain") as? String) ?? "local.planner.sync"

    enum Kind: String { case snapshot, op, web, audio, file, backup }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: sealing

    static func seal(_ object: Any, kind: Kind, key: SymmetricKey) throws -> Data {
        let json = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let packed = try (json as NSData).compressed(using: .zlib) as Data
        let box = try AES.GCM.seal(packed, using: key, authenticating: Data(kind.rawValue.utf8))
        guard let combined = box.combined else { throw Failure(message: "Could not encrypt") }
        return magic + combined
    }

    static func open(_ data: Data, kind: Kind, key: SymmetricKey) throws -> Any {
        guard data.count > magic.count + 28, data.prefix(magic.count) == magic else { throw Failure(message: "Not a Planner sync file") }
        let box = try AES.GCM.SealedBox(combined: data.dropFirst(magic.count))
        let packed: Data
        do { packed = try AES.GCM.open(box, using: key, authenticating: Data(kind.rawValue.utf8)) }
        catch { throw Failure(message: "This file was made with another key, or it was changed") }
        let json = try (packed as NSData).decompressed(using: .zlib) as Data
        return try JSONSerialization.jsonObject(with: json)
    }

    /// Raw bytes (a part of a recording), not JSON. `context` (recording id and part number) is authenticated too, so a
    /// part cannot be moved to another place or recording without failing to open.
    static func sealData(_ d: Data, kind: Kind, context: String, key: SymmetricKey) throws -> Data {
        let box = try AES.GCM.seal(d, using: key, authenticating: Data((kind.rawValue + ":" + context).utf8))
        guard let combined = box.combined else { throw Failure(message: "Could not encrypt") }
        return magic + combined
    }

    static func openData(_ data: Data, kind: Kind, context: String, key: SymmetricKey) throws -> Data {
        guard data.count > magic.count + 28, data.prefix(magic.count) == magic else { throw Failure(message: "Not a Planner sync file") }
        do { return try AES.GCM.open(try AES.GCM.SealedBox(combined: data.dropFirst(magic.count)), using: key, authenticating: Data((kind.rawValue + ":" + context).utf8)) }
        catch { throw Failure(message: kind == .file ? "A part of the PDF could not be opened" : "A recording part could not be opened") }
    }

    /// Recordings go up in parts of this size (a Durable Object value is at most 128 KB; sealing adds 32 bytes).
    static let audioPart = 90 * 1024

    /// PDFs from the Mac to the phone use the same part store as recordings (/audio/<id>/<n> on the Worker, so its caps and
    /// clean-up apply), sealed as kind "file" so a PDF part can never pass for a recording part or the other way round.
    /// The Mac uploads them; the phone downloads them and deletes them once the whole file checked out.
    static let filePart = audioPart
    static let maxFile = 60 << 20            // a PDF sent to the phone: at most 60 MB (his largest is 20 MB)

    // MARK: key

    static func newKey() -> SymmetricKey { SymmetricKey(size: .bits256) }

    static func keyData(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

    /// Short code shown on both devices after pairing, to check they hold the same key. Not secret.
    static func fingerprint(_ key: SymmetricKey) -> String {
        let h = SHA256.hash(data: keyData(key))
        return h.prefix(4).map { String(format: "%02X", $0) }.joined().inserted(":", at: 4)
    }

    /// Keychain items on this device only. On the Mac this is the login keychain (never synced); on the iPhone the items
    /// are marked "this device only", so they are not in backups or iCloud Keychain either.
    static func loadKey() -> SymmetricKey? {
        guard let d = keychainGet("key"), d.count == 32 else { return nil }
        return SymmetricKey(data: d)
    }
    static func saveKey(_ key: SymmetricKey) throws { try keychainSet("key", keyData(key)) }

    /// Syncing through a Cloudflare Worker is off unless this build turns it on (PlannerCloudSync in Info.plist, set by
    /// the build scripts from PLANNER_CLOUD_SYNC=1 in the data folder's local.env). A copy built from the public repo
    /// never contacts a Worker: no pairing, no upload, no download.
    static let cloudAllowed = (Bundle.main.object(forInfoDictionaryKey: "PlannerCloudSync") as? Bool) == true
    static let cloudOff = "Phone sync is off in this build."

    /// The phone keeps the Worker address and token in the Keychain too (the Mac reads them from sync-server.json).
    static func loadServer() -> Server? {
        guard cloudAllowed, let d = keychainGet("server"), let o = try? JSONSerialization.jsonObject(with: d) as? [String: String],
              let u = o["url"].flatMap(URL.init(string:)), let t = o["token"], !t.isEmpty else { return nil }
        return Server(url: u, token: t)
    }
    static func saveServer(_ s: Server) throws {
        guard cloudAllowed else { throw Failure(message: cloudOff) }
        try keychainSet("server", try JSONSerialization.data(withJSONObject: ["url": s.url.absoluteString, "token": s.token]))
    }

    static func forget() { keychainDelete("key"); keychainDelete("server") }

    static func keychainGet(_ account: String) -> Data? {
        var q = baseQuery(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func keychainSet(_ account: String, _ data: Data) throws {
        keychainDelete(account)
        var q = baseQuery(account)
        q[kSecValueData as String] = data
        #if os(iOS)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif
        let s = SecItemAdd(q as CFDictionary, nil)
        guard s == errSecSuccess else { throw Failure(message: "Could not save to the Keychain (\(s))") }
    }

    static func keychainDelete(_ account: String) { SecItemDelete(baseQuery(account) as CFDictionary) }

    private static func baseQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: keychainService,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }

    // MARK: pairing

    /// What the phone needs: the key, the Worker address and its token. Moved once as a QR code, never over the network.
    struct Pairing {
        let key: SymmetricKey
        let url: URL
        let token: String
    }

    static func qrText(_ p: Pairing) -> String {
        qrPrefix + base64url(keyData(p.key)) + ":" + p.token + ":" + (p.url.host ?? "")
    }

    static func pairingFromQR(_ text: String) -> Pairing? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.hasPrefix(qrPrefix) else { return nil }
        let parts = t.dropFirst(qrPrefix.count).split(separator: ":").map(String.init)
        guard parts.count == 3, let d = unbase64url(parts[0]), d.count == 32, !parts[1].isEmpty,
              parts[2].hasSuffix(".workers.dev"), let u = URL(string: "https://" + parts[2]) else { return nil }
        return Pairing(key: SymmetricKey(data: d), url: u, token: parts[1])
    }

    // MARK: the Worker (sync-worker/worker.js)

    struct Server {
        let url: URL
        let token: String

        private func request(_ path: String, _ method: String = "GET", body: Data? = nil, headers: [String: String] = [:]) async throws -> (Data, HTTPURLResponse) {
            guard SyncCore.cloudAllowed else { throw Failure(message: SyncCore.cloudOff) }
            var r = URLRequest(url: url.appendingPathComponent(path))
            r.httpMethod = method; r.httpBody = body; r.timeoutInterval = 30
            r.cachePolicy = .reloadIgnoringLocalCacheData
            r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
            let (d, resp) = try await URLSession.shared.data(for: r)
            guard let h = resp as? HTTPURLResponse else { throw Failure(message: "No answer from the sync server") }
            switch h.statusCode {
            case 200...299, 304, 404: return (d, h)
            case 401: throw Failure(message: "The sync server does not accept this device. Pair again.")
            case 429: throw Failure(message: "Daily sync limit reached; syncing resumes after midnight UTC.")
            case 507: throw Failure(message: "Sync storage is full: open Planner on the Mac.")
            default: throw Failure(message: "Sync server error \(h.statusCode)")
            }
        }

        /// nil data: unchanged since `etag` (or nothing stored yet).
        func snapshot(etag: String?) async throws -> (data: Data?, etag: String?, at: String?) { try await blob("snapshot", etag: etag) }
        func putSnapshot(_ d: Data) async throws { _ = try await request("snapshot", "PUT", body: d) }
        /// The page (index.html and js/), uploaded by the Mac only when a rebuild changed it.
        func web() async throws -> Data? { try await blob("web", etag: nil).data }
        func putAudio(_ id: String, _ n: Int, _ d: Data) async throws { _ = try await request("audio/\(id)/\(n)", "PUT", body: d) }
        func audio(_ id: String, _ n: Int) async throws -> Data? {
            let (d, h) = try await request("audio/\(id)/\(n)")
            return h.statusCode == 200 ? d : nil
        }
        func deleteAudio(_ id: String, parts: Int) async throws {
            guard SyncCore.cloudAllowed else { throw Failure(message: SyncCore.cloudOff) }
            var r = URLRequest(url: URL(string: url.absoluteString + "/audio/\(id)?parts=\(parts)")!)
            r.httpMethod = "DELETE"; r.timeoutInterval = 30
            r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (_, resp) = try await URLSession.shared.data(for: r)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(message: "Could not delete the recording on the sync server") }
        }
        /// Parts of a PDF the Mac sends to the phone (same store as recordings, see filePart).
        func putFilePart(_ id: String, _ n: Int, _ d: Data) async throws { try await putAudio(id, n, d) }
        func filePart(_ id: String, _ n: Int) async throws -> Data? { try await audio(id, n) }
        func deleteFile(_ id: String, parts: Int) async throws { try await deleteAudio(id, parts: parts) }
        /// Kept reading versions (the Worker's text/ store, never cleared by a fetch): the phone's library.
        func putTextPart(_ id: String, _ n: Int, _ d: Data) async throws { _ = try await request("text/\(id)/\(n)", "PUT", body: d) }
        func textPart(_ id: String, _ n: Int) async throws -> Data? {
            let (d, h) = try await request("text/\(id)/\(n)")
            return h.statusCode == 200 ? d : nil
        }
        func deleteText(_ id: String, parts: Int) async throws {
            guard SyncCore.cloudAllowed else { throw Failure(message: SyncCore.cloudOff) }
            var r = URLRequest(url: URL(string: url.absoluteString + "/text/\(id)?parts=\(parts)")!)
            r.httpMethod = "DELETE"; r.timeoutInterval = 30
            r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (_, resp) = try await URLSession.shared.data(for: r)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(message: "Could not delete a text version on the sync server") }
        }
        /// The Worker's counters: audioBytes is what recordings and PDFs take in the part store right now.
        func status() async throws -> [String: Any] {
            let (d, _) = try await request("status")
            return (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
        }
        func putWeb(_ d: Data) async throws { _ = try await request("web", "PUT", body: d) }
        /// The off-device backup of the data (CloudBackup in Backup.swift): uploaded in chunks under a new generation,
        /// current only after commit (sync-worker/worker.js).
        func putBackupPart(gen: String, n: Int, _ d: Data) async throws { _ = try await request("backup/part/\(gen)/\(n)", "PUT", body: d) }
        func commitBackup(gen: String, chunks: Int, size: Int) async throws {
            var r = URLRequest(url: URL(string: url.absoluteString + "/backup/commit?gen=\(gen)&chunks=\(chunks)&size=\(size)")!)
            guard SyncCore.cloudAllowed else { throw Failure(message: SyncCore.cloudOff) }
            r.httpMethod = "POST"; r.timeoutInterval = 60
            r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (d, resp) = try await URLSession.shared.data(for: r)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(message: "The backup was not saved: " + (String(data: d, encoding: .utf8) ?? "")) }
        }
        /// {gen, chunks, size, at} of the current backup, nil if there is none.
        func backupInfo() async throws -> [String: Any]? {
            let (d, h) = try await request("backup")
            return h.statusCode == 200 ? (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) : nil
        }
        func backupPart(_ n: Int) async throws -> Data {
            let (d, h) = try await request("backup/part/\(n)")
            guard h.statusCode == 200 else { throw Failure(message: "A part of the backup is missing") }
            return d
        }

        private func blob(_ path: String, etag: String?) async throws -> (data: Data?, etag: String?, at: String?) {
            let (d, h) = try await request(path, headers: etag.map { ["If-None-Match": $0] } ?? [:])
            let tag = h.value(forHTTPHeaderField: "Etag"), at = h.value(forHTTPHeaderField: "x-at")
            return (h.statusCode == 200 ? d : nil, tag, at)
        }
        func putOp(_ name: String, _ d: Data) async throws { _ = try await request("ops/" + name, "PUT", body: d) }
        func ops() async throws -> [(name: String, data: Data)] {
            let (d, _) = try await request("ops")
            let o = (try JSONSerialization.jsonObject(with: d) as? [String: Any])?["ops"] as? [[String: Any]] ?? []
            return o.compactMap { x in
                guard let n = x["name"] as? String, let s = x["data"] as? String, let b = Data(base64Encoded: s) else { return nil }
                return (n, b)
            }
        }
        func deleteOps(_ names: [String]) async throws {
            guard !names.isEmpty else { return }
            for i in stride(from: 0, to: names.count, by: 100) {
                let b = try JSONSerialization.data(withJSONObject: ["names": Array(names[i..<min(i + 100, names.count)])])
                _ = try await request("ops/delete", "POST", body: b, headers: ["Content-Type": "application/json"])
            }
        }
    }

    static func newOpName() -> String {
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        let t = String(ms)
        return String(repeating: "0", count: max(0, 13 - t.count)) + t + "-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8).lowercased() + ".bin"
    }

    // MARK: helpers

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func unbase64url(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }
}

private extension String {
    func inserted(_ s: String, at i: Int) -> String {
        guard count > i else { return self }
        let idx = index(startIndex, offsetBy: i)
        return String(self[..<idx]) + s + String(self[idx...])
    }
}
