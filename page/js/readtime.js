/* Reading time (27 Nov 2026, the user's request: "Track my reading time, I must be reading and the app must be in focus"; "I mostly
   want it for the backend, so that better predictions can be made"). Nothing is shown; the planner's reading pace uses it.
   It counts while the reader is open, the window is visible and in front, and something happened in the reader in the
   last RT_IDLE (a page turn, scroll, selection, key, pointer or touch). Kept per PDF as reads/<id> in the plan:
   {id, cid, file, title, at:{pg, label}, sessions:[{id: device-day, d, dev, sec, p:[PDF pages seen while reading]}], hc?}.
   Sessions are per device and day, so the Mac and the phone never write the same one (the phone's merge by id keeps both).
   Saved on close, when the window goes to the background, and every RT_SAVE seconds of reading. */
const RT_IDLE = 120e3, RT_TICK = 5e3, RT_SAVE = 300;
let READS = {};
/* A page counts as read after RT_DWELL seconds of reading on it (27 Nov 2026, the user's rule for Hardcover: pages actually
   read count, selected chapters too, never the page number he jumped to). One spread can hold more than one PDF page, so
   moving on by up to 3 pages after a read page counts the pages in between. */
const RT_DWELL = 15;
const RT = {last:0, acc:0, pages:new Set(), sinceSave:0, dwell:{}, prev:0};
const rtDev = () => (typeof PHONE!=='undefined' && PHONE) ? 'phone' : 'mac';
function rtKey(){ if(!READ) return ''; const file = READ.phone ? READ.phone.file : READ.name; return (READ.phone ? READ.phone.cid : READ.cid || '') + '|' + String(file||'').split('/').pop(); }
function rtId(k){ let h = 0; for(let i = 0; i < k.length; i++) h = (h*31 + k.charCodeAt(i)) | 0; return 'r-' + (h>>>0).toString(36); }
/* the original page is a native view: the web page loses focus to it, so there page turns (readerPage) are the activity */
const rtActive = () => !!READ && !document.hidden && (document.hasFocus() || READ.mode==='page') && Date.now() - RT.last < RT_IDLE;
['mousemove','keydown','wheel','touchstart','pointerdown','selectionchange','scroll'].forEach(t=>document.addEventListener(t, ()=>{ if(READ) RT.last = Date.now(); }, {capture:true, passive:true}));

setInterval(()=>{
  if(!rtActive()) return;
  RT.acc += RT_TICK/1000; RT.sinceSave += RT_TICK/1000;
  const pg = +READ.page || 0;
  if(pg){
    RT.dwell[pg] = (RT.dwell[pg]||0) + RT_TICK/1000;
    if(RT.dwell[pg] >= RT_DWELL){
      RT.pages.add(pg);
      if(RT.prev && pg > RT.prev && pg - RT.prev <= 3 && RT.pages.has(RT.prev)) for(let x = RT.prev+1; x < pg; x++) RT.pages.add(x);
      RT.prev = pg;
    }
  }
  if(typeof hcAuto==='function') hcAuto();
  if(RT.sinceSave >= RT_SAVE) rtFlush();
}, RT_TICK);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) rtFlush(); });
window.addEventListener('blur', ()=>rtFlush());

/* adds the time counted since the last save to today's session of this device */
function rtFlush(){
  RT.sinceSave = 0;
  if(!READ || RT.acc < 15 || !dbh){ if(!READ){ RT.acc = 0; RT.pages.clear(); RT.dwell = {}; RT.prev = 0; } return; }
  const k = rtKey(), id = rtId(k), file = k.split('|').slice(1).join('|');
  const doc = READS[id] = READS[id] || {id, cid:k.split('|')[0], file, title:'', sessions:[]};
  if(READ.title) doc.title = READ.title;
  const sid = rtDev()+'-'+TODAY;
  let s = (doc.sessions = doc.sessions||[]).find(x=>x.id===sid);
  if(!s){ s = {id:sid, d:TODAY, dev:rtDev(), sec:0, p:[]}; doc.sessions.push(s); }
  s.sec = Math.round((s.sec||0) + RT.acc);
  s.p = [...new Set((s.p||[]).concat([...RT.pages]))].sort((a,b)=>a-b).slice(0, 2000);
  if(READ.page) doc.at = {pg:+READ.page, label:(READ.book && typeof bkLabel==='function') ? String(bkLabel(READ.page)) : String(READ.page)};
  doc.sessions = doc.sessions.slice(-120);   /* a phone change carries the document twice and may be at most 96 KB */
  RT.acc = 0; RT.pages.clear(); RT.dwell = {};
  rtSave(doc);
  if(typeof hcProgress==='function') hcProgress(doc);
}
const rtSave = doc => dbh && dbh.doc('reads/'+doc.id).set(JSON.parse(JSON.stringify(doc))).catch(e=>console.error('save failed', e));

/* every page of this PDF read so far, on any device */
const rtPagesRead = doc => new Set((doc && doc.sessions || []).flatMap(s=>s.p||[])).size;
/* pages an hour measured while reading: a course's own after 30 minutes and 10 pages, else null */
function trackedPace(cid){
  let sec = 0, pages = 0;
  Object.values(READS).filter(r=>!cid || r.cid===cid).forEach(r=>(r.sessions||[]).forEach(s=>{ sec += s.sec||0; pages += (s.p||[]).length; }));
  return sec >= 1800 && pages >= 10 ? pages/(sec/3600) : null;
}
/* hours read in a PDF, for the reading tasks that cover those pages (later: planned vs actual in the prompts) */
function trackedHours(cid, file){ const r = READS[rtId(cid+'|'+String(file||'').split('/').pop())]; return r ? (r.sessions||[]).reduce((s,x)=>s+(x.sec||0),0)/3600 : 0; }
