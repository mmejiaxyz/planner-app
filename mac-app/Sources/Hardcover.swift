import AppKit
import Foundation

/// Hardcover (hardcover.app), the reading log: the page links a PDF to a Hardcover book and sends its page; this keeps the
/// person's API key and makes the calls, so the key never reaches the page. The key is pasted in Planner › Hardcover API
/// Key… and kept in Application Support/Planner/hardcover-token (mode 600, like the sync key). It is not in the Cloudflare
/// backup and goes only to api.hardcover.app. GraphQL as used by hardcoverapp.koplugin (MIT).
enum Hardcover {
    static let endpoint = URL(string: "https://api.hardcover.app/v1/graphql")!
    static var tokenFile: URL { Paths.support.appendingPathComponent("hardcover-token") }

    static var token: String? {
        guard let s = try? String(contentsOf: tokenFile, encoding: .utf8) else { return nil }
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.lowercased().hasPrefix("bearer ") { t = String(t.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
        return t.isEmpty ? nil : t
    }

    static func save(_ t: String?) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: tokenFile)
        guard let t, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard fm.createFile(atPath: tokenFile.path, contents: Data(t.trimmingCharacters(in: .whitespacesAndNewlines).utf8), attributes: [.posixPermissions: 0o600]) else {
            throw NSError(domain: "hardcover", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not save the key"])
        }
    }

    /// One GraphQL call: {data, errors} as Hardcover sends it.
    static func call(query: String, variables: [String: Any]) async throws -> Any {
        guard let token else { throw NSError(domain: "hardcover", code: 2, userInfo: [NSLocalizedDescriptionKey: "No Hardcover API key. Add it in Planner › Hardcover API Key…"]) }
        var r = URLRequest(url: endpoint)
        r.httpMethod = "POST"; r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("Planner (personal study planner)", forHTTPHeaderField: "User-Agent")
        r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["query": query, "variables": variables])
        let (d, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 || code == 403 { throw NSError(domain: "hardcover", code: code, userInfo: [NSLocalizedDescriptionKey: "Hardcover did not accept the key. Check it in Planner › Hardcover API Key…"]) }
        if code == 429 { throw NSError(domain: "hardcover", code: code, userInfo: [NSLocalizedDescriptionKey: "Hardcover asks to slow down. Try again in a minute."]) }
        guard (200...299).contains(code) else { throw NSError(domain: "hardcover", code: code, userInfo: [NSLocalizedDescriptionKey: "Hardcover error \(code)"]) }
        return try JSONSerialization.jsonObject(with: d)
    }

    @MainActor static func showKeyWindow() {
        let a = NSAlert()
        a.messageText = "Hardcover API key"
        a.informativeText = "From hardcover.app › Settings › API (without the word Bearer). It stays on this Mac and goes only to Hardcover. With it, books you read in Planner are kept on Hardcover: an ISBN in the PDF links the book by itself, others from the reader’s ☰ menu."
            + (token != nil ? "\n\nA key is saved." : "")
        let f = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        f.placeholderString = token != nil ? "Paste a new key to replace it" : "Paste your key"
        a.accessoryView = f
        a.addButton(withTitle: "Save"); a.addButton(withTitle: "Cancel")
        if token != nil { a.addButton(withTitle: "Remove Key") }
        a.window.initialFirstResponder = f
        switch a.runModal() {
        case .alertFirstButtonReturn: if !f.stringValue.isEmpty { try? save(f.stringValue) }
        case .alertThirdButtonReturn: try? save(nil)
        default: break
        }
    }
}
