#!/usr/bin/env node
/* Summary of the usage log (usage.js, Usage in main.swift): node tools/usage.js [--since YYYY-MM-DD] [--dir path]
   Reads ~/Library/Application Support/Planner/usage/*.jsonl. Prints sessions, time per view, organizer moves he undid
   or changed, planned vs actual hours, AI use and cost, the most used actions, notes and errors. Read only. */
const fs = require('fs'), path = require('path'), os = require('os');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const dir = arg('--dir') || path.join(os.homedir(), 'Library/Application Support/Planner/usage');
const since = arg('--since') || '0000';
if (!fs.existsSync(dir)) { console.log('No usage log yet at ' + dir); process.exit(0); }
const ev = [];
fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().forEach(f => {
  fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach(l => { if (!l) return; try { const e = JSON.parse(l); if (e.t >= since) ev.push(e); } catch (e) {} });
});
ev.sort((a, b) => a.t.localeCompare(b.t));
if (!ev.length) { console.log('No events since ' + since); process.exit(0); }
const ms = t => Date.parse(t), H = x => (x / 3600000).toFixed(1) + ' h', M = x => Math.round(x / 60000) + ' min';
const local = t => new Date(t), day = t => { const d = local(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const count = (list, key) => { const m = new Map(); list.forEach(x => { const k = key(x); if (k == null) return; m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
const table = (rows, n = 15) => rows.slice(0, n).forEach(r => console.log('  ' + String(r[1]).padStart(5) + '  ' + r[0]));
const head = s => console.log('\n## ' + s);

console.log('# Planner usage, ' + day(ev[0].t) + ' to ' + day(ev[ev.length - 1].t) + ' (' + ev.length + ' events)');

/* active time: the app in front (focus..blur), cut by sleep, screen off and quit; an open span ends at the next event (max 30 min) */
const spans = []; let open = null, active = false, awake = true;
const IDLE = 30 * 60000;
ev.forEach(e => {
  if (e.by !== 'app') return;
  const t = ms(e.t);
  if (e.k === 'launch' || e.k === 'focus') active = true;
  if (e.k === 'blur' || e.k === 'quit') active = false;
  if (e.k === 'launch') awake = true;
  if (e.k === 'sleep' || e.k === 'screenOff') awake = false;
  if (e.k === 'wake' || e.k === 'screenOn') awake = true;
  const on = active && awake;
  if (on && open == null) open = t;
  if (!on && open != null) { spans.push([open, t]); open = null; }
});
if (open != null) spans.push([open, ms(ev[ev.length - 1].t)]);
/* cap each span at the last page event inside it plus 30 min, so a forgotten window does not count as hours of use */
const pageT = ev.filter(e => e.by !== 'app').map(e => ms(e.t));
const capped = spans.map(([a, b]) => { const last = pageT.filter(t => t >= a && t <= b).pop(); return [a, Math.min(b, (last || a) + IDLE)]; }).filter(([a, b]) => b > a);
head('Sessions (app in front)');
const launches = ev.filter(e => e.k === 'launch').length;
const byDay = new Map(); capped.forEach(([a, b]) => { const d = day(new Date(a).toISOString()); byDay.set(d, (byDay.get(d) || 0) + (b - a)); });
const total = capped.reduce((s, [a, b]) => s + b - a, 0);
console.log('  Launches: ' + launches + ' · in front ' + capped.length + ' times · ' + H(total) + ' in all · ' + byDay.size + ' days · median stretch ' + M(capped.map(([a, b]) => b - a).sort((x, y) => x - y)[Math.floor(capped.length / 2)] || 0));
const hours = new Array(24).fill(0); capped.forEach(([a, b]) => { for (let t = a; t < b; t += 60000) hours[new Date(t).getHours()]++; });
console.log('  By hour (min): ' + hours.map((m, h) => m ? h + 'h ' + m : '').filter(Boolean).join(' · '));
const wd = new Array(7).fill(0); capped.forEach(([a, b]) => { wd[new Date(a).getDay()] += b - a; });
console.log('  By weekday: ' + wd.map((x, i) => x ? WD[i] + ' ' + M(x) : '').filter(Boolean).join(' · '));
[...byDay].slice(-14).forEach(([d, x]) => console.log('  ' + d + ' ' + WD[new Date(d + 'T12:00').getDay()] + '  ' + M(x)));

head('Time per view');
const views = ev.filter(e => e.k === 'view'), vt = new Map();
views.forEach((v, i) => {
  const a = ms(v.t), next = views[i + 1] ? ms(views[i + 1].t) : a;
  let s = 0; for (const [x, y] of capped) { const lo = Math.max(a, x), hi = Math.min(next, y); if (hi > lo) s += hi - lo; }
  vt.set(v.v, (vt.get(v.v) || 0) + s);
});
[...vt].sort((a, b) => b[1] - a[1]).forEach(([v, x]) => console.log('  ' + M(x).padStart(8) + '  ' + v));
console.log('  First view after launch: ' + count(ev.map((e, i) => e.k === 'page' && e.state === 'load' ? ev.slice(i + 1).find(x => x.k === 'view') : null).filter(Boolean), e => e.v).map(r => r[0] + ' ' + r[1]).join(' · '));

head('Plan changes by who');
const ch = ev.filter(e => /^(task|deliv|course)\./.test(e.k));
table(count(ch, e => e.k + ' · ' + (e.src || '?') + (e.ch ? ' · ' + Object.keys(e.ch).join('+') : '')), 20);

head('Organizer moves he changed afterwards (same task, his own day change within 14 days)');
const orgMoves = ch.filter(e => e.k === 'task.change' && e.src === 'organizer' && e.ch && e.ch.due);
const overrides = [];
orgMoves.forEach(m => {
  const his = ch.find(e => e.k === 'task.change' && e.id === m.id && e.src === 'you' && e.ch && e.ch.due && e.t > m.t && ms(e.t) - ms(m.t) < 14 * 864e5);
  if (his) overrides.push({ m, his });
});
const undos = ev.filter(e => e.k === 'click' && e.data && e.data.org === 'undo').length;
console.log('  Organizer moves: ' + orgMoves.length + ' · changed by him later: ' + overrides.length + ' · Undo clicks: ' + undos);
table(count(overrides, o => o.m.c), 10);
overrides.slice(-12).forEach(o => console.log('  ' + o.m.title.slice(0, 60) + ': organizer ' + o.m.ch.due[0] + ' → ' + o.m.ch.due[1] + ', he put it on ' + o.his.ch.due[1] + ' (' + WD[new Date(o.his.ch.due[1] + 'T12:00').getDay()] + ')'));
const hisMoves = ch.filter(e => e.k === 'task.change' && e.src === 'you' && e.ch && e.ch.due && !(e.ch.status));
console.log('  His own day changes: ' + hisMoves.length + ' · later ' + hisMoves.filter(e => e.ch.due[1] > e.ch.due[0]).length + ' · earlier ' + hisMoves.filter(e => e.ch.due[1] < e.ch.due[0]).length);
console.log('  Moved away from: ' + count(hisMoves.filter(e => e.ch.due[0]), e => WD[new Date(e.ch.due[0] + 'T12:00').getDay()]).map(r => r[0] + ' ' + r[1]).join(' · '));
console.log('  Moved onto: ' + count(hisMoves.filter(e => e.ch.due[1]), e => WD[new Date(e.ch.due[1] + 'T12:00').getDay()]).map(r => r[0] + ' ' + r[1]).join(' · '));
const estEd = ch.filter(e => e.k === 'task.change' && e.src === 'you' && e.ch && e.ch.est);
if (estEd.length) console.log('  Estimates he changed by hand: ' + estEd.length + ' · up ' + estEd.filter(e => e.ch.est[1] > e.ch.est[0]).length + ' · down ' + estEd.filter(e => e.ch.est[1] < e.ch.est[0]).length);

head('Planned vs actual (ticked done)');
const done = ch.filter(e => e.k === 'task.change' && e.ch && e.ch.status && e.ch.status[1] === 'done');
const timed = done.filter(e => e.spent > 0 && e.est > 0);
console.log('  Done: ' + done.length + ' · with time: ' + timed.length);
const ratio = list => { const s = list.reduce((a, e) => a + e.spent, 0), p = list.reduce((a, e) => a + e.est, 0); return p ? (s / p).toFixed(2) + 'x (' + s.toFixed(1) + ' of ' + p.toFixed(1) + ' h)' : '-'; };
if (timed.length) console.log('  All: ' + ratio(timed));
[...new Set(timed.map(e => e.c))].forEach(c => console.log('  ' + c.padEnd(16) + ratio(timed.filter(e => e.c === c))));
[...new Set(timed.map(e => e.where))].forEach(w => console.log('  where ' + String(w).padEnd(10) + ratio(timed.filter(e => e.where === w))));
const when = done.filter(e => e.doneOn && (e.planned || e.ch.due));
const plannedDay = e => e.planned || e.ch.due[0];
console.log('  Done ahead of its day: ' + when.filter(e => e.doneOn < plannedDay(e)).length + ' · on it: ' + when.filter(e => e.doneOn === plannedDay(e)).length + ' · after: ' + when.filter(e => e.doneOn > plannedDay(e)).length);
console.log('  Ticked at (hour): ' + count(done, e => local(e.t).getHours()).sort((a, b) => a[0] - b[0]).map(r => r[0] + 'h ' + r[1]).join(' · '));

head('AI');
const ai = ev.filter(e => e.k === 'ai');
const cost = ai.reduce((s, e) => s + (e.cost || 0), 0), tok = ai.reduce((s, e) => s + (e.tokens || 0), 0);
console.log('  Calls: ' + ai.length + ' · failed: ' + ai.filter(e => !e.ok).length + ' · cost logged $' + cost.toFixed(2) + ' · tokens logged ' + tok);
const feats = new Map(); ai.forEach(e => { const k = (e.from || '?') + ' · ' + e.op + ' · ' + (e.model || e.provider || e.asked || '?'); const f = feats.get(k) || { n: 0, ms: 0, cost: 0, fail: 0 }; f.n++; f.ms += e.ms || 0; f.cost += e.cost || 0; f.fail += e.ok ? 0 : 1; feats.set(k, f); });
[...feats].sort((a, b) => b[1].n - a[1].n).slice(0, 20).forEach(([k, f]) => console.log('  ' + String(f.n).padStart(5) + '  ' + k + ' · avg ' + (f.ms / f.n / 1000).toFixed(1) + ' s' + (f.cost ? ' · $' + f.cost.toFixed(2) : '') + (f.fail ? ' · ' + f.fail + ' failed' : '')));

head('Planner chat');
const notes = ev.filter(e => e.k === 'note'), applies = ev.filter(e => e.k === 'apply');
console.log('  Notes: ' + notes.length + ' · Apply: ' + applies.length + ' · Undo of an Apply: ' + ch.filter(e => e.src === 'chat-undo').length + ' changes');
notes.slice(-10).forEach(e => console.log('  ' + day(e.t) + '  ' + e.text.slice(0, 110)));

head('Most used actions');
const clicks = ev.filter(e => e.k === 'click');
table(count(clicks, e => (e.in ? e.in + ' › ' : '') + (e.data ? Object.entries(e.data).map(([k, v]) => k + '=' + (k === 'tab' || v.length < 14 ? v : '…')).join(' ') : '') + (e.label ? ' "' + e.label.slice(0, 30) + '"' : '')), 25);

head('Errors');
const errs = ev.filter(e => e.k === 'error');
console.log('  ' + errs.length + ' errors');
table(count(errs, e => (e.kind || 'page') + ': ' + (e.msg || '').slice(0, 120)), 12);
