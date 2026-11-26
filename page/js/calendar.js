/* Calendar events: reading, merging with the timetable, changing them in Calendar.app; the iPhone inbox. Part of page/index_v2.html; classic script, loaded in order. */
/* calendar */
const evDay = e => String(e.start).slice(0,10);
const evMin = s => { const m = String(s).match(/T(\d\d):(\d\d)/); return m ? (+m[1])*60 + (+m[2]) : 0; };
/* One source of truth for a day's schedule: a calendar event that repeats a timetable class (same start, and same end when the class has one) is dropped here, so every view, the hours count and the widget see it once. */
const isClassCopy = (e, cl) => !e.allDay && cl.some(c => toMin(c.s)===evMin(e.start) && (!c.e || toMin(c.e)===evMin(e.end)));
function eventsOn(day){ const cl = allClassesOn(day); return CAL.filter(e => e.allDay ? (evDay(e) <= day && String(e.end).slice(0,10) > day) : evDay(e) === day).filter(e => !isClassCopy(e, cl)).sort((a,b)=>String(a.start).localeCompare(String(b.start))); }
function eventHours(day){ return r1(eventsOn(day).filter(e=>!e.allDay && String(e.end).slice(0,10)===day).reduce((s,e)=>s+Math.max(0,(evMin(e.end)-evMin(e.start))/60),0)); }
const evTime = e => e.allDay ? 'All day' : String(e.start).slice(11,16)+'–'+String(e.end).slice(11,16);
const MEET_RE = /https?:\/\/[^\s<>"')]*(?:zoom\.us\/(?:j|w|my|s)\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|webex\.com\/|whereby\.com\/|meet\.jit\.si\/)[^\s<>"')]*/i;
function meetLink(e){ for(const f of [e.url, e.location, e.notes]){ const m = String(f||'').match(MEET_RE); if(m) return m[0]; } return ''; }
const meetKind = u => /zoom/i.test(u) ? 'Zoom' : /meet\.google/i.test(u) ? 'Meet' : /teams/i.test(u) ? 'Teams' : /webex/i.test(u) ? 'Webex' : 'call';
const cleanLoc = e => String(e.location||'').replace(/https?:\/\/\S+/g,'').replace(/(?:meeting[\s-]*)?id[:\s]*[\d\s-]{6,}/ig,'').replace(/(?:passcode|password|pwd|kenncode)[:\s]*\S+/ig,'').replace(/^[\s;,|·-]+|[\s;,|·-]+$/g,'').trim();
function joinBtn(e){ const u = meetLink(e); return u ? ' <button class="join" data-join="'+esc(u)+'" title="Open the '+meetKind(u)+' call">Join '+meetKind(u)+'</button>' : ''; }
const evSub = e => [e.allDay && !cleanLoc(e) && !meetLink(e) ? '' : esc(eventPlace(e)),   /* an all-day event needs no "Place not set" */ e.also && e.also.length ? 'with '+esc(e.also.join(', ')) : esc(calLabel(e))].filter(Boolean).join(' · ');

/* Changing the calendar: events are added, changed and deleted in Calendar.app through the app (EventKit), so every device sees it.
   Invitations from someone else stay read only. A repeating event changes only this time unless "this and later ones" is picked. */
let EVEDIT = null, CALS = null;
const evKey = e => (e.id||'')+'|'+e.start;
const eventSkipped = (day, e) => skipsOn(day).some(x=>x.ev && x.ev===evKey(e));
/* events that take his time: all but the ones he said he will not attend */
const busyEventsOn = day => eventsOn(day).filter(e=>!eventSkipped(day, e));
const evByKey = k => CAL.find(e=>evKey(e)===k) || (typeof cvFind==='function' ? cvFind(k) : null);
function evTitle(e){ const t = esc(e.title); return (IN_APP && e.id ? '<button class="evbtn" data-ev="'+esc(evKey(e))+'" title="'+(e.editable===false?'See this event':'Change or delete this event')+'">'+t+'</button>' : t) + joinBtn(e); }
const newEvBtn = day => IN_APP && CAL_STATUS==='granted' ? '<button class="lnk" data-evnew="'+esc(day)+'">New event</button>' : '';
const evDaysBetween = (a,b) => Math.round((parse(b)-parse(a))/86400000);
async function openEvEdit(e, day){
  if(!CALS){ try{ CALS = (await APP.call('calendars')).calendars||[]; }catch(err){ CALS = []; } }
  if(e){
    EVEDIT = {key:evKey(e), id:e.id, occ:e.start, editable:e.editable!==false, recurring:!!e.recurring, allDay:!!e.allDay, title:e.title, date:evDay(e),
      start:e.allDay?'09:00':String(e.start).slice(11,16), end:e.allDay?'10:00':String(e.end).slice(11,16), location:e.location||'', notes:e.notes||'', notesOrig:e.notes||'', calendarId:e.calendarId||'',
      wasAllDay:!!e.allDay, orig:{date:evDay(e), endDate:String(e.end).slice(0,10), startT:String(e.start).slice(11,16), endT:String(e.end).slice(11,16)}, also:e.calendars||[]};
  } else {
    const def = (CALS.find(c=>c.default)||CALS[0]||{}).id||'';
    EVEDIT = {key:'', id:'', editable:true, recurring:false, allDay:false, title:'', date:day||TODAY, start:'10:00', end:'11:00', location:'', notes:'', calendarId:def};
  }
  renderEvEdit();
  setTimeout(()=>{ const el = document.getElementById('ev-title'); if(el){ el.focus(); if(!EVEDIT.id) el.select(); } }, 30);
}
document.addEventListener('change', e=>{ if(e.target.id==='ev-allday'){ evRead(); renderEvEdit(); } });
function closeEvEdit(){ EVEDIT = null; renderEvEdit(); }
function renderEvEdit(){
  let box = document.getElementById('evedit');
  if(!box){ box = document.createElement('div'); box.id = 'evedit'; document.body.appendChild(box); }
  const v = EVEDIT; if(!v){ box.innerHTML = ''; return; }
  const ro = !v.editable, dis = ro ? ' disabled' : '';
  const calOpts = CALS.length ? CALS.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===v.calendarId?' selected':'')+'>'+esc(c.title)+(c.account && c.account!==c.title?' · '+esc(c.account):'')+'</option>').join('') : '';
  let h = '<div class="evedit" role="dialog" aria-label="'+(v.id?'Change event':'New event')+'"><h2>'+(v.id?(ro?'Event':'Change event'):'New event')+'</h2>';
  if(ro) h += '<p class="evro">An invitation from someone else. Change or decline it in Calendar or in the invite.</p>';
  h += '<label>Title<input id="ev-title" value="'+esc(v.title)+'"'+dis+'></label>'
    + '<label>Day<input id="ev-date" type="date" value="'+esc(v.date)+'"'+dis+'></label>'
    + '<label class="evchk"><input id="ev-allday" type="checkbox"'+(v.allDay?' checked':'')+dis+'> All day</label>'
    + (v.allDay ? '' : '<div class="evrow"><label>Starts<input id="ev-start" type="time" value="'+esc(v.start)+'"'+dis+'></label><label>Ends<input id="ev-end" type="time" value="'+esc(v.end)+'"'+dis+'></label></div>')
    + '<label>Place<input id="ev-loc" value="'+esc(v.location)+'" placeholder="Room, address or call link"'+dis+'></label>'
    + (calOpts && !ro ? '<label>Calendar<select id="ev-cal">'+(v.calendarId && !CALS.some(c=>c.id===v.calendarId)?'<option value="">Keep its calendar</option>':'')+calOpts+'</select></label>' : '')
    + '<label>Notes<textarea id="ev-notes" rows="3"'+dis+'>'+esc(v.notes)+'</textarea></label>';
  if(v.recurring && !ro) h += '<label>This event repeats<select id="ev-span"><option value="this">Change only this one</option><option value="future">Change this and later ones</option></select></label>';
  if(v.also && v.also.length > 1) h += '<div class="faint">Shown once, also in: '+esc(v.also.join(', '))+'. Only this copy changes.</div>';
  if(v.error) h += '<div class="cerr"><span class="tag warn">'+ICON.warn+esc(v.error)+'</span></div>';
  h += '<div class="crow">'+(ro ? '<button class="btn" data-evact="close">Close</button>' :
      '<button class="btn pri" data-evact="save"'+(v.busy?' disabled':'')+'>'+(v.busy?'Saving…':v.id?'Save':'Add to calendar')+'</button><button class="btn" data-evact="close">Cancel</button>'
      + (v.id ? '<button class="lnk evdel" data-evact="delete"'+(v.busy?' disabled':'')+'>'+(v.confirmDel?'Delete for sure':'Delete')+'</button>' : ''))
    + '</div></div>';
  box.innerHTML = h;
}
/* Read the editor's fields into EVEDIT (keeps typing when it re-renders). */
function evRead(){
  const v = EVEDIT, g = id => document.getElementById(id); if(!v) return;
  if(g('ev-title')) v.title = g('ev-title').value; if(g('ev-date')) v.date = g('ev-date').value;
  if(g('ev-start')) v.start = g('ev-start').value; if(g('ev-end')) v.end = g('ev-end').value;
  if(g('ev-loc')) v.location = g('ev-loc').value; if(g('ev-notes')) v.notes = g('ev-notes').value;
  if(g('ev-cal')) v.calendarId = g('ev-cal').value; if(g('ev-allday')) v.allDay = g('ev-allday').checked;
  v.span = g('ev-span') ? g('ev-span').value : 'this';
}
/* The app call for a change, from the planner's own fields (date, HH:MM times). Multi-day events keep their length. */
function evPayload(v){
  const a = {id:v.id||'', occ:v.occ||'', title:v.title.trim(), allDay:!!v.allDay, location:String(v.location||'').trim(), calendarId:v.calendarId||'', span:v.span||'this'};
  if(v.notes !== undefined && v.notes !== v.notesOrig) a.notes = v.notes;
  const o = v.orig, wasAll = !!(o && v.wasAllDay);
  if(v.allDay){
    if(wasAll && o.date===v.date){ /* same day: leave the times as Calendar keeps them */ }
    else if(wasAll){ const sh = evDaysBetween(o.date, v.date); a.start = v.date+'T'+o.startT; a.end = addDays(o.endDate, sh)+'T'+o.endT; }
    else { a.start = v.date+'T00:00'; a.end = v.date+'T00:00'; }
  } else {
    if(!/^\d\d:\d\d$/.test(v.start||'')) throw new Error('Pick a start time');
    const end = /^\d\d:\d\d$/.test(v.end||'') ? v.end : pad(Math.min(23, +v.start.slice(0,2)+1))+v.start.slice(2);
    const endDay = addDays(v.date, o && !wasAll ? Math.max(0, evDaysBetween(o.date, o.endDate)) : 0);
    if(endDay===v.date && end <= v.start) throw new Error('The end is before the start');
    a.start = v.date+'T'+v.start; a.end = endDay+'T'+end;
  }
  return a;
}
async function refreshCal(){ try{ const r = await APP.call('calendar',{from:addDays(TODAY,-7), to:addDays(TODAY,120)}); CAL_STATUS = r.status; CAL = mergeSameSlot(r.events||[]); }catch(e){ CAL_STATUS = 'error'; } render(); }
async function evAct(act){
  const v = EVEDIT; if(!v) return;
  if(act==='close') return closeEvEdit();
  evRead();
  if(act==='delete' && !v.confirmDel){ v.confirmDel = true; return renderEvEdit(); }
  v.error = ''; v.busy = true; renderEvEdit();
  try{
    if(act==='delete') await APP.call('eventDelete', {id:v.id, occ:v.occ, span:v.span||'this'});
    else { if(!validDate(v.date)) throw new Error('Pick a day'); if(!String(v.title||'').trim()) throw new Error('Give it a title'); const r = await APP.call('eventSave', evPayload(v)); if(r && r.error) throw new Error(r.error); }
    EVEDIT = null; renderEvEdit(); if(typeof cvReset==='function') cvReset(); await refreshCal();
  }catch(err){ v.busy = false; v.error = err.message; renderEvEdit(); }
}

async function refreshExternal(){
  if(!IN_APP) return;
  try{ const r = await APP.call('calendar',{from:addDays(TODAY,-7), to:addDays(TODAY,120)}); CAL_STATUS = r.status; CAL = mergeSameSlot(r.events||[]); }catch(e){ CAL_STATUS = 'error'; }
  try{ const r = await APP.call('inbox'); INBOX_STATUS = r.status; INBOX = r.items||[]; }catch(e){ INBOX_STATUS = 'error'; }
  try{ PREFS = await APP.call('prefs'); }catch(e){}
  try{ const d = await APP.call('load'); GROUPS = d.groups||{}; }catch(e){}
  await groupFolders();
  /* every course has its folder in Documents/Planner (made if missing; sessions and reading notes go there). Courses without
     a linked folder of their own use it as the course folder. */
  for(const c of courses){ try{ const p = (await APP.call('helpFolder', {name:c.short})).path; if(!c.folder) CTX[c.id] = p; }catch(e){} const f = folderOf(c); if(f){ try{ FILES[c.id] = (await APP.call('listFiles', {path:f})).files||[]; }catch(e){ FILES[c.id] = []; } } }
  autoLink();
  if(typeof bkAhead==='function') bkAhead();   /* reading versions of course PDFs, made ahead of time (book.js) */
  try{ BRAIN = (await APP.call('brainList')).filter(m=>m && m.id && !String(m.id).startsWith('_')).map(m=>Object.assign(m,{topics:(m.topics||[]).filter(x=>typeof x==='string')})); }catch(e){}
  if(!window.__brainFiles){ window.__brainFiles = 1; try{ const t = await APP.call('brainFile',{name:'topics'}); if(t && t.topics) TOPICS = t; const c = await APP.call('brainFile',{name:'chats'}); if(c && typeof c==='object') CHATS = c; }catch(e){} }
  try{ const s = await APP.call('recStatus'); if(s.recording && !REC.recording){ REC.recording = true; REC.withSystem = s.withSystem; REC.started = Date.now() - s.seconds*1000; startRecTimer(); } REC.tools = s; }catch(e){}
  render();
}

function calBlock(){
  /* Classes and calendar events in one list. Duplicates are removed in eventsOn. */
  const denied = IN_APP && CAL_STATUS==='denied';
  const ev = HAS_CAL ? eventsOn(TODAY) : [];
  const rows = allClassesOn(TODAY).map(c=>({m:toMin(c.s), h:classRow(c)}))
    .concat(ev.map(e=>({m:e.allDay?-1:evMin(e.start), h:'<div class="ev"><span class="bar" style="background:var(--g4)"></span><div><div class="ttitle">'+evTitle(e)+'</div><div class="tmeta">'+evSub(e)+'</div></div><span class="time mono">'+evTime(e)+'</span></div>'})))
    .sort((a,b)=>a.m-b.m);
  if(!rows.length && !denied) return '';
  return '<section class="calnow" aria-label="Calendar today"><h2>Calendar today <span style="float:right">'+newEvBtn(TODAY)+'</span></h2>'
    + (denied ? '<div class="note">Calendar access is off. Turn it on in System Settings › Privacy & Security › Calendars › Planner.</div>' : '')
    + rows.map(r=>r.h).join('') + '</section>';
}

function inboxBlock(){
  if(!IN_APP) return '';
  /* notes from the Planner iPhone app come in here too, so they show even without the Reminders list */
  if(!INBOX.length){
    if(INBOX_STATUS==='nolist') return '<details class="fold"><summary>From your iPhone</summary><div class="note">Add a Reminders list called <b>Planner</b>. What you add there shows up here.</div></details>';
    if(INBOX_STATUS==='denied') return '<section><h2>From your iPhone</h2><div class="note">Reminders access is off. Turn it on in System Settings › Privacy & Security › Reminders › Planner.</div></section>';
    return '';
  }
  return '<section aria-label="From your iPhone"><h2>From your iPhone <span class="muted">· '+INBOX.length+'</span></h2>'+INBOX.map(it=>'<div class="ev"><span class="bar"></span><div><div class="ttitle">'+esc(it.title)+'</div>'+(it.notes?'<div class="tmeta">'+esc(it.notes)+'</div>':'')+'</div><span class="tside"><button class="btn" data-inbox="use" data-id="'+esc(it.id)+'">Plan it</button><button class="lnk" data-inbox="dismiss" data-id="'+esc(it.id)+'">Dismiss</button></span></div>').join('')+'</section>';
}

/* privacy: what goes to Claude (not local) has names, links, emails and phone numbers swapped for placeholders */
