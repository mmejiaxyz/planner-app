import AppKit

/// The selection bubble and the Define card on the original page (reader redesign, 25 Nov 2026). The page draws them in the
/// text view, but the native PDFView sits over the web view, so here they are native views laid over the PDF, at the
/// selection: Explain · Define · Highlight with the key under each (E D H), square edges, the P15 shades.
private func rgb(_ h: UInt32, _ a: CGFloat = 1) -> NSColor { NSColor(srgbRed: CGFloat((h >> 16) & 255) / 255, green: CGFloat((h >> 8) & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: a) }
private func dark(_ v: NSView) -> Bool { v.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

final class SelBubble: NSView {
    static let size = NSSize(width: 312, height: 71)   // 64 high, the 7 px tail outside it
    var onPick: ((String) -> Void)?
    var tailX: CGFloat = 156
    var tailUp = false                                   // shown below the selection: the tail points up
    private var hover = -1
    private let items: [(key: String, label: String, symbol: String)] = [("e", "Explain", "sparkle"), ("d", "Define", "book"), ("h", "Highlight", "highlighter")]

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        shadow = { let s = NSShadow(); s.shadowColor = NSColor(white: 0.1, alpha: 0.18); s.shadowBlurRadius = 18; s.shadowOffset = NSSize(width: 0, height: -6); return s }()
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    required init?(coder: NSCoder) { nil }
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    private var body: NSRect { NSRect(x: 0, y: tailUp ? 7 : 0, width: bounds.width, height: 64) }

    override func draw(_ dirtyRect: NSRect) {
        let b = body
        rgb(0x1A1A1A).setFill(); b.fill()
        let tail = NSBezierPath()
        if tailUp { tail.move(to: NSPoint(x: tailX - 7, y: 7)); tail.line(to: NSPoint(x: tailX, y: 0)); tail.line(to: NSPoint(x: tailX + 7, y: 7)) }
        else { tail.move(to: NSPoint(x: tailX - 7, y: 64)); tail.line(to: NSPoint(x: tailX, y: 71)); tail.line(to: NSPoint(x: tailX + 7, y: 64)) }
        tail.close(); tail.fill()
        let w = b.width / 3
        for (i, it) in items.enumerated() {
            let cell = NSRect(x: CGFloat(i) * w, y: b.minY, width: w, height: b.height)
            if i == hover { rgb(0x2A2A28).setFill(); cell.fill() }
            if i > 0 { rgb(0x3F3F3C).setFill(); NSRect(x: cell.minX, y: cell.minY, width: 1, height: cell.height).fill() }
            let ink = i == 0 ? rgb(0xDDCDF1) : rgb(0xFDFCF8)
            if let img = NSImage(systemSymbolName: it.symbol, accessibilityDescription: it.label)?.withSymbolConfiguration(.init(pointSize: 14, weight: .regular)) {
                let tinted = NSImage(size: img.size, flipped: false) { r in img.draw(in: r); ink.set(); r.fill(using: .sourceAtop); return true }
                tinted.draw(in: NSRect(x: cell.midX - img.size.width / 2, y: cell.minY + 10, width: img.size.width, height: img.size.height), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            }
            let label = NSAttributedString(string: it.label, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .medium), .foregroundColor: ink])
            label.draw(at: NSPoint(x: cell.midX - label.size().width / 2, y: cell.minY + 29))
            let key = NSAttributedString(string: it.key.uppercased(), attributes: [.font: NSFont.monospacedSystemFont(ofSize: 9.5, weight: .regular), .foregroundColor: rgb(0x9C9B96)])
            key.draw(at: NSPoint(x: cell.midX - key.size().width / 2, y: cell.minY + 46))
        }
    }
    private func index(_ e: NSEvent) -> Int {
        let p = convert(e.locationInWindow, from: nil)
        guard body.contains(p) else { return -1 }
        return min(2, Int(p.x / (bounds.width / 3)))
    }
    override func mouseMoved(with e: NSEvent) { let i = index(e); if i != hover { hover = i; needsDisplay = true } }
    override func mouseExited(with e: NSEvent) { hover = -1; needsDisplay = true }
    override func mouseDown(with e: NSEvent) { let i = index(e); if i >= 0 { onPick?(items[i].key) } }
}

/// Define at the word: the word and its part of speech, the definition, "In this passage" and one sentence.
final class DefCard: NSView {
    var word = "", pos = "", def = "", here = "", note = ""
    static let width: CGFloat = 380
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        shadow = { let s = NSShadow(); s.shadowColor = NSColor(white: 0.1, alpha: 0.12); s.shadowBlurRadius = 18; s.shadowOffset = NSSize(width: 0, height: -6); return s }()
    }
    required init?(coder: NSCoder) { nil }
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    private var parts: [(NSAttributedString, CGFloat)] {
        let d = dark(self), ink = d ? rgb(0xF2F1EC) : rgb(0x1A1A1A), ink2 = d ? rgb(0xB4B3AE) : rgb(0x55544F)
        let para = NSMutableParagraphStyle(); para.lineSpacing = 2
        var out: [(NSAttributedString, CGFloat)] = []
        if !note.isEmpty { out.append((NSAttributedString(string: note, attributes: [.font: NSFont.systemFont(ofSize: 13.5), .foregroundColor: ink2, .paragraphStyle: para]), 0)) }
        if !def.isEmpty { out.append((NSAttributedString(string: def, attributes: [.font: NSFont.systemFont(ofSize: 14.5), .foregroundColor: ink, .paragraphStyle: para]), 0)) }
        if !here.isEmpty {
            out.append((NSAttributedString(string: "In this passage", attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: d ? rgb(0xB39AD9) : rgb(0x755A9C)]), 10))
            out.append((NSAttributedString(string: here, attributes: [.font: NSFont.systemFont(ofSize: 13.5), .foregroundColor: ink2, .paragraphStyle: para]), 2))
        }
        return out
    }
    /// The height the card needs at its width.
    func fit() -> CGFloat {
        var h: CGFloat = 3 + 14 + 20 + 6
        for (s, gap) in parts { h += gap + ceil(s.boundingRect(with: NSSize(width: DefCard.width - 32, height: 1000), options: [.usesLineFragmentOrigin]).height) + 4 }
        return h + 12
    }
    override func draw(_ dirtyRect: NSRect) {
        let d = dark(self)
        (d ? rgb(0x1D1D1C) : rgb(0xFDFCF8)).setFill(); bounds.fill()
        (d ? rgb(0x33332F) : rgb(0xDFDDD8)).setStroke(); NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5)).stroke()
        (d ? rgb(0x8470AD) : rgb(0x9579BF)).setFill(); NSRect(x: 0, y: 0, width: bounds.width, height: 3).fill()
        let ink = d ? rgb(0xF2F1EC) : rgb(0x1A1A1A), ink3 = d ? rgb(0x8F8E89) : rgb(0x6B6A65)
        let w = NSAttributedString(string: word.count > 48 ? String(word.prefix(46)) + "…" : word, attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: ink])
        w.draw(at: NSPoint(x: 16, y: 15))
        let p = NSAttributedString(string: pos, attributes: [.font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: ink3])
        p.draw(at: NSPoint(x: bounds.width - 16 - p.size().width, y: 16))
        var y: CGFloat = 3 + 14 + 20 + 6
        for (s, gap) in parts {
            y += gap
            let h = ceil(s.boundingRect(with: NSSize(width: bounds.width - 32, height: 1000), options: [.usesLineFragmentOrigin]).height)
            s.draw(with: NSRect(x: 16, y: y, width: bounds.width - 32, height: h), options: [.usesLineFragmentOrigin])
            y += h + 4
        }
    }
    override func mouseDown(with e: NSEvent) {}
}
