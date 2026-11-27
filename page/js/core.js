/* Dates, plan data, statuses, commute and shared pieces used by every view. Part of page/index_v2.html; classic script, loaded in order. */
/* Courses get a shade from the locked palette (lilac or grey step), never a new hue. */
const STATUS = [['todo','To do'],['doing','Doing'],['blocked','Blocked'],['done','Done']];
const ICON = {
  todo:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  doing:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
  blocked:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 12 12 4" stroke="currentColor" stroke-width="1.8"/></svg>',
  done:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m5 8.2 2 2 4-4.4" fill="none" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.5v4.2" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.3" r="1.1" fill="var(--bg)"/></svg>'
};
let HEAVY = RULES_CFG.heavy;     // hours: warn above this (from the profile: onProfile below)
const ADMIN_ID = 'admin';        // personal admin that belongs to no course (made on load in main.js)
/* TERM_START, TERM_END and CLASSES (the timetable) come from the profile (profile.js). */
/* REMOVED: courses and projects he removed (24 Nov 2026, the user's request: "I should be able to remove courses or projects").
   They stay in plan.json with `removed` (the day), so Restore on Courses brings them back with their tasks; the page,
   the organizer and the timetable leave them out. Their folders are never touched. */
let REMOVED = [];
let courses = [], flags = [], ready = false, dbh = null, tab = 'today', weekOff = 0, weekAnchor = null;
const openKeys = new Set();
let fCourse = '', fStatus = 'open';

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); };
const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const diff = (a,b) => Math.round((parse(a)-parse(b))/864e5);
const qToday = new URLSearchParams(location.search).get('today');
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(qToday||'') ? qToday : iso(new Date());
const monday = s => addDays(s, -((parse(s).getDay()+6)%7));
const fmt = (s,o) => parse(s).toLocaleDateString('en-GB',o);
const fmtShort = s => fmt(s,{weekday:'short',day:'numeric',month:'short'});
const toMin = hm => { const [h,m] = hm.split(':').map(Number); return h*60+m; };
const toHM = m => pad(Math.floor(m/60))+':'+pad(m%60);
function rel(s){
  const n = diff(s,TODAY);
  if(n===0) return 'today'; if(n===1) return 'tomorrow'; if(n===-1) return 'yesterday';
  return n>0 ? 'in '+n+' days' : Math.abs(n)+' days ago';
}
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const r1 = n => Math.round(n*10)/10;
/* Who said a line: the mic track is "you", the computer's audio is "them"; older meetings have no label. */
const SPK_NAME = {you:'You', them:'Meeting'};
const spkName = sp => SPK_NAME[sp] || '';

/* ---------- data ---------- */
const cById = id => courses.find(c=>c.id===id);
const hueOf = id => profileHue(id) || 'hsl('+(((cById(id)||{}).hue)??220)+' 18% 52%)';
const cs = id => 'style="--c:'+hueOf(id)+'"';
function docsOf(snap){
  if(Array.isArray(snap)) return snap;
  if(snap && snap.docs) return snap.docs;
  const out=[]; if(snap && typeof snap.forEach==='function') snap.forEach(d=>out.push(d)); return out;
}
function dataOf(d){ const x = typeof d.data==='function' ? d.data() : (d.data || d); return Object.assign({id:d.id}, x); }
const queue = {};
function save(c){
  if(!dbh) return;
  const payload = JSON.parse(JSON.stringify(c));
  if(typeof usageSaved==='function') usageSaved(c);   /* usage log: what changed and who changed it (usage.js) */
  queue[c.id] = (queue[c.id]||Promise.resolve()).then(()=>dbh.doc('courses/'+c.id).set(payload)).catch(e=>console.error('save failed',e));
  if(typeof scheduleOrganize==='function') scheduleOrganize();
}
/* Work that can be picked up now: not done and not blocked. Every 'fill this time' path uses it. */
const workable = t => t.status!=='done' && t.status!=='blocked';
const deskOnly = c => !!c && (c.deskOnly===true || RULES_CFG.deskOnly.includes(c.id));
const waitsForWeek = c => !!c && (c.fixed===true || RULES_CFG.waitsForWeek.includes(c.id));
function allTasks(){ const out=[]; courses.forEach(c=>(c.tasks||[]).forEach(t=>out.push({c,t}))); return out; }
const delivOf = (c,t) => (c.deliverables||[]).find(d=>d.id===t.did);
const isSession = (c,d) => d ? /^Session\b/i.test(d.title||'') : c.id==='ghost';
/* A deliverable he marked done by hand (25 Nov 2026, the user's report: "I cant make a segment as done if I have deleted the subtasks"):
   `done` is the day he marked it. Done deliverables leave every deadline list; one with tasks is also done when all its tasks are. */
const delivDone = d => !!(d && d.done);
const prioMark = d => d && d.prio > 0 ? '<span class="mx-prio" title="Priority '+esc(d.prio)+': its work goes first">P'+esc(d.prio)+'</span>' : '';
const delivTag = d => (d && d.prio > 0 ? ' · priority '+d.prio : '') + (d && d.done ? ' · done '+d.done : '');   /* for the planner prompts */
/* Finished: marked done by hand, or every task of it is done (26 Nov 2026, the user's report: a deadline whose only task was done
   on 22 Nov still showed under Due this week: "i should not see deadlines that were already completed"). The one rule for
   which deadlines are shown (deadlines(): Today, Week, Month, Year, the widget, the phone). */
const delivFinished = (c,d) => { if(delivDone(d)) return true; const ts = (c.tasks||[]).filter(t=>t.did===d.id); return ts.length > 0 && ts.every(t=>t.status==='done'); };
function deadlines(from,to,withSessions){
  const out=[];
  courses.forEach(c=>{ (c.deliverables||[]).forEach(d=>{ if(delivFinished(c,d) || (!withSessions && isSession(c,d))) return; if(d.date && d.date>=from && d.date<=to) out.push({c,d}); }); });
  return out.sort((a,b)=>a.d.date.localeCompare(b.d.date));
}
/* Classes and events he will not attend (9 Nov 2026, the user's request: "only for this week ignore the original classes"):
   days/<YYYY-MM-DD>.skip = [{c, s}] for a class (course and start), [{ev, t}] for a calendar event (its key and title).
   They are not removed: the timetable and Calendar.app keep them and the views show them struck through with Attend.
   Everything that plans (away time, commute days, free time, the prompts) uses classesOn / busyEventsOn, which leave them out. */
const skipsOn = day => { try{ return ((DAYS||{})[day]||{}).skip||[]; }catch(e){ return []; } };
const classSkipped = (day, e) => skipsOn(day).some(x=>x.c===e.c && x.s===e.s);
/* Class times: the built-in timetable (classes.js) plus sessions a course carries itself (c.sessions, from setting up a course,
   19 Nov 2026), plus sessions waiting in an open preview (so placing new work already counts them). A session's "o" says where it
   meets: none (stored as thb) = in person at the main place (commute day, away time), "near" = in person elsewhere (1 h each way, no train time),
   "online" = only the class hours. */
let ONB_PENDING = [];
const pendingSessions = () => ONB_PENDING.length ? ONB_PENDING : (typeof compose!=='undefined' && compose && compose.proposal && compose.proposal.sessions) || [];
const CLS_CACHE = {sig:'', by:null};
onProfile(()=>{ CLS_CACHE.sig = ''; });   /* a new timetable from the profile */
function classIndex(){
  const pend = pendingSessions(), sig = courses.map(c=>c.id+':'+(c.sessions||[]).length).join(',')+'|-'+REMOVED.length+'|'+pend.length+':'+(pend[0]||{}).d;
  if(CLS_CACHE.sig===sig && CLS_CACHE.by) return CLS_CACHE.by;
  const by = {}, add = e => (by[e.d] = by[e.d] || []).push(e);
  const gone = new Set(REMOVED.map(c=>c.id));
  CLASSES.filter(e=>!gone.has(e.c)).forEach(add); courses.forEach(c=>(c.sessions||[]).forEach(e=>add(Object.assign({c:c.id}, e)))); pend.forEach(add);
  Object.values(by).forEach(l=>l.sort((a,b)=>a.s.localeCompare(b.s)));
  CLS_CACHE.sig = sig; CLS_CACHE.by = by; return by;
}
const allClassesOn = day => classIndex()[day] || [];
const classesOn = day => allClassesOn(day).filter(e=>!classSkipped(day, e));
const skipTag = (day, i) => ' <span class="skipnote">Not attending · <button class="lnk" data-unskip="'+esc(day)+'|'+i+'">Attend</button></span>';
const skipName = (html, on) => on ? '<s class="sk">'+html+'</s>' : html;
const skipIdx = (day, pred) => skipsOn(day).findIndex(pred);
/* carried-over work whose real deadline has passed: shown under "Deadline passed", not counted in today's hours */
const pastDeadline = (c,t) => { const ld = Organizer.lastDayOf(c,t); return !!ld && ld < TODAY && !!t.due && t.due <= TODAY; };   /* also when the organizer put it on today (19 Nov 2026 user test) */
const isCommute = day => classesOn(day).some(e=>!e.o);   /* only classes at the main place mean the train */
/* the lane a task counts in: train, phone, class (on the class he gave it to) or desk (js/organize.js) */
const placeOf = t => Organizer.placeOf(t, TODAY);
const onCommute = t => (t.where==='train'||t.where==='phone') && !!t.due && isCommute(t.due);
/* Done work counts on the day it was done (doneOn), so a task finished early frees its planned day.
   Done before doneOn existed (no doneOn): counts on its day only if that day is past, since it was ticked before today. */
const countsOn = (t, day) => t.status!=='done' ? t.due===day : t.doneOn ? t.doneOn===day : t.due===day && day < TODAY;
/* done work counts what it took when he typed it (19 Nov 2026 user test: a 2 h task done in 0.5 h showed "2 h work") */
const hoursOn = day => allTasks().filter(({t})=>countsOn(t, day)).reduce((s,{t})=>s+(t.status==='done' && Number(t.spent)>0 ? Number(t.spent) : Number(t.est)||0),0);
/* a day over its free time after he moved work there himself: said, not blocked (19 Nov 2026 user test) */
function overNote(day){ const h = r1(hoursOn(day)), cap = r1(deskCap(day)); if(h > cap + 0.25 && typeof flToast==='function') flToast(fmtShort(day)+' now has '+h+' h of work, over its '+cap+' h of free time.'); }
/* The one way to change a task's status. Done: stamps doneOn; done ahead of its day, the task moves to today (its planned
   day kept in "planned") so the organizer can fill the freed day. Undone: an early task goes back to its planned day. */
function setStatus(t, st){
  if(st===t.status) return;
  if(st!=='blocked') delete t.waiting;   /* no longer waiting once it moves on (any way it changes: tick, menu, planner) */
  if(st==='done'){
    t.doneOn = TODAY;
    if(t.due && t.due > TODAY){ t.planned = t.due; t.due = TODAY; }
    if(t.where!=='class' || t.due!==t.pin) delete t.pin;   /* work done in class stays on its class */
  } else if(t.status==='done'){
    if(t.planned && t.planned > TODAY) t.due = t.planned;
    delete t.planned; delete t.doneOn; delete t.spent;
  }
  t.status = st;
}
function dayTimes(day){
  const cl = classesOn(day).filter(e=>!e.o); if(!cl.length) return null;   /* classes he skips take no time away from home; online and nearby sessions are cut in freeAtHome */
  const first = Math.min(...cl.map(e=>toMin(e.s)));
  const classEnd = Math.max(...cl.map(e=>toMin(e.e||e.s)+(e.e?0:60)));
  /* Home is homeAfterCommute after the last thing at the main place (classes, or an event placed there), homeAfterOther after any other in-person event. Online and all-day events don't move it. */
  let home = classEnd + RULES_CFG.homeAfterCommute, last = classEnd;
  if(typeof CAL!=='undefined') busyEventsOn(day).filter(e=>!e.allDay && !meetLink(e) && String(e.end).slice(0,10)===day).forEach(e=>{
    const end = evMin(e.end), far = atMainPlace(eventPlace(e));
    last = Math.max(last, end); home = Math.max(home, end + (far ? RULES_CFG.homeAfterCommute : RULES_CFG.homeAfterOther));
  });
  return {first, last, leave:first-RULES_CFG.leaveBefore, home};
}

/* ---------- pieces ---------- */
function statusChip(t){
  const opts = STATUS.map(([v,l])=>'<option value="'+v+'"'+(t.status===v?' selected':'')+'>'+l+'</option>').join('');
  return '<label class="st st-'+esc(t.status)+'">'+(ICON[t.status]||ICON.todo)+'<select data-act="status" aria-label="Status of '+esc(t.title)+'">'+opts+'</select></label>';
}
/* Actual time: asked for once a task is done, so later estimates can learn from it. */
const spentField = t => t.status==='done' && Number(t.spent)>0 ? '<span class="spent mono">Took '+esc(t.spent)+' h</span>' : '';
const timed = () => allTasks().filter(({t})=>t.status==='done' && Number(t.spent)>0 && Number(t.est)>0);
/* Planned vs actual for the model: overall and per course ratio, plus the latest timed tasks. */
function timeHistory(ids){
  const all = timed(); if(!all.length) return '    none recorded yet';
  const ratio = rows => (rows.reduce((s,{t})=>s+Number(t.spent),0) / rows.reduce((s,{t})=>s+Number(t.est),0)).toFixed(2);
  const out = ['    overall: '+all.length+' tasks, actual = '+ratio(all)+' x estimate'];
  courses.filter(c=>!ids || ids.includes(c.id)).forEach(c=>{ const rows = all.filter(x=>x.c===c); if(rows.length) out.push('    '+c.id+': '+rows.length+' tasks, actual = '+ratio(rows)+' x estimate'); });
  all.filter(({c})=>!ids || ids.includes(c.id)).sort((a,b)=>String(b.t.due).localeCompare(String(a.t.due))).slice(0,15).forEach(({c,t})=>out.push('    ['+c.id+'] '+t.title+' | '+(t.where||'desk')+' | planned '+t.est+' h, took '+t.spent+' h'));
  return out.join('\n');
}
const whereLabel = t => t.where==='train' ? 'Train · laptop' : t.where==='phone' ? 'Metro · phone' : t.where==='class' ? 'In class' : 'Desk';
function taskRow(c,t,o={}){
  const d = delivOf(c,t);
  const overdue = t.status!=='done' && t.due && t.due<TODAY;
  return '<li class="task cc'+(t.status==='done'?' done':'')+'" '+cs(c.id)+' data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'">'
    + '<div class="dcol mono">'+(t.due?esc(fmt(t.due,{weekday:'short',day:'2-digit',month:'short'})):'No date')+'</div>'
    + '<button class="check" data-act="toggle" aria-label="'+(t.status==='done'?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'
    + '<div><div class="ttitle">'+esc(t.title)+pdfBtns(c,t)+'</div><div class="tmeta">'
    +   '<span class="tag"><i class="sw"></i>'+esc(c.short)+'</span>'
    +   (d?'<span>'+esc(d.title)+'</span>':'')
    +   whereTag(c,t)
    +   (o.trip?'<span class="tag trip">On the commute</span>':'')
    +   (overdue?'<span class="tag warn">'+ICON.warn+'Carried over from '+esc(fmtShort(t.due))+'</span>':'')
    +   (typeof waitTag==='function' ? waitTag(c,t) : '')
    + '</div>'+(t.note && o.note!==false?'<div class="tnote">'+esc(String(t.note).split(/(?<=[.!?])\s/)[0])+'</div>':'')+(typeof waitDraft==='function'?waitDraft(t):'')+'</div>'
    + '<div class="tside">'+(t.est?'<span class="est mono">'+(t.status==='done'?'Planned ':'')+esc(t.est)+' h</span>':'')+spentField(t)+statusChip(t)
    +   nextDayBtn(c,t)+taskDlPicker(c,t)+rmLink()+'</div></li>';
}
/* "Move to next day" only while the next day is still before the work's last day (session work: the day before the session).
   On its last day the task stays put and says so, with nothing to move it (14 Nov 2026, the user's request: "I should be forced to
   see it without able to move it"). */
function nextDayBtn(c,t){
  if(t.status==='done') return '';
  const ld = Organizer.lastDayOf(c,t), next = addDays(t.due && t.due>TODAY ? t.due : TODAY, 1);
  /* the phone: "Move to…" opens the date picker, limited to today up to the last day (moveOk in views.js checks the rest) */
  const pick = PHONE && t.due && (!ld || ld > TODAY) ? '<label class="lnk mvday">Move to…<input type="date" data-act="moveday" min="'+TODAY+'"'+(ld?' max="'+ld+'"':'')+' value="'+esc(t.due>=TODAY?t.due:TODAY)+'" aria-label="Move '+esc(t.title)+' to another day"></label>' : '';
  if(ld && next > ld) return '<span class="tag warn">'+ICON.warn+(ld<TODAY?'Deadline passed '+esc(fmtShort(ld)):ld===TODAY?'Last day':'Last day '+esc(fmtShort(ld)))+'</span>'+pick;
  return '<button class="lnk" data-act="tomorrow">Move to next day</button>'+pick;
}
/* A course's call link is found automatically: the next (else the latest) calendar event that names the course and carries a call link. */
const courseKeys = c => [c.short, String(c.name||'').split('·')[0]].map(k=>String(k||'').trim().toLowerCase()).filter(k=>k.length>=4);
const courseOfEvent = e => { const txt = String(e.title||'').toLowerCase(); return courses.find(c=>courseKeys(c).some(k=>txt.includes(k))); };
/* Calendar label: a calendar just called "Calendar"/"Inbox"/"Default" is named by its account instead (e.g. the school's account). */
const calLabel = e => /^(calendar|kalender|inbox|default)$/i.test(String(e.calendar||'').trim()) && e.account ? e.account : (e.calendar||'');
/* Events from different calendars that start at the same moment are one thing (it runs until the later end): keep the one that names a course (else the one with a call link), take the call link and notes from the others. */
function mergeSameSlot(list){
  const groups = new Map(), out = [];
  list.forEach(e=>{ if(e.allDay){ out.push(e); return; } const k = e.start; if(!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
  groups.forEach(g=>{
    if(g.length===1 || new Set(g.map(e=>e.calendar+'|'+e.account)).size < g.length){ out.push(...g); return; }
    const main = g.find(e=>courseOfEvent(e)) || g.find(e=>meetLink(e)) || g[0];
    const others = g.filter(e=>e!==main), link = meetLink(main) || others.map(meetLink).find(Boolean) || '';
    const end = g.map(e=>String(e.end)).sort().pop();
    out.push(Object.assign({}, main, {end, url: main.url || link, location: main.location || others.map(e=>cleanLoc(e)).find(Boolean) || '',
      notes: [main.notes].concat(others.map(e=>e.title+': '+(e.notes||''))).filter(Boolean).join('\n'),
      also: others.map(e=>e.title), calendars: [...new Set(g.map(calLabel).filter(Boolean))]}));
  });
  return out.sort((a,b)=>String(a.start).localeCompare(String(b.start)));
}
function courseLink(c){
  if(typeof HAS_CAL==='undefined' || !HAS_CAL || !CAL.length) return '';
  const keys = courseKeys(c);
  if(!keys.length) return '';
  const hits = CAL.filter(e=>{ const txt = [e.title,e.notes,e.location].join(' ').toLowerCase(); return keys.some(k=>txt.includes(k)) && meetLink(e); })
    .sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  const up = hits.find(e=>String(e.end||e.start).slice(0,10)>=TODAY) || hits[hits.length-1];
  return up ? meetLink(up) : '';
}
/* Remove a task: the first click asks "Remove for sure", the second removes it. */
const rmLink = () => '<button class="lnk" data-act="remove" title="Remove this task from the plan">Remove</button>';
/* Where things happen, one rule for every view. Timetable classes are at the main place (profile). Calendar events show only the place the event itself gives (or Online when it has a call link). Nothing is guessed. */
/* online and nearby sessions are not at the main place (19 Nov 2026 user test: a Zoom seminar showed the campus with "Room Zoom") */
const classPlace = e => (e.o==='online' ? 'Online' : e.o==='near' ? (e.r || 'In person') : mainPlace().name + (e.r ? ' · Room ' + e.r : '')) + (typeof classWorkOn==='function' && classWorkOn(e.d, e.c) ? ' · work time' : '');
const eventPlace = e => meetLink(e) ? 'Online · ' + meetKind(meetLink(e)) : (cleanLoc(e) || 'Place not set');
function classRow(e){
  const k = skipIdx(e.d, x=>x.c===e.c && x.s===e.s);
  return '<div class="ev'+(k>=0?' skipped':'')+'" '+cs(e.c)+'><span class="bar"></span><div><div class="ttitle">'+skipName(esc(e.t), k>=0)+(k>=0?skipTag(e.d,k):'')+'</div><div class="tmeta">'+esc(classPlace(e))+'</div></div><span class="time mono">'+e.s+(e.e?'–'+e.e:'')+'</span></div>';
}

/* F45 — station clock */
function clockSvg(min){
  const h = Math.floor(min/60)%12, m = min%60;
  let ticks='';
  for(let i=0;i<60;i++){
    const big = i%5===0, a = i*6;
    ticks += '<rect x="'+(big?48.4:49.3)+'" y="5" width="'+(big?3.2:1.4)+'" height="'+(big?11:4)+'" fill="currentColor" transform="rotate('+a+' 50 50)"/>';
  }
  const ha = (h + m/60)*30, ma = m*6;
  return '<svg class="clock" viewBox="0 0 100 100" role="img" aria-label="Clock showing '+toHM(min)+'">'
    + '<circle cx="50" cy="50" r="48" fill="var(--bg)" stroke="var(--rule)" stroke-width="1.5"/>'
    + '<g style="color:var(--ink)">'+ticks
    + '<rect x="47" y="22" width="6" height="36" rx="1" fill="currentColor" transform="rotate('+ha+' 50 50)"/>'
    + '<rect x="48" y="9" width="4" height="49" rx="1" fill="currentColor" transform="rotate('+ma+' 50 50)"/>'
    + '<circle cx="50" cy="50" r="2.6" fill="var(--bg)"/></g></svg>';
}
/* Commute: pick at most 2 h laptop and 2 h phone, most urgent first. Everything else stays desk work. */
let COMMUTE_CAP = RULES_CFG.commuteCap;
onProfile(()=>{ HEAVY = RULES_CFG.heavy; COMMUTE_CAP = RULES_CFG.commuteCap; });
const urgency = ({c,t}) => { const d = delivOf(c,t); return [ (d && d.date) || t.due || '9999', t.due || '9999', Number(t.est)||0 ]; };
const prioRank = ({c,t}) => { const d = delivOf(c,t); return d && d.prio > 0 ? +d.prio : 99; };   /* priority deadlines first (26 Nov 2026) */
const byUrgency = (x,y) => { const a = urgency(x), b = urgency(y); return prioRank(x)-prioRank(y) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2]-b[2]; };
function commutePlan(day){
  /* Only tasks planned for that day. Per mode, pick the set that fills the 2 h best; ties go to the more urgent tasks. */
  const plan = {train:[], phone:[], used:{train:0, phone:0}, picked:new Set()};
  if(!isCommute(day)) return plan;
  for(const w of ['train','phone']){
    const cand = allTasks().filter(({c,t})=>t.status!=='done' && t.where===w && t.due===day && !deskOnly(c) && (Number(t.est)||0)>0 && (Number(t.est)||0)<=COMMUTE_CAP).sort(byUrgency).slice(0,14);
    let best = [], bestH = -1;
    for(let m=0; m<(1<<cand.length); m++){
      let hrs = 0, pick = [];
      for(let i=0;i<cand.length;i++) if(m & (1<<i)){ hrs += Number(cand[i].t.est); pick.push(i); }
      if(hrs > COMMUTE_CAP + 1e-9) continue;
      const better = hrs > bestH + 1e-9 || (Math.abs(hrs-bestH)<1e-9 && pick.join(',') < best.join(','));
      if(better){ best = pick; bestH = hrs; }
    }
    best.forEach(i=>{ plan[w].push(cand[i]); plan.picked.add(cand[i].t); });
    plan.used[w] = Math.max(0,bestH);
  }
  return plan;
}
/* What a commute task needs offline: the reading or video named in the title, or the files its note says to have on the laptop or phone.
   Parts of one reading collapse into one line. Files already in the course folder are skipped. Writing and slide work needs nothing extra. */
const PREP_NOTE = /\b(download|save|offline|on (the|your) (laptop|phone)|before the train|needs the)\b/i;
function prepFor(c,t){
  const title = String(t.title||'').replace(/\s*\(part \d+ of \d+\)\s*$/i,'').trim();
  const out = [];
  /* A reading or video already in the course folder (it has an Open PDF button) needs no download. */
  const have = c && typeof pdfsFor==='function' && pdfsFor(c,t).length>0;
  let m = !have && title.match(/^read\s+(.+)$/i);
  if(m){
    const what = m[1].replace(/^the (first|second|third|final|last) (third|half|part) of /i,'');
    const d = /^the (first|second|third|final|last|next) (third|half|part)$/i.test(what) && c && delivOf(c,t);
    out.push(d ? 'Download the reading for '+d.title : 'Download '+what);
  }
  m = !have && title.match(/\bwatch\s+(.+?)(\s+and\s+|$)/i);
  if(m) out.push('Download the video: '+m[1]);
  String(t.note||'').split(/(?<=\.)\s+/).filter(s=>PREP_NOTE.test(s)).forEach(s=>out.push(s.replace(/\.$/,'')));
  return out;
}
function commutePrep(plan){
  const seen = new Set(), items = [];
  plan.train.concat(plan.phone).forEach(({c,t})=>prepFor(c,t).forEach(p=>{ const k = c.id+'|'+p.toLowerCase(); if(!seen.has(k)){ seen.add(k); items.push({c, p, w:t.where}); } }));
  return items;
}
function commuteTile(day, title){
  const tm = dayTimes(day); if(!tm) return '';
  const plan = commutePlan(day);
  if(day===TODAY){
    /* Today's commute tasks are in the list below (tagged "On the commute"); the tile only says what to get ready. */
    const prep = commutePrep(plan);
    return '<div class="tile ctile" aria-label="'+esc(title)+'"><div class="ctop">'+clockSvg(tm.leave)
      + '<div><div class="lbl">'+esc(title)+'</div><div class="leave">Leave <span class="mono">'+toHM(tm.leave)+'</span></div><div class="csub">Home about <span class="mono">'+toHM(tm.home)+'</span> · laptop <span class="mono">'+r1(plan.used.train)+'</span> h · phone <span class="mono">'+r1(plan.used.phone)+'</span> h</div></div></div>'
      + '<div class="tz tz1"><div><h3><span>Prepare before you leave</span></h3><ol>'
      + (prep.length ? prep.map(({c,p,w})=>'<li class="cc" '+cs(c.id)+'><span class="mono">'+(w==='phone'?'phone':'laptop')+'</span><span><i class="sw"></i> '+esc(p)+' <span class="faint">· '+esc(c.short)+'</span></span></li>').join('') : '<li><span class="mono">—</span><span class="muted">Nothing to download</span></li>')
      + '</ol></div></div></div>';
  }
  const col = (w,label) => '<div><h3><span>'+label+'</span><span>'+r1(plan.used[w])+' / '+COMMUTE_CAP+' h</span></h3><ol>'
    + (plan[w].length ? plan[w].map(({c,t})=>'<li class="cc" '+cs(c.id)+'><span class="mono">'+esc(t.est)+' h</span><span><i class="sw"></i> '+esc(t.title)+' <span class="faint">· '+esc(c.short)+'</span></span></li>').join('') : '<li><span class="mono">—</span><span class="muted">Nothing fits</span></li>')
    + '</ol></div>';
  return '<div class="tile ctile" aria-label="'+esc(title)+'"><div class="ctop">'+clockSvg(tm.leave)
    + '<div><div class="lbl">'+esc(title)+'</div><div class="leave">Leave <span class="mono">'+toHM(tm.leave)+'</span></div><div class="csub">Home about <span class="mono">'+toHM(tm.home)+'</span>'+(day!==TODAY?' · download files tonight':'')+'</div></div></div>'
    + '<div class="tz">'+col('train','Train · laptop')+col('phone','Metro · phone')+'</div></div>';
}

/* Heads-up: three lines, nearest dated items that are not over yet */
const MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function flagDates(when){
  const w = String(when||''), out = [];
  const months = [...w.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/ig)].map(m=>MON[m[1].toLowerCase()]);
  if(!months.length) return out;
  const yr = mo => { const m = w.match(/\b(20\d\d)\b/); return m ? +m[1] : (mo>=8 ? 2026 : 2027); };
  const days = [...w.matchAll(/\b(\d{1,2})\b(?!:)/g)].map(m=>+m[1]).filter(n=>n>=1 && n<=31);
  if(days.length) days.forEach((d,i)=>{ const mo = months[Math.min(i, months.length-1)]; out.push(yr(mo)+'-'+pad(mo+1)+'-'+pad(d)); });
  else { out.push(yr(months[0])+'-'+pad(months[0]+1)+'-01'); const l = months[months.length-1]; out.push(yr(l)+'-'+pad(l+1)+'-28'); }
  return out.sort();
}
/* Move a deadline by picking a date. Tasks for it that now fall after the deadline move to the day before (not before today). */
const dlPicker = (c,d,label) => '<label class="dlmove" title="Pick a new date for '+esc(d.title)+'">'+esc(label||'Move')+'<input type="date" data-dl="'+esc(c.id)+'|'+esc(d.id)+'" value="'+esc(d.date||'')+'"></label>';
/* A task's deadline by hand, no model (24 Nov 2026, the user's request: "change deadline of tasks without the need of AI").
   The real deadline is the deliverable's date (see "Two deadlines"), so picking one moves that deliverable, and its other
   open steps with it. A task without a deliverable gets its own, named after it. Weekly work and session readings keep
   theirs (the class date is the deadline). */
const taskDlOk = (c,t) => { const d = delivOf(c,t); return t.status!=='done' && !(d && (d.state==='ongoing' || isSession(c,d))); };
function taskDlPicker(c,t,short){
  if(!taskDlOk(c,t)) return '';
  const d = delivOf(c,t), dl = d && d.date;
  return '<label class="dlmove lnk" title="Pick the deadline'+(d?' of '+esc(d.title)+' (its other steps keep it too)':'')+'">'+(short?'Deadline':dl?'Deadline '+esc(fmtShort(dl)):'Set deadline')+'<input type="date" data-tdl="'+esc(c.id)+'|'+esc(t.id)+'" min="'+TODAY+'" value="'+esc(dl||'')+'" aria-label="Deadline of '+esc(t.title)+'"></label>';
}
function taskDeadline(cid, tid, date){
  const c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid); if(!t || !taskDlOk(c,t) || !/^\d{4}-\d\d-\d\d$/.test(date)) return '';
  if(!delivOf(c,t)){
    const id = c.id+'-'+Date.now().toString(36), title = String(t.title).replace(Organizer.PART_RE,'');
    c.deliverables = c.deliverables||[]; c.deliverables.push({id, title, date:null, state:'tbd', note:''});
    /* the other parts of the same task share the new deadline */
    const base = title; (c.tasks||[]).forEach(x=>{ if(x===t || (!delivOf(c,x) && String(x.title).replace(Organizer.PART_RE,'')===base)) x.did = id; });
  }
  return moveDeadline(cid, t.did, date);
}
function moveDeadline(cid, did, date){
  const c = cById(cid), d = c && (c.deliverables||[]).find(x=>x.id===did); if(!d || !/^\d{4}-\d\d-\d\d$/.test(date)) return '';
  const old = d.date; d.date = date; if(d.state==='tbd' || d.state==='likely') d.state = 'set';
  const lastDay = addDays(date,-1) < TODAY ? date : addDays(date,-1); let moved = 0;
  (c.tasks||[]).forEach(t=>{ if(t.did===did && t.status!=='done' && t.due && t.due>date){ t.due = lastDay; moved++; } });
  save(c);
  return d.title+': '+(old?fmtShort(old)+' → ':'')+fmtShort(date)+(moved?' · '+moved+' task'+(moved===1?'':'s')+' moved to '+fmtShort(lastDay):'');
}

/* Heads-up shows one item at a time: deadlines and dated notes in date order, nearest first. Arrows step through them. */
let HU_I = 0;
function headsUpItems(){
  const firstLine = t => String(t||'').split(/(?<=[.!?])\s/)[0];
  const dls = deadlines(TODAY, addDays(TODAY,400)).map(({c,d})=>({date:d.date, c, d, title:d.title, sub:esc(c.short)+' · <span class="mono">'+esc(fmtShort(d.date))+'</span>', kind:'Deadline'}));
  const notes = flags.map(f=>({f, ds:flagDates(f.when)})).filter(x=>x.ds.length && x.ds[x.ds.length-1]>=TODAY && !dls.some(d=>x.ds.length===1 && d.date===x.ds[0]))
    .map(({f,ds})=>({date:ds[0]<TODAY?TODAY:ds[0], title:firstLine(f.text), full:f.text, sub:'<span class="mono">'+esc(f.when)+'</span>', kind:'Heads-up'}));
  return dls.concat(notes).sort((a,b)=>a.date.localeCompare(b.date) || (a.kind==='Deadline'?-1:1)).slice(0,12);
}
function headsUp(){
  const items = headsUpItems(); if(!items.length) return '';
  HU_I = Math.max(0, Math.min(HU_I, items.length-1));
  const x = items[HU_I], n = diff(x.date, TODAY);
  return '<div class="tile brief'+(x.c?' cc':'')+'" '+(x.c?cs(x.c.id):'')+' aria-label="Heads-up"><div class="lbl hub"><span>'+(HU_I===0?'Next · ':'')+x.kind+'</span><span class="hunav"><button class="lnk" data-hu="-1" aria-label="Previous"'+(HU_I===0?' disabled':'')+'>‹</button><span class="mono">'+(HU_I+1)+' / '+items.length+'</span><button class="lnk" data-hu="1" aria-label="Next"'+(HU_I>=items.length-1?' disabled':'')+'>›</button></span></div>'
    + '<div class="num">'+(n<=0?'Today':n+'<small>'+(n===1?'day':'days')+'</small>')+'</div>'
    + '<div class="foot"><div class="nt"'+(x.full?' title="'+esc(x.full)+'"':'')+'>'+esc(x.title)+'</div><div class="muted">'+(x.c?'<i class="sw"></i> ':'')+x.sub+(x.d && IN_APP?' · '+dlPicker(x.c,x.d):'')+'</div></div></div>';
}
/* the Planner logo (the app icon, mac-app/AppIcon.png): the square that opens the planner chat on the Mac and the add sheet on the
   iPhone (27 Nov 2026, the user's request: "make it be a square with the planner logo, instead of always being a text box") */
const PLANNER_LOGO = '<svg class="pl-logo" viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="fill:none;stroke:none"><rect width="100" height="100" style="fill:#CCB6EB;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(0 50 50)" style="fill:#F8F7F0;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(60 50 50)" style="fill:#F8F7F0;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(120 50 50)" style="fill:#F8F7F0;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(180 50 50)" style="fill:#F8F7F0;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(240 50 50)" style="fill:#F8F7F0;stroke:none"/><ellipse cx="50" cy="31" rx="9.4" ry="18.2" transform="rotate(300 50 50)" style="fill:#F8F7F0;stroke:none"/><circle cx="50" cy="50" r="9" style="fill:#E2E984;stroke:none"/><circle cx="50" cy="50" r="4" style="fill:#1A1A1A;stroke:none"/></svg>';
