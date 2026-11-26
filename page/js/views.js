/* The planner views: Today, Week, Term, Courses, All tasks. Part of page/index_v2.html; classic script, loaded in order. */
/* ---------- Today (M1, Mac redesign agreed in Figma 26 Nov 2026: design/mac-redesign/mockups.html) ----------
   Left: what to do now (the reading he is on, today's open work, Next up he can pull forward). Right: the day as a timeline
   with leaving and coming home on it, then every deadline of the next 7 days. No big date, hours box, heads-up or commute card.
   A row's actions (Move, Deadline, Get help, Remove…) open with a click on the row, as on the phone. */
let TK_OPEN = '';          /* c|t of the row whose actions are open (Today, Week) */
let TD_DONE = false;       /* Today: done list open */
const tkKey = (c,t) => c.id+'|'+t.id;
const realDl = (c,t) => { const d = delivOf(c,t); return d && d.date || ''; };
const placeWord = t => t.where==='train' ? 'train' : t.where==='phone' ? 'metro' : t.where==='class' ? 'in class' : '';
/* The dates are the controls (26 Nov 2026, the user's request: "I want to click in the date and be able to change it", then "make the
   interactions consistent"): everywhere on the Mac the planned day and the deadline are clickable dates (All tasks, Today,
   Week, Courses). Planned moves the task (moveOk, the rule drag uses: not before today, not past its last day, parts in
   order; the day is pinned). Deadline moves the deliverable's real date (taskDeadline). A date that cannot change is plain
   text, with "Last day" / "Deadline passed" when that is why. */
const dayLab = d => esc(fmt(d,{weekday:'short',day:'numeric'})+(d.slice(0,7)!==TODAY.slice(0,7)?' '+fmt(d,{month:'short'}):''));
function plannedPick(c,t,cls){
  const ld = t.due ? Organizer.lastDayOf(c,t) : '';
  if(t.status!=='done' && t.due && (!ld || ld > TODAY))
    return '<label class="mx-pick'+(cls?' '+cls:'')+'" title="Pick another day">'+dayLab(t.due)+'<input type="date" data-act="moveday" min="'+TODAY+'"'+(ld?' max="'+ld+'"':'')+' value="'+esc(t.due>=TODAY?t.due:TODAY)+'" aria-label="Planned day of '+esc(t.title)+'"></label>';
  const why = t.status!=='done' && ld && ld <= TODAY ? (ld < TODAY ? 'deadline passed' : 'last day') : '';
  return '<span class="'+(cls||'')+'"'+(why?' title="Cannot move: '+why+'"':'')+'>'+(t.due?dayLab(t.due):'—')+'</span>';
}
function deadlinePick(c,t,cls){
  const d = delivOf(c,t), dl = d && d.date || '';
  if(t.status!=='done' && taskDlOk(c,t))
    return '<label class="mx-pick'+(cls?' '+cls:'')+'" title="Pick the deadline'+(d?' of '+esc(d.title)+' (its other steps keep it too)':'')+'">'+(dl?dayLab(dl):'Set')+'<input type="date" data-tdl="'+esc(c.id)+'|'+esc(t.id)+'" min="'+TODAY+'" value="'+esc(dl)+'" aria-label="Deadline of '+esc(t.title)+'"></label>';
  return '<span class="'+(cls||'')+'"'+(d && (d.state==='ongoing' || isSession(c,d)) ? ' title="Set by the class date"' : '')+'>'+(dl?dayLab(dl):'—')+'</span>';
}
/* the two dates as a line, for row actions and cards */
function datePicks(c,t){
  const ld = t.status!=='done' && t.due ? Organizer.lastDayOf(c,t) : '';
  const tag = ld && ld <= TODAY ? ' <span class="tag warn">'+ICON.warn+(ld < TODAY ? 'Deadline passed' : 'Last day')+'</span>' : '';
  return '<span class="mx-dates">Planned '+plannedPick(c,t)+' · Deadline '+deadlinePick(c,t)+tag+'</span>';
}
/* what sits behind a click on a row */
function tkActs(c,t){
  const d = delivOf(c,t);
  if(t.status==='done') return '<div class="mx-acts">'+(d?'<span class="faint">'+esc(d.title)+'</span>':'')+spentField(t)+'<button class="lnk" data-act="toggle">Mark not done</button></div>';
  return '<div class="mx-acts">'+(d?'<span class="faint">'+esc(d.title)+'</span>':'')+datePicks(c,t)+pdfBtns(c,t)+whereTag(c,t)+statusChip(t)
    + (IN_APP?'<button class="lnk" data-act="context">Ask the planner</button>':'')+rmLink()
    + (t.note?'<div class="tnote">'+esc(t.note)+'</div>':'')+(typeof waitDraft==='function'?waitDraft(t):'')+'</div>';
}
/* one task as a line: tick, title, course · place, hours; o.sub replaces the second line, o.chip adds Do now */
function tkRow(c,t,o={}){
  const k = tkKey(c,t), open = TK_OPEN===k, done = t.status==='done';
  const sub = o.sub || [esc(c.short)].concat(placeWord(t) ? [placeWord(t)] : [])
    .concat(!done && t.due && t.due<TODAY ? ['<span class="due">from '+esc(fmtShort(t.due))+'</span>'] : [])
    .concat(o.trip ? ['on the commute'] : []).join(' · ');
  return '<div class="mx-tk'+(open?' open':'')+(done?' dn':'')+(o.next?' next':'')+'" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'" data-tk="'+esc(k)+'">'
    + '<button class="check" data-act="toggle" aria-label="'+(done?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'
    + '<div class="mx-m"><div class="ttitle">'+esc(t.title)+'</div><div class="mx-su">'+sub+(typeof waitTag==='function'?waitTag(c,t):'')+'</div>'+(open?tkActs(c,t):'')+'</div>'
    + (o.chip ? '<button class="mx-chip" data-donow="'+esc(k)+'" title="Plan it for today">Do now</button>' : '')
    + '<span class="mx-h mono">'+(t.est?esc(t.est)+' h':'')+'</span></div>';
}
/* the reading he is on: open readings with a PDF, the one with a kept reader session first (the phone's rule, phone.js) */
function readCard(r){
  const c = r.c, t = r.t, d = delivOf(c,t), pg = t.pages, inRange = pg && r.page >= pg.from && r.page <= pg.to;
  const total = pg ? pg.to - pg.from + 1 : 0, left = inRange ? pg.to - r.page + 1 : total;
  const title = String(t.title).replace(READ_RE, '').replace(/\s*\(part \d+ of \d+\)\s*$/i,'').trim();
  const s = [t.est ? esc(t.est)+' h' : '', placeWord(t) ? 'on the '+placeWord(t) : ''].filter(Boolean).join(' · ');
  return '<section class="mx-read" aria-label="Reading now"><div>'
    + '<div class="lbl">Reading · '+esc(c.short)+(d?' · for '+esc(d.title.replace(/^Session\s*/i,'Session ')):'')+'</div>'
    + '<div class="mx-rt">'+esc(title)+'</div>'+(s?'<div class="mx-rs">'+s+'</div>':'')
    + (total ? '<div class="mx-bar"><i style="width:'+Math.round(100*(total-left)/total)+'%"></i></div>' : '')
    + '<div class="mx-rp mono">'+(r.page ? 'p. '+r.page+(left?' · '+left+' page'+(left===1?'':'s')+' left':'') : total ? total+' pages' : '')+'</div></div>'
    + '<div class="mx-rb">'+helpBtn(c,t)+'<button class="btn pri" data-file="'+esc(fileRef(c,r.f))+'" data-ctx="'+esc(c.id+'|'+t.id)+'">'+(r.page?'Continue reading':'Start reading')+'</button></div></section>';
}
/* the day as a timeline: leaving and home, classes, events, busy times */
function dayLine(day){
  const items = [], now = nowMinutes(), tm = dayTimes(day);
  if(tm) items.push({m:tm.leave, e:tm.leave+1, time:toHM(tm.leave), h:'<div class="ti">Leave home</div><div class="su">home about '+toHM(tm.home)+'</div>', g:true});
  allClassesOn(day).forEach(e=>{ const k = skipIdx(day, x=>x.c===e.c && x.s===e.s); items.push({m:toMin(e.s), e:e.e?toMin(e.e):toMin(e.s)+60, time:e.s, h:'<div class="ti">'+skipName(esc(e.t), k>=0)+'</div><div class="su">'+esc(classPlace(e))+(k>=0?skipTag(day,k):'')+'</div>'}); });
  if(HAS_CAL) eventsOn(day).forEach(e=>{ const k = skipIdx(day, x=>x.ev===evKey(e));
    items.push({m:e.allDay?-1:evMin(e.start), e:e.allDay?-1:evMin(e.end), time:e.allDay?'all day':String(e.start).slice(11,16), g:true,
      h:'<div class="mx-evr"><div><div class="ti">'+skipName(evTitle(e), k>=0)+'</div><div class="su">'+evSub(e)+(k>=0?skipTag(day,k):'')+'</div></div>'+'</div>'}); });
  busyOn(day).forEach((b,i)=>items.push({m:b.from, e:b.to, time:toHM(b.from), g:true, h:'<div class="ti">Busy</div><div class="su">'+esc(b.note||busyLabel(b))+' · <button class="lnk" data-busy="'+esc(day)+'|'+i+'">Remove</button></div>'}));
  items.sort((a,b)=>a.m-b.m);
  const cur = day===TODAY ? items.find(x=>x.m>=0 && x.m<=now && now<x.e) || items.find(x=>x.m>now) : null;
  return items.map(x=>'<div class="mx-ev'+(x===cur?' cur':'')+'"><div class="tm mono">'+x.time+'</div><div class="bx'+(x.g?' g':'')+'"></div>'+x.h+'</div>').join('');
}
function viewToday(){
  const all = allTasks();
  /* blocked work waits under "Waiting on others", not in today's list or its hours (19 Nov 2026 user test) */
  const open0 = all.filter(({t})=>t.status!=='done' && t.status!=='blocked' && t.due && t.due<=TODAY).sort((a,b)=>a.t.due.localeCompare(b.t.due));
  /* work whose real deadline has passed stays on Today, in its own fold and outside today's hours (19 Nov 2026 user test) */
  const missed = open0.filter(({c,t})=>pastDeadline(c,t));
  const open = open0.filter(x=>!missed.includes(x));
  const homeNow = isCommute(TODAY) && (dayTimes(TODAY)||{}).home != null && nowMinutes() >= dayTimes(TODAY).home;
  const onTrip = isCommute(TODAY) && !homeNow ? commutePlan(TODAY).picked : new Set();
  const desk = open.slice().sort(byUrgency);
  const doneToday = all.filter(({t})=>t.status==='done' && countsOn(t, TODAY));
  const r = typeof phReadingNow==='function' && HAS_FILES() ? phReadingNow(desk) : null;
  /* Next up: the nearest open work after today he can pull forward */
  const next = all.filter(({t})=>t.status!=='done' && t.status!=='blocked' && t.due && t.due>TODAY).sort((a,b)=>a.t.due.localeCompare(b.t.due) || byUrgency(a,b)).slice(0,3);

  let L = phoneBlock() + inboxBlock() + organizeNote() + (typeof risksBlock==='function' ? risksBlock() : '');
  if(r) L += readCard(r);
  L += '<div class="mx-sec"><b>Today</b><span class="mono">'+desk.length+' open · '+doneToday.length+' done</span></div>'
    + '<div class="mx-list">'+(desk.length ? desk.map(({c,t})=>tkRow(c,t,{trip:onTrip.has(t)})).join('') : '<div class="empty">Nothing else planned for today.</div>')+'</div>';
  if(doneToday.length) L += '<button class="mx-more" data-tddone="1" aria-expanded="'+TD_DONE+'">'+(TD_DONE?'– ':'+ ')+'Done · '+doneToday.length+'</button>'
    + (TD_DONE ? '<div class="mx-list">'+doneToday.map(({c,t})=>tkRow(c,t)).join('')+'</div>' : '');
  if(missed.length) L += '<details class="fold missed" data-key="missed"'+(openKeys.has('missed')?' open':'')+'><summary>Deadline passed <span class="muted">· '+missed.length+' task'+(missed.length===1?'':'s')+' · '+r1(missed.reduce((s2,{t})=>s2+(Number(t.est)||0),0))+' h, not counted today</span></summary>'
    + '<div class="muted">Tick what you did, move what still matters, remove what no longer does.</div><div class="mx-list">'+missed.map(({c,t})=>tkRow(c,t)).join('')+'</div></details>';
  if(typeof waitingBlock==='function') L += waitingBlock();
  if(next.length){
    const n0 = next[0].t.due, lab = n0===addDays(TODAY,1) ? 'tomorrow · '+fmt(n0,{weekday:'short',day:'numeric'}) : 'from '+fmtShort(n0);
    L += '<div class="mx-sec"><b>Next up</b><span class="mono">'+esc(lab)+'</span></div><div class="mx-list">'
      + next.map(({c,t})=>{ const dl = realDl(c,t); return tkRow(c,t,{next:true, chip:moveOk(c,t,TODAY), sub:esc(c.short)+(dl?' · due '+esc(fmt(dl,{weekday:'short',day:'numeric'})):'')}); }).join('')+'</div>';
  }
  if(!IN_APP && !PHONE) L += '<div class="note">To add a task, tell Claude in the chat. It asks for the course, due date, time needed and whether it works offline.</div>';

  const denied = IN_APP && CAL_STATUS==='denied';
  const line = dayLine(TODAY), dls = deadlines(TODAY, addDays(TODAY,7), true);
  let R = '<div class="mx-lblrow"><span class="lbl">'+esc(fmt(TODAY,{weekday:'long',day:'numeric',month:'short'}))+'</span>'+newEvBtn(TODAY)+'</div>'
    + (denied ? '<div class="note">Calendar access is off: System Settings › Privacy & Security › Calendars › Planner.</div>' : '')
    + (line || '<div class="empty">Nothing in the calendar.</div>');
  R += '<div class="mx-lblrow" style="margin-top:34px"><span class="lbl">Due this week</span></div>'
    + (dls.length ? dls.map(({c,d})=>'<button class="mx-dl'+(diff(d.date,TODAY)<=2?' soon':'')+'" data-go="'+esc(d.date)+'"><span class="d mono">'+esc(fmt(d.date,{weekday:'short',day:'numeric'}))+'</span><span class="ti">'+prioMark(d)+esc(d.title)+'</span><span class="c">'+esc(c.short)+'</span></button>').join('') : '<div class="empty">No deadlines in the next 7 days.</div>');
  return '<div class="mx-td"><div>'+L+'</div><aside class="mx-side" aria-label="The day">'+R+'</aside></div>';
}
/* Today and tomorrow, side by side: everything organisational in one widget */
function dayAgenda(day){
  const items = [];
  allClassesOn(day).forEach(e=>{ const k = skipIdx(day, x=>x.c===e.c && x.s===e.s); items.push({m:toMin(e.s), time:e.s+(e.e?'–'+e.e:''), title:skipName(esc(e.t), k>=0)+(k>=0?skipTag(day,k):''), sub:esc(classPlace(e)), cls:'cl'+(k>=0?' skipped':'')}); });
  if(HAS_CAL) eventsOn(day).forEach(e=>{ const k = skipIdx(day, x=>x.ev===evKey(e)); items.push({m:e.allDay?-1:evMin(e.start), time:e.allDay?'All day':evTime(e), title:skipName(evTitle(e), k>=0)+(k>=0?skipTag(day,k):''), sub:evSub(e), cls:'ce'+(k>=0?' skipped':'')}); });
  busyOn(day).forEach((b,i)=>items.push({m:b.from, time:busyLabel(b)==='all day'?'All day':busyLabel(b), title:'Busy <button class="lnk" data-busy="'+esc(day)+'|'+i+'" title="Remove this busy time">Remove</button>', sub:esc(b.note||'No planner work then'), cls:'ce'}));
  return items.sort((a,b)=>a.m-b.m);
}
function agendaList(items){ return items.length ? '<ol class="agenda">'+items.map(x=>'<li class="'+x.cls+'"><span class="mono at">'+x.time+'</span><span><span class="aw">'+x.title+'</span>'+(x.sub?'<span class="as">'+x.sub+'</span>':'')+'</span></li>').join('')+'</ol>' : '<div class="empty">Nothing scheduled.</div>'; }
function orgWidget(){
  const tm = addDays(TODAY,1), tmt = dayTimes(tm), dls = deadlines(tm, tm, true);
  const tmTasks = allTasks().filter(({t})=>t.due===tm && t.status!=='done'), tmHrs = r1(tmTasks.reduce((a,{t})=>a+(+t.est||0),0));
  const tmTrain = tmTasks.filter(({t})=>onCommute(t));
  let h = '<section class="wbox org" aria-label="Today and tomorrow"><div class="orgcols"><div><h2>Today</h2>';
  if(IN_APP && CAL_STATUS==='denied') h += '<div class="note">Calendar access is off: System Settings › Privacy & Security › Calendars › Planner.</div>';
  h += agendaList(dayAgenda(TODAY)) + '</div><div><h2>Tomorrow <span class="muted">· '+esc(fmt(tm,{weekday:'short',day:'numeric'}))+'</span></h2>';
  if(tmt) h += '<div class="leave"><span class="mono">'+toHM(tmt.leave)+'</span> leave home'+(tmTrain.length?' · '+tmTrain.length+' on the way':'')+'</div><div class="csub">Offline on the way: download files tonight.</div>';
  h += agendaList(dayAgenda(tm));
  if(dls.length) h += '<div class="tdue">'+dls.map(({c,d})=>'<div>'+(isSession(c,d)?'':'<b>Due</b> ')+esc(d.title)+' <span class="muted">'+esc(c.short)+'</span></div>').join('')+'</div>';
  h += '<div class="muted tsum">'+tmTasks.length+' task'+(tmTasks.length===1?'':'s')+' · <span class="mono">'+tmHrs+' h</span>'+(tmHrs+eventHours(tm)>HEAVY?' · <span class="tag warn">'+ICON.warn+'Heavy</span>':'')+'</div>';
  return h + '</div></div></section>';
}

/* ---------- Week: drag a task to another day ----------
   Dropped on a day, the task is placed there by hand (pin), so the organizer leaves it. Not before today, not after its
   deadline (class session: by the day before). Train or metro work dropped on a day without a commute becomes desk work;
   class work moved off its class becomes desk work. */
const dragAttrs = (c,t) => t.status!=='done' && t.due>=TODAY ? ' data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'" draggable="true" title="Drag to another day"' : '';
let DRAG = null;
/* The one rule for moving a task to a day by hand (drag in Week, "Move to…" on the phone): not before today, not past its
   last day, and a part never before an earlier open part of its task or after a later one. */
function moveOk(c, t, day){
  if(!day || day < TODAY || day===t.due) return false;
  const p = Organizer.partInfo(t);
  if(p && (c.tasks||[]).some(x=>{ const q = x!==t && x.status!=='done' && x.due && Organizer.partInfo(x); return q && q.base===p.base && (q.n < p.n ? day < x.due : q.n > p.n && day > x.due); })) return false;
  const ld = Organizer.lastDayOf(c, t); return !ld || day <= ld;
}
function dropOk(day){ return !!DRAG && moveOk(DRAG.c, DRAG.t, day); }
function moveTo(c, t, day){
  if(t.where==='class') t.where = 'desk';
  if((t.where==='train' || t.where==='phone') && !isCommute(day)) t.where = 'desk';
  t.due = day; t.pin = day;
  save(c); render(); setTimeout(()=>overNote(day), 50);
}
document.addEventListener('dragstart', e=>{
  const li = e.target.closest && e.target.closest('.wday li[draggable][data-c], .cvday [draggable][data-c]'); if(!li) return;
  const c = cById(li.dataset.c), t = c && (c.tasks||[]).find(x=>x.id===li.dataset.t); if(!t) return;
  DRAG = {c, t}; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.title); li.classList.add('dragging');
  document.querySelectorAll('.wday[data-day],.cvday[data-day]').forEach(s=>s.classList.toggle('nodrop', !dropOk(s.dataset.day) && s.dataset.day!==t.due));
});
document.addEventListener('dragend', ()=>{ DRAG = null; document.querySelectorAll('.wday.over,.wday.nodrop,.cvday.over,.cvday.nodrop,.dragging').forEach(x=>x.classList.remove('over','nodrop','dragging')); });
document.addEventListener('dragover', e=>{
  if(!DRAG) return; const s = e.target.closest('.wday[data-day],.cvday[data-day]');
  document.querySelectorAll('.wday.over,.cvday.over').forEach(x=>{ if(x!==s) x.classList.remove('over'); });
  if(s && dropOk(s.dataset.day)){ s.classList.add('over'); e.dataTransfer.dropEffect = 'move'; } else e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('drop', e=>{
  if(!DRAG) return; const s = e.target.closest('.wday[data-day],.cvday[data-day]'), ok = s && dropOk(s.dataset.day), x = DRAG; DRAG = null;
  document.querySelectorAll('.wday.over,.wday.nodrop,.cvday.over,.cvday.nodrop').forEach(y=>y.classList.remove('over','nodrop'));
  if(ok) moveTo(x.c, x.t, s.dataset.day);
});

/* ---------- C7 numbered cells ---------- */
function taskCell(c,t,n,o={}){
  const overdue = t.status!=='done' && t.due && t.due<TODAY;
  return '<li class="cell t-'+esc(t.status)+'" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'">'
    + '<div class="chd"><span class="cn mono">'+String(n).padStart(3,'0')+'</span><span class="cd mono">'+(t.due?esc(fmt(t.due,{weekday:'short',day:'2-digit',month:'short'})):'No date')+'</span></div>'
    + '<div class="ct">'+esc(t.title)+pdfBtns(c,t)+'</div>'
    + '<div class="cm">'+(o.course!==false?'<span>'+esc(c.short)+'</span>':'')+whereTag(c,t)+(overdue?'<span class="tag warn">'+ICON.warn+'Overdue</span>':'')+'</div>'
    + '<div class="cf"><button class="check sm" data-act="toggle" aria-label="'+(t.status==='done'?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'+(t.est?'<span class="est mono">'+(t.status==='done'?'Planned ':'')+esc(t.est)+' h</span>':'')+spentField(t)+statusChip(t)+'</div>'
    + (t.status!=='done' ? '<div class="cdates">'+datePicks(c,t)+'</div>' : '')+rmLink()
    + '</li>';
}

/* ---------- Courses ---------- */
/* new course or project: a name is enough; the rest can be added later through the input field */
let NEWC = {where:'', name:'', kind:'project', note:'', error:''};
let GROUPS = {};
const groupOf = c => c.group || ((c.kind||'course')==='project' ? 'Personal' : 'Other');
function groupNames(){ const g = []; courses.forEach(c=>{ const n = groupOf(c); if(!g.includes(n)) g.push(n); }); return g; }
function courseOptions(sel){ return '<option value="">None</option>'+groupNames().map(k=>{ const list = courses.filter(c=>groupOf(c)===k); return list.length ? '<optgroup label="'+esc(k)+'">'+list.map(c=>'<option value="'+esc(c.id)+'"'+(sel===c.id?' selected':'')+'>'+esc(c.short)+'</option>').join('')+'</optgroup>' : ''; }).join('')+'<option value="__new">+ New course or project…</option>'; }
function newCourseForm(where){
  if(NEWC.where!==where) return '';
  return '<div class="newc" data-where="'+where+'"><input id="nc-name" value="'+esc(NEWC.name)+'" placeholder="Name, e.g. Project X installation or Thesis" aria-label="Name">'
    + '<select id="nc-kind" aria-label="Type"><option value="project"'+(NEWC.kind==='project'?' selected':'')+'>Project</option><option value="course"'+(NEWC.kind==='course'?' selected':'')+'>Course</option></select>'
    + '<input id="nc-note" value="'+esc(NEWC.note)+'" placeholder="One line about it (optional)" aria-label="Short description">'
    + '<select id="nc-group" aria-label="Group">'+groupNames().concat(groupNames().includes('Personal')?[]:['Personal']).map(g=>'<option value="'+esc(g)+'"'+((NEWC.group||'Personal')===g?' selected':'')+'>'+esc(g)+'</option>').join('')+'<option value="__new">New group…</option></select>'
    + (NEWC.group==='__new'?'<input id="nc-gname" value="'+esc(NEWC.gname||'')+'" placeholder="Group name" aria-label="New group name">':'')
    + '<button class="btn pri" data-nc="add">Add</button><button class="btn" data-nc="cancel">Cancel</button>'
    + (NEWC.error?'<div class="cerr"><span class="tag warn">'+ICON.warn+esc(NEWC.error)+'</span></div>':'')+'</div>';
}
function addCourse(){
  const name = NEWC.name.trim(); if(!name){ NEWC.error = 'Give it a name.'; return null; }
  if(courses.some(c=>c.name.toLowerCase()===name.toLowerCase() || c.short.toLowerCase()===name.toLowerCase())){ NEWC.error = 'That name is already in the list.'; return null; }
  let base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,14) || 'project', id = base, n = 2;
  while(cById(id)) id = base+'-'+(n++);
  const c = {id, name, short: name.length > 30 ? (name.slice(0,31).replace(/\s+\S*$/,'') || name.slice(0,30)) : name, kind: NEWC.kind, group: (NEWC.group==='__new' ? (NEWC.gname||'').trim() : NEWC.group) || (NEWC.kind==='project'?'Personal':'Other'), note: NEWC.note.trim(), hue: 270, order: Math.max(0,...courses.map(x=>x.order||0))+1, deliverables:[], tasks:[]};
  courses.push(c); save(c);
  /* its folder in Documents/Planner is made right away (24 Nov 2026, the user's request) */
  if(IN_APP) APP.call('helpFolder', {name:c.short}).then(r=>{ if(!c.folder) CTX[c.id] = r.path; }).catch(()=>{});
  NEWC = {where:'', name:'', kind:'project', note:'', error:''};
  return c;
}
/* where a task can be done: tap the tag to change it (desk-only courses stay at the desk) */
function whereTag(c,t){
  if(deskOnly(c)) return '<span class="wtag">Desk only</span>';
  const opts = [['desk','Desk'],['train','Train · laptop'],['phone','Metro · phone']].concat(t.where==='class' ? [['class','In class']] : []);
  return '<label class="wtag'+(t.where!=='desk'?' on':'')+'" title="Where this can be done"><select data-act="where" aria-label="Where: '+esc(t.title)+'">'+opts.map(([v,l])=>'<option value="'+v+'"'+(t.where===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>';
}

/* Mark done by hand: offered while no task of it is open (a deliverable whose tasks were removed had no way to be done). */
function delivDoneBtn(c,d,dt){
  if(delivDone(d)) return ' <span class="muted dlh">· <button class="lnk" data-ddone="'+esc(c.id+'|'+d.id)+'">Mark not done</button></span>';
  if(dt.some(t=>t.status!=='done')) return '';
  return ' <span class="muted dlh">· <button class="lnk" data-ddone="'+esc(c.id+'|'+d.id)+'">Mark done</button></span>';
}
function viewCourses(){
  const span = diff(TERM_END, TERM_START);
  const pct = s => Math.max(0,Math.min(100, diff(s,TERM_START)/span*100));
  const firsts = []; for(let m = TERM_START.slice(0,8)+'01'; m <= TERM_END; m = addDays(m, 32).slice(0,8)+'01') if(m > TERM_START) firsts.push(m);
  let months=''; firsts.forEach(m=>{ months += '<span class="m" style="left:'+pct(m)+'%">'+fmt(m,{month:'short'})+'</span>'; });
  let h='<div class="wbar"><span style="flex:1"></span>'+(NEWC.where==='courses'?'':'<button class="btn" data-nc="open" data-where="courses">+ New course or project</button>')+'</div>'+newCourseForm('courses');
  let lastGroup = null;
  const ordered = groupNames().flatMap(g=>courses.filter(c=>groupOf(c)===g));
  ordered.forEach(c=>{
    if(groupOf(c)!==lastGroup){ if(lastGroup!==null) h += '</details>'; lastGroup = groupOf(c); const n = ordered.filter(x=>groupOf(x)===lastGroup).length; h += '<details class="cgroup" data-key="group:'+esc(lastGroup)+'"'+(openKeys.has('closed:'+lastGroup)?'':' open')+'><summary class="ghead"><h2>'+esc(lastGroup)+' <span class="muted">· '+n+'</span></h2>'+(GROUPS[lastGroup]?'<span class="muted">'+esc(GROUPS[lastGroup])+'</span>':'')+'</summary>'; }
    const ds = (c.deliverables||[]).slice().sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
    const ts = c.tasks||[]; const done = ts.filter(t=>t.status==='done').length;
    h += '<div class="course"><div class="chead"><h3>'+esc(c.short)+((c.kind||'course')==='project'?' <span class="kind">Project</span>':'')+'</h3><span class="muted mono" style="font-size:15px">'+done+' / '+ts.length+' done'+(IN_APP ? ' · <button class="lnk" data-obopen="'+esc(c.id)+'">'+(c.onboarded ? 'Set up again' : 'Set up')+'</button> · <button class="lnk" data-cremove="'+esc(c.id)+'" title="Take it off the plan. Its tasks and folder are kept; Restore brings it back.">Remove</button>' : '')+'</span></div>'+filesFold(c)
      + (c.info ? '<details class="fold cnotes" data-key="notes:'+esc(c.id)+'"'+(openKeys.has('notes:'+c.id)?' open':'')+'><summary>Course notes</summary><div class="pch">'+esc(c.info).replace(/\n/g,'<br>')+'</div></details>' : '');
    let axis='';
    h += '<ol class="cells">';
    ds.forEach((d,i)=>{
      const dt = ts.filter(t=>t.did===d.id); const dd = dt.filter(t=>t.status==='done').length;
      const key = c.id+':'+d.id; const open = openKeys.has(key);
      const when = d.state==='ongoing' ? 'Weekly' : d.date ? fmt(d.date,{weekday:'short',day:'2-digit',month:'short'}) : 'Date TBD';
      const st = delivDone(d) || dt.length && dd===dt.length ? 'done' : dt.some(t=>t.status==='blocked') ? 'blocked' : dt.some(t=>t.status==='doing') ? 'doing' : 'todo';
      const stl = {done:'Done',blocked:'Blocked',doing:'Doing',todo:'To do'}[st];
      const sub = d.state==='likely' ? 'Likely date' : d.date && d.date>=TODAY && !isSession(c,d) ? rel(d.date) : d.date && d.date<TODAY ? 'Past' : isSession(c,d) ? 'Session' : '';
      h += '<li'+(open?' class="open"':'')+'><button class="dcell phase" data-key="'+esc(key)+'" aria-expanded="'+open+'">'
        + '<span class="chd"><span class="cn mono">'+pad(i+1)+'</span><span class="cd mono">'+esc(when)+'</span></span>'
        + '<span class="ct">'+esc(d.title)+'</span>'
        + (sub?'<span class="cm">'+esc(sub)+'</span>':'')
        + '<span class="cf"><span class="st st-'+st+'" style="cursor:inherit">'+ICON[st]+stl+'</span><span class="mono est">'+dd+' / '+dt.length+'</span></span>'
        + '<span class="pbar"><i style="width:'+(delivDone(d)?100:dt.length?dd/dt.length*100:0)+'%"></i></span></button></li>';
      const dues = dt.map(t=>t.due).filter(Boolean).sort();
      const a = dues[0] || d.date, b = d.date || dues[dues.length-1];
      if(a && b) axis += '<span class="sp" style="left:'+pct(a)+'%;width:'+Math.max(.6,pct(b)-pct(a))+'%" title="'+esc(d.title)+'"></span>';
      if(d.date) axis += '<span class="tk" style="left:'+pct(d.date)+'%" title="'+esc(d.title+' · '+fmtShort(d.date))+'"></span>';
    });
    h += '</ol><div class="axis" aria-hidden="true"><span class="ln"></span>'+axis+'<span class="now" style="left:'+pct(TODAY)+'%"></span>'+months+'</div>';
    ds.forEach(d=>{
      const key = c.id+':'+d.id; if(!openKeys.has(key)) return;
      const dt = ts.filter(t=>t.did===d.id).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      h += '<div class="ptasks"><h2>'+esc(d.title)+(d.state!=='ongoing'?' <span class="muted dlh">· Deadline <label class="mx-pick" title="Pick a new date for '+esc(d.title)+'">'+(d.date?esc(fmtShort(d.date)):'Set')+'<input type="date" data-dl="'+esc(c.id)+'|'+esc(d.id)+'" value="'+esc(d.date||'')+'" aria-label="Deadline of '+esc(d.title)+'"></label> · <label class="mx-prsel">Priority <select data-dprio="'+esc(c.id)+'|'+esc(d.id)+'" aria-label="Priority of '+esc(d.title)+'">'+[0,1,2,3,4,5].map(n=>'<option value="'+n+'"'+((+d.prio||0)===n?' selected':'')+'>'+(n?n:'none')+'</option>').join('')+'</select></label></span>':'')+delivDoneBtn(c,d,dt)+'</h2>'+(d.note?'<p class="cnote">'+esc(d.note)+'</p>':'')
        + (dt.length?'<ol class="cells">'+dt.map((t,j)=>taskCell(c,t,j+1,{course:false})).join('')+'</ol>':'<div class="empty">'+(delivDone(d)?'Marked done '+esc(fmtShort(d.done))+'.':'No tasks yet. Ask Claude to break this one down, or mark it done.')+'</div>')+'</div>';
    });
    h += '</div>';
  });
  if(lastGroup!==null) h += '</details>';
  if(IN_APP && REMOVED.length) h += '<details class="fold files removedc"><summary>Removed <span class="muted">· '+REMOVED.length+'</span></summary><ul class="flist">'+REMOVED.map(c=>'<li>'+esc(c.short)+' <span class="faint">· '+(c.tasks||[]).length+' tasks · removed '+esc(fmtShort(c.removed))+'</span> · <button class="lnk" data-crestore="'+esc(c.id)+'">Restore</button></li>').join('')+'</ul></details>';
  return h;
}
/* Remove takes two clicks (like a task's Remove). The course stays in plan.json with `removed`, so Restore brings it back. */
function removeCourse(id){
  const c = cById(id); if(!c) return;
  c.removed = TODAY; save(c);
  courses = courses.filter(x=>x!==c); REMOVED.push(c);
  if(compose.setup && compose.setup.cid===id) compose = freshCompose();   /* a set-up of a removed course ends */
  if(fCourse===id) fCourse = '';
}
function restoreCourse(id){
  const c = REMOVED.find(x=>x.id===id); if(!c) return;
  delete c.removed; REMOVED = REMOVED.filter(x=>x!==c);
  courses.push(c); courses.sort((a,b)=>(a.order||0)-(b.order||0)); save(c);
}
document.addEventListener('click', e=>{
  const r = e.target.closest('[data-cremove]');
  if(r){ e.preventDefault();
    if(!r.dataset.sure){ const c = cById(r.dataset.cremove), n = c ? (c.tasks||[]).filter(t=>t.status!=='done').length : 0; r.dataset.sure = '1'; r.textContent = 'Remove '+(c?c.short:'')+(n?' and its '+n+' open task'+(n===1?'':'s'):'')+' for sure'; r.style.color = 'var(--coral)'; setTimeout(()=>{ if(r.isConnected){ delete r.dataset.sure; r.textContent = 'Remove'; r.style.color = ''; } }, 4000); return; }
    removeCourse(r.dataset.cremove); render(); return; }
  const s = e.target.closest('[data-crestore]');
  if(s){ e.preventDefault(); restoreCourse(s.dataset.crestore); render(); }
});

/* ---------- All tasks (M5): one line per task, weeks fold, actions on the row you point at ----------
   The course list on the left filters (fCourse), with done / total as a thin bar. By week: this week open, later weeks fold
   with counts and hours. By course: the same rows under numbered deliverables. Show done adds the done rows (fStatus). */
let AT_MODE = (()=>{ try{ return localStorage.getItem('atMode') || 'week'; }catch(e){ return 'week'; } })();
const AT_OPEN = new Set(['w0']);
function atRow(c,t){
  const done = t.status==='done', dl = realDl(c,t), soon = !done && dl && diff(dl, TODAY) <= 3;
  const w = t.where==='train' ? 'train' : t.where==='phone' ? 'metro' : t.where==='class' ? 'class' : 'desk';
  const acts = done ? spentField(t)+'<button class="lnk" data-act="toggle">Not done</button>' : helpBtn(c,t)+rmLink();
  const planned = plannedPick(c,t,'d mono'), dlCell = deadlinePick(c,t,'dl mono'+(soon?' soon':''));
  return '<div class="mx-tr'+(done?' dn':'')+'" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'" tabindex="0">'
    + '<button class="check sm" data-act="toggle" aria-label="'+(done?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'
    + '<span class="mx-t" title="'+esc(t.title)+'"><span class="ttitle">'+esc(t.title)+'</span></span>'
    + '<span class="c">'+esc(c.short)+'</span><span class="acts">'+acts+'</span><span class="w mono'+(w==='train'||w==='metro'?' tr2':'')+'">'+w+'</span>'
    + planned + dlCell
    + '<span class="h mono">'+(t.est?esc(t.est)+' h':'')+'</span></div>';
}
const atHrs = rows => r1(rows.reduce((s,{t})=>s+(Number(t.est)||0),0));
const atColh = '<div class="mx-colh"><span></span><span>Task</span><span>Course</span><span>Where</span><span>Planned</span><span>Deadline</span><span style="text-align:right">Hours</span></div>';
function atGroup(key, title, rows, def){
  const open = AT_OPEN.has(key) || (def && !AT_OPEN.has('closed:'+key));
  const nOpen = rows.filter(({t})=>t.status!=='done').length;
  return '<button class="mx-wh'+(open?'':' fold')+'" data-atw="'+esc(key)+'" aria-expanded="'+open+'"><b>'+(open?'':'+ ')+title+'</b><span class="mono">'+nOpen+' open · '+atHrs(rows.filter(({t})=>t.status!=='done'))+' h</span></button>'
    + (open ? atColh + rows.map(({c,t})=>atRow(c,t)).join('') : '');
}
function viewAll(){
  const showDone = fStatus==='all';
  const mine = allTasks().filter(({c,t})=>(!fCourse||c.id===fCourse) && (showDone || t.status!=='done'));
  const openAll = allTasks().filter(({t})=>t.status!=='done');
  const shown = mine.filter(({t})=>t.status!=='done');
  /* courses with work, most open hours first */
  const cl = courses.filter(c=>(c.tasks||[]).length).map(c=>{ const ts = c.tasks, o = ts.filter(t=>t.status!=='done'); return {c, n:o.length, h:r1(o.reduce((s,t)=>s+(Number(t.est)||0),0)), p:ts.length ? ts.filter(t=>t.status==='done').length/ts.length : 0}; })
    .filter(x=>x.n || x.c.id===fCourse).sort((a,b)=>b.n-a.n || b.h-a.h);
  const side = '<div><span class="lbl" style="display:block;margin-bottom:8px">Courses</span><div class="mx-cl">'
    + '<button class="mx-cr'+(fCourse?'':' on')+'" data-atc=""><span>All courses</span><span class="mono">'+openAll.length+' · '+atHrs(openAll)+' h</span></button>'
    + cl.map(x=>'<button class="mx-cr'+(fCourse===x.c.id?' on':'')+'" data-atc="'+esc(x.c.id)+'"><span>'+esc(x.c.short)+'<i class="pb"><i style="width:'+Math.round(x.p*100)+'%"></i></i></span><span class="mono">'+x.n+' · '+x.h+' h</span></button>').join('')+'</div></div>';
  let body = '';
  if(!mine.length) body = '<div class="empty" style="padding:14px 0">No tasks match.</div>';
  else if(AT_MODE==='course'){
    const byC = courses.filter(c=>mine.some(x=>x.c===c));
    byC.forEach(c=>{
      const rows = mine.filter(x=>x.c===c), ds = (c.deliverables||[]).slice().sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
      let inner = ''; let n = 0;
      ds.forEach(d=>{ const dr = rows.filter(({t})=>t.did===d.id).sort((a,b)=>(a.t.due||'9999').localeCompare(b.t.due||'9999')); if(!dr.length) return; n++;
        inner += '<div class="mx-dh"><span class="mono">'+pad(n)+'</span><b>'+esc(d.title)+'</b><span class="mono">'+(d.date?esc(fmtShort(d.date)):d.state==='ongoing'?'weekly':'no date')+'</span></div>'+dr.map(({c,t})=>atRow(c,t)).join(''); });
      const loose = rows.filter(({t})=>!ds.some(d=>d.id===t.did));
      if(loose.length) inner += '<div class="mx-dh"><span class="mono">–</span><b>Other tasks</b><span></span></div>'+loose.map(({c,t})=>atRow(c,t)).join('');
      const key = 'c:'+c.id, open = byC.length===1 || AT_OPEN.has(key);
      body += '<button class="mx-wh'+(open?'':' fold')+'" data-atw="'+esc(key)+'" aria-expanded="'+open+'"><b>'+(open?'':'+ ')+esc(c.short)+'</b><span class="mono">'+rows.filter(({t})=>t.status!=='done').length+' open · '+atHrs(rows.filter(({t})=>t.status!=='done'))+' h</span></button>'+(open?atColh+inner:'');
    });
  } else {
    const w0 = monday(TODAY), w1 = addDays(w0,7), w2 = addDays(w0,14), w3 = addDays(w0,21);
    const rows = mine.slice().sort((a,b)=>(a.t.due||'9999').localeCompare(b.t.due||'9999') || byUrgency(a,b));
    const span = w => fmt(w,{day:'numeric'})+(w.slice(5,7)===addDays(w,6).slice(5,7)?'':' '+fmt(w,{month:'short'}))+' – '+fmt(addDays(w,6),{day:'numeric',month:'short'});
    const groups = [
      ['w0', 'This week · '+span(w0), rows.filter(({t})=>t.due && t.due<w1), true],
      ['w1', 'Next week · '+span(w1), rows.filter(({t})=>t.due && t.due>=w1 && t.due<w2)],
      ['w2', span(w2), rows.filter(({t})=>t.due && t.due>=w2 && t.due<w3)],
      ['w3', 'Later', rows.filter(({t})=>t.due && t.due>=w3)],
      ['nd', 'No date', rows.filter(({t})=>!t.due)]];
    body = groups.filter(g=>g[2].length).map(([k,ti,rs,def])=>atGroup(k, esc(ti), rs, def)).join('');
  }
  const head = '<div class="cvbar"><h1 class="cvtitle">All tasks<small>'+shown.length+' open · '+atHrs(shown)+' h</small></h1>'
    + '<nav class="cvlv" aria-label="Group"><button class="'+(AT_MODE==='week'?'on':'')+'" data-atmode="week">By week</button><button class="'+(AT_MODE==='course'?'on':'')+'" data-atmode="course">By course</button></nav><span style="flex:1"></span>'
    + '<button class="btn" data-atdone="1" aria-pressed="'+showDone+'">'+(showDone?'Hide done':'Show done')+'</button></div>';
  return head + '<div class="mx-at">'+side+'<div class="mx-tl">'+body+'</div></div>';
}
document.addEventListener('click', e=>{
  const m = e.target.closest('[data-atmode]'); if(m){ AT_MODE = m.dataset.atmode; lsSet('atMode', AT_MODE); render(); return; }
  const c = e.target.closest('[data-atc]'); if(c){ fCourse = c.dataset.atc; render(); return; }
  /* a date picker opens on the first click, not only on its calendar icon */
  const pk = e.target.closest('.mx-pick'); if(pk){ const i = pk.querySelector('input'); if(i && i.showPicker && e.target!==i){ try{ i.showPicker(); }catch(err){} } return; }
  if(e.target.closest('[data-atdone]')){ fStatus = fStatus==='all' ? 'open' : 'all'; render(); return; }
  const w = e.target.closest('[data-atw]'); if(w){ const k = w.dataset.atw, open = w.getAttribute('aria-expanded')==='true';
    if(open){ AT_OPEN.delete(k); AT_OPEN.add('closed:'+k); } else { AT_OPEN.add(k); AT_OPEN.delete('closed:'+k); } render(); return; }
  /* Today and Week: Do now, the done list, and a click on a row opens its actions */
  const dn = e.target.closest('[data-donow]');
  if(dn){ const [cid, tid] = dn.dataset.donow.split('|'), co = cById(cid), t = co && (co.tasks||[]).find(x=>x.id===tid);
    if(t && moveOk(co, t, TODAY)){ t.due = TODAY; t.pin = TODAY; save(co); render(); } return; }
  if(e.target.closest('[data-tddone]')){ TD_DONE = !TD_DONE; render(); return; }
  const row = e.target.closest('[data-tk]');
  if(row && !e.target.closest('button,a,input,select,label,textarea,.spent,.mx-acts')){ TK_OPEN = TK_OPEN===row.dataset.tk ? '' : row.dataset.tk; render(); }
});
