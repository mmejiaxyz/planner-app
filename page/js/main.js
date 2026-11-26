/* Updates, desktop widget, render, event handlers, data version, midnight reload, load. Part of page/index_v2.html; classic script, loaded in order. */
/* ---------- updates: pulled from the GitHub repo; data and permissions are kept ---------- */
let UPD = {state:'', msg:'', behind:0};
window.checkUpdates = async function(manual){
  if(!IN_APP) return;
  if(manual){ UPD = {state:'checking', msg:'', behind:0}; renderUpd(); }
  try{ const r = await APP.call('updateCheck');
    if(!r.ok){ UPD = manual ? {state:'error', msg:r.message||'Could not check for updates.'} : {state:''}; }
    else if(r.behind>0) UPD = {state:'available', behind:r.behind, msg:''};
    else UPD = manual ? {state:'current', msg:'Planner is up to date.'} : {state:''};
  }catch(e){ UPD = manual ? {state:'error', msg:e.message} : {state:''}; }
  renderUpd();
};
function renderUpd(){
  let el = document.getElementById('updbar');
  if(!UPD.state){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('div'); el.id = 'updbar'; document.querySelector('.wrap').prepend(el); }
  const txt = UPD.state==='checking' ? 'Checking for updates…' : UPD.state==='available' ? 'An update is ready ('+UPD.behind+' change'+(UPD.behind===1?'':'s')+'). Your plan, meetings and permissions are kept.' : UPD.state==='applying' ? 'Updating… a copy of your plan and notes is saved first. Planner restarts when done.' : UPD.msg;
  el.className = 'updbar '+UPD.state;
  el.innerHTML = '<span>'+esc(txt)+'</span>'+(UPD.state==='available'?'<button class="btn pri" data-upd="apply">Update now</button><button class="lnk" data-upd="later">Later</button>':(UPD.state==='current'||UPD.state==='error'?'<button class="lnk" data-upd="later">Close</button>':''));
}
document.addEventListener('click', async e=>{
  const b = e.target.closest('[data-upd]'); if(!b) return;
  if(b.dataset.upd==='later'){ UPD = {state:''}; return renderUpd(); }
  if(b.dataset.upd==='apply'){ UPD = {state:'applying'}; renderUpd(); try{ const r = await APP.call('updateApply'); if(!r.restart){ UPD = {state: r.ok?'current':'error', msg:r.message}; renderUpd(); } }catch(err){ UPD = {state:'error', msg:err.message}; renderUpd(); } }
});

/* ---------- desktop widget summary (written to widget.json by the app) ---------- */
let widgetTimer = null;
function widgetSnap(){
  const all = allTasks(), open = all.filter(({t})=>t.status!=='done' && t.due && t.due<=TODAY), overdue = open.filter(({t})=>t.due<TODAY);
  const hours = r1(open.reduce((a,{t})=>a+(+t.est||0),0)), load = r1(hoursOn(TODAY) + overdue.reduce((a,{t})=>a+(+t.est||0),0) + eventHours(TODAY));
  const now = new Date(), nowMin = now.getHours()*60+now.getMinutes(), tm = addDays(TODAY,1);
  const item = (x, day) => ({time: x.time.slice(0,5), title: x.raw, sub: (day==='tomorrow'?'Tomorrow':'') + (x.sub ? (day==='tomorrow'?' · ':'')+x.sub : ''), join: x.join||null, day});
  const agendaRaw = day => { const out = []; classesOn(day).forEach(e=>out.push({m:toMin(e.s), end:e.e?toMin(e.e):toMin(e.s)+60, time:e.s, raw:e.t, sub:classPlace(e)})); busyEventsOn(day).filter(e=>!e.allDay).forEach(e=>out.push({m:evMin(e.start), end:evMin(e.end), time:String(e.start).slice(11,16), raw:e.title, sub:eventPlace(e), join:meetLink(e)||null})); return out.sort((a,b)=>a.m-b.m); };
  const agenda = agendaRaw(TODAY).filter(x=>x.end>=nowMin).map(x=>item(x,'today')).concat(agendaRaw(tm).slice(0,2).map(x=>item(x,'tomorrow')));
  const tt = dayTimes(tm), firstTm = agendaRaw(tm)[0];
  const nx = deadlines(TODAY, addDays(TODAY,400))[0];
  return {updated: new Date().toISOString(), date: TODAY, day: pad(parse(TODAY).getDate()), weekday: fmt(TODAY,{weekday:'long'}), month: fmt(TODAY,{month:'long'}),
    tasksLeft: open.length, hours, heavy: load > HEAVY, carried: overdue.length, agenda,
    tomorrowLeave: tt ? toHM(tt.leave) : null, tomorrowFirst: firstTm ? firstTm.time+' '+firstTm.raw : null,
    next: nx ? {title: nx.d.title, course: nx.c.short, date: nx.d.date, days: diff(nx.d.date, TODAY)} : null,
    tasks: open.filter(({t})=>t.due===TODAY).slice(0,6).map(({c,t})=>({title:t.title, course:c.short, est:+t.est||0}))};
}
function pushWidget(){ if(!IN_APP || !courses.length) return; clearTimeout(widgetTimer); widgetTimer = setTimeout(()=>{ try{ APP.call('widget', {snap: widgetSnap()}).catch(()=>{}); }catch(e){} }, 2500); }

/* ---------- render ---------- */
const TABS = ['today','calendar','courses','all-tasks','brain','tasks'];   /* tasks: the phone's one list (phone.js) */
function render(){
  document.querySelectorAll('nav.tabs a').forEach(a=>{ if(a.dataset.tab===tab) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  if(!courses.length){ if(typeof PHONE!=='undefined' && PHONE && ready) document.getElementById('app').innerHTML = phoneBlock(true); return; }   /* the phone before its first plan: pair or wait for the Mac */
  const app = document.getElementById('app');
  const ae = document.activeElement, fid = ae && ae.id, sel = fid && ('selectionStart' in ae) ? [ae.selectionStart, ae.selectionEnd] : null;
  if(typeof PHONE!=='undefined' && PHONE){ app.innerHTML = phRender(); document.querySelectorAll('nav.tabs a').forEach(a=>{ if(a.dataset.tab===tab) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); }); phSheets(); }
  else app.innerHTML = tab==='today'?viewToday(): tab==='calendar'?viewCalendar(): tab==='courses'?viewCourses(): tab==='brain'?viewBrain(): viewAll();
  if(typeof IN_APP!=='undefined' && IN_APP) pushWidget();
  if(typeof usageView==='function') usageView();   /* usage log: tab and calendar level (usage.js) */
  if(typeof chatRender==='function') chatRender();   /* the floating planner chat (chatwin.js) */
  if(typeof IN_APP!=='undefined' && IN_APP && tab==='brain'){ if(BRAIN_OPEN) updateStage(); const th = document.getElementById('thread2'); if(th) th.scrollTop = th.scrollHeight; }
  if(fid){ const el = document.getElementById(fid); if(el && el!==document.activeElement){ el.focus(); if(sel && el.setSelectionRange) try{ el.setSelectionRange(sel[0], sel[1]); }catch(e){} } }
  app.querySelectorAll('[data-pos]').forEach(el=>{ const [t,h,l,w] = el.dataset.pos.split(',').map(Number); Object.assign(el.style,{top:t+'px',height:h+'px',left:'calc('+l+'% + 3px)',width:'calc('+w+'% - 6px)',right:'auto'}); });
}
function route(){
  const h = (location.hash||'').replace('#','');
  /* Week and Term live in the Calendar tab now; their old links open its Week and Year levels */
  if(h==='week' || h==='term'){ CV.level = h==='week' ? 'week' : 'year'; if(h==='week' && weekAnchor) CV.anchor = weekAnchor; tab = 'calendar'; }
  else tab = TABS.includes(h) ? h : 'today';
  if(tab==='tasks' && !(typeof PHONE!=='undefined' && PHONE)) tab = 'all-tasks';
  render();
}
window.addEventListener('hashchange', ()=>{ route(); window.scrollTo(0,0); });

/* ---------- events ---------- */
/* Ticking a task opens a small hours field. Enter or Done marks it done (an empty field records no time), Escape or clicking away cancels. */
function askSpent(row, btn, c, t){
  const open = document.querySelector('.spent.ask'); if(open) open.remove();
  const f = document.createElement('label'); f.className = 'spent ask';
  f.innerHTML = 'Took <input type="number" inputmode="decimal" step="0.25" min="0" placeholder="'+esc(t.est||'')+'" aria-label="Hours it actually took: '+esc(t.title)+'"> h <button type="button" class="btn spent-ok">Done</button> <span class="faint">'+(PHONE?'empty = no time':'Enter to mark done · empty = no time')+'</span>';
  const tt = row.querySelector('.ttitle'); (tt ? tt.parentElement : row.classList.contains('cell') ? row : (row.querySelector(':scope > span') || row)).appendChild(f);
  const i = f.querySelector('input'); let done = false;
  const commit = () => { done = true; const v = Number(i.value); setStatus(t, 'done'); if(v>0) t.spent = Math.min(24, Math.round(v*4)/4); else delete t.spent;   /* at most a day's work (19 Nov 2026 user test: 250 h was kept) */ save(c); render(); };
  const ok = f.querySelector('.spent-ok');
  ok.addEventListener('pointerdown', e=>e.preventDefault());   /* keep the field focused, so blur does not close it first */
  ok.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); commit(); });
  i.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); commit(); }
    else if(e.key==='Escape'){ e.preventDefault(); done = true; f.remove(); }
    e.stopPropagation();
  });
  i.addEventListener('blur', ()=>{ if(!done) setTimeout(()=>f.remove(), 0); });
  i.focus();
}
document.addEventListener('click', e=>{
  const ah = e.target.closest('[data-ahead]');
  if(ah){ e.preventDefault(); aheadAct(ah); return; }
  const og = e.target.closest('[data-org]');
  if(og){ e.preventDefault(); organizeAct(og.dataset.org); return; }
  const bu = e.target.closest('[data-busy]');
  if(bu){ e.preventDefault(); const [day, i] = bu.dataset.busy.split('|'); removeBusy(day, +i); render(); return; }
  const ev = e.target.closest('[data-ev],[data-evnew],[data-evact]');
  if(ev){ e.preventDefault(); if(ev.dataset.evact) evAct(ev.dataset.evact); else if(ev.dataset.evnew) openEvEdit(null, ev.dataset.evnew); else { const x = evByKey(ev.dataset.ev); if(x) openEvEdit(x); } return; }
  const wk = e.target.closest('[data-week]');
  if(wk){ const v = Number(wk.dataset.week); if(v===0){ weekOff = 0; weekAnchor = null; } else weekOff += v; render(); return; }
  const hu = e.target.closest('[data-hu]');
  if(hu){ HU_I += Number(hu.dataset.hu); render(); return; }
  const go = e.target.closest('[data-go]');
  if(go){ cvGo('week', go.dataset.go); return; }
  const dd = e.target.closest('[data-ddone]');
  if(dd){ e.preventDefault(); const [cid, did] = dd.dataset.ddone.split('|'), c = cById(cid), d = c && (c.deliverables||[]).find(x=>x.id===did); if(!d) return; if(d.done) delete d.done; else d.done = TODAY; save(c); render(); return; }
  const ph = e.target.closest('.phase[data-key]');
  if(ph){ const k = ph.dataset.key; openKeys.has(k) ? openKeys.delete(k) : openKeys.add(k); render(); return; }
  const b = e.target.closest('[data-act]'); if(!b || b.tagName==='SELECT') return;
  const row = b.closest('[data-c]'); if(!row) return;
  const c = cById(row.dataset.c); const t = c && (c.tasks||[]).find(x=>x.id===row.dataset.t); if(!t) return;
  if(b.dataset.act==='toggle'){
    if(t.status==='done') setStatus(t, 'todo');
    else { askSpent(row, b, c, t); return; }
  }
  else if(b.dataset.act==='tomorrow'){ const nd = addDays(t.due && t.due>TODAY ? t.due : TODAY, 1), ld = Organizer.lastDayOf(c,t); if(ld && nd > ld) return; t.due = nd; t.pin = t.due; setTimeout(()=>overNote(nd), 50); }
  else if(b.dataset.act==='remove'){
    if(!b.dataset.sure){ b.dataset.sure = '1'; b.textContent = 'Remove for sure'; b.style.color = 'var(--coral)'; setTimeout(()=>{ if(b.isConnected){ delete b.dataset.sure; b.textContent = 'Remove'; b.style.color = ''; } }, 4000); return; }
    c.tasks = c.tasks.filter(x=>x!==t); save(c);
    render(); return;
  }
  else if(b.dataset.act==='context'){ compose = freshCompose(); compose.focus = {course:c.id, id:t.id}; chatOpen(true); render(); setTimeout(()=>{ const el = document.getElementById('cmp-text'); if(el) el.focus(); }, 60); return; }
  else return;
  save(c); render();
});
document.addEventListener('toggle', e=>{ const g = e.target; if(g.classList && g.classList.contains('cgroup')){ const k = 'closed:'+g.dataset.key.slice(6); g.open ? openKeys.delete(k) : openKeys.add(k); } }, true);
document.addEventListener('change', e=>{
  const el = e.target;
  if(el.dataset && el.dataset.tdl){ const [cid,tid] = el.dataset.tdl.split('|'); const msg = taskDeadline(cid, tid, el.value); if(msg){ compose.done = msg; if(typeof flToast==='function') flToast(msg); render(); } return; }
  if(el.dataset && el.dataset.dprio){ const [cid,did] = el.dataset.dprio.split('|'), c = cById(cid), d = c && (c.deliverables||[]).find(x=>x.id===did); if(!d) return; const n = +el.value||0; if(n) d.prio = n; else delete d.prio; save(c); render(); return; }   /* priority by hand (Courses) */
  if(el.dataset && el.dataset.dl){ const [cid,did] = el.dataset.dl.split('|'); const msg = moveDeadline(cid, did, el.value); if(msg){ compose.done = msg; render(); } return; }
  if(el.dataset && el.dataset.act==='where'){
    const row = el.closest('[data-c]'); const c = cById(row.dataset.c); const t = c && (c.tasks||[]).find(x=>x.id===row.dataset.t); if(!t) return;
    t.where = deskOnly(c) ? 'desk' : el.value; save(c); render(); return;
  }
  if(el.dataset && el.dataset.act==='moveday'){
    const row = el.closest('[data-c]'); const c = cById(row.dataset.c); const t = c && (c.tasks||[]).find(x=>x.id===row.dataset.t); if(!t || !el.value) return;
    if(moveOk(c, t, el.value)) moveTo(c, t, el.value);
    else if(el.value!==t.due && typeof flToast==='function') flToast('Not moved: '+(el.value < TODAY ? 'that day is past.' : Organizer.partInfo(t) ? 'parts stay in order, and work stays before its last day.' : 'that is after its last day.'));
    render(); return;
  }
  if(el.dataset && el.dataset.act==='status'){
    const row = el.closest('[data-c]'); const c = cById(row.dataset.c); const t = c && (c.tasks||[]).find(x=>x.id===row.dataset.t); if(!t) return;
    setStatus(t, el.value); save(c); render(); return;
  }
  if(el.id==='flt-course'){ fCourse = el.value; render(); }
  if(el.id==='flt-status'){ fStatus = el.value; render(); }
});

/* ---------- data version ----------
   Each course document carries "v". Older documents are brought up to date once on load, then saved.
   v2 (3 Nov 2026): today pulls no longer change "where" or keep "back"; a task still marked from the old way gets its
   train or metro place back. */
const PLAN_VERSION = 2;
const MIGRATIONS = {
  2: c => (c.tasks||[]).forEach(t=>{ if(t.wasWhere){ if(!deskOnly(c)) t.where = t.wasWhere; delete t.wasWhere; } delete t.back; })
};
function migrate(list){
  const changed = [];
  list.forEach(c=>{ const v = Number(c.v)||1; if(v >= PLAN_VERSION) return; for(let k = v+1; k <= PLAN_VERSION; k++) if(MIGRATIONS[k]) MIGRATIONS[k](c); c.v = PLAN_VERSION; changed.push(c); });
  return changed;
}

/* The date is read once at load (TODAY). When the clock passes midnight the page reloads, so every view, the organizer and
   doneOn use the new day. It waits while something is in progress (planning, recording, a help session, typing). */
function checkDay(){
  if(qToday || iso(new Date())===TODAY) return;
  const busy = compose.busy || (compose.draft||'').trim() || REC.recording || RECSTAGE || HELP || document.querySelector('input:focus, textarea:focus');
  if(busy){ clearTimeout(checkDay.t); checkDay.t = setTimeout(checkDay, 60000); return; }
  location.reload();
}
setInterval(checkDay, 60000); window.addEventListener('focus', checkDay); document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkDay(); });

/* ---------- load ---------- */
(async function(){
  const loading = document.getElementById('loading');
  const timer = setTimeout(()=>{ if(!courses.length && loading) loading.textContent = 'Your plan did not load. Open this page signed in to your account, or ask Claude to restore the plan.'; }, 10000);
  try{ dbh = window.claude && claude.use ? await claude.use('db') : null; }catch(e){ dbh = null; }
  if(!dbh){ clearTimeout(timer); if(loading) loading.textContent = 'Sign in to load your plan.'; return; }
  /* The profile first (term, places, rules, colours, timetable: profile.js), so the first render already uses it.
     A plan without one runs on the defaults; a later change re-renders. */
  await new Promise(res=>{
    let first = true; const done = p => { applyProfile(p, TODAY); if(first){ first = false; res(); } else if(ready){ ORG.key = ''; render(); } };
    try{ dbh.collection('profile').onSnapshot(snap=>done(docsOf(snap).map(dataOf).find(x=>x.id==='me')), ()=>done(null)); }catch(e){ done(null); }
    setTimeout(()=>{ if(first) done(null); }, 4000);
  });
  dbh.collection('courses').onSnapshot(snap=>{
    clearTimeout(timer);
    const all = docsOf(snap).map(dataOf).map(c=>Object.assign({tasks:[],deliverables:[]},c)).sort((a,b)=>(a.order||0)-(b.order||0));
    REMOVED = all.filter(c=>c.removed); courses = all.filter(c=>!c.removed);
    migrate(courses).forEach(save);
    /* Personal admin that belongs to no course (scholarships, applications, forms, offices) has its own project, so its
       deadlines are kept like any other (19 Nov 2026: "Apply for the scholarship before 15 Dec" lost its deadline and fell on today). */
    if(IN_APP && !all.some(c=>c.id===ADMIN_ID)){ const c = {id:ADMIN_ID, name:'Admin', short:'Admin', kind:'project', group:'Personal', note:'Scholarships, applications, forms, offices', hue:270, order:Math.max(0,...courses.map(x=>x.order||0))+1, deliverables:[], tasks:[], v:PLAN_VERSION}; courses.push(c); save(c); }
    ready = true; route();
    if(IN_APP && !window.__ext){ window.__ext = 1; scheduleOrganize(3000); pollJobs(); jobPoll = setInterval(()=>{ if(document.hidden && !REC.recording) return; if(Object.values(JOBS).some(ACTIVE) || REC.recording || RECSTAGE) pollJobs(); }, 4000);
      APP.call('recover').then(async r=>{ const n = (r.recovered||[]).length; RECSTAGE = ''; if(n){ BRAIN = await APP.call('brainList'); BRAIN_MSG = 'Recovered '+n+' unfinished recording'+(n===1?'':'s')+' after Planner closed.'; UPD = {state:'current', msg:'Recovered '+n+' unfinished recording'+(n===1?'':'s')+'. Open Brain to see '+(n===1?'it':'them')+'.'}; renderUpd(); } render(); }).catch(()=>{}); document.querySelector('nav.tabs a[data-tab="brain"]').hidden = false; refreshExternal(); setInterval(refreshExternal, 300000); setInterval(pushWidget, 600000); setTimeout(()=>window.checkUpdates(false), 8000); setInterval(()=>window.checkUpdates(false), 6*3600*1000); window.addEventListener('focus', refreshExternal); }
  }, err=>{ console.error(err); });
  dbh.collection('reads').onSnapshot(snap=>{ READS = {}; docsOf(snap).map(dataOf).forEach(r=>{ READS[r.id] = r; }); }, ()=>{});   /* reading time per PDF (readtime.js) */
  dbh.collection('flags').onSnapshot(snap=>{ flags = docsOf(snap).map(dataOf); if(ready) render(); }, ()=>{});
  dbh.collection('days').onSnapshot(snap=>{ DAYS = {}; docsOf(snap).map(dataOf).forEach(d=>{ if(d.id >= addDays(TODAY,-1)) DAYS[d.id] = d; }); if(ready){ ORG.key = ''; scheduleOrganize(); render(); } }, ()=>{});
})();
/* ---------- light / dark ----------
   The header button switches between light and dark and keeps the choice; Option-click goes back to following the Mac.
   In the app the window, the PDF view and the native cards follow too (op "appearance"). */
const THEME_ICON = {sun:'<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></svg>',
  moon:'<svg viewBox="0 0 20 20"><path d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1z"/></svg>'};
function themeButton(){
  const b = document.getElementById('themebtn'); if(!b) return;
  const dark = document.documentElement.classList.contains('dark'), pref = window.themePref ? themePref() : '';
  b.innerHTML = dark ? THEME_ICON.sun : THEME_ICON.moon;
  b.title = (dark ? 'Switch to light' : 'Switch to dark') + (pref ? ' · Option-click to follow the Mac' : ' · now following the Mac');
  b.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
}
function themeSet(t){
  try{ if(t) localStorage.setItem('theme', t); else localStorage.removeItem('theme'); }catch(e){}
  if(typeof IN_APP!=='undefined' && IN_APP) APP.call('appearance', {mode: t || 'auto'}).catch(()=>{});
  if(window.themeApply) themeApply(); themeButton(); document.dispatchEvent(new Event('themechange')); render();
}
document.getElementById('themebtn') && document.getElementById('themebtn').addEventListener('click', e=>{
  if(e.altKey) return themeSet('');
  themeSet(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
});
if(window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeButton);
themeButton();
if(typeof IN_APP!=='undefined' && IN_APP && window.themePref && themePref()) APP.call('appearance', {mode: themePref()}).catch(()=>{});

route();
