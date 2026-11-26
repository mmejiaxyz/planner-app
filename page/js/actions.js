/* The planner chat's fixed framework (24 Nov 2026, the user's request: "merge plan and set up into one chat capable of both, make it
   very smart but with a fixed framework, so that dangerous tasks can't be done by the chat"). Part of page/index_v2.html;
   classic script, loaded after onboard.js.
   1. Actions. A model answer can only fill the sections in ACTIONS, and code checks every one of them (normalize(),
      onbProposal()). There is no action for files, folders, courses, settings, sync or messages, so no answer can ask for one.
   2. Risky rows: removing a task, moving a real deadline, deleting or changing a calendar event. They show with a tick box,
      unticked; Apply leaves out every risky row he has not ticked (`applyable`). At most MAX_REMOVES removals in one answer.
   3. Where it came from. An answer read from documents (set up: a syllabus, a reading list) may only add (`gateDocs`):
      removals, deadline moves, calendar changes, busy time, skipped classes and task changes are dropped and named. Only
      his own words can change or remove what is planned.
   4. Undo. Every Apply keeps what it changed (`undoBefore` / `undoAfter`); "Undo" reverts the whole batch item by item, and
      only where the item is still as the Apply left it (work he ticked done since stays). */
const ACTIONS = [
  {key:'tasks', label:'new tasks', risk:'add'},
  {key:'deliverables', label:'new deadlines', risk:'add'},
  {key:'sessions', label:'class times', risk:'add'},
  {key:'info', label:'course notes', risk:'add'},
  {key:'updates', label:'changes to planned tasks', risk:'change'},
  {key:'busy', label:'busy time', risk:'change'},
  {key:'unbusy', label:'busy time removed', risk:'change'},
  {key:'classWork', label:'class as work time', risk:'change'},
  {key:'skips', label:'classes not attended', risk:'change'},
  {key:'prios', label:'priorities', risk:'change'},
  {key:'dupdates', label:'moved deadlines', risk:'risky'},
  {key:'removes', label:'removed tasks', risk:'risky'},
  {key:'events', label:'calendar', risk:x=>x.op==='add' ? 'add' : 'risky'}
];
const MAX_REMOVES = 10;
const riskOf = (a, row) => typeof a.risk==='function' ? a.risk(row) : a.risk;
/* rows that need his tick: [section, row] */
function riskyRows(p){
  const out = [];
  ACTIONS.forEach(a=>{ const list = p && p[a.key]; if(Array.isArray(list)) list.forEach(row=>{ if(row && riskOf(a, row)==='risky') out.push([a.key, row]); }); });
  return out;
}
const needsTick = p => riskyRows(p).filter(([,r])=>!r._ok).length;
/* the proposal Apply writes: unticked rows and risky rows he has not ticked are left out */
function applyable(p){
  const q = Object.assign({}, p);
  ACTIONS.forEach(a=>{ if(Array.isArray(p[a.key])) q[a.key] = p[a.key].filter(row=>row && !row._off && (riskOf(a, row)!=='risky' || row._ok)); });
  if(p.info && p.info._off) q.info = null;
  /* a class work row left out takes its in-class task moves with it */
  (p.classWork||[]).filter(w=>w._off).forEach(w=>{ q.updates = q.updates.filter(u=>!(u.course===w.course && u.changes.where==='class')); });
  return q;
}
/* every answer: at most MAX_REMOVES removals; an answer read from documents may only add */
function gateProposal(p, origin){
  if(!p) return p;
  p.unused = p.unused || []; p.notes = p.notes || [];
  if((p.removes||[]).length > MAX_REMOVES){ const n = p.removes.length - MAX_REMOVES; p.removes = p.removes.slice(0, MAX_REMOVES); p.unused.push(n+' more removal'+(n===1?'':'s')+' (at most '+MAX_REMOVES+' at once)'); }
  if(origin==='docs') gateDocs(p);
  p.origin = origin || 'note';
  return p;
}
function gateDocs(p){
  const gone = [];
  (p.dupdates||[]).forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id);
    if(d) p.notes.push('The documents give '+fmtShort(u.changes.date)+' for "'+d.title+'" ('+(d.date?fmtShort(d.date):'no date')+' in the plan). Say "move it" to change it.'); });
  p.dupdates = [];
  if((p.removes||[]).length) gone.push(p.removes.length+' removal'+(p.removes.length===1?'':'s'));
  p.removes = [];
  const ev = (p.events||[]).filter(x=>x.op!=='add'); if(ev.length) gone.push(ev.length+' calendar change'+(ev.length===1?'':'s'));
  p.events = (p.events||[]).filter(x=>x.op==='add');
  if((p.updates||[]).length) gone.push(p.updates.length+' change'+(p.updates.length===1?'':'s')+' to planned tasks');
  p.updates = [];
  ['busy','unbusy','skips','classWork','prios'].forEach(k=>{ if((p[k]||[]).length) gone.push(p[k].length+' '+ACTIONS.find(a=>a.key===k).label); p[k] = []; });
  if(gone.length) p.unused.push(gone.join(', ')+': set up from documents only adds. Say it yourself to change what is planned');
}
/* ---------- Undo ---------- */
let UNDO = null;   /* the last Apply on Today: {label, at, ...}; one level, kept until the next Apply or a reload */
const clone = v => v===undefined ? undefined : JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a===undefined?null:a) === JSON.stringify(b===undefined?null:b);
const taskOf = (cid, id) => { const c = cById(cid); return c && (c.tasks||[]).find(x=>x.id===id); };
function undoBefore(p){
  const rec = {at:Date.now(), label:p.summary||'', prios:[], updates:[], removes:[], dupdates:[], sessions:[], info:null, onboard:null, days:{}, events:[], tasks:[], deliverables:[]};
  p.updates.forEach(u=>{ const t = taskOf(u.course, u.id); if(!t) return;
    const keys = [...new Set(Object.keys(u.changes).concat(['due','pin','status','waiting','doneOn','planned']))], before = {};
    keys.forEach(k=>{ before[k] = clone(t[k]); }); rec.updates.push({course:u.course, id:u.id, keys, before}); });
  (p.removes||[]).forEach(r=>{ const c = cById(r.course), i = c ? (c.tasks||[]).findIndex(x=>x.id===r.id) : -1; if(i>=0) rec.removes.push({course:c.id, at:i, task:clone(c.tasks[i])}); });
  p.dupdates.forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(d) rec.dupdates.push({course:c.id, id:d.id, date:d.date, state:d.state}); });
  (p.prios||[]).forEach(x=>{ const c = cById(x.course), d = c && (c.deliverables||[]).find(y=>y.id===x.id); if(d) rec.prios.push({course:c.id, id:d.id, before:d.prio, after:x.rank||undefined}); });
  (p.sessions||[]).forEach(e=>{ const c = cById(e.c); if(c && !(c.sessions||[]).some(x=>x.d===e.d && x.s===e.s)) rec.sessions.push({course:c.id, d:e.d, s:e.s}); });
  if(p.info && p.info.text && cById(p.info.course)) rec.info = {course:p.info.course, before:cById(p.info.course).info};
  if(p.onboard && cById(p.onboard)){ const c = cById(p.onboard); rec.onboard = {course:c.id, onboarded:c.onboarded, meets:c.meets}; }
  /* day documents (busy time, class work, skipped classes) are kept whole */
  const days = new Set(); (p.busy||[]).forEach(b=>b.days.forEach(d=>days.add(d))); (p.unbusy||[]).forEach(b=>days.add(b.day)); (p.classWork||[]).forEach(w=>days.add(w.day)); (p.skips||[]).forEach(x=>days.add(x.day));
  days.forEach(d=>{ rec.days[d] = {before:clone(DAYS[d]||null)}; });
  return rec;
}
function undoAfter(rec, p){
  rec.updates.forEach(u=>{ const t = taskOf(u.course, u.id); u.after = {}; if(t) u.keys.forEach(k=>{ u.after[k] = clone(t[k]); }); });
  rec.dupdates.forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); u.after = d ? d.date : null; });
  if(rec.info){ rec.info.after = (cById(rec.info.course)||{}).info; }
  Object.keys(rec.days).forEach(d=>{ rec.days[d].after = clone(DAYS[d]||null); });
  rec.tasks = (p._made||{}).tasks || []; rec.deliverables = (p._made||{}).deliverables || [];
  rec.events = (p.events||[]).filter(x=>x.op==='add' && x._id).map(x=>({id:x._id, title:x.title}));
  rec.calLeft = (p.events||[]).filter(x=>x.op!=='add').length;
  rec.n = applyCount(p);
  UNDO = rec;
}
async function undoApply(){
  const rec = UNDO; if(!rec) return '';
  UNDO = null;
  const touched = new Set(), kept = [];
  const touch = c => { if(c) touched.add(c); };
  /* new tasks and deadlines go, unless he already ticked the task done */
  rec.tasks.forEach(({course, id})=>{ const c = cById(course), t = taskOf(course, id); if(!t) return; if(t.status==='done'){ kept.push(t.title); return; } c.tasks = c.tasks.filter(x=>x!==t); touch(c); });
  rec.deliverables.forEach(({course, id})=>{ const c = cById(course); if(!c) return; if((c.tasks||[]).some(t=>t.did===id)){ kept.push((c.deliverables.find(d=>d.id===id)||{}).title||'a deadline'); return; } const n = (c.deliverables||[]).length; c.deliverables = (c.deliverables||[]).filter(d=>d.id!==id); if(c.deliverables.length!==n) touch(c); });
  /* changed tasks: each field back, where it is still what the Apply wrote (the day always: the organizer moves it) */
  rec.updates.forEach(u=>{ const t = taskOf(u.course, u.id); if(!t) return; let back = false;
    u.keys.forEach(k=>{ if(k!=='due' && !same(t[k], u.after[k])) return; if(k==='due' && !same(t.status, u.after.status)) return; if(u.before[k]===undefined) delete t[k]; else t[k] = clone(u.before[k]); back = true; });
    if(back) touch(cById(u.course)); });
  rec.removes.slice().sort((a,b)=>a.at-b.at).forEach(r=>{ const c = cById(r.course); if(!c || (c.tasks||[]).some(x=>x.id===r.task.id)) return; c.tasks = c.tasks||[]; c.tasks.splice(Math.min(r.at, c.tasks.length), 0, r.task); touch(c); });
  rec.dupdates.forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(!d || d.date!==u.after) return; d.date = u.date; d.state = u.state; touch(c); });
  (rec.prios||[]).forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(!d || (d.prio||undefined)!==u.after) return; if(u.before) d.prio = u.before; else delete d.prio; touch(c); });
  rec.sessions.forEach(s=>{ const c = cById(s.course); if(!c) return; const n = (c.sessions||[]).length; c.sessions = (c.sessions||[]).filter(x=>!(x.d===s.d && x.s===s.s)); if(c.sessions.length!==n) touch(c); });
  if(rec.info){ const c = cById(rec.info.course); if(c && c.info===rec.info.after){ if(rec.info.before===undefined) delete c.info; else c.info = rec.info.before; touch(c); } }
  if(rec.onboard){ const c = cById(rec.onboard.course); if(c){ ['onboarded','meets'].forEach(k=>{ if(rec.onboard[k]===undefined) delete c[k]; else c[k] = rec.onboard[k]; }); touch(c); } }
  Object.entries(rec.days).forEach(([d, x])=>{ if(!same(DAYS[d]||null, x.after)) return; if(x.before) DAYS[d] = clone(x.before); else DAYS[d] = {id:d, busy:[]}; saveDay(d); });
  touched.forEach(save);
  let calFail = 0;
  for(const e of rec.events){ try{ const r = await APP.call('eventDelete', {id:e.id, occ:'', span:'this'}); if(r && r.error) calFail++; }catch(err){ calFail++; } }
  if(rec.events.length) refreshCal();
  return 'Undone: '+rec.n+' change'+(rec.n===1?'':'s')+'.'
    + (kept.length ? ' Kept because you worked on '+(kept.length===1?'it':'them')+' since: '+kept.slice(0,3).map(x=>'"'+String(x).slice(0,50)+'"').join(', ')+'.' : '')
    + (rec.calLeft ? ' Calendar events that were moved or deleted are not put back; check Calendar.' : '')
    + (calFail ? ' '+calFail+' new calendar event'+(calFail===1?'':'s')+' could not be deleted.' : '');
}
const applyCount = p => (p.prios||[]).length + (p.unbusy||[]).length + (p.sessions||[]).length + (p.info && p.info.text ? 1 : 0) + p.tasks.length + p.updates.length + p.deliverables.length + p.dupdates.length + (p.removes||[]).length + (p.busy||[]).length + (p.classWork||[]).length + (p.skips||[]).length + evChangeCount(p);
/* a tick box on a proposal row: risky rows keep _ok (ticked to confirm), the others _off (unticked) */
document.addEventListener('change', e=>{
  const b = e.target.closest && e.target.closest('[data-pt]'); if(!b) return;
  const box = b.closest('.prop'), p = !box ? null : box.dataset.ctx==='meeting' ? (typeof BRAIN_OPEN!=='undefined' && BRAIN_OPEN && BRAIN_OPEN._proposal) : compose.proposal; if(!p) return;
  const key = b.dataset.pt, i = +b.dataset.i, on = b.checked;
  if(key==='info'){ if(p.info) p.info._off = !on; }
  else if(key==='sessions'){ const g = sessGroups(p.sessions||[])[i]; if(g) g.items.forEach(x=>{ x._off = !on; }); }
  else { const a = ACTIONS.find(x=>x.key===key), row = (p[key]||[])[i]; if(!a || !row) return; if(riskOf(a, row)==='risky') row._ok = on; else row._off = !on; }
  render();
});
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-pedit]'); if(!b) return; e.preventDefault(); e.stopPropagation();
  const box = b.closest('.prop'), p = !box ? null : box.dataset.ctx==='meeting' ? (typeof BRAIN_OPEN!=='undefined' && BRAIN_OPEN && BRAIN_OPEN._proposal) : compose.proposal; if(!p) return;
  const row = (p[b.dataset.pedit]||[])[+b.dataset.i]; if(row){ row._edit = !row._edit; render(); }
}, true);
