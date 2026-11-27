/* What runs in the background (27 Nov 2026, the user's words: "in general i never know if something its running in the bkg, eg
   if data its sent I want an indication, if data is being process, download others"). Mac only.
   The header shows one line while anything runs ("Making text versions · Testo Junkie"), or "+N" when more runs; a click
   opens the list: what runs now (with its detail and how long) and what finished lately. Sources: the app's Activity
   (op `activity`: text versions, pictures, sending to the iPhone and to Cloudflare, recordings and changes from the
   iPhone) and the page's own work (Brain jobs, the planner, Get help, Hardcover, the Library). Asked every 2 s while
   something runs or the list is open, else every 8 s. */
const ACT = {native:{now:[], recent:[]}, open:false, timer:null, seen:0};
const ACT_KIND = {send:'↑', get:'↓', make:'◐', think:'◐'};
function actPage(){
  const out = [];
  if(typeof JOBS!=='undefined') Object.values(JOBS).filter(ACTIVE).forEach(j=>out.push({kind:'make', label:(JOB_STAGE[j.stage]||'Working')+' a recording', detail:(j.title||'')+(j.stage==='transcribing' && j.pct ? ' · '+j.pct+'%' : ''), at:(j.started||Date.now())/1000}));
  if(typeof compose!=='undefined' && compose.busy) out.push({kind:'think', label:'The planner is thinking', detail:'', at:ACT.cb || (ACT.cb = Date.now()/1000)}); else ACT.cb = 0;
  if(typeof HELP!=='undefined' && HELP && HELP.busy) out.push({kind:'think', label:'Get help is answering', detail:HELP.tool||'', at:ACT.hb || (ACT.hb = Date.now()/1000)}); else ACT.hb = 0;
  if(typeof HC!=='undefined' && HC.busy) out.push({kind:'send', label:'Talking to Hardcover', detail:'', at:Date.now()/1000});
  if(typeof LIB!=='undefined' && LIB.loading) out.push({kind:'make', label:'Looking through the course folders', detail:'for the Library', at:Date.now()/1000});
  return out;
}
const actNow = () => (ACT.native.now||[]).concat(actPage());
const actAgo = t => { const s = Math.max(0, Math.round(Date.now()/1000 - t)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s/60)+' min ago' : Math.round(s/3600)+' h ago'; };
const actFor = t => { const s = Math.max(0, Math.round(Date.now()/1000 - t)); return s < 60 ? s+' s' : Math.round(s/60)+' min'; };
function actRender(){
  if(typeof IN_APP==='undefined' || !IN_APP || (typeof PHONE!=='undefined' && PHONE)) return;
  let btn = document.getElementById('actbtn');
  if(!btn){ const th = document.getElementById('themebtn'); if(!th) return; btn = document.createElement('button'); btn.id = 'actbtn'; btn.type = 'button'; btn.className = 'actbtn'; th.parentNode.insertBefore(btn, th); }
  const now = actNow(), first = now[0];
  btn.classList.toggle('on', !!first);
  btn.setAttribute('aria-expanded', ACT.open ? 'true' : 'false');
  btn.title = first ? now.map(x=>x.label+(x.detail?' · '+x.detail:'')).join('\n') : 'Nothing running in the background';
  btn.innerHTML = first
    ? '<i class="act-run"></i><span class="act-l">'+esc(first.label)+(first.detail?'<span class="act-d"> · '+esc(first.detail)+'</span>':'')+'</span>'+(now.length>1?'<span class="act-n mono">+'+(now.length-1)+'</span>':'')
    : '<i class="act-idle"></i><span class="act-l act-quiet">Up to date</span>';
  let pop = document.getElementById('actpop');
  if(!ACT.open){ if(pop) pop.remove(); return; }
  if(!pop){ pop = document.createElement('div'); pop.id = 'actpop'; pop.className = 'actpop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','Background activity'); document.body.appendChild(pop); }
  const rec = (ACT.native.recent||[]).slice(0, 10);
  pop.innerHTML = '<div class="act-h mono">NOW</div>'
    + (now.length ? now.map(x=>'<div class="act-row"><span class="act-k">'+(ACT_KIND[x.kind]||'·')+'</span><span><b>'+esc(x.label)+'</b>'+(x.detail?'<br><span class="muted">'+esc(x.detail)+'</span>':'')+'</span><span class="mono faint">'+actFor(x.at)+'</span></div>').join('') : '<div class="act-row act-none muted">Nothing is running.</div>')
    + '<div class="act-h mono">DONE LATELY</div>'
    + (rec.length ? rec.map(x=>'<div class="act-row'+(x.ok===false?' act-bad':'')+'"><span class="act-k">'+(x.ok===false?'!':ACT_KIND[x.kind]||'·')+'</span><span>'+esc(x.label)+(x.note?'<br><span class="muted">'+esc(x.note)+'</span>':'')+'</span><span class="mono faint">'+actAgo(x.at)+'</span></div>').join('') : '<div class="act-row act-none muted">Nothing since Planner opened.</div>');
  const r = btn.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 8)+'px'; pop.style.right = Math.max(12, Math.round(window.innerWidth - r.right))+'px';
}
async function actPoll(){
  clearTimeout(ACT.timer);
  if(typeof IN_APP==='undefined' || !IN_APP || (typeof PHONE!=='undefined' && PHONE)) return;
  try{ ACT.native = await APP.call('activity') || {now:[], recent:[]}; }catch(e){ ACT.native = {now:[], recent:[]}; }   /* an older app has no activity op */
  actRender();
  ACT.timer = setTimeout(actPoll, actNow().length || ACT.open ? 2000 : 8000);
}
document.addEventListener('click', e=>{
  if(e.target.closest('#actbtn')){ e.preventDefault(); ACT.open = !ACT.open; actRender(); if(ACT.open) actPoll(); return; }
  if(ACT.open && !e.target.closest('#actpop')){ ACT.open = false; actRender(); }
});
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && ACT.open){ ACT.open = false; actRender(); } });
if(typeof IN_APP!=='undefined' && IN_APP && !(typeof PHONE!=='undefined' && PHONE)) setTimeout(actPoll, 1500);

/* ---------- the iPhone ----------
   The same idea from what the phone app already reports (no new native code): changes and notes waiting for the Mac,
   texts still to come from the Mac, files downloading or asked for, recordings being sent, sync errors, and the reading
   partner thinking. A slim line at the top of every phone screen; a tap shows the list. While something moves, the phone
   asks every 4 s; the line is redrawn on its own, not the whole screen. */
const PACT = {open:false, timer:null};
function phActItems(){
  const s = (typeof SYNC!=='undefined' && SYNC) || {}, out = [];
  if(s.error) out.push({kind:'bad', label:'Sync problem', detail:s.error});
  if(s.waiting) out.push({kind:'send', label:s.waiting+' change'+(s.waiting===1?'':'s')+' waiting for the Mac', detail:'They go in when Planner is open on the Mac'});
  if((s.notes||[]).length) out.push({kind:'send', label:s.notes.length+' note'+(s.notes.length===1?'':'s')+' waiting for the Mac', detail:''});
  let left = 0;
  Object.entries(typeof PFILES!=='undefined' ? PFILES : {}).forEach(([cid, list])=>(list||[]).forEach(x=>{
    const name = String(x.f||'').split('/').pop().replace(/\.pdf$/i,'');
    if(x.state==='downloading') out.push({kind:'get', label:'Getting a file from the Mac', detail:name+(x.progress!=null?' · '+Math.round(x.progress*100)+'%':'')});
    else if(x.state==='asking' || x.state==='late') out.push({kind:'get', label:'Asked the Mac for a text', detail:name+(x.state==='late'?' · the Mac has not answered yet':'')});
    else if(x.state==='error') out.push({kind:'bad', label:'A file did not come', detail:name+(x.error?' · '+x.error:'')});
    if(!x.reading && !(typeof TEXTLESS!=='undefined' && TEXTLESS.has(cid+'/'+x.f))) left++;
  }));
  if(left) out.push({kind:'get', label:'Texts still to come from the Mac', detail:left+' left · they arrive while the Mac is on'});
  const rs = (typeof PHONE_REC!=='undefined' && PHONE_REC.state && PHONE_REC.state.uploads) || [];
  rs.filter(u=>u.state!=='done').forEach(u=>out.push({kind:'send', label:'Sending a recording to the Mac', detail:(u.title||'Recording')+(u.parts?' · '+(u.sent||0)+' of '+u.parts+' parts':'')}));
  if(typeof READ!=='undefined' && READ && READ.busy) out.push({kind:'think', label:'Explaining', detail:'DeepSeek'});
  return out;
}
function phActHTML(){
  if(typeof PHONE==='undefined' || !PHONE) return '';
  const s = (typeof SYNC!=='undefined' && SYNC) || {}, items = phActItems(), first = items[0];
  const mark = k => k==='bad' ? '!' : ACT_KIND[k] || '·';
  let h = '<div id="ph-act-wrap"><button class="ph-act'+(first?' on':'')+(first && first.kind==='bad'?' bad':'')+'" data-phact="1" aria-expanded="'+PACT.open+'">'
    + (first ? '<i class="act-run"></i><span>'+esc(first.label)+(items.length>1?' <b class="mono">+'+(items.length-1)+'</b>':'')+'</span>'
             : '<i class="act-idle"></i><span>Up to date'+(s.snapshotAt?' · plan from the Mac '+esc(agoText(s.snapshotAt)):'')+'</span>')+'</button>';
  if(PACT.open) h += '<div class="ph-actlist">'+(items.length ? items.map(x=>'<div class="act-row'+(x.kind==='bad'?' act-bad':'')+'"><span class="act-k">'+mark(x.kind)+'</span><span><b>'+esc(x.label)+'</b>'+(x.detail?'<br><span class="muted">'+esc(x.detail)+'</span>':'')+'</span></div>').join('') : '<div class="act-row act-none muted">Nothing is moving.</div>')
    + '<div class="act-row act-none muted">Plan from the Mac '+esc(agoText(s.snapshotAt))+' · syncs every minute while open'+(s.page?'<br>Page: '+esc(s.page==='built in'?'the one this app came with':'from the Mac, '+s.page):'')+'</div></div>';
  return h + '</div>';
}
function phActRedraw(){ const w = document.getElementById('ph-act-wrap'); if(w) w.outerHTML = phActHTML(); }
async function phActPoll(){
  clearTimeout(PACT.timer);
  if(typeof PHONE==='undefined' || !PHONE) return;
  const moving = phActItems().some(x=>x.kind==='get' && /Getting|Asked/.test(x.label) || x.kind==='send' && /recording/.test(x.label));
  if(moving || PACT.open){
    try{ SYNC = await APP.call('syncStatus'); }catch(e){}
    if(typeof phoneFilesRefresh==='function') await phoneFilesRefresh();
    try{ if(typeof PHONE_REC!=='undefined') PHONE_REC.state = await APP.call('recState'); }catch(e){}
    phActRedraw();
  }
  PACT.timer = setTimeout(phActPoll, moving || PACT.open ? 4000 : 15000);
}
document.addEventListener('click', e=>{ if(e.target.closest('[data-phact]')){ e.preventDefault(); PACT.open = !PACT.open; phActRedraw(); if(PACT.open) phActPoll(); } });
if(typeof PHONE!=='undefined' && PHONE) setTimeout(phActPoll, 3000);
