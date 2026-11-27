/* Phone sync. Part of page/index_v2.html; classic script, loaded after organizer-run.js.
   On the Mac: changes made on the iPhone arrive through the sync Worker, decrypted by the app (phoneOps). Each is merged into the plan with
   PlanMerge.merge3 (only what the phone changed), saved the usual way (so the organizer runs after it), then confirmed
   (phoneOpsDone), which deletes the files and writes a new snapshot for the phone.
   On the iPhone (PHONE, see ios-app/): the page shows the plan from the last snapshot plus its own changes not yet applied, a sync line,
   and a note field whose notes show up on the Mac under "From your iPhone". The phone never plans: no organizer, no models. */
let PHONE_BUSY = false, SYNC = null, PHONE_NOTE = {draft:'', sending:false, error:''};
/* the Sync button on the phone: running, and when it last checked (the plan time only changes when the Mac has news) */
let PHONE_SYNC = {busy:false, checked:''};

async function pullPhoneOps(){
  if(!IN_APP || PHONE_BUSY || !ready || !courses.length) return;
  let r; try{ r = await APP.call('phoneOps'); }catch(e){ return; }
  const ops = (r && r.ops) || [];
  if(r && r.notes) refreshExternal();               /* new notes for the inbox */
  if(r && r.helps && JSON.stringify(r.helps)!==JSON.stringify(PHONE_HELPS)){ PHONE_HELPS = r.helps; render(); }
  if(!ops.length) return;
  PHONE_BUSY = true;
  const done = [], touched = new Set(), days = new Set();
  try{
    for(const op of ops){
      const [col, id] = String(op.path||'').split('/');
      if(col==='courses' && id){
        const cur = cById(id);
        if(cur){ const m = PlanMerge.merge3(op.base, op.data, JSON.parse(JSON.stringify(cur))); Object.keys(cur).forEach(k=>delete cur[k]); Object.assign(cur, m, {id}); definePhoneTasks(cur); touched.add(id); }
        else if(!op.base && op.data){ courses.push(Object.assign({tasks:[], deliverables:[]}, op.data, {id})); touched.add(id); }
      } else if(col==='days' && id){
        DAYS[id] = Object.assign(PlanMerge.merge3(op.base, op.data, DAYS[id]) || {}, {id}); days.add(id);
      } else if(col==='reads' && id && typeof READS!=='undefined'){   /* reading time on the phone (readtime.js): its own sessions, merged by id */
        READS[id] = Object.assign(PlanMerge.merge3(op.base, op.data, READS[id]) || {}, {id}); rtSave(READS[id]); if(typeof hcProgress==='function') hcProgress(READS[id]);
      }
      done.push(op.id);                              /* flags are not edited on the phone; anything else is confirmed and dropped */
    }
    touched.forEach(id=>save(cById(id)));
    days.forEach(d=>saveDay(d));
    await Promise.all(Object.values(queue));
    await APP.call('phoneOpsDone', {ids: done});
  }catch(e){ console.error('phone changes', e); }
  finally{ PHONE_BUSY = false; render(); }
}
/* Tasks added with the phone's form (the user's choice, 21 Nov 2026: "Also a quick form", next to notes for the Mac) are defined
   here like any new task (rule: splitting happens when a task is defined): the day he picked is kept and pinned, else
   placeNew picks it; splitBig cuts big ones (his hours count as stated: desk work in blocks up to `heavy`, train and metro
   work in parts of `splitAt`). The organizer runs after the save, as always. */
let PHONE_HELPS = [];
const phoneHelpFor = (cid, tid) => PHONE_HELPS.find(h=>h.cid===cid && h.tid===tid);
function phoneHelpTaken(id){ PHONE_HELPS = PHONE_HELPS.filter(h=>h.id!==id); APP.call('phoneHelpTaken', {id}).catch(()=>{}); render(); }
function definePhoneTasks(c){
  const fresh = (c.tasks||[]).filter(t=>t.phoneNew); if(!fresh.length) return;
  c.tasks = c.tasks.filter(t=>!t.phoneNew);
  fresh.forEach(t=>{
    const where = deskOnly(c) ? 'desk' : (['desk','train','phone'].includes(t.where) ? t.where : 'desk');
    const did = (c.deliverables||[]).some(d=>d.id===t.did) ? t.did : '';
    const dv = (c.deliverables||[]).find(d=>d.id===did), dl = dv && dv.date ? (Organizer.isSession(c,dv) ? Organizer.sessionLast(c,dv) : dv.date) : '';
    const pinned = !!(t.phoneNew && t.phoneNew.day) && validDate(t.due) && t.due >= TODAY && (!dl || t.due <= dl);
    const x = {course:c.id, did, title:String(t.title||'').trim().slice(0,200) || 'Task from iPhone', est:Math.min(100, Math.max(0.25, Number(t.est)||1)), where, due:pinned ? t.due : TODAY, pinned, stated:true, note:String(t.note||'')};
    if(!pinned) placeNew({tasks:[x], deliverables:[], updates:[], removes:[]});
    const parts = splitBig([x], () => dl, HEAVY);
    parts.forEach((q,i)=>{ const nt = {id:parts.length>1 ? t.id+'-'+(i+1) : t.id, did, title:q.title, due:q.due, est:q.est, status:'todo', note:x.note, where};
      if(pinned && i===0) nt.pin = q.due; c.tasks.push(nt); });
  });
}
/* Known names (helpNames: professors, private words, names found before) are hidden in what the reading partner sees. They are
   kept in the Mac page's storage, so the Mac sends them to the phone inside the encrypted snapshot (phoneNames), and the
   phone's reader hides the same names from DeepSeek. */
let NAMES_SENT = '';
function sendNames(){ if(!IN_APP) return; const n = JSON.stringify(helpNames()); if(n===NAMES_SENT) return; NAMES_SENT = n; APP.call('phoneNames', {names:helpNames()}).catch(()=>{ NAMES_SENT = ''; }); }
if(IN_APP){ setTimeout(sendNames, 6000); setInterval(sendNames, 300000); }
if(IN_APP){ setInterval(pullPhoneOps, 20000); window.addEventListener('focus', pullPhoneOps); setTimeout(pullPhoneOps, 4000); }

/* ---------- on the iPhone ---------- */
async function phoneRefresh(){
  if(!PHONE) return;
  try{ SYNC = await APP.call('syncStatus'); }catch(e){ SYNC = {error: e.message}; }
  if(SYNC && Array.isArray(SYNC.names) && SYNC.names.length) lsSet('helpNames', JSON.stringify(SYNC.names.slice(-400)));
  await phoneFilesRefresh();
  try{ const r = await APP.call('calendar', {from:addDays(TODAY,-7), to:addDays(TODAY,60)}); CAL_STATUS = r.status; CAL = mergeSameSlot(r.events||[]); }catch(e){}
  if(ready) render();
}
const agoText = s => { if(!s) return 'never'; const m = Math.round((Date.now()-Date.parse(s))/60000); return m<1 ? 'just now' : m<60 ? m+' min ago' : m<1440 ? Math.round(m/60)+' h ago' : fmtShort(String(s).slice(0,10)); };
function phoneBlock(empty){
  if(!PHONE) return '';
  const s = SYNC || {};
  if(empty && !SYNC) return '<div class="loading">Checking the connection…</div>';
  if(empty && s.paired){
    return '<section class="phsync" aria-label="Sync"><h2>Waiting for the Mac</h2><div class="note">Paired'+(s.check?' (check code <b class="mono">'+esc(s.check)+'</b>)':'')+'. Open Planner on the Mac; your plan arrives within about two minutes.</div>'
      + (s.error ? '<div class="note"><span class="tag warn">'+ICON.warn+esc(s.error)+'</span></div>' : '')
      + '<div class="phbtns"><button class="btn pri" data-sync="now">Check now</button> <button class="lnk" data-sync="pair">Pair again</button></div></section>';
  }
  if(!s.paired){
    return '<section class="phsync" aria-label="Sync"><h2>Connect to your Mac</h2><div class="note">On the Mac, open Planner and choose <b>Pair iPhone…</b> in the Planner menu. Then scan the code here.</div>'
      + '<div class="phbtns"><button class="btn pri" data-sync="pair">Scan the code</button></div></section>';
  }
  const waiting = s.waiting||0, notes = s.notes||[];
  /* Syncing runs on its own (on open, every minute while open, pull down to check now). The line shows only when there
     is something to know: an error, changes the Mac has not applied yet, or a plan more than a day old. */
  const stale = s.snapshotAt && (Date.now() - Date.parse(s.snapshotAt)) > 86400000;
  const line = [];
  const act = typeof phActHTML==='function';   /* errors and waiting changes are in the activity line at the top (activity.js) */
  if(s.error && !act) line.push('<span class="tag warn">'+ICON.warn+esc(s.error)+'</span>');
  if(waiting && !act) line.push('<b>'+waiting+' change'+(waiting===1?'':'s')+' waiting for the Mac</b>');
  if(stale && !s.error) line.push('Plan from the Mac '+esc(agoText(s.snapshotAt))+'. Open Planner on the Mac to update it.');
  let h = '<section class="phsync" aria-label="Sync">' + (line.length ? '<div class="phline"><span>'+line.join(' · ')+'</span></div>' : '');
  h += '<div class="phnote"><textarea id="ph-note" rows="2" placeholder="Note for the Mac: a task, a date, a change">'+esc(PHONE_NOTE.draft)+'</textarea>'
    + '<button class="btn" data-sync="note"'+(PHONE_NOTE.sending?' disabled':'')+'>Send</button></div>'
    + (PHONE_NOTE.error ? '<div class="note">'+esc(PHONE_NOTE.error)+'</div>' : '')
    + (notes.length ? '<ul class="phnotes">'+notes.map(n=>'<li><span class="muted">Waiting:</span> '+esc(n.text)+'</li>').join('')+'</ul>' : '');
  return h + '</section>' + addBlock() + recBlock();
}

/* ---------- the phone: course PDFs (PhoneReader.swift), read in the reader (reader.js) ---------- */
async function phoneFilesRefresh(){
  try{ const r = await APP.call('phoneFiles'); PFILES = r.files||{}; FILES = {}; Object.keys(PFILES).forEach(cid=>{ FILES[cid] = PFILES[cid].map(x=>x.f); }); }catch(e){}
}
function phoneFileEvent(ev){
  const i = ev.key.indexOf('/'), cid = ev.key.slice(0,i), f = ev.key.slice(i+1), x = (PFILES[cid]||[]).find(y=>y.f===f);
  if(x){ ['state','progress','error'].forEach(k=>{ delete x[k]; }); Object.assign(x, ev.ready ? {cached:true, current:true} : {state:ev.state, progress:ev.progress, error:ev.error}); }
  if(typeof readerFileEvent==='function') readerFileEvent(ev);
}
if(PHONE) window.__appEvent = ev => {
  if(ev.type==='fileState'){ phoneFileEvent(ev); return; }
  if(ev.type==='helpChunk' || /^reader/.test(ev.type)) readerEvent(ev);
};
document.addEventListener('click', e=>{
  if(!PHONE) return;
  const b = e.target.closest('[data-file]'); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  const [cid, tid] = String(b.dataset.ctx||'').split('|');
  openReader(b.dataset.file, {cid, tid});
}, true);

/* ---------- the phone: add a task with a form (the user's choice, 21 Nov 2026; the Mac defines it, see definePhoneTasks) ---------- */
let PHONE_ADD = {title:'', cid:'', did:'', est:'', where:'desk', day:'', msg:'', error:''};
const openDelivs = c => (c.deliverables||[]).filter(d=>!delivFinished(c,d) && (!d.date || d.date >= TODAY)).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
function addBlock(){
  if(!PHONE || !(SYNC||{}).paired || !courses.length) return '';
  const a = PHONE_ADD, cs2 = courses.slice().sort((x,y)=>(x.order||0)-(y.order||0));
  if(!a.cid) a.cid = lsGet('phAddCourse') || (cs2[0]||{}).id || '';
  const c = cById(a.cid) || cs2[0], dv = c ? openDelivs(c) : [], d = dv.find(x=>x.id===a.did);
  const last = d && d.date ? (Organizer.isSession(c,d) ? Organizer.sessionLast(c,d) : d.date) : '';
  return '<details class="fold phadd"'+(a.open?' open':'')+' data-phadd="fold"><summary>Add a task</summary><div class="phaddf">'
    + '<input id="pa-title" placeholder="What to do" value="'+esc(a.title)+'" aria-label="Task">'
    + '<label>Course<select id="pa-cid">'+cs2.map(x=>'<option value="'+esc(x.id)+'"'+(c&&x.id===c.id?' selected':'')+'>'+esc(x.short||x.name)+'</option>').join('')+'</select></label>'
    + '<label>Deadline<select id="pa-did"><option value="">No deadline</option>'+dv.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===a.did?' selected':'')+'>'+esc(x.title)+(x.date?' · '+esc(fmtShort(x.date)):'')+'</option>').join('')+'</select></label>'
    + '<div class="phrow"><label>Hours<input id="pa-est" type="number" inputmode="decimal" step="0.25" min="0.25" max="100" value="'+esc(a.est)+'"></label>'
    + (c && deskOnly(c) ? '<span class="faint">Desk only</span>' : '<label>Where<select id="pa-where">'+[['desk','Desk'],['train','Train · laptop'],['phone','Metro · phone']].map(([v,l])=>'<option value="'+v+'"'+(a.where===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>')+'</div>'
    + '<label>Day<input id="pa-day" type="date" min="'+TODAY+'"'+(last?' max="'+last+'"':'')+' value="'+esc(a.day)+'"></label>'
    + '<div class="faint">Leave the day empty and the Mac picks one. Big tasks are split there.</div>'
    + '<div class="phbtns"><button class="btn pri" data-phadd="add">Add</button></div>'
    + (a.error ? '<div class="note"><span class="tag warn">'+ICON.warn+esc(a.error)+'</span></div>' : a.msg ? '<div class="note">'+esc(a.msg)+'</div>' : '')
    + '</div></details>';
}
document.addEventListener('input', e=>{
  if(!PHONE) return; const id = e.target.id, a = PHONE_ADD;
  if(id==='pa-title') a.title = e.target.value; else if(id==='pa-est') a.est = e.target.value;
});
document.addEventListener('change', e=>{
  if(!PHONE) return; const id = e.target.id, a = PHONE_ADD, v = e.target.value;
  if(id==='pa-cid'){ a.cid = v; a.did = ''; a.day = ''; lsSet('phAddCourse', v); render(); }
  else if(id==='pa-did'){ a.did = v; a.day = ''; render(); }
  else if(id==='pa-where') a.where = v;
  else if(id==='pa-day') a.day = v;
});
document.addEventListener('toggle', e=>{ if(PHONE && e.target.dataset && e.target.dataset.phadd==='fold') PHONE_ADD.open = e.target.open; }, true);
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-phadd="add"]'); if(!b || !PHONE) return;
  e.preventDefault();
  const a = PHONE_ADD, c = cById(a.cid), title = a.title.trim(), est = Number(String(a.est).replace(',','.'));
  a.error = ''; a.msg = '';
  if(!title) a.error = 'Write what to do.';
  else if(!c) a.error = 'Pick a course.';
  else if(!(est >= 0.25 && est <= 100)) a.error = 'Hours: between 0.25 and 100.';
  else if(a.day && (!validDate(a.day) || a.day < TODAY)) a.error = 'Pick today or a later day.';
  if(!a.error && a.day && a.did){ const d = (c.deliverables||[]).find(x=>x.id===a.did), last = d && d.date ? (Organizer.isSession(c,d) ? Organizer.sessionLast(c,d) : d.date) : ''; if(last && a.day > last) a.error = 'That is after the deadline. The last day is '+fmtShort(last)+'.'; }
  if(!a.error && (c.tasks||[]).some(t=>t.status!=='done' && t.title.trim().toLowerCase()===title.toLowerCase())) a.error = 'You already have “'+title+'” in '+c.short+'.';
  if(a.error){ render(); return; }
  const t = {id:c.id+'-p'+Date.now().toString(36), did:a.did||'', title, due:a.day||'', est, status:'todo', note:'', where:deskOnly(c) ? 'desk' : a.where, phoneNew:{day:!!a.day}};
  (c.tasks = c.tasks||[]).push(t); save(c);
  PHONE_ADD = {title:'', cid:a.cid, did:a.did, est:'', where:a.where, day:'', open:true, error:'', msg:'Added to '+c.short+'. '+(a.day ? 'It shows on '+fmtShort(a.day)+'.' : 'The Mac picks the day when Planner is open there.')+(est > (t.where==='desk' ? HEAVY : RULES_CFG.splitAt) ? ' The Mac splits it into parts of at most '+(t.where==='desk' ? HEAVY : RULES_CFG.splitAt)+' h.' : '')};
  render();
});

/* ---------- the phone: Get help sends the question to the Mac (help.js helpBtn) ---------- */
let PHONE_ASK = null;
function askSheet(){
  let host = document.getElementById('phask');
  if(!PHONE_ASK){ if(host) host.remove(); return; }
  if(!host){ host = document.createElement('div'); host.id = 'phask'; host.className = 'phask'; host.setAttribute('role','dialog'); host.setAttribute('aria-label','Get help'); document.body.appendChild(host); }
  const q = PHONE_ASK, c = cById(q.cid), t = c && (c.tasks||[]).find(x=>x.id===q.tid);
  host.innerHTML = '<div class="phaskbox"><div class="plabel">Get help · '+esc(c?c.short:'')+'</div><b>'+esc(t?t.title:'')+'</b>'
    + (q.sent ? '<p>Sent. It waits on this task’s <b>Get help</b> button on the Mac and goes in as your first message when you open it there.</p><div class="phbtns"><button class="btn pri" data-phask="close">OK</button></div>'
      : '<p class="muted">Get help runs on the Mac with Claude. Write your question; it waits there for you.</p>'
      + '<textarea id="phask-text" rows="4" placeholder="What do you need help with?">'+esc(q.text)+'</textarea>'
      + (q.error ? '<div class="note"><span class="tag warn">'+ICON.warn+esc(q.error)+'</span></div>' : '')
      + '<div class="phbtns"><button class="btn pri" data-phask="send"'+(q.sending?' disabled':'')+'>Send to the Mac</button> <button class="lnk" data-phask="close">Cancel</button></div>')
    + '</div>';
}
document.addEventListener('input', e=>{ if(e.target.id==='phask-text' && PHONE_ASK) PHONE_ASK.text = e.target.value; });
document.addEventListener('click', async e=>{
  if(!PHONE) return;
  const o = e.target.closest('[data-phelp]');
  if(o){ e.preventDefault(); e.stopPropagation(); const [cid, tid] = o.dataset.phelp.split('|'); PHONE_ASK = {cid, tid, text:'', sending:false, error:'', sent:false}; askSheet(); const ta = document.getElementById('phask-text'); if(ta) ta.focus(); return; }
  const b = e.target.closest('[data-phask]'); if(!b || !PHONE_ASK) return;
  e.preventDefault();
  if(b.dataset.phask==='close'){ PHONE_ASK = null; askSheet(); return; }
  PHONE_ASK.sending = true; PHONE_ASK.error = ''; askSheet();
  try{ await APP.call('helpPhone', {cid:PHONE_ASK.cid, tid:PHONE_ASK.tid, text:PHONE_ASK.text}); PHONE_ASK.sent = true; }
  catch(err){ PHONE_ASK.error = err.message; }
  if(PHONE_ASK) PHONE_ASK.sending = false; askSheet(); phoneRefresh();
}, true);

/* ---------- recording on the iPhone (Recordings in PhoneApp.swift) ----------
   Record, then Stop sends it encrypted to the Mac, which imports it into Brain and transcribes it there. */
let PHONE_REC = {state:null, course:'', title:'', sure:false, busy:false, error:'', base:null};
async function recRefresh(){
  if(!PHONE) return;
  try{ PHONE_REC.state = await APP.call('recState'); }catch(e){ return; }
  const r = PHONE_REC.state.recording;
  PHONE_REC.base = r ? {secs: r.seconds||0, t: Date.now()} : null;
  if(ready && !document.querySelector('#ph-rec-title:focus')) render();
}
function recBlock(){
  if(!PHONE || !(SYNC||{}).paired) return '';
  const st = PHONE_REC.state || {}, r = st.recording, ups = (st.uploads||[]).slice().reverse();
  if(!PHONE_REC.course) PHONE_REC.course = lsGet('phRecCourse') || '';
  let h = '<section class="phrec" aria-label="Record"><h2>Record</h2>';
  if(r){
    h += '<div class="phrecon"><span class="recdot"></span><span class="mono" id="ph-rec-time">'+clockLabel(r.seconds||0)+'</span><span>'+esc(r.title||'No title')+' · '+esc(r.course?cnm(r.course):'No course')+'</span></div>'
      + '<div class="phbtns"><button class="btn pri" data-rec2="stop"'+(PHONE_REC.busy?' disabled':'')+'>Stop and send to the Mac</button> '
      + '<button class="lnk" data-rec2="cancel">'+(PHONE_REC.sure?'Discard for sure':'Discard')+'</button></div>'
      + '<div class="faint phrechint">Keeps recording with the screen locked.</div>';
  } else {
    h += '<div class="phrecform"><select id="ph-rec-course" aria-label="Course"><option value="">No course</option>'
      + courses.slice().sort((a,b)=>(a.order||0)-(b.order||0)).map(c=>'<option value="'+esc(c.id)+'"'+(c.id===PHONE_REC.course?' selected':'')+'>'+esc(c.short||c.name)+'</option>').join('')+'</select>'
      + '<input id="ph-rec-title" placeholder="Title (optional)" value="'+esc(PHONE_REC.title)+'" aria-label="Recording title">'
      + '<button class="btn pri" data-rec2="start"'+(PHONE_REC.busy?' disabled':'')+'>Record</button></div>'
      + '<div class="faint phrechint">Ask people before you record them. The Mac transcribes it into Brain.</div>';
  }
  const err = PHONE_REC.error || st.error;
  if(err) h += '<div class="note"><span class="tag warn">'+ICON.warn+esc(err)+'</span></div>';
  if(ups.length) h += '<ul class="phnotes">'+ups.map(u=>{
    const what = u.state==='sending' ? 'Sending '+Math.round(100*(u.sent||0)/Math.max(1,u.parts||1))+'%' : u.state==='sent' ? 'Sent, the Mac imports it when Planner is open there' : 'In Brain on the Mac';
    return '<li><b>'+esc(u.title||'No title')+'</b> <span class="muted">· '+esc(u.course?cnm(u.course):'No course')+' · '+clockLabel(u.seconds||0)+' · '+what+'</span></li>';
  }).join('')+'</ul>';
  return h + '</section>';
}
document.addEventListener('change', e=>{ if(e.target.id==='ph-rec-course'){ PHONE_REC.course = e.target.value; lsSet('phRecCourse', e.target.value); } });
document.addEventListener('input', e=>{ if(e.target.id==='ph-rec-title') PHONE_REC.title = e.target.value; });
document.addEventListener('click', async e=>{
  const b = e.target.closest('[data-rec2]'); if(!b || !PHONE) return;
  e.preventDefault();
  const act = b.dataset.rec2;
  if(act==='cancel' && !PHONE_REC.sure){ PHONE_REC.sure = true; render(); setTimeout(()=>{ PHONE_REC.sure = false; render(); }, 4000); return; }
  PHONE_REC.busy = true; PHONE_REC.error = ''; render();
  try{
    if(act==='start'){ await APP.call('recStart', {course: PHONE_REC.course, title: PHONE_REC.title.trim()}); PHONE_REC.title = ''; }
    else if(act==='stop') await APP.call('recStop');
    else if(act==='cancel'){ PHONE_REC.sure = false; await APP.call('recCancel'); }
  }catch(err){ PHONE_REC.error = err.message; }
  PHONE_REC.busy = false;
  recRefresh();
});
window.__recChanged = () => recRefresh();
if(PHONE){
  recRefresh();
  /* the timer ticks here; the app is asked again every 3 s only while recording or sending */
  setInterval(()=>{ const el = document.getElementById('ph-rec-time'); if(el && PHONE_REC.base) el.textContent = clockLabel(PHONE_REC.base.secs + (Date.now()-PHONE_REC.base.t)/1000); }, 1000);
  setInterval(()=>{ const st = PHONE_REC.state||{}; if(st.recording || (st.uploads||[]).some(u=>u.state==='sending')) recRefresh(); }, 3000);
}
document.addEventListener('input', e=>{ if(e.target.id==='ph-note') PHONE_NOTE.draft = e.target.value; });
document.addEventListener('click', async e=>{
  const b = e.target.closest('[data-sync]'); if(!b || !PHONE) return;
  e.preventDefault();
  const act = b.dataset.sync;
  try{
    if(act==='note'){
      const text = PHONE_NOTE.draft.trim(); if(!text) return;
      PHONE_NOTE.sending = true; render();
      await APP.call('note', {text}); PHONE_NOTE = {draft:'', sending:false, error:''};
    }
    else if(act==='pair') await APP.call('pair');
    else if(act==='now'){
      if(PHONE_SYNC.busy) return;
      PHONE_SYNC.busy = true; render();
      const r = await APP.call('syncNow').finally(()=>{ PHONE_SYNC.busy = false; });
      if(r && !r.error) PHONE_SYNC.checked = new Date().toISOString();
    }
  }catch(err){ PHONE_NOTE.sending = false; PHONE_NOTE.error = err.message; PHONE_SYNC.busy = false; }
  phoneRefresh();
});
window.__syncChanged = () => phoneRefresh();
if(PHONE){ phoneRefresh(); setInterval(phoneRefresh, 60000); document.querySelector('html').classList.add('phone'); }
