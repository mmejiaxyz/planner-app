/* The iPhone's own views (25 Nov 2026, the user's comments on the Figma "Archive" page and the agreed mock-ups P1–P3, C1–C2, T1–T2 in
   design/phone-redesign/mockups.html). The user's words: the phone is "to get readings done, add or mark tasks, no more info is needed,
   also a general overview of the calendar, similar to the ios calendar"; the calendar "cant be a huge scroll"; Courses and
   All tasks become one Tasks tab. Phone only: the Mac keeps views.js and calview.js. Tabs: Today · Calendar · Tasks, at the bottom.
   Ticking, Move to…, Remove, deadlines and Get help reuse the Mac's handlers (data-act, data-phelp, data-file in main.js/sync.js). */
const PH = {sheet:null, add:null, cal:{mode:'month', anchor:TODAY, sel:TODAY}, tasks:{mode:lsGet('phTasksMode')||'week', open:new Set(['w0']), course:'', files:false}, doneOpen:false};
const PH_ICON = {
  book:'<svg viewBox="0 0 20 20"><path d="M3 4h5.5c.8 0 1.5.7 1.5 1.5V17c0-.8-.7-1.5-1.5-1.5H3zM17 4h-5.5c-.8 0-1.5.7-1.5 1.5V17c0-.8.7-1.5 1.5-1.5H17z"/></svg>',
  plus:'<svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg>',
  left:'<svg viewBox="0 0 20 20"><path d="M12 5l-5 5 5 5"/></svg>', right:'<svg viewBox="0 0 20 20"><path d="M8 5l5 5-5 5"/></svg>',
  up:'<svg viewBox="0 0 20 20"><path d="M5 12l5-5 5 5"/></svg>', down:'<svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg>',
  check:'<svg viewBox="0 0 20 20"><path d="M4 10l4 4 8-8"/></svg>', cal:'<svg viewBox="0 0 20 20"><path d="M4 5h12v12H4zM4 9h12M8 3v3M12 3v3"/></svg>',
  ask:'<svg viewBox="0 0 20 20"><path d="M3 4h14v9H8l-4 3.5V13H3z"/></svg>', file:'<svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3"/></svg>'};
const phRead = (c,t) => typeof READ_RE!=='undefined' && READ_RE.test(t.title||'');
const phFile = (c,t) => HAS_FILES() ? (filesOf(c,t)[0] || '') : '';
const phOpen = () => allTasks().filter(({t})=>t.status!=='done' && t.status!=='blocked' && t.due && t.due<=TODAY).sort(byUrgency);

/* ---------- Today (P1): the reading he is on, then what is open; no date, hours, commute or heads-up ---------- */
function phReadingNow(open){
  const store = rdStore(), list = open.filter(({c,t})=>phRead(c,t) && phFile(c,t));
  if(!list.length) return null;
  const kept = x => store[fileRef(x.c, phFile(x.c,x.t))];
  const x = list.find(y=>{ const k = kept(y); return k && k.at; }) || list[0], k = kept(x) || {};
  return {c:x.c, t:x.t, f:phFile(x.c,x.t), page:k.page||0};
}
function phReadCard(r){
  const d = delivOf(r.c, r.t), pg = r.t.pages, inRange = pg && r.page >= pg.from && r.page <= pg.to;
  const left = inRange ? pg.to - r.page + 1 : pg ? pg.to - pg.from + 1 : 0, total = pg ? pg.to - pg.from + 1 : 0;
  const title = String(r.t.title).replace(READ_RE, '').replace(/\s*\(part \d+ of \d+\)\s*$/i,'').trim();
  return '<section class="ph-read" aria-label="Reading now"><div class="ph-lbl">Reading · '+esc(r.c.short)+'</div>'
    + '<div class="ph-rt">'+esc(title)+'</div>'
    + (d ? '<div class="ph-rs">'+esc(d.title)+'</div>' : '')
    + (total ? '<div class="ph-bar"><i style="width:'+Math.round(100*(total-left)/total)+'%"></i></div>' : '<div class="ph-gap"></div>')
    + '<div class="ph-rrow"><span class="ph-p">'+(r.page ? 'p. '+r.page+(left?' · '+left+' page'+(left===1?'':'s')+' left':'') : left ? left+' pages' : '')+'</span>'
    + '<button class="ph-btn" data-file="'+esc(fileRef(r.c,r.f))+'" data-ctx="'+esc(r.c.id+'|'+r.t.id)+'">'+PH_ICON.book+(r.page?'Continue':'Start reading')+'</button></div></section>';
}
function phRow(c,t,o={}){
  const f = phRead(c,t) && phFile(c,t), late = t.status!=='done' && pastDeadline(c,t);
  const sub = [esc(c.short)];
  if(o.day) sub.push(esc(fmtShort(t.due)));
  if(t.where==='train' || t.where==='phone') sub.push(t.where==='train' ? 'train' : 'metro');
  if(late) sub.push('<span class="ph-due">deadline passed</span>');
  else if(t.status!=='done' && t.due && t.due<TODAY && !o.day) sub.push('from '+esc(fmtShort(t.due)));
  return '<li class="ph-tk'+(t.status==='done'?' dn':'')+'" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'" data-pht="'+esc(c.id+'|'+t.id)+'">'
    + '<button class="ph-ck" data-act="toggle" aria-label="'+(t.status==='done'?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'
    + '<div class="ph-m"><div class="ttitle">'+esc(t.title)+'</div>'+(o.sub===false?'':'<div class="ph-su">'+sub.join(' · ')+'</div>')+'</div>'
    + (f && t.status!=='done' && !o.right ? '<button class="ph-go" data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|'+t.id)+'">'+PH_ICON.book+'Read</button>' : o.right ? '<span class="ph-d">'+o.right+'</span>' : '')
    + '</li>';
}
function phToday(){
  const open = phOpen(), done = allTasks().filter(({t})=>t.status==='done' && countsOn(t, TODAY)), r = phReadingNow(open);
  let h = phHead('Today', open.length ? open.length+' open' : '') + phLine();
  if(r) h += phReadCard(r);
  h += '<section aria-label="Open today"><div class="ph-sec">Open</div>'
    + (open.length ? '<ul class="ph-list">'+open.map(({c,t})=>phRow(c,t)).join('')+'</ul>' : '<div class="ph-empty">Nothing left for today.</div>')
    + (done.length ? '<button class="ph-more" data-ph="done">'+(PH.doneOpen?PH_ICON.up:PH_ICON.down)+'Done · '+done.length+'</button>'
      + (PH.doneOpen ? '<ul class="ph-list">'+done.map(({c,t})=>phRow(c,t)).join('')+'</ul>' : '') : '')
    + '</section>';
  return h + phAddBar();
}

/* ---------- shared bits ---------- */
const phHead = (title, right) => '<div class="ph-hd"><h1>'+title+'</h1>'+(right?'<span class="ph-r">'+esc(right)+'</span>':'')+'</div>';
/* the sync line: only an error, changes waiting for the Mac, or an old plan (as before, phoneBlock) */
function phLine(){
  const s = SYNC || {}, line = [], stale = s.snapshotAt && (Date.now() - Date.parse(s.snapshotAt)) > 86400000;
  if(s.error) line.push(esc(s.error));
  if(s.waiting) line.push(s.waiting+' change'+(s.waiting===1?'':'s')+' waiting for the Mac');
  if((s.notes||[]).length) line.push(s.notes.length+' note'+(s.notes.length===1?'':'s')+' waiting');
  if(stale && !s.error) line.push('Plan from the Mac '+esc(agoText(s.snapshotAt)));
  return line.length ? '<div class="ph-line">'+line.join(' · ')+'</div>' : '';
}
const phAddBar = () => (SYNC||{}).paired ? '<button class="ph-addbar" data-ph="add"><span>Add a task or a note for the Mac</span><i>'+PH_ICON.plus+'</i></button>' : '';

/* ---------- task sheet (P2): everything a task can do on the phone ---------- */
function phTaskSheet(){
  const [cid, tid] = PH.sheet.split('|'), c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid);
  if(!t){ PH.sheet = null; return ''; }
  const d = delivOf(c,t), f = phFile(c,t), open = t.status!=='done';
  const part = Organizer.partInfo ? Organizer.partInfo(t) : null;
  let h = '<div class="ph-sheet" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'"><div class="ph-grab" data-ph="close"></div>'
    + '<div class="ph-lbl">'+esc(c.short)+(d?' · '+esc(d.title):'')+'</div><h2 class="ttitle">'+esc(t.title)+'</h2>'
    + '<div class="ph-acts">'
    + (f ? '<button class="ph-act pri" data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|'+t.id)+'">'+PH_ICON.book+(phRead(c,t)?'Read':'Open PDF')+'<small>'+esc(f.split('/').pop().slice(0,34))+'</small></button>' : '')
    + '<button class="ph-act" data-act="toggle">'+PH_ICON.check+(open?'Done':'Not done')+'<small>'+(open?'asks the time it took':'puts it back')+'</small></button>'
    + (open ? '<button class="ph-act" data-phelp="'+esc(c.id+'|'+t.id)+'">'+PH_ICON.ask+'Ask the Mac<small>waits on Get help there</small></button>' : '')
    + '</div>';
  if(open) h += '<div class="ph-ln ph-mv"><span>'+PH_ICON.cal+(t.due ? esc(fmtShort(t.due)) : 'No day yet')+'</span><span>'+nextDayBtn(c,t)+'</span></div>'
    + (taskDlOk(c,t) ? '<div class="ph-ln"><span>Deadline</span><span>'+taskDlPicker(c,t)+'</span></div>' : '');
  h += '<div class="ph-ln"><span>'+(part ? 'Part '+part.n+' of '+part.of : t.est ? esc(t.est)+' h planned' : '')+'</span><span class="ph-v">'+esc(whereLabel(t))+'</span></div>';
  if(t.note) h += '<div class="ph-note">'+esc(t.note)+'</div>';
  return h + '<div class="ph-ln">'+rmLink()+'<span></span></div></div>';
}

/* ---------- add sheet (P3): Task · Note for the Mac · Record; the ids and handlers are the old ones in sync.js ---------- */
function phAddSheet(){
  const m = PH.add, a = PHONE_ADD, cs2 = courses.slice().sort((x,y)=>(x.order||0)-(y.order||0));
  let h = '<div class="ph-sheet ph-tall"><div class="ph-grab" data-ph="close"></div><div class="ph-seg">'
    + [['task','Task'],['note','Note for the Mac'],['rec','Record']].map(([k,l])=>'<button class="'+(m===k?'on':'')+'" data-phmode="'+k+'">'+l+'</button>').join('') + '</div>';
  if(m==='task'){
    if(!a.cid) a.cid = lsGet('phAddCourse') || (cs2[0]||{}).id || '';
    const c = cById(a.cid) || cs2[0], dv = c ? openDelivs(c) : [], d = dv.find(x=>x.id===a.did);
    const last = d && d.date ? (Organizer.isSession(c,d) ? Organizer.sessionLast(c,d) : d.date) : '';
    h += '<label class="ph-fl"><span class="ph-lbl">What</span><input id="pa-title" placeholder="What to do" value="'+esc(a.title)+'"></label>'
      + '<label class="ph-fl"><span class="ph-lbl">Course</span><select id="pa-cid">'+cs2.map(x=>'<option value="'+esc(x.id)+'"'+(c&&x.id===c.id?' selected':'')+'>'+esc(x.short||x.name)+'</option>').join('')+'</select></label>'
      + '<div class="ph-two"><label class="ph-fl"><span class="ph-lbl">Deadline</span><select id="pa-did"><option value="">None</option>'+dv.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===a.did?' selected':'')+'>'+esc(x.title)+(x.date?' · '+esc(fmtShort(x.date)):'')+'</option>').join('')+'</select></label>'
      + '<label class="ph-fl ph-hrs"><span class="ph-lbl">Hours</span><input id="pa-est" type="number" inputmode="decimal" step="0.25" min="0.25" max="100" value="'+esc(a.est)+'"></label></div>'
      + (c && deskOnly(c) ? '<div class="ph-fl"><span class="ph-lbl">Where</span><div class="ph-v">Desk only</div></div>'
        : '<div class="ph-fl"><span class="ph-lbl">Where</span><div class="ph-chips">'+[['desk','Desk'],['train','Train'],['phone','Metro']].map(([v,l])=>'<button class="'+(a.where===v?'on':'')+'" data-phwhere="'+v+'">'+l+'</button>').join('')+'</div></div>')
      + '<label class="ph-fl"><span class="ph-lbl">Day (optional)</span><input id="pa-day" type="date" min="'+TODAY+'"'+(last?' max="'+last+'"':'')+' value="'+esc(a.day)+'"></label>'
      + '<div class="ph-hint">Empty day: the Mac picks one and splits big tasks.</div>'
      + '<button class="ph-btn wide" data-phadd="add">Add</button>'
      + (a.error ? '<div class="ph-err">'+esc(a.error)+'</div>' : a.msg ? '<div class="ph-hint">'+esc(a.msg)+'</div>' : '');
  } else if(m==='note'){
    h += '<label class="ph-fl"><span class="ph-lbl">Note for the Mac</span><textarea id="ph-note" rows="5" placeholder="A task, a date, a change. The planner on the Mac reads it.">'+esc(PHONE_NOTE.draft)+'</textarea></label>'
      + '<button class="ph-btn wide" data-sync="note"'+(PHONE_NOTE.sending?' disabled':'')+'>Send</button>'
      + (PHONE_NOTE.error ? '<div class="ph-err">'+esc(PHONE_NOTE.error)+'</div>' : '')
      + ((SYNC||{}).notes||[]).map(n=>'<div class="ph-hint">Waiting: '+esc(n.text)+'</div>').join('');
  } else h += recBlock();
  return h + '</div>';
}

/* ---------- Calendar (C1 Month, C2 Week): one screen each, like iOS ---------- */
function phDayInfo(d){
  const cls = allClassesOn(d).map(e=>({e, skip:classSkipped(d,e)}));
  const evs = HAS_CAL ? eventsOn(d) : [];
  const due = deadlines(d, d, false);
  const tks = allTasks().filter(({t})=>t.status!=='done' && t.due===d);
  return {cls, evs, due, tks, commute:isCommute(d)};
}
function phCalendar(){
  const P = PH.cal, wk = P.mode==='week';
  const first = monthStart(P.anchor), mon = wk ? monday(P.anchor) : null;
  const title = wk ? (()=>{ const e = addDays(mon,6), a = parse(mon), b = parse(e); return a.getDate()+' – '+b.getDate()+' <small>'+fmt(e,{month:'short'})+(a.getMonth()!==b.getMonth()?'':'')+'</small>'; })()
    : fmt(first,{month:'long'})+' <small>'+first.slice(0,4)+'</small>';
  let h = '<div class="ph-mhd"><h1>'+title+'</h1><div class="ph-arr"><button data-phcal="-1" aria-label="Back">'+PH_ICON.left+'</button><button data-phcal="1" aria-label="Next">'+PH_ICON.right+'</button></div></div>'
    + '<div class="ph-seg ph-segw"><button class="'+(wk?'':'on')+'" data-phcm="month">Month</button><button class="'+(wk?'on':'')+'" data-phcm="week">Week</button></div>';
  h += '<div id="ph-swipe">' + (wk ? phWeek(mon) : phMonth(first)) + '</div>';
  return h;
}
function phMonth(first){
  const P = PH.cal, start = monday(first), n = monthDays(first), last = addDays(first, n-1), end = addDays(monday(last), 6);
  let g = '<div class="ph-grid">' + ['M','T','W','T','F','S','S'].map(x=>'<div class="ph-wd">'+x+'</div>').join('');
  for(let d = start; d <= end; d = addDays(d,1)){
    const out = d.slice(0,7)!==first.slice(0,7), x = out ? null : phDayInfo(d), we = (parse(d).getDay()+6)%7 >= 5;
    const dots = x ? '<i class="cl"></i>'.repeat(Math.min(2, x.cls.filter(y=>!y.skip).length + x.evs.length)) + '<i class="du"></i>'.repeat(Math.min(1, x.due.length)) + (x.tks.length?'<i class="tq"></i>':'') : '';
    g += '<button class="ph-c'+(out?' out':'')+(we?' we':'')+(x&&x.commute?' cm':'')+(d===TODAY?' today':'')+(d===P.sel&&d!==TODAY?' sel':'')+'"'+(out?' tabindex="-1"':' data-phday="'+d+'"')+'><span class="n">'+parse(d).getDate()+'</span><span class="dots">'+dots+'</span></button>';
  }
  g += '</div><div class="ph-key"><span><i class="cl"></i>class / event</span><span><i class="du"></i>due</span><span><i class="tq"></i>tasks</span><span><i class="cm"></i>commute</span></div>';
  return g + (P.sel && P.sel.slice(0,7)===first.slice(0,7) ? phAgenda(P.sel) : '');
}
function phAgenda(d){
  const x = phDayInfo(d), items = [];
  x.cls.forEach(({e,skip})=>items.push({m:toMin(e.s), tm:e.s, cls:'cl', ti:(skip?'<s>':'')+esc(e.t)+(skip?'</s>':''), su:esc(skip?'Not attending':classPlace(e))}));
  x.evs.forEach(e=>items.push({m:e.allDay?-1:evMin(e.start), tm:e.allDay?'all day':String(e.start).slice(11,16), cls:'cl', ti:esc(e.title), su:evSub(e)}));
  x.due.forEach(({c,d:dv})=>items.push({m:-2, tm:'due', cls:'du', ti:esc(dv.title), su:esc(c.short)}));
  items.sort((a,b)=>a.m-b.m);
  let h = '<div class="ph-agenda"><div class="ph-sec">'+esc(fmt(d,{weekday:'long',day:'numeric',month:'long'}))+(x.commute?' <span class="ph-lbl">commute</span>':'')+'</div>';
  h += items.map(i=>'<div class="ph-ev"><span class="tm">'+i.tm+'</span><i class="'+i.cls+'"></i><div><div class="ti">'+i.ti+'</div>'+(i.su?'<div class="su">'+i.su+'</div>':'')+'</div></div>').join('');
  if(x.tks.length) h += '<ul class="ph-list ph-small">'+x.tks.map(({c,t})=>phRow(c,t)).join('')+'</ul>';
  if(!items.length && !x.tks.length) h += '<div class="ph-empty">Nothing on this day.</div>';
  return h + '</div>';
}
function phWeek(mon){
  let h = '<div class="ph-week">';
  for(let i=0;i<7;i++){
    const d = addDays(mon,i), x = phDayInfo(d), it = [];
    x.cls.forEach(({e,skip})=>it.push('<div class="ph-pill'+(skip?' sk':'')+'"><span class="tm">'+esc(e.s)+'</span>'+esc(e.t)+(e.r && !skip?' · '+esc(e.r):'')+'</div>'));
    x.evs.forEach(e=>it.push('<div class="ph-pill"><span class="tm">'+(e.allDay?'all day':String(e.start).slice(11,16))+'</span>'+esc(e.title)+'</div>'));
    x.due.forEach(({d:dv})=>it.push('<div class="ph-pill du">Due · '+esc(dv.title)+'</div>'));
    if(x.tks.length) it.push('<div class="ph-pill tq">'+x.tks.length+' task'+(x.tks.length===1?'':'s')+'</div>');
    if(x.commute) it.push('<div class="ph-tag">commute</div>');
    h += '<button class="ph-wr'+(d===TODAY?' today':'')+'" data-phday="'+d+'" data-phwk="1"><span class="dy"><b>'+parse(d).getDate()+'</b><span>'+fmt(d,{weekday:'short'})+'</span></span><span class="it">'+it.join('')+'</span></button>';
  }
  return h + '</div>';
}

/* ---------- Tasks (T1 by week, T2 by course): Courses and All tasks in one tab ---------- */
function phTasks(){
  const T = PH.tasks, open = allTasks().filter(({t})=>t.status!=='done');
  let h = phHead('Tasks', open.length+' open') + phLine()
    + '<div class="ph-seg ph-segw"><button class="'+(T.mode==='week'?'on':'')+'" data-phtm="week">By week</button><button class="'+(T.mode==='course'?'on':'')+'" data-phtm="course">By course</button></div>';
  h += T.mode==='course' ? phByCourse(open) : phByWeek(open);
  return h + phAddBar();
}
function phByWeek(open){
  const T = PH.tasks, m0 = monday(TODAY), groups = [];
  const add = (k, title, from, to) => groups.push({k, title, from, to, list:[], due:[]});
  add('w0', 'This week', '0000', addDays(m0,6)); add('w1', 'Next week', addDays(m0,7), addDays(m0,13));
  for(let i=2;i<5;i++){ const a = addDays(m0,7*i), b = addDays(a,6); add('w'+i, parse(a).getDate()+' – '+fmt(b,{day:'numeric',month:'short'}), a, b); }
  add('later', 'Later', addDays(m0,35), '9999'); add('none', 'No day yet', '', '');
  open.sort((x,y)=>String(x.t.due||'9999').localeCompare(String(y.t.due||'9999')) || byUrgency(x,y)).forEach(x=>{
    const g = x.t.due ? groups.find(g=>g.from && x.t.due>=g.from && x.t.due<=g.to) : groups[groups.length-1]; if(g) g.list.push(x); });
  deadlines(TODAY, '9999', false).forEach(x=>{ const g = groups.find(g=>g.from && x.d.date>=g.from && x.d.date<=g.to); if(g) g.due.push(x); });
  return groups.filter(g=>g.list.length || g.due.length).map(g=>{
    const on = T.open.has(g.k);
    let h = '<section class="ph-grp"><button class="ph-gh" data-phg="'+g.k+'"><b>'+g.title+'</b><span>'+g.list.length+' open'+(on?PH_ICON.up:PH_ICON.down)+'</span></button>';
    if(on){
      const rows = g.list.map(x=>({k:x.t.due||'9999', h:phRow(x.c, x.t, {sub:false, right:x.t.due ? (x.t.due<TODAY ? 'late' : fmt(x.t.due, g.k==='w0'||g.k==='w1' ? {weekday:'short'} : {day:'numeric',month:'short'})) : ''})}))
        .concat(g.due.map(({c,d})=>({k:d.date+'~', h:'<li class="ph-tk ph-dl"><span class="ph-dueb">Due</span><div class="ph-m"><div class="ttitle">'+esc(d.title)+'</div></div><span class="ph-d">'+esc(c.short)+' · '+fmt(d.date,{weekday:'short',day:'numeric'})+'</span></li>'})));
      rows.sort((a,b)=>a.k.localeCompare(b.k));
      h += '<ul class="ph-list ph-small">'+rows.map(r=>r.h).join('')+'</ul>';
    }
    return h + '</section>';
  }).join('');
}
function phByCourse(open){
  const T = PH.tasks, sorted = courses.slice().sort((a,b)=>(a.order||0)-(b.order||0));
  const list = sorted.filter(c=>(c.tasks||[]).some(t=>t.status!=='done')), idle = sorted.filter(c=>!list.includes(c));
  return list.map(c=>{
    const all = c.tasks||[], done = all.filter(t=>t.status==='done').length, on = T.course===c.id;
    const nx = (c.deliverables||[]).filter(d=>d.date && d.date>=TODAY && all.some(t=>t.did===d.id && t.status!=='done')).sort((a,b)=>a.date.localeCompare(b.date))[0];
    let h = '<section class="ph-crs'+(on?' open':'')+'"><button class="ph-ch" data-phc="'+esc(c.id)+'"><span class="top"><b>'+esc(c.short||c.name)+'</b><span>'+done+' / '+all.length+'</span></span>'
      + '<span class="ph-pb"><i style="width:'+(all.length?Math.round(100*done/all.length):0)+'%"></i></span>'
      + (nx ? '<span class="nx"><span>'+esc(nx.title)+'</span><span'+(diff(nx.date,TODAY)<=2?' class="ph-due"':'')+'>'+esc(diff(nx.date,TODAY)<7 ? fmt(nx.date,{weekday:'short'}) : fmt(nx.date,{day:'numeric',month:'short'}))+'</span></span>' : '')
      + '</button>';
    if(on){
      const ds = (c.deliverables||[]).filter(d=>all.some(t=>t.did===d.id && t.status!=='done')).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
      h += '<div class="ph-dl-list">' + ds.map((d,i)=>'<div class="ph-dh"><span class="no">'+pad(i+1)+'</span><b>'+esc(d.title)+'</b><span class="ph-lbl">'+(d.date?esc(fmt(d.date,{day:'numeric',month:'short'})):'no date')+'</span></div>'
        + '<ul class="ph-list ph-small">'+all.filter(t=>t.did===d.id && t.status!=='done').map(t=>phRow(c,t,{sub:false, right:t.due?fmt(t.due,{weekday:'short',day:'numeric'}):''})).join('')+'</ul>').join('');
      const loose = all.filter(t=>t.status!=='done' && !ds.some(d=>d.id===t.did));
      if(loose.length) h += '<div class="ph-dh"><span class="no">··</span><b>Other</b></div><ul class="ph-list ph-small">'+loose.map(t=>phRow(c,t,{sub:false, right:t.due?fmt(t.due,{weekday:'short',day:'numeric'}):''})).join('')+'</ul>';
      if(!ds.length && !loose.length) h += '<div class="ph-empty">Nothing open.</div>';
      const fs = (FILES[c.id]||[]).filter(f=>/\.pdf$/i.test(f));
      if(fs.length){
        h += '<button class="ph-files" data-phfiles="1"><span>'+PH_ICON.file+'Readings · '+fs.length+' PDF'+(fs.length===1?'':'s')+'</span>'+(T.files?PH_ICON.up:PH_ICON.down)+'</button>';
        if(T.files) h += '<ul class="ph-flist">'+fs.map(f=>{ const x = ((PFILES[c.id]||[]).find(y=>y.f===f))||{}; return '<li><button data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|')+'">'+esc(f.split('/').pop().replace(/\.pdf$/i,''))+'</button>'+(x.reading?'<span>text</span>':x.cached?'<span>on the phone</span>':'<span class="muted">text coming<b class="ph-dl" aria-hidden="true"><i></i></b></span>')+'</li>'; }).join('')+'</ul>';
      }
      h += '</div>';
    }
    return h + '</section>';
  }).join('') + (idle.length ? '<div class="ph-idle">Nothing open: '+idle.map(c=>esc(c.short||c.name)).join(', ')+'</div>' : '');
}

/* ---------- render and events ---------- */
function phRender(){
  if(tab==='courses' || tab==='all-tasks') tab = 'tasks';
  const s = SYNC || {};
  if(!s.paired) return phoneBlock();
  return tab==='calendar' ? phCalendar() : tab==='tasks' ? phTasks() : phToday();
}
/* sheets live outside #app so they stay put while the page scrolls */
function phSheets(){
  let host = document.getElementById('ph-sheets');
  const html = PH.add ? phAddSheet() : PH.sheet ? phTaskSheet() : '';
  if(!html){ if(host) host.remove(); document.documentElement.classList.remove('ph-noscroll'); return; }
  if(!host){ host = document.createElement('div'); host.id = 'ph-sheets'; document.body.appendChild(host); }
  if(host.querySelector('.spent.ask') && PH.sheet){ const [cid,tid] = PH.sheet.split('|'), c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid); if(t && t.status!=='done') return; }   /* keep the "Took … h" field while he types */
  const ae = document.activeElement, fid = ae && host.contains(ae) && ae.id;
  host.innerHTML = '<div class="ph-dim" data-ph="close"></div>' + html;
  document.documentElement.classList.add('ph-noscroll');
  if(fid){ const el = document.getElementById(fid); if(el) el.focus(); }
}
function phClose(){ PH.sheet = null; PH.add = null; phSheets(); }
if(PHONE){
  document.addEventListener('click', e=>{
    const el = e.target;
    const ph = el.closest('[data-ph]');
    if(ph){ e.preventDefault(); const a = ph.dataset.ph;
      if(a==='close') phClose(); else if(a==='add'){ PH.add = 'task'; PH.sheet = null; PHONE_ADD.msg = ''; PHONE_ADD.error = ''; phSheets(); }
      else if(a==='done'){ PH.doneOpen = !PH.doneOpen; render(); } return; }
    const md = el.closest('[data-phmode]'); if(md){ e.preventDefault(); PH.add = md.dataset.phmode; phSheets(); return; }
    const wh = el.closest('[data-phwhere]'); if(wh){ e.preventDefault(); PHONE_ADD.where = wh.dataset.phwhere; phSheets(); return; }
    const cm = el.closest('[data-phcm]'); if(cm){ e.preventDefault(); PH.cal.mode = cm.dataset.phcm; PH.cal.anchor = PH.cal.sel || TODAY; render(); return; }
    const cv = el.closest('[data-phcal]'); if(cv){ e.preventDefault(); phCalMove(+cv.dataset.phcal); return; }
    const dy = el.closest('[data-phday]'); if(dy){ e.preventDefault(); PH.cal.sel = dy.dataset.phday; if(dy.dataset.phwk){ PH.cal.mode = 'month'; PH.cal.anchor = PH.cal.sel; } render(); return; }
    const tm = el.closest('[data-phtm]'); if(tm){ e.preventDefault(); PH.tasks.mode = tm.dataset.phtm; lsSet('phTasksMode', PH.tasks.mode); render(); return; }
    const g = el.closest('[data-phg]'); if(g){ e.preventDefault(); const k = g.dataset.phg; PH.tasks.open.has(k) ? PH.tasks.open.delete(k) : PH.tasks.open.add(k); render(); return; }
    const pc = el.closest('[data-phc]'); if(pc){ e.preventDefault(); PH.tasks.course = PH.tasks.course===pc.dataset.phc ? '' : pc.dataset.phc; PH.tasks.files = false; render(); return; }
    const pf = el.closest('[data-phfiles]'); if(pf){ e.preventDefault(); PH.tasks.files = !PH.tasks.files; render(); return; }
    /* a tap on a task row (not its tick or Read) opens its sheet */
    const row = el.closest('[data-pht]');
    if(row && !el.closest('button,a,input,label,select,.spent')){ e.preventDefault(); PH.sheet = row.dataset.pht; PH.add = null; phSheets(); return; }
  });
  /* actions that leave the sheet: Read opens the reader, Ask the Mac opens its own sheet (their handlers in sync.js stop the click) */
  document.addEventListener('click', e=>{ if(e.target.closest('#ph-sheets [data-file], #ph-sheets [data-phelp]')) setTimeout(phClose, 0); }, true);
  window.addEventListener('hashchange', ()=>{ PH.sheet = null; PH.add = null; }, true);   /* a tab change closes any sheet (render after it redraws) */
  /* the bottom tab bar: Today · Calendar · Tasks */
  const nav = document.querySelector('nav.tabs');
  if(nav) nav.innerHTML = [['today','Today','<path d="M4 6h16M4 12h16M4 18h10"/>'],['calendar','Calendar','<path d="M4 5h16v15H4zM4 10h16M9 3v4M15 3v4"/>'],['tasks','Tasks','<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>']]
    .map(([k,l,d])=>'<a href="#'+k+'" data-tab="'+k+'"><svg viewBox="0 0 24 24">'+d+'</svg>'+l+'</a>').join('');
  /* swipe sideways on the calendar for the next or last month / week */
  let sx = null, sy = 0;
  document.addEventListener('touchstart', e=>{ if(tab==='calendar' && e.target.closest('#ph-swipe') && e.touches.length===1){ sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, {passive:true});
  document.addEventListener('touchend', e=>{ if(sx==null) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null; if(Math.abs(dx) > 60 && Math.abs(dx) > 2*Math.abs(dy)) phCalMove(dx < 0 ? 1 : -1); }, {passive:true});
  /* a swipe down on a sheet's handle closes it */
  let gy = null;
  document.addEventListener('touchstart', e=>{ gy = e.target.closest('.ph-grab') ? e.touches[0].clientY : null; }, {passive:true});
  document.addEventListener('touchend', e=>{ if(gy!=null && e.changedTouches[0].clientY - gy > 40) phClose(); gy = null; }, {passive:true});
}
function phCalMove(n){
  const P = PH.cal;
  P.anchor = P.mode==='week' ? addDays(monday(P.anchor), 7*n) : addMonths(P.anchor, n);
  if(P.mode==='month') P.sel = P.anchor.slice(0,7)===TODAY.slice(0,7) ? TODAY : monthStart(P.anchor); else P.sel = P.anchor;
  render();
}
