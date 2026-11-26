/* Usage log (24 Nov 2026, the user's request: "collect data on how I use it, sessions and so on to improve the app to my way of using it").
   Mac only, never synced: events go to the Mac app (op `usage`), which appends them to
   ~/Library/Application Support/Planner/usage/<YYYY-MM>.jsonl. The app itself logs launch, quit, focus, sleep and wake.
   Titles and note text are kept (the user's choice): the file never leaves the Mac. `node tools/usage.js` summarizes it.
   System level, not per view: plan changes are a diff in save() (core.js), views come from render() (main.js),
   AI calls from one wrapper around APP.call, actions from one click listener. Who made a change (`src`) is set by
   wrapping the few functions that change the plan on his behalf: the organizer, chat Apply and Undo, phone changes.
   Loaded after brain.js, before main.js. */
const USAGE = {buf:[], timer:null, src:'you', base:null, view:'', on:false};
USAGE.on = !!(window.APP && !(typeof PHONE!=='undefined' && PHONE));

function track(k, data){
  if(!USAGE.on) return;
  USAGE.buf.push(Object.assign({t:new Date().toISOString(), k}, data||{}));
  if(USAGE.buf.length>=50) usageFlush(); else if(!USAGE.timer) USAGE.timer = setTimeout(usageFlush, 3000);
}
function usageFlush(){
  clearTimeout(USAGE.timer); USAGE.timer = null;
  if(!USAGE.buf.length) return;
  const events = USAGE.buf; USAGE.buf = [];
  try{ USAGE.call('usage', {events}).catch(()=>{}); }catch(e){}
}
const usageCut = (s, n) => { s = String(s==null?'':s).replace(/\s+/g,' ').trim(); return s.length>n ? s.slice(0,n)+'…' : s; };

/* ---------- plan changes: a diff against the last saved copy of each course ---------- */
const U_TASK = ['title','due','est','status','where','pin','did','spent'];
const U_DEL = ['title','date','state'];
const U_COURSE = ['removed','folder','meets','onboarded'];
function usageShape(c){
  const pick = (o, keys) => { const r = {}; keys.forEach(k=>{ if(o[k]!==undefined && o[k]!=='') r[k] = o[k]; }); return r; };
  const tasks = {}, dels = {};
  (c.tasks||[]).forEach(t=>{ tasks[t.id] = pick(t, U_TASK); });
  (c.deliverables||[]).forEach(d=>{ dels[d.id] = pick(d, U_DEL); });
  return {course: pick(c, U_COURSE), tasks, dels};
}
function usageBaseline(){
  if(USAGE.base || !courses.length) return;
  USAGE.base = {}; courses.concat(typeof REMOVED!=='undefined' ? REMOVED : []).forEach(c=>{ USAGE.base[c.id] = usageShape(c); });
}
function usageChanges(a, b, keys){
  const ch = {}; keys.forEach(k=>{ if(JSON.stringify(a[k])!==JSON.stringify(b[k])) ch[k] = [a[k]===undefined?null:a[k], b[k]===undefined?null:b[k]]; });
  return Object.keys(ch).length ? ch : null;
}
function usageSaved(c){
  if(!USAGE.on || !c || !c.id) return;
  if(!USAGE.base){ usageBaseline(); if(USAGE.base) USAGE.base[c.id] = usageShape(c); return; }   /* first save before the first render: only the baseline */
  const before = USAGE.base[c.id], now = usageShape(c), src = USAGE.src;
  USAGE.base[c.id] = now;
  if(!before){ track('course.add', {src, c:c.id, name:c.name||c.short||''}); return; }
  const cch = usageChanges(before.course, now.course, U_COURSE);
  if(cch) track('course.change', {src, c:c.id, ch:cch});
  Object.keys(now.tasks).forEach(id=>{
    const a = before.tasks[id], b = now.tasks[id];
    if(!a){ track('task.add', Object.assign({src, c:c.id, id}, b)); return; }
    const ch = usageChanges(a, b, U_TASK); if(!ch) return;
    const ev = {src, c:c.id, id, title:b.title, ch};
    if(ch.status && b.status==='done'){ const t = (c.tasks||[]).find(x=>x.id===id) || {}; Object.assign(ev, {est:b.est, spent:b.spent==null?null:b.spent, due:b.due, doneOn:t.doneOn||null, planned:t.planned||null, where:b.where}); }
    track('task.change', ev);
  });
  Object.keys(before.tasks).forEach(id=>{ if(!now.tasks[id]) track('task.remove', Object.assign({src, c:c.id, id}, before.tasks[id])); });
  Object.keys(now.dels).forEach(id=>{
    const a = before.dels[id], b = now.dels[id];
    if(!a){ track('deliv.add', Object.assign({src, c:c.id, id}, b)); return; }
    const ch = usageChanges(a, b, U_DEL); if(ch) track('deliv.change', {src, c:c.id, id, title:b.title, ch});
  });
  Object.keys(before.dels).forEach(id=>{ if(!now.dels[id]) track('deliv.remove', Object.assign({src, c:c.id, id}, before.dels[id])); });
}
/* who changed the plan: set while one of these runs (async ones until they finish), then put back */
function usageAs(name, src){
  const f = window[name]; if(typeof f!=='function' || f._usage) return;
  const w = function(...args){
    const prev = USAGE.src; USAGE.src = src; let r;
    try{ r = f.apply(this, args); }
    catch(e){ USAGE.src = prev; throw e; }
    if(r && typeof r.then==='function') return r.finally(()=>{ USAGE.src = prev; });
    USAGE.src = prev; return r;
  };
  w._usage = true; window[name] = w;
}

/* ---------- views: which tab and calendar level, so time per view comes from the gaps ---------- */
function usageView(){
  if(!USAGE.on) return;
  usageBaseline();
  const lvl = tab==='calendar' && typeof CV!=='undefined' ? CV.level : '';
  const v = tab + (lvl?'/'+lvl:'');
  if(v!==USAGE.view){ USAGE.view = v; track('view', {v}); }
}

/* ---------- AI calls: feature (the calling file and function), model, time, tokens, cost, errors ---------- */
const U_AI = ['llm','llmStream','helpAsk'];
function usageCaller(){
  const lines = String(new Error().stack||'').split('\n');
  for(const l of lines){ const m = l.match(/^(?:async\*)?([\w$.]*)@.*\/js\/([\w-]+)\.js/) || l.match(/at\s+([\w$.]+)\s+\(.*\/js\/([\w-]+)\.js/);
    if(m && m[2]!=='usage') return m[2]+(m[1]?':'+m[1]:''); }
  return '';
}
if(USAGE.on){
  USAGE.call = window.APP.call.bind(window.APP);
  window.APP.call = function(op, args){
    if(!U_AI.includes(op)) return USAGE.call(op, args);
    const t0 = Date.now(), from = usageCaller(), a = args||{};
    const base = {op, from, asked: a.model || (a.order||[])[0] || ''};
    if(op==='helpAsk') Object.assign(base, {reading: !!a.reading, asked: a.model || ''});
    return USAGE.call(op, args).then(r=>{
      r = r || {};
      track('ai', Object.assign(base, {ms:Date.now()-t0, provider:r.provider||'', model:r.model||'', tokens:r.tokens||null, cost:r.cost||null,
        ok: !!(r.text || r.answer || r.ok || r.result), err: r.error ? usageCut(r.error, 200) : (r.errors||[]).length ? usageCut(r.errors.join(' · '), 200) : undefined}));
      return r;
    }, e=>{ track('ai', Object.assign(base, {ms:Date.now()-t0, ok:false, err:usageCut(e && e.message, 200)})); throw e; });
  };

  /* ---------- actions: every button, link and tick, by its data-* name and label ---------- */
  document.addEventListener('click', e=>{
    const el = e.target.closest && e.target.closest('button, a, summary, [data-tab], input[type=checkbox], [role=button]');
    if(!el) return;
    const data = {}; Object.keys(el.dataset||{}).slice(0,3).forEach(k=>{ data[k] = usageCut(el.dataset[k], 60); });
    const label = usageCut(el.getAttribute('aria-label') || el.textContent || el.title || '', 50);
    const where = el.closest('#pchat') ? 'chat' : el.closest('#reader, .reader') ? 'reader' : el.closest('.help, #help') ? 'help' : '';
    track('click', Object.assign({v:USAGE.view, label}, Object.keys(data).length ? {data} : {}, where ? {in:where} : {}, el.type==='checkbox' ? {checked:el.checked} : {}));
  }, true);

  /* ---------- friction: page errors and console errors ---------- */
  window.addEventListener('error', e=>track('error', {msg:usageCut(e.message, 300), at:(e.filename||'').split('/').pop()+':'+(e.lineno||'')}));
  window.addEventListener('unhandledrejection', e=>track('error', {msg:usageCut(e.reason && (e.reason.message || e.reason), 300), kind:'promise'}));
  const cerr = console.error.bind(console);
  console.error = function(...a){ try{ track('error', {msg:usageCut(a.map(x=>x && x.message || (typeof x==='string' ? x : JSON.stringify(x))).join(' '), 300), kind:'console'}); }catch(e){} return cerr(...a); };

  document.addEventListener('visibilitychange', ()=>{ track('page', {state:document.visibilityState}); if(document.visibilityState==='hidden') usageFlush(); });
  window.addEventListener('pagehide', usageFlush);
  track('page', {state:'load'});

  /* notes typed into the planner chat, and what was applied from a preview */
  const note = window.runCompose;
  if(typeof note==='function') window.runCompose = function(...a){ const s = (compose.draft||'').trim(); if(s && !compose.busy) track('note', {text:usageCut(s, 2000), setup:!!compose.setup, thread:compose.thread.length}); return note.apply(this, a); };
  usageAs('runOrganize', 'organizer');
  usageAs('organizeAct', 'organizer-undo');
  usageAs('applyProposal', 'chat');
  usageAs('undoApply', 'chat-undo');
  usageAs('pullPhoneOps', 'phone');
  const ap = window.applyProposal;
  window.applyProposal = function(p){
    try{ const n = k => (p[k]||[]).length;
      track('apply', {tasks:n('tasks'), updates:n('updates'), removes:n('removes'), deliverables:n('deliverables'), dupdates:n('dupdates'), events:n('events'), busy:n('busy'), skips:n('skips'), sessions:n('sessions')}); }catch(e){}
    return ap.apply(this, arguments);
  };
}
