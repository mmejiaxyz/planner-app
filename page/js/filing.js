/* Filing dropped documents. Part of page/index_v2.html; classic script, loaded after reader.js.
   Files dropped anywhere on the window are caught by the app (DropWebView in main.swift), which sends their paths here.
   A floating panel asks for each file's course, folder and name, then moves it into that course's folder (fileMove).
   Dropped on the help panel's drop area, files are copied into that course's context folder instead, as before. */
let FILING = null;
const flExt = n => { const m = /\.[a-z0-9]{1,6}$/i.exec(n); return m ? m[0] : ''; };
const flBase = n => n.slice(0, n.length - flExt(n).length);
/* The course a file most likely belongs to: one named in its file name, else the PDF or task open now, else the last one used. */
function flGuess(name){
  const named = [...coursesNamed(String(name).replace(/[_-]+/g,' '))];
  if(named.length===1) return named[0];
  if(READ && READ.cid) return READ.cid;
  if(HELP && HELP.cid) return HELP.cid;
  const last = lsGet('fileLast'); return cById(last) ? last : '';
}
/* Tagging a file to a task (9 Nov 2026, the user's idea: "I can drop books into the app, maybe I can also tag it to a task").
   The file name goes on the task (t.files, relative to the course folder), so Open PDF and Get help find it whatever its name. */
const flTasks = cid => { const c = cById(cid); return c ? (c.tasks||[]).filter(t=>t.status!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')) : []; };
function flTaskGuess(cid, name){
  if(READ && READ.cid===cid && READ.tid) return READ.tid;
  if(HELP && HELP.cid===cid && HELP.tid) return HELP.tid;
  const fw = new Set(fileWords(name)), hits = flTasks(cid).filter(t=>fileWords(t.title).filter(w=>fw.has(w)).length>=2);
  return hits.length===1 ? hits[0].id : '';
}
function flLink(cid, tid, rel, on){
  const c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid); if(!t) return null;
  const had = Array.isArray(t.files) ? t.files : [];
  if(on && !had.includes(rel)) t.files = had.concat([rel]);
  else if(!on){ t.files = had.filter(f=>f!==rel); if(!t.files.length) delete t.files; }
  save(c); return t;
}
async function flDirs(cid){
  const c = cById(cid); if(!c || !FILING) return;
  if(!folderOf(c)){ try{ CTX[c.id] = (await APP.call('helpFolder', {name:c.short})).path; }catch(e){} }
  if(FILING.dirs[cid]) return;
  try{ FILING.dirs[cid] = (await APP.call('listDirs', {path:folderOf(c)})).dirs||[]; }catch(e){ FILING.dirs[cid] = []; }
}
async function filesDropped(ev){
  flCue(false);
  const at = document.elementFromPoint(ev.x, ev.y), files = (ev.items||[]).filter(i=>!i.dir);
  if(!files.length){ if((ev.items||[]).length) flToast('Folders cannot be filed yet, only files.'); return; }
  if(HELP && at && at.closest('#help-drop, #pchat.pc-help')) return helpAddContext('paths', files.map(f=>f.path));
  /* dropped on the planner chat: set up a course from them (onboard.js) */
  if(typeof chatDrop==='function' && IN_APP && at && at.closest('.compose')) return chatDrop(files.map(f=>f.path));
  const items = files.map(f=>{ const name = f.path.split('/').pop(); return {src:f.path, from:f.path.split('/').slice(0,-1).join('/'), name:flBase(name), ext:flExt(name), cid:flGuess(name), sub:''}; });
  items.forEach(it=>{ it.tid = it.cid ? flTaskGuess(it.cid, it.name) : ''; });
  if(FILING && !FILING.done) FILING.items = FILING.items.concat(items.filter(i=>!FILING.items.some(x=>x.src===i.src)));
  else FILING = {items, dirs:{}, error:'', busy:false, done:null};
  for(const it of FILING.items) if(it.cid) await flDirs(it.cid);
  flRender();
  const first = document.querySelector('#filing input[data-fl="name"]'); if(first){ first.focus(); first.select(); }
}
const flDest = it => { const c = cById(it.cid); return c && folderOf(c) ? folderOf(c)+(it.sub?'/'+it.sub:'') : ''; };
const flShort = p => String(p||'').replace(/^.*?\/Documents\//,'Documents/');
async function flMove(){
  if(!FILING || FILING.busy) return;
  const bad = FILING.items.find(it=>!it.cid || !String(it.name).trim());
  if(bad){ FILING.error = !bad.cid ? 'Pick a course for '+bad.name+bad.ext+'.' : 'A file needs a name.'; return flRender(); }
  FILING.busy = true; FILING.error = ''; flRender();
  for(const it of FILING.items) await flDirs(it.cid);   /* a course without its own folder gets its Documents/Planner folder first */
  const done = [];
  for(const it of FILING.items){
    try{ const r = await APP.call('fileMove', {src:it.src, dir:flDest(it), name:String(it.name).trim().replace(/[\/:]/g,'-')+it.ext}); const rel = (it.sub ? it.sub+'/' : '')+r.path.split('/').pop();
      const t = it.tid ? flLink(it.cid, it.tid, rel, true) : null;
      done.push({path:r.path, cid:it.cid, ok:true, tid:t?t.id:'', rel, task:t?t.title:''}); lsSet('fileLast', it.cid); }
    catch(e){ done.push({path:it.src, cid:it.cid, ok:false, error:e.message}); }
  }
  FILING.busy = false; FILING.done = done;
  await flRefresh([...new Set(done.map(d=>d.cid))]);
  flRender(); render();
  /* a book tagged to a reading: its pages and hours from the book, shown as the usual preview on Today */
  for(const d of done) if(d.ok && d.tid && typeof sizeFromFiling==='function') await sizeFromFiling(d.cid, d.tid, d.rel);
}
async function flRefresh(cids){ for(const id of cids){ const c = cById(id); if(c && folderOf(c)){ try{ FILES[id] = (await APP.call('listFiles', {path:folderOf(c)})).files||[]; }catch(e){} } } }
async function flUndo(i){
  const d = FILING && FILING.done && FILING.done[i]; if(!d || !d.ok) return;
  try{ const r = await APP.call('fileUndoMove', {path:d.path}); d.ok = false; d.undone = r.path; if(d.tid) flLink(d.cid, d.tid, d.rel, false); }catch(e){ d.error = e.message; }
  await flRefresh([d.cid]); flRender(); render();
}
function flRender(){
  let host = document.getElementById('filing');
  if(!FILING){ if(host) host.remove(); return; }
  if(!host){ host = document.createElement('div'); host.id = 'filing'; host.className = 'filing'; host.setAttribute('role','dialog'); host.setAttribute('aria-label','File documents'); document.body.appendChild(host); }
  const n = FILING.items.length;
  let h = '<div class="hhead"><div><div class="plabel">File '+(n===1?'a document':n+' documents')+'</div><h2>'+(FILING.done?'Done':'Where does '+(n===1?'it':'each one')+' go?')+'</h2></div><button class="lnk" data-fl="close">Close</button></div>';
  if(FILING.done){
    h += '<ul class="fldone">'+FILING.done.map((d,i)=>{ const c = cById(d.cid), name = d.path.split('/').pop();
      if(d.undone) return '<li class="muted">'+esc(name)+' is back in '+esc(flShort(d.undone.split('/').slice(0,-1).join('/')))+'</li>';
      if(!d.ok) return '<li><span class="tag warn">'+ICON.warn+esc(name)+': '+esc(d.error||'not moved')+'</span></li>';
      return '<li><b>'+esc(name)+'</b><div class="muted">'+esc(flShort(d.path.split('/').slice(0,-1).join('/')))+(c?' · '+esc(c.short):'')+(d.task?' · for '+esc(d.task):'')+'</div><span class="crow"><button class="btn sm" data-fl="open" data-fi="'+i+'">Open</button><button class="lnk" data-fl="undo" data-fi="'+i+'">Undo</button></span></li>'; }).join('')+'</ul>';
  } else {
    const groups = [...new Set(courses.map(groupOf))];
    const opts = sel => '<option value="">Pick a course</option>'+groups.map(g=>'<optgroup label="'+esc(g)+'">'+courses.filter(c=>groupOf(c)===g).map(c=>'<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.short)+'</option>').join('')+'</optgroup>').join('');
    h += FILING.items.map((it,i)=>{ const dirs = FILING.dirs[it.cid]||[];
      return '<div class="flrow" data-fi="'+i+'">'
        + '<label>Name<span class="flname"><input data-fl="name" data-fi="'+i+'" value="'+esc(it.name)+'"><span class="faint mono">'+esc(it.ext)+'</span></span></label>'
        + '<div class="flpick"><label>Course<select data-fl="cid" data-fi="'+i+'">'+opts(it.cid)+'</select></label>'
        + (it.cid && dirs.length ? '<label>Folder<select data-fl="sub" data-fi="'+i+'"><option value="">Main folder</option>'+dirs.map(d=>'<option'+(d===it.sub?' selected':'')+'>'+esc(d)+'</option>').join('')+'</select></label>' : '')
        + (it.cid ? '<label>Task<select data-fl="tid" data-fi="'+i+'"><option value="">No task</option>'+flTasks(it.cid).map(t=>'<option value="'+esc(t.id)+'"'+(t.id===it.tid?' selected':'')+'>'+esc(t.title.slice(0,60))+(t.due?' · '+esc(fmtShort(t.due)):'')+'</option>').join('')+'</select></label>' : '')+'</div>'
        + '<div class="faint flto">'+esc(flShort(it.from))+' → '+(it.cid ? esc(flShort(flDest(it))) : 'pick a course')+'</div>'
        + (n>1?'<button class="lnk" data-fl="drop" data-fi="'+i+'">Leave this one</button>':'')+'</div>'; }).join('');
    if(FILING.error) h += '<div class="tag warn">'+ICON.warn+esc(FILING.error)+'</div>';
    h += '<div class="crow"><button class="btn pri" data-fl="move"'+(FILING.busy?' disabled':'')+'>'+(FILING.busy?'Moving…':'Move '+(n===1?'it':'all '+n))+'</button><button class="btn" data-fl="close">Cancel</button><span class="faint">The file moves out of where it is now.</span></div>';
  }
  const ae = document.activeElement, keep = ae && host.contains(ae) && ae.dataset ? [ae.dataset.fl, ae.dataset.fi, ae.selectionStart] : null;
  host.innerHTML = h;
  if(keep && keep[0]==='name'){ const el = host.querySelector('input[data-fl="name"][data-fi="'+keep[1]+'"]'); if(el){ el.focus(); try{ el.setSelectionRange(keep[2], keep[2]); }catch(e){} } }
}
/* A plain line at the bottom for messages that need no panel. */
function flToast(text){ let t = document.getElementById('fltoast'); if(!t){ t = document.createElement('div'); t.id = 'fltoast'; t.className = 'fltoast'; document.body.appendChild(t); } t.textContent = text; clearTimeout(flToast.t); flToast.t = setTimeout(()=>t.remove(), 4000); }
/* While files are dragged over the window, a cue says what a drop does. */
function flCue(on){ let c = document.getElementById('dropcue'); if(!on){ if(c) c.remove(); return; } if(!c){ c = document.createElement('div'); c.id = 'dropcue'; c.className = 'dropcue'; c.innerHTML = '<span>Drop to file it in a course</span>'; document.body.appendChild(c); } }
document.addEventListener('dragenter', e=>{ if(IN_APP && e.dataTransfer && [...(e.dataTransfer.types||[])].includes('Files')) flCue(!e.target.closest('#help-drop, #pchat.pc-help')); });
document.addEventListener('dragover', e=>{ if(document.getElementById('dropcue') && e.target.closest('#help-drop, #pchat.pc-help')) flCue(false); });
document.addEventListener('dragleave', e=>{ if(!e.relatedTarget) flCue(false); });
document.addEventListener('drop', ()=>flCue(false));
document.addEventListener('click', async e=>{
  const b = e.target.closest('#filing [data-fl]'); if(!b || !FILING || b.tagName==='INPUT' || b.tagName==='SELECT') return;
  const a = b.dataset.fl, i = +b.dataset.fi;
  if(a==='close'){ FILING = null; flRender(); }
  else if(a==='move') flMove();
  else if(a==='drop'){ FILING.items.splice(i,1); flRender(); }
  else if(a==='undo') flUndo(i);
  else if(a==='open'){ const d = FILING.done[i]; if(/\.pdf$/i.test(d.path)){ FILING = null; flRender(); openReader(d.path, {cid:d.cid}); } else APP.call('openFile', {path:d.path}).catch(()=>{}); }
}, true);
document.addEventListener('input', e=>{ const el = e.target; if(!FILING || !el.closest || !el.closest('#filing')) return; const it = FILING.items[+el.dataset.fi]; if(it && el.dataset.fl==='name'){ it.name = el.value; } });
document.addEventListener('change', async e=>{
  const el = e.target; if(!FILING || !el.closest || !el.closest('#filing')) return; const it = FILING.items[+el.dataset.fi]; if(!it) return;
  if(el.dataset.fl==='cid'){ it.cid = el.value; it.sub = ''; it.tid = it.cid ? flTaskGuess(it.cid, it.name) : ''; FILING.error = ''; if(it.cid) await flDirs(it.cid); flRender(); }
  else if(el.dataset.fl==='sub'){ it.sub = el.value; flRender(); }
  else if(el.dataset.fl==='tid'){ it.tid = el.value; }
});
document.addEventListener('keydown', e=>{
  if(!FILING || !document.getElementById('filing')) return;
  if(e.key==='Escape' && !FILING.busy){ FILING = null; flRender(); }
  else if(e.key==='Enter' && !FILING.done && e.target.closest && e.target.closest('#filing') && e.target.tagName==='INPUT'){ e.preventDefault(); flMove(); }
});

/* ---------- group folders and files linked to tasks (21 Nov 2026) ----------
   Request: link the files in a group's shared folder to its tasks automatically, without moving them; new files for the
   group land there too.
   groupFolders: a course in a group whose courses keep one folder each in a folder named after the group (Documents/<group>/…)
   gets its own folder there, named after the course. Files added from Get help, Set up and filing then land in it (Help.dest);
   saved sessions and reading notes stay in Documents/Planner.
   autoLink: for groups in RULES_CFG.autoLink, the model reads the course's file names and its open tasks and says which
   files each task needs; code keeps only real files of that course and open tasks, and adds them to t.files (his own links
   stay; nothing is moved or removed). A task is asked about again only when its title or the course's files change
   (t.linkSeen). One call per course, only when something changed; after a failure it waits 30 minutes. */
async function groupFolders(){
  if(!IN_APP) return;
  for(const c of courses){
    if(c.folder || !c.group) continue;
    const parents = [...new Set(courses.filter(o=>o.group===c.group && o.folder).map(o=>o.folder.replace(/\/[^/]+$/,'')))];
    if(parents.length!==1 || parents[0].split('/').pop()!==c.group) continue;
    const name = String(c.name||c.short||'').replace(/[\/:]/g,'-').replace(/\s+/g,' ').trim().slice(0,80);
    if(!name || name[0]==='.') continue;
    try{ const r = await APP.call('makeFolder', {path:parents[0]+'/'+name}); c.folder = r.path; save(c); }catch(e){}
  }
}
let AUTOLINK = {busy:false, failAt:0};
const linkKey = (c,t) => { const s = (FILES[c.id]||[]).slice().sort().join('\n')+'\n#'+t.title; let h = 0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) | 0; return (h>>>0).toString(36); };
async function autoLink(){
  if(!IN_APP || AUTOLINK.busy || Date.now()-AUTOLINK.failAt < 30*60000) return;
  AUTOLINK.busy = true;
  try{
    for(const c of courses.filter(x=>(RULES_CFG.autoLink||[]).includes(x.group))){
      const files = (FILES[c.id]||[]).slice(0,150);
      const todo = (c.tasks||[]).filter(t=>t.status!=='done' && t.linkSeen!==linkKey(c,t)).slice(0,40);
      if(!files.length || !todo.length) continue;
      const prompt = 'A student\'s course "'+c.name+'"'+(c.note?' ('+c.note+')':'')+' keeps these files in its folder:\n'
        + files.map((f,i)=>'F'+(i+1)+' '+f).join('\n')
        + '\n\nOpen tasks:\n'+todo.map((t,i)=>{ const d = delivOf(c,t); return 'T'+(i+1)+' '+t.title+(d?' (for: '+d.title+')':'')+(t.note?' · note: '+String(t.note).split(/(?<=[.!?])\s/)[0].slice(0,200):''); }).join('\n')
        + '\n\nFor each task, list the files the student will need to open to do it: readings or sources it names or clearly builds on (an essay on a topic: the readings on that topic). The syllabus only when the task is about the course\'s requirements or schedule. No file is better than a guess. At most 3 per task.\nAnswer with JSON only: {"links":[{"task":"T1","files":["F2"]}]}';
      const red = redact(prompt, {heuristics:false});
      const r = await APP.call('llm', {prompt, remotePrompt:red.text, order:llmOrder()});
      if(!r || !r.text){ AUTOLINK.failAt = Date.now(); break; }
      let out; try{ out = JSON.parse((String(r.text).match(/\{[\s\S]*\}/)||['{}'])[0]); }catch(e){ AUTOLINK.failAt = Date.now(); break; }
      const cur = cById(c.id); if(!cur) continue;
      (Array.isArray(out.links) ? out.links : []).forEach(l=>{
        const t = todo[parseInt(String(l && l.task||'').replace(/\D/g,''),10)-1]; if(!t) return;
        const pick = (Array.isArray(l.files) ? l.files : []).map(x=>files[parseInt(String(x).replace(/\D/g,''),10)-1]).filter(Boolean).slice(0,3);
        if(pick.length) t.files = [...new Set((Array.isArray(t.files) ? t.files : []).concat(pick))];
      });
      todo.forEach(t=>{ t.linkSeen = linkKey(c,t); });
      save(cur);
    }
  }catch(e){ AUTOLINK.failAt = Date.now(); }
  AUTOLINK.busy = false; render();
}
