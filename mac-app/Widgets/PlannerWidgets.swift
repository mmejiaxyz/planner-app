// Planner desktop widgets (small, medium, large).
// Reads ~/Library/Application Support/Planner/widget.json, which the app writes whenever the plan changes.
// Square edges, lilac + greys, like the app.

import WidgetKit
import SwiftUI

// MARK: - Data

struct WItem: Codable, Hashable { var time: String; var title: String; var sub: String?; var join: String?; var day: String? }
struct WTask: Codable, Hashable { var title: String; var course: String; var est: Double }
struct WDeadline: Codable, Hashable { var title: String; var course: String; var date: String; var days: Int }
struct WSnap: Codable {
    var updated: String = ""
    var date: String = ""
    var day: String = ""
    var weekday: String = ""
    var month: String = ""
    var tasksLeft: Int = 0
    var hours: Double = 0
    var heavy: Bool = false
    var carried: Int = 0
    var agenda: [WItem] = []
    var tomorrowLeave: String? = nil
    var tomorrowFirst: String? = nil
    var next: WDeadline? = nil
    var tasks: [WTask] = []
}

enum Store {
    /// The real home folder (the widget runs in a sandbox container, so NSHomeDirectory() is not it).
    static var home: String { if let pw = getpwuid(getuid()), let d = pw.pointee.pw_dir { return String(cString: d) }; return NSHomeDirectory() }
    static var file: URL { URL(fileURLWithPath: home + "/Library/Application Support/Planner/widget.json") }
    static func load() -> WSnap? { (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(WSnap.self, from: $0) } }
    static let sample = WSnap(updated: "", date: "2026-11-02", day: "02", weekday: "Monday", month: "November", tasksLeft: 4, hours: 3.8, heavy: false, carried: 2,
        agenda: [WItem(time: "08:00", title: "Lecture", sub: "Room 1.01", join: nil, day: "today"),
                 WItem(time: "20:00", title: "Seminar", sub: "Zoom", join: "https://zoom.us", day: "today")],
        tomorrowLeave: "07:30", tomorrowFirst: "10:00 Lecture",
        next: WDeadline(title: "Presentation", course: "Course", date: "2026-11-02", days: 0),
        tasks: [WTask(title: "Exercise sheet", course: "Course", est: 1.5), WTask(title: "Reading", course: "Course", est: 0.5)])
}

struct Entry: TimelineEntry { let date: Date; let snap: WSnap?; }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snap: Store.sample) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: Date(), snap: Store.load() ?? Store.sample)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let e = Entry(date: Date(), snap: Store.load())
        completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

// MARK: - Look

extension Color {
    static let lilac = Color(red: 0xCC/255, green: 0xB6/255, blue: 0xEB/255)
    static let lilacPale = Color(red: 0xE9/255, green: 0xDF/255, blue: 0xF6/255)
    static let ink = Color(red: 0x1A/255, green: 0x1A/255, blue: 0x1A/255)
    static let ink2 = Color(red: 0x55/255, green: 0x54/255, blue: 0x4F/255)
    static let paper = Color(red: 0xFA/255, green: 0xF8/255, blue: 0xF2/255)
    static let coral = Color(red: 0xE0/255, green: 0x55/255, blue: 0x4D/255)
}
let mono = Font.system(.body, design: .monospaced)

/// In accented / vibrant modes (desktop in the background, tinted or clear widgets) macOS removes the
/// background and turns every opaque shape into one tint. So fills become outlines and colours become
/// .primary / .secondary there; lilac and cream only in full colour.
struct Look { var full = true
    var ink: Color { full ? .ink : .primary }
    var ink2: Color { full ? .ink2 : .secondary }
    var warn: Color { full ? .coral : .primary }
}

struct Tag: View {
    let text: String; var warn = false; var look = Look()
    var body: some View {
        let t = Text(text).font(.system(size: 10, weight: .medium)).padding(.horizontal, 5).padding(.vertical, 2)
        if look.full { t.background(warn ? Color.coral.opacity(0.18) : Color.lilacPale).foregroundStyle(warn ? Color.coral : Color.ink) }
        else { t.overlay(Rectangle().stroke(Color.primary.opacity(0.6), lineWidth: 1)).foregroundStyle(Color.primary).widgetAccentable() }
    }
}

struct DateBlock: View {
    let s: WSnap; var big: CGFloat = 44; var look = Look()
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(s.day).font(.system(size: big, weight: .regular, design: .monospaced)).foregroundStyle(look.ink).widgetAccentable()
            VStack(alignment: .leading, spacing: 0) {
                Text(s.weekday).font(.system(size: 12, weight: .semibold))
                Text(s.month).font(.system(size: 11)).foregroundStyle(look.ink2)
            }
        }
    }
}

struct Counts: View {
    let s: WSnap; var look = Look()
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(s.tasksLeft)").font(.system(size: 20, design: .monospaced))
                Text("tasks").font(.system(size: 10)).foregroundStyle(look.ink2)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(String(format: s.hours == s.hours.rounded() ? "%.0f h" : "%.1f h", s.hours)).font(.system(size: 20, design: .monospaced))
                Text("work").font(.system(size: 10)).foregroundStyle(look.ink2)
            }
            if s.heavy { Tag(text: "Heavy", warn: true, look: look) }
        }
    }
}

struct NextDeadline: View {
    let n: WDeadline; var look = Look()
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(n.days == 0 ? "Due today" : n.days == 1 ? "Due tomorrow" : "Due in \(n.days) days")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(n.days <= 2 ? look.warn : look.ink2).widgetAccentable(n.days <= 2)
            Text(n.title).font(.system(size: 12, weight: .medium)).lineLimit(2)
            Text(n.course).font(.system(size: 10)).foregroundStyle(look.ink2).lineLimit(1)
        }
    }
}

struct AgendaRow: View {
    let i: WItem; var look = Look()
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(i.time).font(.system(size: 11, design: .monospaced)).foregroundStyle(look.ink2).frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                Text(i.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                if let sub = i.sub, !sub.isEmpty { Text(sub).font(.system(size: 10)).foregroundStyle(look.ink2).lineLimit(1) }
            }
            Spacer(minLength: 2)
            if let j = i.join, let u = URL(string: j) {
                Link(destination: u) {
                    let t = Text("Join").font(.system(size: 10, weight: .semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                    if look.full { t.background(Color.lilac).foregroundStyle(Color.ink) }
                    else { t.overlay(Rectangle().stroke(Color.primary, lineWidth: 1)).foregroundStyle(Color.primary).widgetAccentable() }
                }
            }
        }
    }
}

struct Empty: View {
    var body: some View { Text("Open Planner once to fill this widget.").font(.system(size: 12)).foregroundStyle(.secondary) }
}

// MARK: - Sizes

struct SmallView: View {
    let s: WSnap; var look = Look()
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DateBlock(s: s, big: 36, look: look)
            Counts(s: s, look: look)
            Spacer(minLength: 0)
            if let n = s.next { NextDeadline(n: n, look: look) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumView: View {
    let s: WSnap; var look = Look()
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                DateBlock(s: s, big: 34, look: look)
                Counts(s: s, look: look)
                Spacer(minLength: 0)
                if let n = s.next { NextDeadline(n: n, look: look) }
            }.frame(width: 130, alignment: .leading)
            Rectangle().fill(look.ink.opacity(0.15)).frame(width: 1)
            VStack(alignment: .leading, spacing: 5) {
                Text("Next").font(.system(size: 10, weight: .semibold)).foregroundStyle(look.ink2)
                ForEach(Array(s.agenda.prefix(3)), id: \.self) { AgendaRow(i: $0, look: look) }
                if s.agenda.isEmpty { Text("Nothing else today").font(.system(size: 12)).foregroundStyle(look.ink2) }
                Spacer(minLength: 0)
                if let l = s.tomorrowLeave { Text("Tomorrow: leave \(l)").font(.system(size: 11, design: .monospaced)).foregroundStyle(look.ink2) }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct LargeView: View {
    let s: WSnap; var look = Look()
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                DateBlock(s: s, big: 40, look: look)
                Spacer()
                Counts(s: s, look: look)
            }
            if let n = s.next {
                let box = NextDeadline(n: n, look: look).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                if look.full { box.background(Color.lilacPale) } else { box.overlay(Rectangle().stroke(Color.primary.opacity(0.4), lineWidth: 1)) }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("Today and tomorrow").font(.system(size: 10, weight: .semibold)).foregroundStyle(look.ink2)
                ForEach(Array(s.agenda.prefix(4)), id: \.self) { AgendaRow(i: $0, look: look) }
                if let l = s.tomorrowLeave { Text("Tomorrow: leave \(l)" + (s.tomorrowFirst.map { " · \($0)" } ?? "")).font(.system(size: 11)).foregroundStyle(look.ink2).lineLimit(1) }
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text("Tasks").font(.system(size: 10, weight: .semibold)).foregroundStyle(look.ink2); if s.carried > 0 { Tag(text: "\(s.carried) carried over", warn: true, look: look) } }
                ForEach(Array(s.tasks.prefix(5)), id: \.self) { t in
                    HStack(spacing: 6) {
                        Rectangle().stroke(look.ink.opacity(0.5), lineWidth: 1).frame(width: 9, height: 9)
                        Text(t.title).font(.system(size: 12)).lineLimit(1).privacySensitive()
                        Spacer(minLength: 2)
                        Text(String(format: "%.1f h", t.est)).font(.system(size: 10, design: .monospaced)).foregroundStyle(look.ink2)
                    }
                }
            }
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct PlannerWidgetView: View {
    @Environment(\.widgetFamily) var family
    @Environment(\.widgetRenderingMode) var mode
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                let look = Look(full: mode == .fullColor)
                switch family {
                case .systemSmall: SmallView(s: s, look: look)
                case .systemLarge: LargeView(s: s, look: look)
                default: MediumView(s: s, look: look)
                }
            } else { Empty() }
        }
        .foregroundStyle(mode == .fullColor ? Color.ink : Color.primary)
        .containerBackground(for: .widget) { Color.paper }
        .widgetURL(URL(string: "planner://today"))
    }
}

struct PlannerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlannerToday", provider: Provider()) { PlannerWidgetView(entry: $0) }
            .configurationDisplayName("Planner")
            .description("Today: tasks, next deadline, classes and calls.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct PlannerWidgets: WidgetBundle {
    var body: some Widget { PlannerWidget() }
}
