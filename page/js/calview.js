/* Calendar tab: his own view of time over Calendar.app. Levels Year (the term) › Month › Week; the day stays on Today.
   Redesigned 26 Nov 2026 (Figma, design/mac-redesign/mockups.html M2–M4).
   Replaces the Week and Term tabs (#week and #term still open the Week and Year levels). Part of page/index_v2.html; classic script, loaded in order. */
const CV = {level:'week', anchor:TODAY, sel:''};   /* sel: the picked day in Month */
const CV_LEVELS = [['year','Year'],['month','Month'],['week','Week']];
let cvShowDone = localStorage.getItem('cvShowDone')==='1';   /* Week: done tasks hidden unless he opens them */

/* ---------- calendar events by year ----------
   CAL (the organizer's copy) covers last week to 120 days ahead. Other years are fetched when shown and kept a few minutes. */
const CALY = {};        /* year -> {at, events, idx} */
const CALY_PENDING = new Set();
const CALY_FALLBACK = {};   /* year -> {list, idx} built from CAL while that year is not fetched */
function cvReset(){ Object.keys(CALY).forEach(k=>delete CALY[k]); }
function cvLoadYear(y){
  if(!IN_APP || CAL_STATUS!=='granted' || CALY_PENDING.has(y)) return;
  const have = CALY[y]; if(have && Date.now()-have.at < 300000) return;
  CALY_PENDING.add(y);
  APP.call('calendar', {from:y+'-01-01', to:y+'-12-31'}).then(r=>{
    CALY[y] = {at:Date.now(), events:mergeSameSlot(r.events||[]), idx:null};
  }).catch(()=>{}).finally(()=>{ CALY_PENDING.delete(y); if(tab==='calendar') render(); });
}
function cvFind(k){ for(const y in CALY){ const e = CALY[y].events.find(x=>evKey(x)===k); if(e) return e; } return null; }
/* day -> {ev:[events], allDay:[events], calH} for one year, from that year's fetch or else from CAL */
function cvIdx(y){
  const src = CALY[y], fb = CALY_FALLBACK[y];
  if(src && src.idx) return src.idx;
  if(!src && fb && fb.list===CAL) return fb.idx;
  const list = src ? src.events : CAL;
  const idx = {};
  const at = d => idx[d] || (idx[d] = {ev:[], allDay:[], calH:0});
  list.forEach(e=>{
    if(e.allDay){
      /* the last day: Calendar may end an all-day event at 00:00 the next day or at 23:59 on the day */
      const ed = String(e.end).slice(0,10), lastD = String(e.end).slice(11,16)==='00:00' && ed > evDay(e) ? addDays(ed,-1) : ed;
      for(let d = evDay(e), n = 0; d <= lastD && n < 400; d = addDays(d,1), n++) if(d.slice(0,4)===String(y)) at(d).allDay.push(e);
      return;
    }
    const d = evDay(e); if(d.slice(0,4)!==String(y)) return;
    if(isClassCopy(e, allClassesOn(d))) return;
    at(d).ev.push(e);
    if(String(e.end).slice(0,10)===d && !eventSkipped(d, e)) at(d).calH += Math.max(0,(evMin(e.end)-evMin(e.start))/60);
  });
  Object.values(idx).forEach(x=>x.ev.sort((a,b)=>String(a.start).localeCompare(String(b.start))));
  if(src) src.idx = idx; else CALY_FALLBACK[y] = {list:CAL, idx};
  return idx;
}
const CV_EMPTY = {ev:[], allDay:[], calH:0};
const cvDay = d => cvIdx(+d.slice(0,4))[d] || CV_EMPTY;
const classH = d => classesOn(d).reduce((s,c)=>s+(c.e ? (toMin(c.e)-toMin(c.s))/60 : 1),0);
/* planner work per day, the same rule as countsOn() */
function cvWork(){
  const m = {};
  allTasks().forEach(({t})=>{
    const d = t.status!=='done' ? t.due : t.doneOn ? t.doneOn : (t.due && t.due < TODAY ? t.due : null);
    if(d) m[d] = (m[d]||0) + (Number(t.est)||0);
  });
  return m;
}
function isoWeek(s){ const d = parse(s); const t = new Date(d); t.setDate(d.getDate()+3-((d.getDay()+6)%7)); const w1 = new Date(t.getFullYear(),0,4,12); return 1+Math.round(((t-w1)/864e5-3+((w1.getDay()+6)%7))/7); }
const monthStart = s => s.slice(0,8)+'01';
const monthDays = s => new Date(+s.slice(0,4), +s.slice(5,7), 0).getDate();
const addMonths = (s,n) => { const d = parse(monthStart(s)); d.setMonth(d.getMonth()+n); return iso(d); };

/* ---------- moving ---------- */
function cvMove(n){
  const a = CV.anchor;
  CV.anchor = CV.level==='week' ? addDays(a, 7*n) : CV.level==='month' ? addMonths(a, n) : addMonths(cvTerm(a).from, 6*n);   /* Year shows a term: one step is the next term */
  if(CV.level==='month') CV.sel = '';
  render();
}
function cvGo(level, day){ CV.level = level; if(day) CV.anchor = day; if(tab!=='calendar') location.hash = 'calendar'; else { render(); window.scrollTo(0,0); } }
function cvOut(){ const i = CV_LEVELS.findIndex(l=>l[0]===CV.level); if(i>0) cvGo(CV_LEVELS[i-1][0]); }

function cvBar(title, sub){
  const lv = CV_LEVELS.map(([k,n],i)=>'<button class="'+(k===CV.level?'on':'')+'" data-cv-level="'+k+'" title="'+n+' ('+(i+1)+')">'+n+'</button>').join('');
  const span = CV.level==='week' ? 'week' : CV.level==='month' ? 'month' : 'year';
  const arrows = '<button class="btn" data-cv-move="-1" aria-label="Previous '+span+'">‹</button><button class="btn" data-cv-today="1">Today</button><button class="btn" data-cv-move="1" aria-label="Next '+span+'">›</button>';
  return '<div class="cvbar"><h1 class="cvtitle">'+title+(sub?'<small>'+sub+'</small>':'')+'</h1>'
    + '<nav class="cvlv" aria-label="Zoom">'+lv+'</nav><span style="flex:1"></span>'
    + arrows+'</div>';
}

function viewCalendar(){
  const y = +CV.anchor.slice(0,4);
  if(CV.level==='year') for(let i=-1;i<=3;i++) cvLoadYear(y+i);
  else if(CV.level==='month'){ cvLoadYear(y); cvLoadYear(+addMonths(CV.anchor,3).slice(0,4)); }
  else { cvLoadYear(y); cvLoadYear(+addDays(monday(CV.anchor),13).slice(0,4)); }
  const body = CV.level==='year' ? cvYear() : CV.level==='month' ? cvMonth() : cvWeek();
  return '<div class="cv">'+body+'</div>';
}

/* one week: calendar and class hours, planner work, and whether a day goes over HEAVY */
function cvWeekLoad(w, work){ let c=0, k=0, heavy=false; for(let i=0;i<7;i++){ const d=addDays(w,i), x = cvDay(d); c += x.calH + classH(d); const h = work[d]||0; k += h; if(h + x.calH > HEAVY) heavy = true; } return {w, c, k, heavy}; }

/* ---------- Year (M4, Mac redesign 26 Nov 2026): the term. How heavy each week is (the chart in the palette, course names
   in a legend with each course's hours, nothing on the curves), then every deadline by month of the term. Weeks open on
   click, months too. The 2025–2029 tabs and the twelve mini calendars are gone. ---------- */
/* the term around a day: winter Oct–Feb, summer Mar–Sep */
function cvTerm(a){
  const y = +a.slice(0,4), m = +a.slice(5,7);
  if(m >= 10 || m <= 2){ const y0 = m >= 10 ? y : y-1; return {name:'Winter term', sub:y0+'/'+String(y0+1).slice(2), from:y0+'-10-01', to:(y0+1)+'-02-'+pad(monthDays((y0+1)+'-02-01'))}; }
  return {name:'Summer term', sub:String(y), from:y+'-03-01', to:y+'-09-30'};
}
/* shades of the locked palette for the courses, darkest first (no extra hues: memory "locked palette") */
const CV_SHADES = ['var(--l8)','var(--l7)','var(--l6)','var(--l5)','var(--l4)','var(--l3)','var(--g6)','var(--g4)','var(--g3)','var(--l2)','var(--g5)','var(--l1)'];
function cvTermChart(from, to, work){
  const weeks = []; for(let w = monday(from); w <= to; w = addDays(w,7)) weeks.push(w);
  const cs2 = courses.filter(c=>(c.tasks||[]).length).map(c=>({c, row:weeks.map(w=>(c.tasks||[]).filter(t=>t.due && t.due>=w && t.due<addDays(w,7)).reduce((s,t)=>s+(Number(t.est)||0),0))}))
    .map(x=>Object.assign(x,{sum:x.row.reduce((a,b)=>a+b,0)})).filter(x=>x.sum>0).sort((a,b)=>b.sum-a.sum);
  const loads = weeks.map(w=>cvWeekLoad(w, work)), cal = loads.map(l=>l.c);
  const workW = weeks.map((_,i)=>cs2.reduce((s,x)=>s+x.row[i],0)), tot = workW.map((v,i)=>v+cal[i]);
  if(weeks.length < 2 || !tot.some(v=>v>0)) return {svg:'', legend:'', peak:''};
  const W=900, H=266, L=34, R=6, T=10, B=26;
  const max = Math.max(10, Math.ceil(Math.max(...tot)/20)*20);
  const x = i => L + i*(W-L-R)/(weeks.length-1), y = v => T + (H-T-B)*(1-v/max);
  const curve = pts => pts.map((p,i)=>i ? 'C'+((pts[i-1][0]+p[0])/2)+' '+pts[i-1][1]+' '+((pts[i-1][0]+p[0])/2)+' '+p[1]+' '+p[0]+' '+p[1] : 'M'+p[0]+' '+p[1]).join(' ');
  const band = (lo, hi) => { const top = weeks.map((_,i)=>[x(i), y(hi[i])]), bot = weeks.map((_,i)=>[x(i), y(lo[i])]).reverse(); return curve(top)+' L'+bot[0][0]+' '+bot[0][1]+' '+curve(bot).slice(1).replace(/^[^C]*/,'')+' Z'; };
  let s = '';
  for(let g = 20; g <= max; g += 20) s += '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(g)+'" y2="'+y(g)+'" stroke="var(--rule)"/><text x="'+(L-8)+'" y="'+(y(g)+4)+'" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">'+g+'</text>';
  let acc = weeks.map(()=>0);
  if(cal.some(v=>v>0)){ s += '<path d="'+band(acc, cal)+'" fill="var(--g2)"><title>Classes and calendar</title></path>'; acc = cal.slice(); }
  cs2.forEach((xc,ci)=>{ const hi = acc.map((v,i)=>v+xc.row[i]); s += '<path d="'+band(acc, hi)+'" fill="'+CV_SHADES[ci % CV_SHADES.length]+'" stroke="var(--bg)" stroke-width="1"><title>'+esc(xc.c.short)+'</title></path>'; acc = hi; });
  weeks.forEach((w,i)=>{ const d = parse(w); if(d.getDate()<=7) s += '<text x="'+x(i)+'" y="'+(H-6)+'" font-size="12" fill="var(--ink-2)" font-family="IBM Plex Mono,monospace">'+esc(fmt(w,{month:'short'}))+'</text>'; });
  weeks.forEach((w,i)=>{ if(loads[i].heavy) s += '<rect x="'+(x(i)-2)+'" y="'+(H-B+2)+'" width="4" height="6" fill="var(--coral)"><title>A day over '+HEAVY+' h</title></rect>'; });
  const ti = diff(TODAY, weeks[0])/7;
  if(ti>=0 && ti<=weeks.length-1){ const tx = L + ti*(W-L-R)/(weeks.length-1); s += '<line x1="'+tx+'" x2="'+tx+'" y1="'+T+'" y2="'+(H-B)+'" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/><text x="'+(tx+5)+'" y="'+(T+10)+'" font-size="12" fill="var(--ink)" font-family="Inter,sans-serif">Today</text>'; }
  const half = (W-L-R)/(weeks.length-1)/2;
  weeks.forEach((w,i)=>{ s += '<rect class="ldhit" data-cv-go="week|'+w+'" x="'+(x(i)-half)+'" y="'+T+'" width="'+(2*half)+'" height="'+(H-T-B)+'" fill="transparent"><title>Week '+isoWeek(w)+' · '+esc(fmt(w,{day:'numeric',month:'short'}))+' · '+r1(workW[i])+' h work · '+r1(cal[i])+' h classes and calendar</title></rect>'; });
  const pk = tot.indexOf(Math.max(...tot));
  return {svg:'<svg class="mx-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Hours per week: planned work by course over classes and calendar">'+s+'</svg>',
    legend: cs2.map((xc,ci)=>'<div class="mx-lg"><i style="background:'+CV_SHADES[ci % CV_SHADES.length]+'"></i><span>'+esc(xc.c.short)+'</span><b class="mono">'+Math.round(xc.sum)+' h</b></div>').join('')
      + '<div class="mx-lg"><i style="background:var(--g2)"></i><span>Classes & calendar</span><b></b></div>'
      + '<div class="mx-lg"><i style="background:var(--coral);width:4px"></i><span>A day over '+HEAVY+' h</span><b></b></div>',
    peak:'busiest: week of '+fmt(weeks[pk],{day:'numeric',month:'short'})+' · '+Math.round(workW[pk])+' h work + '+Math.round(cal[pk])+' h classes'};
}
function cvYear(){
  const tm = cvTerm(CV.anchor), work = cvWork();
  const ch = cvTermChart(tm.from, tm.to, work);
  let months = '', n = 0;
  for(let m = tm.from; m <= tm.to; m = addMonths(m,1)){
    n++;
    const last = m.slice(0,8)+pad(monthDays(m)), dls = deadlines(m, last, false).filter(z=>!isSession(z.c,z.d)).sort((a,b)=>a.d.date.localeCompare(b.d.date));
    months += '<div class="mx-mc'+(m===monthStart(TODAY)?' cur':'')+'"><button class="mx-mch" data-cv-go="month|'+m+'">'+esc(fmt(m,{month:'long'}))+'<span class="mono">'+(dls.length?dls.length+' due':'')+'</span></button>'
      + (dls.length ? dls.map(({c,d})=>'<button class="mx-di'+(d.date<TODAY?' past':'')+'" data-cv-go="week|'+d.date+'" title="'+esc(fmtShort(d.date)+' · '+d.title+' · '+c.short)+'"><span class="d mono">'+parse(d.date).getDate()+'</span><span class="t">'+esc(d.title)+' <span class="c">· '+esc(c.short)+'</span></span></button>').join('') : '<div class="mx-mr">No deadlines</div>')
      + '</div>';
  }
  return cvBar(tm.name, tm.sub)
    + (ch.svg ? '<div class="mx-yr"><div><div class="mx-chh"><b>Hours per week</b><span class="mono">'+esc(ch.peak)+'</span></div>'+ch.svg+'</div><div><span class="lbl" style="display:block;margin:2px 0 8px">Work by course</span>'+ch.legend+'</div></div>' : '<p class="cvmnone">Nothing planned in this term.</p>')
    + '<div class="mx-mths" style="grid-template-columns:repeat('+n+',minmax(0,1fr))">'+months+'</div>';
}

/* ---------- Month (M3): the grid carries the content. Each day: deadlines by name, session readings, a count of classes and
   events, a load bar (outlined coral over HEAVY). Commute days tinted with a lilac edge. Click a day: its list on the right;
   double click opens its week. ---------- */
const CV_MFULL = 16;   /* hours that fill a day's load bar in Month */
function cvMonth(){
  const m0 = monthStart(CV.anchor), n = monthDays(m0), last = m0.slice(0,8)+pad(n), off = (parse(m0).getDay()+6)%7, work = cvWork();
  const sel = CV.sel && CV.sel.slice(0,7)===m0.slice(0,7) ? CV.sel : (TODAY.slice(0,7)===m0.slice(0,7) ? TODAY : m0);
  let g = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w=>'<div class="mx-wn mono">'+w+'</div>').join('') + '<div class="mx-cell out"></div>'.repeat(off);
  let nDue = 0;
  for(let i=1; i<=n; i++){
    const d = m0.slice(0,8)+pad(i), x = cvDay(d), w = work[d]||0, cal = x.calH + classH(d), dls = deadlines(d,d,true);
    const due = dls.filter(z=>!isSession(z.c,z.d)), ss = dls.filter(z=>isSession(z.c,z.d)); nDue += due.length;
    const nEv = allClassesOn(d).length + x.ev.length + x.allDay.length;
    const cls = ['mx-cell', d<TODAY?'past':'', d===TODAY?'today':'', isCommute(d)?'cmd':'', d===sel?'sel':''].filter(Boolean).join(' ');
    const tip = fmtShort(d)+(w?' · '+r1(w)+' h work':'')+(cal?' · '+r1(cal)+' h calendar':'')+(due.length?' · Due: '+due.map(z=>z.d.title).join('; '):'');
    g += '<button class="'+cls+'" data-cv-pick="'+d+'" title="'+esc(tip)+'" aria-pressed="'+(d===sel)+'"><span class="n"><span>'+i+'</span>'+(w?'<small class="mono">'+r1(w)+' h</small>':'')+'</span>'
      + due.map(z=>'<span class="x du">'+(z.d.prio>0?'P'+esc(z.d.prio)+' · ':'')+esc(z.d.title)+'</span>').join('') + ss.map(z=>'<span class="x ss">'+esc(z.d.title.replace(/^Session\s*[^·]*·\s*/i,'Session · '))+' · '+esc(z.c.short)+'</span>').join('')
      + (nEv ? '<span class="x ec">'+nEv+(nEv===1?' event':' events')+'</span>' : '')
      + '<span class="ld'+(w + x.calH > HEAVY?' hv':'')+'"><i class="w" style="width:'+Math.min(100,w/CV_MFULL*100)+'%"></i><i class="c" style="width:'+Math.min(100,cal/CV_MFULL*100)+'%"></i></span></button>';
  }
  const tail = (7 - (off+n)%7) % 7; g += '<div class="mx-cell out"></div>'.repeat(tail);
  /* the picked day */
  const x = cvDay(sel), w = work[sel]||0, cal = x.calH + classH(sel), items = [];
  deadlines(sel, sel, true).forEach(({c,d})=>items.push({m:-2, h:'<div class="mx-mev"><div class="tm mono">all day</div><div class="bx'+(isSession(c,d)?'':' due')+'"></div><div><div class="ti">'+prioMark(d)+(isSession(c,d)?'':'Due · ')+esc(d.title)+'</div><div class="s2">'+esc(c.short)+'</div></div></div>'}));
  x.allDay.forEach(e=>items.push({m:-1, h:'<div class="mx-mev"><div class="tm mono">all day</div><div class="bx g"></div><div><div class="ti"><button class="evbtn" data-ev="'+esc(evKey(e))+'">'+esc(e.title)+'</button></div></div></div>'}));
  allClassesOn(sel).forEach(e=>{ const k = skipIdx(sel, z=>z.c===e.c && z.s===e.s); items.push({m:toMin(e.s), h:'<div class="mx-mev"><div class="tm mono">'+esc(e.s)+'</div><div class="bx"></div><div><div class="ti">'+skipName(esc(e.t), k>=0)+'</div><div class="s2">'+esc(classPlace(e))+(k>=0?skipTag(sel,k):'')+'</div></div></div>'}); });
  x.ev.forEach(e=>{ const sk = eventSkipped(sel, e); items.push({m:evMin(e.start), h:'<div class="mx-mev"><div class="tm mono">'+String(e.start).slice(11,16)+'</div><div class="bx g"></div><div><div class="ti"><button class="evbtn" data-ev="'+esc(evKey(e))+'">'+skipName(esc(e.title), sk)+'</button></div>'+(eventPlace(e)?'<div class="s2">'+esc(eventPlace(e))+'</div>':'')+'</div></div>'}); });
  busyOn(sel).forEach((b,i)=>items.push({m:b.from, h:'<div class="mx-mev"><div class="tm mono">'+toHM(b.from)+'</div><div class="bx g"></div><div><div class="ti">Busy</div><div class="s2">'+esc(b.note||busyLabel(b))+' · <button class="lnk" data-busy="'+esc(sel)+'|'+i+'">Remove</button></div></div></div>'}));
  items.sort((a,b)=>a.m-b.m);
  const tks = allTasks().filter(({t})=>countsOn(t, sel) || (t.status!=='done' && t.due===sel));
  const side = '<aside class="mx-mside"><span class="lbl">Picked day</span><h2>'+esc(fmt(sel,{weekday:'long',day:'numeric'}))+'</h2>'
    + '<div class="su mono">'+r1(w)+' h work · '+r1(cal)+' h calendar'+(w + x.calH > HEAVY?' · heavy':'')+'</div>'
    + '<div style="margin:0 0 14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-cv-go="week|'+sel+'">Open week '+isoWeek(sel)+' ›</button>'+(IN_APP && CAL_STATUS==='granted' ? '<button class="btn" data-cv-new="'+sel+'">New event</button>' : '')+'</div>'
    + items.map(z=>z.h).join('')
    + tks.map(({c,t})=>'<div class="mx-mev'+(t.status==='done'?' dn':'')+'"><div class="tm mono">'+(t.est?esc(t.est)+' h':'')+'</div><div class="bx tk"></div><div><div class="ti">'+esc(t.title)+'</div><div class="s2">'+esc(c.short)+(t.status==='done'?' · done':'')+'</div></div></div>').join('')
    + (!items.length && !tks.length ? '<div class="empty">Nothing on this day.</div>' : '')
    + '</aside>';
  return cvBar(esc(fmt(m0,{month:'long'})), m0.slice(0,4))
    + '<div class="mx-mo"><div><div class="mx-mg" style="--rows:'+Math.ceil((off+n)/7)+'">'+g+'</div>'
    + '<div class="mx-mkey mono"><span><i class="k-du"></i>due</span><span><i style="background:var(--l6)"></i>planned work</span><span><i style="background:var(--g5)"></i>calendar</span><span><i class="k-cm"></i>commute day</span><span>'+nDue+' deadline'+(nDue===1?'':'s')+' this month</span></div></div>'
    + side+'</div>';
}

/* ---------- Week (M2): every day has the same four bands at the same height, so you read across: load, Due, Classes &
   events, Tasks. One load bar (lilac = planned work, grey = calendar). Leaving and coming home are on Today. Tasks are one line
   with hours; the full title, course and actions open on click. Drag between days as before. Fits one screen: long days
   scroll inside their own band. ---------- */
const CV_WFULL = 18;   /* hours that fill a day's load bar in Week */
function cvWeekDay(d, work, all){
  const x = cvDay(d), w = work[d]||0, cal = x.calH + classH(d), heavy = w + x.calH > HEAVY;
  const dls = deadlines(d,d,true), cp = dayTimes(d) ? commutePlan(d) : null;
  const ev = [];
  x.allDay.forEach(e=>ev.push({a:-1, h:'<button class="mx-pe ev" data-ev="'+esc(evKey(e))+'"><span class="tm mono">all day</span><span class="t">'+esc(e.title)+'</span></button>'}));
  allClassesOn(d).forEach(c=>{ const k = skipIdx(d, z=>z.c===c.c && z.s===c.s); ev.push({a:toMin(c.s), h:'<div class="mx-pe cl'+(k>=0?' skipped':'')+'"><span class="tm mono">'+esc(c.s)+'</span><span class="t">'+skipName(esc(c.t), k>=0)+'<span class="r">'+esc(c.o ? classPlace(c) : c.r ? 'Room '+c.r : placeShort())+(k>=0?' · Not attending · <button class="lnk" data-unskip="'+esc(d)+'|'+k+'">Attend</button>':'')+'</span></span></div>'}); });
  x.ev.forEach(e=>{ const sk = eventSkipped(d, e); ev.push({a:evMin(e.start), h:'<button class="mx-pe ev'+(sk?' skipped':'')+'" data-ev="'+esc(evKey(e))+'"><span class="tm mono">'+String(e.start).slice(11,16)+'</span><span class="t">'+skipName(esc(e.title), sk)+(eventPlace(e)||sk?'<span class="r">'+esc(eventPlace(e))+(sk?(eventPlace(e)?' · ':'')+'Not attending':'')+'</span>':'')+'</span></button>'}); });
  busyOn(d).forEach((b,i)=>ev.push({a:b.from, h:'<div class="mx-pe ev"><span class="tm mono">'+toHM(b.from)+'</span><span class="t">Busy<span class="r">'+esc(b.note||busyLabel(b))+' · <button class="lnk" data-busy="'+esc(d)+'|'+i+'">Remove</button></span></span></div>'}));
  ev.sort((p,q)=>p.a-q.a);
  const picked = cp ? cp.picked : new Set(), ct = cp ? cp.train.concat(cp.phone) : [];
  const mine = all.filter(({t})=>t.due===d && !picked.has(t)).concat(ct);
  const open = mine.filter(z=>z.t.status!=='done'), done = mine.filter(z=>z.t.status==='done');
  const od = d===TODAY ? all.filter(({t})=>t.due && t.due<TODAY && t.status!=='done') : [];
  const row = ({c,t}) => { const k = tkKey(c,t), on = TK_OPEN===k, pl = ct.some(z=>z.t===t) ? placeWord(t) : '';
    return '<div class="mx-tt'+(t.status==='done'?' dn':'')+(on?' open':'')+'" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'" data-tk="'+esc(k)+'"'+(t.status!=='done' && d>=TODAY && t.due>=TODAY ? ' draggable="true" title="Drag to another day"' : ' title="'+esc(t.title)+'"')+'>'
      + '<button class="check sm" data-act="toggle" aria-label="'+(t.status==='done'?'Mark as not done':'Mark as done')+': '+esc(t.title)+'"></button>'
      + '<span class="t">'+esc(t.title)+'</span>'+(pl?'<span class="w mono">'+pl+'</span>':'')+'<span class="h mono">'+(t.est?esc(t.est)+' h':'')+'</span>'
      + (on ? '<div class="mx-ttx"><div class="ttitle">'+esc(t.title)+'</div><div class="faint">'+esc(c.short)+(delivOf(c,t)?' · '+esc(delivOf(c,t).title):'')+'</div>'+tkActs(c,t)+'</div>' : '')+'</div>'; };
  return '<section class="mx-wd cvday'+(d===TODAY?' today':'')+(d<TODAY?' past':'')+'" data-day="'+esc(d)+'">'
    + '<div class="band"><div class="dh"><b>'+parse(d).getDate()+'</b><span class="mono">'+esc(fmt(d,{weekday:'short'}))+'</span></div>'
    +   '<div class="ld"><i class="w" style="width:'+Math.min(100,w/CV_WFULL*100)+'%"></i><i class="c" style="width:'+Math.min(100,cal/CV_WFULL*100)+'%"></i></div>'
    +   '<div class="lh mono"><span title="planned work + classes and calendar">'+r1(w)+' h + '+r1(cal)+' h</span>'+(heavy?'<span class="hv">heavy</span>':'')+'</div></div>'
    + '<div class="band b-due"><span class="bl mono">Due</span>'+(dls.length ? dls.map(({c,d:dl})=>isSession(c,dl) ? '<div class="mx-ss" title="'+esc(dl.title+' · '+c.short)+'">'+esc(dl.title)+' · '+esc(c.short)+'</div>' : '<div class="mx-dp" title="'+esc('Due · '+dl.title+' · '+c.short)+'">'+prioMark(dl)+'Due · '+esc(dl.title)+' · '+esc(c.short)+'</div>').join('') : '<div class="empty">—</div>')+'</div>'
    + '<div class="band b-ev"><span class="bl mono">Classes &amp; events'+(IN_APP && CAL_STATUS==='granted' ? ' <button class="lnk" data-cv-new="'+esc(d)+'" aria-label="New event on '+esc(fmtShort(d))+'" title="New event">+</button>' : '')+'</span>'+(ev.length ? ev.map(r=>r.h).join('') : '<div class="empty">—</div>')+'</div>'
    + '<div class="band b-tk"><span class="bl mono">Tasks</span>'
    +   (od.length?'<a class="pcarry" href="#today">'+ICON.warn+'<span>'+od.length+' carried over</span></a>':'')
    +   open.map(row).join('') + (cvShowDone ? done.map(row).join('') : '')
    +   (!open.length && !(cvShowDone && done.length) && !od.length ? '<div class="empty">'+(done.length ? 'All done · '+done.length : 'Nothing planned')+'</div>' : '')
    + '</div></section>';
}
function cvWeek(){
  const start = monday(CV.anchor), days = [...Array(7)].map((_,i)=>addDays(start,i)), work = cvWork(), all = allTasks();
  const sub = fmt(start,{day:'numeric'})+(start.slice(5,7)===days[6].slice(5,7)?'':' '+fmt(start,{month:'short'}))+' – '+fmt(days[6],{day:'numeric',month:'short'});
  const tw = days.reduce((s,d)=>s+(work[d]||0),0), tc = days.reduce((s,d)=>s+cvDay(d).calH+classH(d),0);
  const nDone = all.filter(({t})=>t.status==='done' && days.includes(t.due)).length;
  return cvBar('Week '+isoWeek(start), esc(sub))
    + '<div class="mx-wk">'+days.map(d=>cvWeekDay(d, work, all)).join('')+'</div>'
    + '<div class="mx-wsum mono"><span><b>'+r1(tw)+' h</b> planned work</span><span><b>'+r1(tc)+' h</b> classes and calendar</span>'
    + (nDone ? '<button class="lnk" data-cv-done-toggle="1" aria-pressed="'+cvShowDone+'">'+(cvShowDone ? 'Hide' : 'Show')+' '+nDone+' done</button>' : '')
    + '</div>';
}

/* ---------- input ---------- */
document.addEventListener('click', async e=>{
  if(tab!=='calendar') return;
  const lv = e.target.closest('[data-cv-level]'); if(lv){ cvGo(lv.dataset.cvLevel); return; }
  const mv = e.target.closest('[data-cv-move]'); if(mv){ cvMove(+mv.dataset.cvMove); return; }
  if(e.target.closest('[data-cv-today]')){ CV.anchor = TODAY; render(); return; }
  if(e.target.closest('[data-cv-done-toggle]')){ cvShowDone = !cvShowDone; localStorage.setItem('cvShowDone', cvShowDone?'1':'0'); render(); return; }
  const nw = e.target.closest('[data-cv-new]'); if(nw){ openEvEdit(null, nw.dataset.cvNew); return; }
  if(e.target.closest('[data-ev],[data-act],[data-busy],a,.cvt,.mx-tt')) return;
  const pk = e.target.closest('[data-cv-pick]'); if(pk){ CV.sel = pk.dataset.cvPick; render(); return; }
  const go = e.target.closest('[data-cv-go]'); if(go){ const [l, d] = go.dataset.cvGo.split('|'); cvGo(l, d); return; }
});
document.addEventListener('dblclick', e=>{ if(tab!=='calendar') return; const pk = e.target.closest('[data-cv-pick]'); if(pk) cvGo('week', pk.dataset.cvPick); });
document.addEventListener('keydown', e=>{
  if(tab!=='calendar' || e.metaKey || e.ctrlKey || e.altKey || EVEDIT) return;
  if(e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
  if(typeof HELP!=='undefined' && HELP) return;
  if(typeof READ!=='undefined' && READ) return;
  const k = e.key;
  if(k==='ArrowLeft'){ cvMove(-1); e.preventDefault(); }
  else if(k==='ArrowRight'){ cvMove(1); e.preventDefault(); }
  else if(k==='ArrowUp' || k==='Escape'){ cvOut(); e.preventDefault(); }
  else if(k==='t' || k==='T'){ CV.anchor = TODAY; render(); }
  else if(/^[1-3]$/.test(k)) cvGo(CV_LEVELS[+k-1][0]);
});

