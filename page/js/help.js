/* Mac app state, the task help side panel (Claude through the CLI, redacted sandbox). Part of page/index_v2.html; classic script, loaded in order. */
/* ---------- Mac app: input field, calendar, iPhone inbox, second brain ---------- */
/* Only active inside the Mac app, where window.APP exists. The claude.ai page ignores all of this. */
/* PHONE: the iPhone app (sync.js). It shows the plan and calendar the Mac sends and ticks tasks, but never plans,
   so every Mac-only feature (organizer, models, files, Brain) stays behind IN_APP. HAS_CAL: calendar events can be shown. */
const PHONE = !!(window.APP && window.APP.phone);
const IN_APP = !!window.APP && !PHONE;
const HAS_CAL = IN_APP || PHONE;
let CAL = [], CAL_STATUS = '', INBOX = [], INBOX_STATUS = '', PREFS = null;
let BRAIN = [], BRAIN_OPEN = null, RECSTAGE = '', BRAIN_MSG = '';
let REC = {recording:false, seconds:0, sysPref:null, course:'', error:'', title:'', notes:''};
function callNow(){ const now = new Date(), d = iso(now), m = now.getHours()*60+now.getMinutes(); return (typeof CAL!=='undefined'?CAL:[]).find(e=>!e.allDay && evDay(e)===d && evMin(e.start)-10 <= m && m <= evMin(e.end) && meetLink(e)); }
function detectOnline(){ const t = REC.tools||{}, ev = callNow(); return t.callApp ? t.callApp+' is open' : ev ? ev.title+' has a call link' : ''; }
let TOPICS = {topics:[]}, CHATS = {}, CHAT = {topic:'All', draft:'', busy:false, error:'', clustering:false};
const freshCompose = () => ({draft:'', thread:[], busy:false, error:'', provider:'', questions:null, proposal:null, inboxId:null, done:''});
let compose = freshCompose();
const PROV = {claude:'Claude Haiku (Pro)', amp:'Amp'};
const cnm = id => (cById(id)||{}).short || id;
/* a real calendar date: no rollover ("2026-11-31", "2027-02-30" are not dates; 19 Nov 2026 user test) */
const validDate = s => { if(!/^\d{4}-\d{2}-\d{2}$/.test(s||'')) return false; const d = parse(s); return !isNaN(d) && iso(d)===s; };
const clockLabel = s => { s = Math.max(0, Math.round(s||0)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return (h?h+':'+pad(m):m)+':'+pad(x); };
const durLabel = s => !s ? '' : s < 60 ? 'under 1 min' : s < 3600 ? Math.round(s/60)+' min' : r1(s/3600)+' h';

/* course files: ~/Documents folders set per course; readings are matched to tasks by author or title words */
let FILES = {};
let PFILES = {};   /* the phone: {cid: [{f, s, cached, current, state, progress, error}]} from phoneFiles (sync.js) */
const FILE_SKIP = new Set('about after against archive between chapter digital during history media theory their there these those under which while world testimony exploring implications'.split(' '));
const fileWords = n => String(n).toLowerCase().replace(/\.[a-z0-9]+$/,'').split(/[^\p{L}]+/u).filter(w=>w.length>=5 && !FILE_SKIP.has(w));
/* A file matches a task when two title words match, or one that is capitalized in the task (an author or a book name, not the first word). */
const CTX = {};
const folderOf = c => c.folder || CTX[c.id] || '';
function pdfsFor(c,t){
  const fs = FILES[c.id]||[]; if(!fs.length) return [];
  /* files linked to the task (t.files: names in the course folder, set when filing or from "Add to the plan") come first */
  const linked = (Array.isArray(t.files) ? t.files : []).filter(f=>fs.includes(f));
  const tw = new Set(fileWords(t.title));
  const proper = new Set(String(t.title).split(/[^\p{L}]+/u).slice(1).filter(w=>/^\p{Lu}/u.test(w)).map(w=>w.toLowerCase()));
  return linked.concat(fs.filter(f=>!linked.includes(f) && (()=>{ const hit = [...new Set(fileWords(f))].filter(w=>tw.has(w)); return hit.length>=2 || hit.some(w=>proper.has(w)); })()));
}
/* Matching PDFs open from a button on the task's title line, like "Join Zoom".
   On the phone the files are the ones the Mac lists in its snapshot (PFILES, sync.js); a file is named "phone:<course>|<file>"
   and opens in the phone's reader, which gets it from the Mac the first time. Only PDFs open on the phone. */
const HAS_FILES = () => typeof IN_APP!=='undefined' && (IN_APP || PHONE);
const fileRef = (c,f) => PHONE ? 'phone:'+c.id+'|'+f : folderOf(c)+'/'+f;
const filesOf = (c,t) => pdfsFor(c,t).filter(f=>!PHONE || /\.pdf$/i.test(f));
function pdfBtns(c,t){ if(!HAS_FILES()) return ''; const fs = filesOf(c,t); return helpBtn(c,t) + fs.map(f=>' <button class="join" data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|'+t.id)+'" title="Open '+esc(f)+'">'+(fs.length===1?'Open PDF':'Open '+esc(f.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').slice(0,28)))+'</button>').join(''); }
function pdfLinks(c,t){ if(!HAS_FILES()) return ''; const fs = filesOf(c,t); return fs.length ? '<div class="pdfs">'+fs.map(f=>'<button class="lnk" data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|'+t.id)+'" title="'+esc(f)+'">Open '+esc(f.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').slice(0,40))+'</button>').join('')+'</div>' : ''; }
function filesFold(c){
  let h = c.note ? '<p class="cnote">'+esc(c.note)+'</p>' : '';
  const fs = FILES[c.id]||[];
  const dcs = c.decisions||[];
  if(dcs.length) h += '<details class="fold files"><summary>Decisions <span class="muted">· '+dcs.length+'</span></summary><ul class="dlist">'+dcs.slice().reverse().map(d=>'<li><span class="mono faint">'+esc(fmtShort(d.date))+'</span> <b>'+esc(d.text)+'</b>'+(d.summary?'<div class="muted">'+esc(d.summary).replace(/\n/g,'<br>')+'</div>':'')+'</li>').join('')+'</ul></details>';
  if(PHONE && fs.length) h += '<details class="fold files"><summary>Files <span class="muted">· '+fs.length+'</span></summary><ul class="flist">'+fs.map(f=>{ const x = ((PFILES[c.id]||[]).find(y=>y.f===f))||{}; return '<li><button class="lnk" data-file="'+esc(fileRef(c,f))+'" data-ctx="'+esc(c.id+'|')+'">'+esc(f)+'</button>'+(x.cached?' <span class="faint">on the phone</span>':x.reading?' <span class="faint">text on the phone</span>':x.s?' <span class="faint">'+Math.max(1,Math.round(x.s/1048576))+' MB</span>':'')+'</li>'; }).join('')+'</ul></details>';
  if(IN_APP && folderOf(c)) h += '<details class="fold files"><summary>Files <span class="muted">· '+fs.length+'</span></summary><ul class="flist">'+fs.map(f=>'<li><button class="lnk" data-file="'+esc(folderOf(c)+'/'+f)+'" data-ctx="'+esc(c.id+'|')+'">'+esc(f)+'</button></li>').join('')+'</ul><button class="lnk" data-file="'+esc(folderOf(c))+'" data-reveal="1">Show folder</button></details>';
  return h;
}
/* ---------- task help ----------
   "Get help" on an open task opens a panel with a Claude session (Sonnet, through the CLI). Claude reads only a sandbox of
   redacted copies: the whole planner, this course's Brain meetings, the course folder and the course's context folder
   (Documents/Planner/<course>, where dropped files and saved sessions go). Names, links, emails and numbers become
   placeholders before anything leaves this Mac and are put back in the answers. The result is saved to the course as a decision. */
let HELP = null;
/* Get help needs the Mac (the user's rule, 21 Nov 2026: the phone's only AI is the PDF reading partner). On the phone the button
   sends the question to the Mac (helpPhone, sync.js); on the Mac it waits on that task's button and goes in as the first
   message when he opens Get help there (PHONE_HELPS). */
const helpBtn = (c,t) => {
  if(typeof IN_APP==='undefined' || t.status==='done') return '';
  if(PHONE) return ' <button class="join" data-phelp="'+esc(c.id+'|'+t.id)+'" title="Ask about this task; Get help on the Mac answers it">Get help</button>';
  if(!IN_APP) return '';
  const q = typeof phoneHelpFor==='function' && phoneHelpFor(c.id, t.id);
  return ' <button class="join'+(q?' on':'')+'" data-help="'+esc(c.id+'|'+t.id)+'" title="'+(q?'Question from your iPhone: '+esc(q.text.slice(0,200)):'Work on this task with Claude, using the planner, meetings and course files')+'">Get help'+(q?' · iPhone question':'')+'</button>';
};
const helpNames = () => { try{ return JSON.parse(lsGet('helpNames')||'[]'); }catch(e){ return []; } };
const helpTask = () => { if(!HELP) return null; const c = cById(HELP.cid); if(!c) return null; const t = (c.tasks||[]).find(x=>x.id===HELP.tid) || null; if(t) HELP.title = t.title; return {c, t: t || {id:HELP.tid, title:HELP.title||'Task', status:'gone', est:'', note:''}, gone:!t}; };
/* A task's open session is kept for 7 days, so opening the task again continues it instead of starting over. */
const HS_DAYS = 7;
const helpKey = (cid,tid) => cid+'|'+tid;
const helpStore = () => { try{ return JSON.parse(lsGet('helpSessions')||'{}'); }catch(e){ return {}; } };
function helpKeep(){
  if(!HELP || !HELP.session) return; const all = helpStore(), from = addDays(TODAY,-HS_DAYS);
  Object.keys(all).forEach(k=>{ if(!all[k].date || all[k].date<from) delete all[k]; });
  all[helpKey(HELP.cid,HELP.tid)] = {session:HELP.session, thread:HELP.thread, map:HELP.map, date:TODAY, at:HELP.lastAt||Date.now(), turns:HELP.turns||0, books:[...(HELP.books||[])], usage:HELP.usage||null};
  lsSet('helpSessions', JSON.stringify(all));
}
/* A continued session resends its whole history each message, at full price once the cache is gone (about an hour).
   Past an hour or 12 replies the next message starts a new session with a short recap made in code instead. */
const HS_FRESH_MIN = 60, HS_MAX_TURNS = 12;
const helpStale = () => HELP && HELP.session && ((HELP.lastAt && Date.now()-HELP.lastAt > HS_FRESH_MIN*60000) || (HELP.turns||0) >= HS_MAX_TURNS);
function helpRecap(){
  const th = HELP.thread, lastA = th.map((m,i)=>m.role==='assistant'?i:-1).filter(i=>i>=0).slice(-2);
  const cut = (t,n) => { t = String(t||'').trim(); return t.length>n ? t.slice(0,n)+' …' : t; };
  return th.length ? 'Earlier in this session (shortened):\n'+th.map((m,i)=>(m.role==='user'?'Student: '+cut(m.text,400):'You: '+cut(m.text, lastA.includes(i)?2500:500))).join('\n\n') : '';
}
function helpForget(cid,tid){ const all = helpStore(); delete all[helpKey(cid,tid)]; lsSet('helpSessions', JSON.stringify(all)); }
/* Saved results that belong to this task: its own decisions and those another session marked as needed for it. */
function helpEarlier(cid, tid){
  const out = [];
  courses.forEach(o=>(o.decisions||[]).forEach(d=>{
    const own = o.id===cid && d.task===tid, linked = (d.helps||[]).some(h=>h.course===cid && h.task===tid);
    if(own || linked){ const src = (o.tasks||[]).find(t=>t.id===d.task); out.push({d, course:o.short, from: own ? '' : (src ? src.title : d.text)}); }
  }));
  return out;
}
/* Books (files over about 30 pages) are not read unless he names them: in the task, in the chat, or with the button in the panel. */
const PAGE_CHARS = 3000, BOOK_CHARS = 30*PAGE_CHARS, PART_CHARS = 10*PAGE_CHARS;
function bookNamed(name, text, all){
  const T = helpNorm(text), ws = w => [...new Set(helpNorm(String(w).replace(/\.[a-z0-9]+$/i,'')).trim().split(' ').filter(x=>x.length>=4 && !FILE_SKIP.has(x)))];
  const hits = ws(name).filter(w=>T.includes(' '+w+' '));
  const unique = w => w.length>=6 && all.filter(o=>o!==name && ws(o).includes(w)).length===0;
  return hits.length>=2 || hits.some(unique);
}
function bookParts(text){
  const out = []; let i = 0; text = String(text);
  while(i < text.length){ let j = Math.min(text.length, i+PART_CHARS); if(j<text.length){ const k = text.lastIndexOf('\n\n', j); if(k > i+PART_CHARS/2) j = k; } out.push(text.slice(i,j)); i = j; }
  return out;
}
const hRed = (text, heuristics=true) => redact(text, {map:HELP.map, terms:HELP.terms, heuristics}).text;
const hBack = text => restore(text, HELP.map);
function plannerMarkdown(only){
  return '# Planner\nToday is '+TODAY+' ('+wd(TODAY)+').\n\n'+courses.filter(c=>!only || only.includes(c.id)).map(c=>{
    let s = '## '+c.short+' ['+c.id+']\n'+(c.name?c.name+'\n':'')+(c.note?'Note: '+c.note+'\n':'');
    s += '\n### Deliverables\n'+((c.deliverables||[]).map(d=>'- '+d.id+': '+d.title+' ['+(d.date||d.state)+']'+(d.note?' — '+d.note:'')).join('\n')||'- none');
    s += '\n\n### Tasks\n'+((c.tasks||[]).map(t=>'- ['+t.id+'] '+t.title+' | '+(t.due||'no day')+' | '+t.est+' h'+(t.spent?' (took '+t.spent+' h)':'')+' | '+t.where+' | '+t.status+(t.did?' | for '+t.did:'')+(t.note?'\n  note: '+t.note:'')).join('\n')||'- none');
    if((c.decisions||[]).length) s += '\n\n### Decisions\n'+c.decisions.map(d=>'- '+d.date+': '+d.text+(d.summary?'\n  '+String(d.summary).replace(/\n/g,'\n  '):'')).join('\n');
    return s;
  }).join('\n\n');
}
function meetingMarkdown(m){
  const L = a => (a||[]).map(x=>'- '+(typeof x==='string'?x:(x.text||'')+(x.owner?' ('+x.owner+')':'')+(x.due?' by '+x.due:''))).join('\n');
  return '# '+(m.title||'Meeting')+'\nDate: '+String(m.created||'').slice(0,10)+'\n'
    + (m.summary?'\n## Summary\n'+m.summary+'\n':'') + ((m.points||[]).length?'\n## Points\n'+L(m.points)+'\n':'')
    + ((m.concepts||[]).length?'\n## Concepts\n'+m.concepts.map(c=>'- '+c.term+(c.explain?': '+c.explain:'')+(c.at?' ('+c.at+')':'')).join('\n')+'\n':'')
    + ((m.decisions||[]).length?'\n## Decisions\n'+L(m.decisions)+'\n':'') + ((m.actions||[]).length?'\n## Actions\n'+L(m.actions)+'\n':'')
    + (m.notes?'\n## Notes\n'+m.notes+'\n':'') + ((m.segments||[]).length?'\n## Transcript\n'+m.segments.map(g=>'['+clockLabel(Math.round(g.t||0))+'] '+(g.sp?'['+spkName(g.sp)+'] ':'')+g.text).join('\n')+'\n':'');
}
/* Builds the sandbox. Safe to run again after files are added: the copies are rewritten, the session keeps going. */
/* Which courses a session draws on: its own, the rest of its group (courses of one group share), courses or groups named
   in the task, and any named later in the chat. A name counts when a word of it belongs to one course only ("capital",
   "studio") or the group's name appears ("Studio"). */
const helpNorm = t => ' '+String(t||'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\d]+/gu,' ')+' ';
/* The folder index as text (24 Nov 2026, the user's request: project folders (Unreal, code) sit next to the readings, and Claude
   should know what exists without spending context on it). Built from `folderIndex` (main.swift, in code, no model):
   documents (a folder with many is one line with a few names), each code or 3D project one line (kind, size, last
   change, its README's first line, what is at its top), other files counted per folder. `red` hides names. */
function folderIndexText(idx, red, opts={}){
  red = red || (x=>x); const L = [], many = opts.many || 6;
  const mb = b => b >= 1e9 ? (b/1e9).toFixed(1)+' GB' : b >= 1e6 ? Math.round(b/1e6)+' MB' : 'under 1 MB';
  const when = t => t ? ', changed '+fmtShort(new Date(t*1000).toISOString().slice(0,10)) : '';
  const base = f => f.split('/').pop().replace(/\.[a-z0-9]+$/i,'');
  (idx||[]).forEach(f=>{
    const docs = f.docs||[], projects = f.projects||[], other = f.other||[];
    if(!docs.length && !projects.length && !other.length) return;
    L.push('## '+red(f.folder));
    const byDir = {}; docs.forEach(d=>{ const k = d.path.includes('/') ? d.path.replace(/\/[^/]*$/,'') : ''; (byDir[k] = byDir[k]||[]).push(d); });
    Object.keys(byDir).sort().forEach(k=>{ const list = byDir[k], pages = list.reduce((n,d)=>n+(d.pages||0),0);
      if(list.length > many) L.push('- '+(k ? red(k)+'/' : '(top)')+': '+list.length+' documents'+(pages?', '+pages+' pages':'')+' · '+list.slice(0,4).map(d=>red(base(d.path)).slice(0,50)).join('; ')+'…');
      else list.forEach(d=>L.push('- '+red(d.path)+(d.pages?' ('+d.pages+' pages)':''))); });
    /* old copies (an archive, backup or old folder) are one line per folder; more than 3 small code folders side by side
       (scripts/alex, scripts/cast…) are one line too */
    const arch = {}, live = projects.filter(p=>{ const m = p.path.match(/^(.*?(?:^|\/)(?:_?archive|archiv|old|backup|_old|deprecated))(?:\/|$)/i); if(!m) return true; (arch[m[1]] = arch[m[1]]||[]).push(p); return false; });
    const sib = {}; live.forEach(p=>{ const k = p.path.includes('/') ? p.path.replace(/\/[^/]*$/,'') : ''; (sib[k] = sib[k]||[]).push(p); });
    Object.keys(sib).sort().forEach(k=>{ const list = sib[k];
      if(k && list.length > 3 && list.every(p=>/^Code folder/.test(p.kind))) L.push('- '+red(k)+'/: '+list.length+' code folders ('+[...new Set(list.map(p=>p.kind.replace(/^Code folder \(|\)$/g,'')))].join(', ')+'), '+list.reduce((n,p)=>n+p.files,0)+' files'+when(Math.max(...list.map(p=>p.modified||0)))+' · '+list.map(p=>red(p.path.split('/').pop())).join(', '));
      else list.forEach(p=>L.push('- '+red(p.path)+'/: '+p.kind+', '+p.files+' files, '+mb(p.bytes)+when(p.modified)+(p.readme?' · "'+red(p.readme)+'"':'')+((p.top||[]).length?' · top: '+p.top.slice(0,6).map(red).join(', '):''))); });
    Object.keys(arch).sort().forEach(k=>{ const list = arch[k]; L.push('- '+red(k)+'/: '+list.length+' older '+(list.length===1?'copy':'copies')+' ('+[...new Set(list.map(p=>p.kind))].join(', ')+')'+when(Math.max(...list.map(p=>p.modified||0)))); });
    if(other.length){ const top = other.slice().sort((a,b)=>b.bytes-a.bytes).slice(0, opts.other || 8);
      top.forEach(o=>L.push('- '+(o.path ? red(o.path)+'/' : '(top)')+': '+Object.entries(o.counts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([e,n])=>n+' '+e).join(', ')+' ('+mb(o.bytes)+')'));
      if(other.length > top.length) L.push('- and '+(other.length-top.length)+' more folders of other files'); }
  });
  return L.join('\n');
}
function coursesNamed(text){
  const T = helpNorm(text), out = new Set();
  const words = c => [...new Set(helpNorm(c.short+' '+String(c.name||'').split('·')[0]).trim().split(' ').filter(w=>w.length>=5))];
  const count = {}; courses.forEach(c=>words(c).forEach(w=>count[w]=(count[w]||0)+1));
  courses.forEach(c=>{ if(words(c).some(w=>count[w]===1 && T.includes(' '+w+' '))) out.add(c.id); });
  const groups = [...new Set(courses.map(groupOf))];
  groups.forEach(g=>{ const k = helpNorm(String(g).replace(/&/g,' ')).trim(); if(k.length>=3 && T.includes(' '+k+' ')) courses.filter(c=>groupOf(c)===g).forEach(c=>out.add(c.id)); });
  return out;
}
function helpCourses(){
  const x = helpTask(); if(!x) return []; const {c,t} = x, d = delivOf(c,t);
  const ids = new Set([c.id]);
  if(!RULES_CFG.unsharedGroups.includes(groupOf(c))) courses.filter(o=>groupOf(o)===groupOf(c)).forEach(o=>ids.add(o.id));
  coursesNamed([t.title, t.note, d && d.title].join(' ')).forEach(id=>ids.add(id));
  (HELP.extra||[]).forEach(id=>ids.add(id));
  return courses.filter(o=>ids.has(o.id));
}
async function helpPrepare(){
  const x = helpTask(); if(!x) return; const {c} = x;
  HELP.stage = 'Collecting the planner, meetings and files'; renderHelp();
  const fold = await APP.call('helpFolder', {name:c.short}); HELP.folder = fold.path; HELP.ownFiles = fold.files||[];
  const cs = helpCourses(); HELP.cids = cs.map(o=>o.id);
  const meets = []; for(const o of cs){ ((await APP.call('helpMeetings', {course:o.id}).catch(()=>({meetings:[]}))).meetings||[]).forEach(m=>{ m._course = o.short; meets.push(m); }); }
  const terms = new Set(helpNames());
  meets.forEach(m=>(m.actions||[]).forEach(a=>{ if(a && a.owner && String(a.owner).length>1) terms.add(String(a.owner).trim()); }));
  HELP.terms = [...terms];
  const out = [{path:'planner.md', text:hRed(plannerMarkdown(HELP.cids))}];
  /* the notes and the transcript are separate files, so a meeting is usually read without its transcript */
  meets.forEach(m=>{ const base = 'meetings/'+hRed(m._course+'/'+String(m.created||'').slice(0,10)+' '+(m.title||'Meeting'), false);
    out.push({path:base+'.md', text:hRed('Course: '+m._course+'\n'+meetingMarkdown(Object.assign({}, m, {segments:[]})))});
    if((m.segments||[]).length) out.push({path:base+' transcript.md', text:hRed(m.segments.map(g=>'['+clockLabel(Math.round(g.t||0))+'] '+(g.sp?'['+spkName(g.sp)+'] ':'')+g.text).join('\n'))}); });
  /* names found so far are hidden in the files too; readings keep their authors otherwise */
  const found = Object.entries(HELP.map).filter(([k])=>k.startsWith('[Person')).map(([,v])=>v);
  HELP.terms = [...new Set(HELP.terms.concat(found))];
  HELP.stage = 'Reading the course files'; renderHelp();
  const folders = [...new Set([HELP.folder].concat(cs.map(o=>folderOf(o))).filter(Boolean))];
  const src = await APP.call('helpSources', {folders, course:c.id}).catch(()=>({files:[]})), files = src.files||[];
  const x2 = helpTask(), asked = [x2.t.title, x2.t.note].concat(HELP.thread.filter(m=>m.role==='user').map(m=>m.text)).join(' ');
  HELP.held = [];
  files.forEach(f=>{ const session = /^Sessions\//.test(f.name), base = 'files/'+hRed(f.folder+'/'+f.name, false);
    if(!session && String(f.text||'').length > BOOK_CHARS && !HELP.books.has(f.name)){
      if(bookNamed(f.name, asked, files.map(g=>g.name)) || pdfsFor(x2.c, x2.t).includes(f.name)) HELP.books.add(f.name);
      else { HELP.held.push({name:f.name, pages:Math.round(f.text.length/PAGE_CHARS)}); return; }
    }
    if(String(f.text||'').length > BOOK_CHARS) bookParts(f.text).forEach((part,i,all)=>{ if(i===0) out.push({path:base+'/contents.txt', text:hRed(all.map((p2,j)=>'part '+pad(j+1)+': '+p2.slice(0,120).replace(/\s+/g,' ')).join('\n'), session)}); out.push({path:base+'/part '+pad(i+1)+'.txt', text:hRed(part, session)}); });
    else out.push({path:base+'.txt', text:hRed(f.text, session)}); });
  /* the whole folder, projects and media included, as INDEX.md; the first prompt gets a short form of it */
  const fi = ((await APP.call('folderIndex', {folders}).catch(()=>null))||{}).folders || [];
  const projLines = fi.length ? folderIndexText(fi.map(f=>Object.assign({}, f, {docs:[]})), x=>hRed(x,false), {other:4}) : '';
  if(fi.length) out.push({path:'INDEX.md', text:'# Everything in the course folders\nDocuments are copied under files/. Code projects, 3D scenes, renders and other media are listed here only: they are not copied and cannot be opened from here (the student works on them in Terminal).\n\n'+folderIndexText(fi, x=>hRed(x,false), {many:1e9, other:40})});
  await APP.call('helpSandbox', {course:c.id, files:out});
  /* names and sizes only, so the first answer can point at sources without opening them; a folder with many files is
     one line (the full list is INDEX.md) */
  const listed = out.filter(f=>f.path!=='planner.md' && f.path!=='INDEX.md' && !/\/part \d+\.txt$/.test(f.path)), byDir = {};
  listed.forEach(f=>{ const k = f.path.replace(/\/contents\.txt$/,'').replace(/\/[^/]*$/,''); (byDir[k] = byDir[k]||[]).push(f); });
  HELP.index = Object.keys(byDir).sort().flatMap(k=>{ const list = byDir[k];
      if(list.length > 6 && !/^meetings\//.test(k)) return ['- '+k+'/: '+list.length+' files, about '+list.reduce((n,f)=>n+Math.max(1, Math.round(String(f.text||'').length/PAGE_CHARS)),0)+' pages (names in INDEX.md)'];
      return list.map(f=>'- '+f.path+(/\/contents\.txt$/.test(f.path)?' (a book in parts; read the contents first, then only the parts you need)':' (about '+Math.max(1, Math.round(String(f.text||'').length/PAGE_CHARS))+' pages)')); })
    .concat(HELP.held.map(b=>'- '+hRed(b.name,false)+' (book, about '+b.pages+' pages, not in the folder: it is added when the student names it)'))
    .concat(projLines ? ['', 'Also in the folders, not copied (projects and media, see INDEX.md):', projLines.replace(/^## .*\n?/gm,'')] : []);
  const names = Object.entries(HELP.map).filter(([k])=>k.startsWith('[Person')).map(([,v])=>v);
  lsSet('helpNames', JSON.stringify([...new Set(helpNames().concat(names))].slice(-400)));
  HELP.counts = {courses:cs.map(o=>o.short), meetings:meets.length, files:files.length, hidden:Object.keys(HELP.map).length, scanned:src.scanned||[]};
  HELP.stage = '';
}
const helpModels = () => { try{ return JSON.parse(lsGet('helpModel')||'{}'); }catch(e){ return {}; } };
function helpSetModel(m){ HELP.model = m; const all = helpModels(); if(m==='sonnet') all[HELP.cid] = m; else delete all[HELP.cid]; lsSet('helpModel', JSON.stringify(all)); renderHelp(); }
async function openHelp(cid, tid){
  if(HELP && HELP.busy) return;
  HELP = {cid, tid, thread:[], session:'', map:{}, terms:[], stage:'', error:'', busy:true, stream:null, tool:'', draft:'', save:null, counts:null, folder:'', ownFiles:[], added:[]};
  const kept = helpStore()[helpKey(cid,tid)], from = addDays(TODAY,-HS_DAYS);
  if(kept && kept.session && kept.date>=from){ HELP.session = kept.session; HELP.thread = kept.thread||[]; HELP.map = kept.map||{}; HELP.lastAt = kept.at||0; HELP.turns = kept.turns||0; HELP.books = new Set(kept.books||[]); HELP.usage = kept.usage||null; HELP.note = 'Your session from '+fmtShort(kept.date)+' continues here.'; }
  HELP.earlier = helpEarlier(cid, tid); HELP.model = helpModels()[cid] || 'haiku'; HELP.books = HELP.books || new Set();
  renderHelp();
  try{
    await helpPrepare();
    /* nothing is sent until he asks when there is a session to continue or saved work to build on */
    if(HELP.session || HELP.earlier.length){ HELP.busy = false; HELP.stage = ''; renderHelp(); return; }
    const r = await helpSend(hRed(helpOpening()+'\n\nStart with two or three lines on how you suggest going about the task and which sources look useful, and offer to open them. Keep it at that surface level.'), null, {fresh:true});
    if(r!=null && HELP){ HELP.thread.push({role:'assistant', text:hBack(r)}); helpKeep(); renderHelp(); }
  }catch(e){ HELP.error = e.message; HELP.busy = false; HELP.stage = ''; renderHelp(); }
}
/* Opens Get help; a question sent from the iPhone for this task goes in as the next message, then leaves the inbox. */
async function openHelpPhone(cid, tid){
  const q = typeof phoneHelpFor==='function' ? phoneHelpFor(cid, tid) : null;
  await openHelp(cid, tid);
  if(!q || !HELP || HELP.cid!==cid || HELP.tid!==tid) return;
  phoneHelpTaken(q.id);
  if(HELP.busy){ HELP.draft = q.text; HELP.note = 'Your question from the iPhone is below. Send it when Claude is done.'; renderHelp(); return; }
  helpTurn(q.text);
}
function helpOpening(){
    const {c,t} = helpTask(), d = delivOf(c,t);
    const done = (HELP.earlier||[]).map(e=>'- '+(e.from?'From the session on "'+e.from+'" ('+e.course+')':'Earlier session on this task')+', '+e.d.date+': '+e.d.text+(e.d.summary?'\n  '+String(e.d.summary).replace(/\n/g,'\n  '):'')+(e.d.drafts||[]).map(x=>'\n  Draft "'+x.title+'":\n  '+String(x.text).replace(/\n/g,'\n  ')).join('')).join('\n');
    return `You help a student finish one task from their study planner. The files in this folder are your sources:
- planner.md: every course with its deadlines, tasks, notes and the decisions saved earlier
- meetings/: notes and transcripts of recorded meetings for this course
- files/: readings, course files and context the student added
Reading costs time and money, so open as little as you can:
- This first answer: do not use any tools. Work only from the task, the course section and the list of sources below.
- Later: open a source only when the question needs it. Grep for the words that matter first, then Read just those parts (offset and limit), never a whole book or transcript. Do not open files you do not need.
Say which file a point comes from.
Help the student get this task done. For a decision: lay out the real options with pros and cons from the sources, recommend one, and ask only what you need to know. Keep it short and plain, no decorative language, at most two questions at a time.

Task: ${t.title}
Course: ${c.short}${c.name && c.name!==c.short ? ' ('+c.name+')' : ''}
${d ? 'For: '+d.title+(d.date?' due '+d.date+' '+wd(d.date):'')+'\n' : ''}Planned: ${t.due||'no day'}, ${t.est} h, ${t.where}${t.note ? '\nNote: '+t.note : ''}

This course in the planner:
${plannerMarkdown([c.id]).replace(/^# Planner\n/,'')}

Sources (not opened yet; other courses are under their own folder names):
${(HELP.index||[]).join('\n') || '- none'}

${done ? 'Already done in earlier sessions. Build on this; do not write it again or look for it in the files:\n'+done+'\n' : ''}`;
}
/* opts.fresh: the prompt already carries the opening. opts.model: 'haiku' for the mechanical steps (summary, plan JSON). */
const LINK_RE = /https?:\/\/\S+|www\.\S+/gi;
const linkHost = u => { try{ return new URL(/^www\./i.test(u) ? 'https://'+u : u).hostname.toLowerCase(); }catch(e){ return ''; } };
async function helpSend(prompt, shown, opts={}){
  if(helpStale()){ HELP.session = ''; HELP.turns = 0; HELP.recap = true; }
  if(!HELP.session && !opts.fresh){ const rc = HELP.recap ? helpRecap() : ''; HELP.recap = false; prompt = hRed(helpOpening()+(rc?'\n\n'+rc:''))+'\n\n'+prompt; }
  if(shown) HELP.thread.push({role:'user', text:shown});
  HELP.busy = true; HELP.error = ''; HELP.stream = ''; HELP.tool = ''; const sid = 'h'+Date.now(); HELP.sid = sid; renderHelp();
  try{
    const r = await APP.call('helpAsk', {course:HELP.cid, prompt, session:HELP.session, sid, model:opts.model||HELP.model, web:opts.web||[]});
    if(!HELP || HELP.sid!==sid) return null;
    if(r.session) HELP.session = r.session;
    HELP.lastAt = Date.now(); HELP.turns = (HELP.turns||0)+1;
    const u = HELP.usage = HELP.usage || {tokens:0, cost:0}; u.tokens += r.tokens||0; u.cost += r.cost||0;
    HELP.busy = false; HELP.stream = null;
    if(r.stopped==='budget') HELP.error = 'Stopped at the cost limit for one message. Ask a narrower question, or name the part to read.';
    return r.text||'';
  }catch(e){ if(HELP && HELP.sid===sid){ HELP.error = e.message; HELP.busy = false; HELP.stream = null; renderHelp(); } return null; }
}
async function helpTurn(text){
  text = String(text||'').trim(); if(!text || !HELP || HELP.busy) return;
  HELP.draft = '';
  const named = [...coursesNamed(text)].filter(id=>!(HELP.cids||[]).includes(id));
  let widened = '';
  if(named.length){ HELP.extra = (HELP.extra||[]).concat(named); HELP.reprep = true; widened = named.map(id=>cById(id).short).join(', '); }
  const newBooks = (HELP.held||[]).filter(b=>bookNamed(b.name, text, HELP.held.map(h=>h.name)));
  if(newBooks.length){ newBooks.forEach(b=>{ HELP.books.add(b.name); HELP.added.push(hRed(b.name,false)); }); HELP.reprep = true; }
  if(HELP.reprep){ HELP.reprep = false; HELP.thread.push({role:'user', text}); HELP.busy = true; try{ await helpPrepare(); }catch(e){} HELP.busy = false; HELP.thread.pop(); }
  let p = text;
  if(widened) p = '(Files and meetings from '+widened+' were added to files/ and meetings/. Search them if the question needs them.)\n\n'+p;
  if(HELP.added.length){ p = '(New context was added to files/: '+HELP.added.join(', ')+'. Search it if the question needs it.)\n\n'+p; HELP.added = []; }
  /* Links he typed himself stay in the clear and may be opened this turn (WebFetch on their sites only); links in the sources stay hidden. */
  const links = [...new Set(text.match(LINK_RE)||[])];
  let q = hRed(p);
  links.forEach(u=>{ for(const k in HELP.map) if(HELP.map[k]===u) q = q.split(k).join(u); });
  const web = [...new Set(links.map(linkHost).filter(Boolean))];
  if(web.length) q = '(You may open the links in this message with WebFetch.)\n\n'+q;
  const r = await helpSend(q, text, {web});
  if(r!=null){ HELP.thread.push({role:'assistant', text:hBack(r)}); helpKeep(); renderHelp(); }
}
function helpChunk(ev){
  if(!HELP || HELP.sid!==ev.sid) return;
  const s = String(ev.text||'');
  if(s[0]==='\u0001'){ HELP.tool = {Grep:'Searching the sources', Glob:'Looking through the folder', Read:'Reading a file', WebFetch:'Opening the link'}[s.slice(1)] || 'Working'; }
  else { HELP.stream += s; HELP.tool = ''; }
  const el = document.getElementById('help-stream');
  if(el) el.innerHTML = HELP.stream ? md(hBack(HELP.stream)) : '<span class="muted">'+esc(HELP.tool||'Thinking')+'…</span>';
  else renderHelp();
  const th = document.getElementById('help-thread'); if(th) th.scrollTop = th.scrollHeight;
}
async function helpSummarize(){
  if(!HELP || HELP.busy) return;
  const x = helpTask(), others = openTasksContext(HELP.cids).split('\n').filter(l=>l && !(x && l.includes('task '+x.t.id+' ['+x.c.id+']'))).join('\n');
  const r = await helpSend(hRed(`Sum up the result of this session for the planner. Reply with JSON only, no other text: {"decision":"the decision or result in one line","summary":"3 to 6 short lines: what was decided, why, and the next steps","done":true or false (is the task finished now?),"changesPlan":true or false (does this change what other open tasks should be, such as a new concept, tool, scope or order of work?),"drafts":[{"title":"short name, for example Email to the professor","text":"the final text exactly as agreed"}],"helps":[{"course":"course id","task":"task id"}]}
"drafts": finished texts written in this session that will be sent or used (emails, messages, paragraphs), copied exactly; [] if none.
"helps": other open tasks below that this result or a draft is needed for; [] if none.
"changesPlan": false when the result only finishes or informs this task.

Other open tasks:
${others || '    none'}`), null, {model:'haiku'});
  if(r==null) return;
  const real = h => { const o = cById(h && h.course); return o && (o.tasks||[]).some(t=>t.id===h.task && t.status!=='done') && !(x && o.id===x.c.id && h.task===x.t.id); };
  try{ const j = extractJSON(hBack(r));
    HELP.save = {decision:String(j.decision||'').trim(), summary:String(j.summary||'').trim(), done:!!j.done, spent:'', changesPlan:j.changesPlan===true,
      drafts:(Array.isArray(j.drafts)?j.drafts:[]).filter(d=>d && String(d.text||'').trim()).map(d=>({title:String(d.title||'Draft').trim(), text:String(d.text).trim()})),
      helps:(Array.isArray(j.helps)?j.helps:[]).filter(real).map(h=>({course:h.course, task:h.task, on:true}))}; }
  catch(e){ HELP.save = {decision:'', summary:hBack(r).trim(), done:false, spent:'', drafts:[], helps:[]}; }
  renderHelp();
}
/* Change the plan from the session (what "Add context" used to do): Claude writes the planner JSON, the usual editable preview opens on Today. */
async function helpPlan(){
  const x = helpTask(); if(!x || !HELP || HELP.busy) return; const {c} = x;
  const prompt = `From what we worked out, write the changes to the planner. Change this task (day, hours, title, note, status), split it, mark it done or remove it, and add follow-up tasks if the work needs them. Touch other tasks only if we agreed to. Leave "events" empty.
Reply with JSON only, no other text, in this shape:
${SHAPE}

${rulesText()}

The task (id [course] title | day | hours | where | status | deliverable):
${taskLine(c, x.t)}${x.t.note ? '\n    current note: '+x.t.note : ''}

Open tasks in ${c.short}:
${openTasksContext([c.id]) || '    none'}

Courses and their deliverables:
${courseIndex()}`;
  const r = await helpSend(hRed(prompt), null, {model:'haiku'});
  if(r==null) return;
  try{
    const raw = extractJSON(hBack(r)); raw.events = [];
    const pr = normalize(raw, 'claude', HELP.thread.filter(m=>m.role==='user').map(m=>m.text).join(' '));
    if(!hasChanges(pr)) throw new Error(pr.summary || 'No changes to the plan came out of this session.');
    compose = freshCompose(); compose.focus = x.gone ? null : {course:c.id, id:x.t.id}; compose.provider = 'claude'; compose.proposal = pr;
    compose.thread = [{role:'user', text:'From the help session on "'+x.t.title+'"'}];
    HELP.min = true; HELP.note = 'Plan changes are waiting on Today.';
    renderHelp();
    chatOpen(true); render();   /* the preview opens in the planner chat window */
  }catch(e){ HELP.error = e.message; renderHelp(); }
}
async function helpApply(){
  const x = helpTask(); if(!x || !HELP.save) return; const {c,t} = x, s = HELP.save;
  if(!s.decision.trim()){ HELP.error = 'Write the decision in one line first.'; return renderHelp(); }
  c.decisions = c.decisions||[];
  const helps = (s.helps||[]).filter(h=>h.on).map(h=>({course:h.course, task:h.task})), drafts = s.drafts||[];
  c.decisions.push(Object.assign({id:'dc'+Date.now().toString(36), date:TODAY, task:t.id, did:t.did||'', text:s.decision.trim(), summary:s.summary.trim()}, drafts.length?{drafts}:{}, helps.length?{helps}:{}));
  helpForget(HELP.cid, HELP.tid);
  if(!x.gone){ t.note = (t.note ? String(t.note).trim()+' ' : '') + 'Decision: '+s.decision.trim(); }
  if(s.done && !x.gone){ setStatus(t, 'done'); const v = Number(s.spent); if(v>0) t.spent = Math.round(v*4)/4; }
  save(c);
  const log = '# '+t.title+'\n'+c.short+' · '+TODAY+'\n\n## Decision\n'+s.decision.trim()+'\n\n'+s.summary.trim()+'\n\n'+drafts.map(d=>'## '+d.title+'\n\n'+d.text+'\n\n').join('')+'## Session\n\n'+HELP.thread.map(m=>(m.role==='user'?'**Me:** ':'**Claude:** ')+m.text).join('\n\n')+'\n';
  APP.call('helpWrite', {name:c.short, sub:'Sessions', file:TODAY+' '+t.title.slice(0,60)+'.md', text:log}).catch(()=>{});
  HELP = null; renderHelp();
  /* A decision that changes direction goes to the main planner, which sees every open task, and its changes open
     in the usual preview on Today. Nothing changes until he accepts them. */
  if(s.changesPlan){
    compose = freshCompose();
    compose.prepared = true; compose.draft = 'Decision for '+c.short+' (from the help session on "'+t.title+'"): '+s.decision.trim()+'\n'+s.summary.trim()
      +'\nUpdate the open tasks this changes: rewrite titles and notes that follow the old direction, remove tasks it makes pointless, add work the new direction needs. Leave tasks it does not affect as they are.';
    chatOpen(true); render();
    runCompose();
  } else render();
}
async function helpAddContext(kind, items){
  const x = helpTask(); if(!x) return; const name = x.c.short, dest = x.c.folder||''; const names = [];
  try{
    if(kind==='pick'){ const r = await APP.call('helpAddFiles', {name, dest}); (r.added||[]).forEach(f=>names.push(f)); }
    else if(kind==='paths'){ const r = await APP.call('helpAddPaths', {name, dest, paths:items}); (r.added||[]).forEach(f=>names.push(f)); }
    else if(kind==='text'){ const file = 'Note '+TODAY+'.md'; await APP.call('helpWrite', {name, dest, file, text:items}); names.push(file); }
    else for(const f of items){
      const data = await new Promise((res,rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(String(fr.result).split(',')[1]||''); fr.onerror = ()=>rej(fr.error); fr.readAsDataURL(f); });
      await APP.call('helpWrite', {name, dest, file:f.name, data}); names.push(f.name);
    }
    if(!names.length) return;
    HELP.added = HELP.added.concat(names.map(n=>hRed(n,false)));
    const busy = HELP.busy; HELP.busy = true; await helpPrepare(); HELP.busy = busy;
    if(dest) flRefresh([x.c.id]).then(()=>{ if(typeof autoLink==='function') autoLink(); });
    HELP.note = 'Added '+names.length+' to '+name+'. Claude sees '+(names.length===1?'it':'them')+' from your next message.';
  }catch(e){ HELP.error = e.message; HELP.stage = ''; }
  renderHelp();
}
/* Scanned PDFs are read with OCR on this Mac in the background; when one is done, Claude gets it from the next message on. */
async function helpOcr(ev){
  if(!HELP || HELP.cid!==ev.course) return;
  HELP.ocr = HELP.ocr || {};
  if(ev.done){
    delete HELP.ocr[ev.name];
    if(ev.chars>200){ HELP.added.push(hRed(ev.name, false)); if(!HELP.busy){ HELP.busy = true; try{ await helpPrepare(); }catch(e){} HELP.busy = false; } else HELP.reprep = true; HELP.note = 'Text read from '+ev.name.replace(/\.[a-z0-9]+$/i,'')+'. Claude can use it from your next message.'; }
    renderHelp(); return;
  }
  HELP.ocr[ev.name] = ev.page+' of '+ev.pages;
  const el = document.getElementById('help-ocr'); if(el) el.textContent = helpOcrLine(); else renderHelp();
}
const helpOcrLine = () => { const o = HELP && HELP.ocr ? Object.entries(HELP.ocr) : []; return o.length ? 'Reading scanned PDFs on this Mac: '+o.map(([n,p])=>n.replace(/\.[a-z0-9]+$/i,'')+' page '+p).join(', ') : ''; };
/* Terminal: Claude Code in ~/Documents/Planner/<course>[/<project>], continuing the last conversation in that folder.
   The project picked last is remembered per course (localStorage termLast) and listed first. */
const termLast = () => { try{ return JSON.parse(lsGet('termLast')||'{}'); }catch(e){ return {}; } };
async function helpTermToggle(){
  if(HELP.term){ HELP.term = null; renderHelp(); return; }
  const cid = HELP.cid, dirs = HELP.folder ? await APP.call('listDirs', {path:HELP.folder}).catch(()=>({dirs:[]})) : {dirs:[]};
  if(!HELP || HELP.cid!==cid) return;
  HELP.term = {name:'', dirs:(dirs.dirs||[]).filter(d=>!['Sessions','Reading notes'].includes(d)), msg:''}; renderHelp();
}
function helpTermBlock(c){
  const last = termLast()[HELP.cid];
  const btn = (p,label) => '<button class="btn'+(p===last?' pri':'')+'" data-hp="termgo" data-proj="'+esc(p)+'">'+esc(label)+'</button>';
  const items = HELP.term.dirs.map(d=>[d,d]).concat([['', c.short+' folder']]).sort((a,b)=>(b[0]===last)-(a[0]===last));
  return '<div class="hdrop"><div class="plabel">Open Claude in Terminal</div><div class="crow">'
    + items.map(([p,l])=>btn(p,l)).join('') + '</div>'
    + '<div class="crow"><input id="help-termname" placeholder="New project name" value="'+esc(HELP.term.name||'')+'"><button class="btn" data-hp="termnew">New project</button></div>'
    + (HELP.term.msg?'<div class="hsrc muted">'+esc(HELP.term.msg)+'</div>':'') + '</div>';
}
async function helpTermOpen(proj){
  const x = helpTask(); if(!x) return; proj = String(proj||'').trim();
  try{
    const r = await APP.call('terminalOpen', {name:x.c.short, project:proj});
    proj = r.project || '';   // the folder name the app made (":" becomes "-")
    const all = termLast(); all[x.c.id] = proj; lsSet('termLast', JSON.stringify(all));
    if(!HELP || !HELP.term || HELP.cid!==x.c.id) return;
    if(proj && !HELP.term.dirs.includes(proj)) HELP.term.dirs.push(proj);
    HELP.term.name = '';
    HELP.term.msg = (r.resumed ? 'Continuing the last conversation in ' : 'New conversation in ') + (proj || x.c.short) + '.';
  }catch(e){ if(!HELP || !HELP.term) return; HELP.term.msg = e.message; }
  renderHelp();
}
function renderHelp(){
  let host = document.getElementById('help');
  if(!HELP){ if(host) host.remove(); return; }
  const x = helpTask(); if(!x){ HELP = null; if(host) host.remove(); return; }
  const {c,t} = x;
  if(host) host.classList.toggle('min', !!HELP.min);
  if(!host){ host = document.createElement('div'); host.id = 'help'; host.className = 'help'; host.setAttribute('role','dialog'); host.setAttribute('aria-label','Help with a task'); document.body.appendChild(host); }
  host.classList.toggle('min', !!HELP.min);
  if(HELP.min){ host.innerHTML = '<span>Help · <b>'+esc(t.title)+'</b>'+(HELP.note?' <span class="muted">· '+esc(HELP.note)+'</span>':'')+'</span><button class="btn" data-hp="max">Back to the session</button><button class="lnk" data-hp="close">Close</button>'; return; }
  const ae = document.activeElement, hadFocus = ae && ae.id==='help-text';
  let h = '<div class="hhead"><div><div class="plabel">Help · '+esc(c.short)+'</div><h2>'+esc(t.title)+'</h2></div><button class="lnk" data-hp="close">Close</button></div>';
  if(HELP.counts) h += '<div class="hsrc muted">Sources: planner'+(HELP.counts.courses.length>1?' · '+esc(HELP.counts.courses.join(', ')):'')+', '+HELP.counts.meetings+' meeting'+(HELP.counts.meetings===1?'':'s')+', '+HELP.counts.files+' file'+(HELP.counts.files===1?'':'s')+'</div>'
    +'<div class="hsrc muted" id="help-ocr">'+esc(helpOcrLine())+'</div>';
  h += '<div class="hdrop" id="help-drop">Drop files or text here to add them to '+esc(c.short)+'\'s folder · <button class="lnk" data-hp="pick">Add files</button>'+(HELP.folder?' · <button class="lnk" data-file="'+esc(HELP.folder)+'" data-reveal="1">Open folder</button> · <button class="lnk" data-hp="term" title="Work in Terminal with Claude Code in this course\'s folder or one of its projects. It continues the last conversation there.">Terminal</button>':'')+'</div>';
  if(HELP.term) h += helpTermBlock(c);
  if(x.gone) h += '<div class="hnote muted">This task was changed in the plan. Saving the result still adds it to '+esc(c.short)+'\'s decisions.</div>';
  if(HELP.note) h += '<div class="hnote muted">'+esc(HELP.note)+'</div>';
  const ear = (HELP.earlier||[]).map((e,i)=>'<div class="msg ma hearly"><div class="plabel">'+esc(e.from?'From “'+e.from+'”':'Earlier session')+' · '+esc(fmtShort(e.d.date))+'</div><b>'+esc(e.d.text)+'</b>'+(e.d.summary?'<div class="muted">'+esc(e.d.summary).replace(/\n/g,'<br>')+'</div>':'')
    +(e.d.drafts||[]).map((x,j)=>'<details class="fold"><summary>'+esc(x.title)+'</summary><div class="hdraft">'+esc(x.text).replace(/\n/g,'<br>')+'</div><button class="lnk" data-hp="copy" data-ci="'+i+'|'+j+'">Copy</button></details>').join('')+'</div>').join('');
  h += '<div class="hthread" id="help-thread">'+ear+HELP.thread.map(m=>'<div class="msg '+(m.role==='user'?'mu':'ma')+'">'+(m.role==='user'?esc(m.text):md(m.text))+'</div>').join('');
  if(HELP.stage) h += '<div class="muted">'+esc(HELP.stage)+'…</div>';
  else if(HELP.busy) h += '<div class="msg ma" id="help-stream">'+(HELP.stream ? md(hBack(HELP.stream)) : '<span class="muted">'+esc(HELP.tool||'Reading the sources')+'…</span>')+'</div>';
  h += '</div>';
  if(HELP.error) h += '<div class="tag warn">'+ICON.warn+esc(HELP.error)+'</div>';
  if(HELP.save){
    const s = HELP.save;
    h += '<div class="hsave"><div class="plabel">Save to '+esc(c.short)+'</div>'
      + '<label>Decision<input data-hs="decision" value="'+esc(s.decision)+'" placeholder="One line"></label>'
      + '<label>Summary<textarea data-hs="summary" rows="5">'+esc(s.summary)+'</textarea></label>'
      + (s.drafts||[]).map(d=>'<div class="hsrc muted">Keeps the draft “'+esc(d.title)+'”</div>').join('')
      + (s.changesPlan ? '<div class="hsrc muted">This changes the plan. After saving, the planner updates the tasks it affects and shows the changes on Today.</div>' : '')
      + '<label class="evchk"><input type="checkbox" data-hs="done"'+(s.done?' checked':'')+'> Mark the task done</label>'
      + (s.done && !x.gone?'<label class="spent">Took <input type="number" step="0.25" min="0" data-hs="spent" value="'+esc(s.spent)+'" placeholder="'+esc(t.est||'')+'"> h <span class="faint">empty = no time</span></label>':'')
      + '</div><div class="crow hsavebar">'
      + '<button class="btn pri" data-hp="apply">Save to course</button>'
      + '<button class="btn" data-hp="unsave">Back to the session</button></div>';
  } else {
    h += '<div class="hcmp"><textarea id="help-text" rows="3" placeholder="Answer, ask, or paste something"'+(HELP.stage?' disabled':'')+'>'+esc(HELP.draft)+'</textarea>'
      + '<div class="crow"><button class="btn pri" data-hp="send"'+(HELP.busy?' disabled':'')+'>Send</button><button class="btn" data-hp="sum"'+(HELP.busy||!HELP.thread.length?' disabled':'')+'>Save result</button><button class="btn" data-hp="plan"'+(HELP.busy||!HELP.thread.length?' disabled':'')+' title="Move, change, split or remove this task, or add follow-ups. You see the changes before anything is saved.">Change the plan</button><span class="hmodel"><button class="lnk'+(HELP.model!=='sonnet'?' on':'')+'" data-hp="haiku" title="Fast and cheap, the default">Haiku</button> · <button class="lnk'+(HELP.model==='sonnet'?' on':'')+'" data-hp="sonnet" title="For hard work such as research. Remembered for this course.">Sonnet</button>'+(HELP.usage?'<span class="htok">'+(HELP.usage.tokens>=1000?Math.round(HELP.usage.tokens/1000)+'k':HELP.usage.tokens)+' · $'+HELP.usage.cost.toFixed(2)+'</span>':'')+'</span></div></div>';
  }
  host.innerHTML = h;
  const th = document.getElementById('help-thread'); if(th) th.scrollTop = th.scrollHeight;
  if(hadFocus || (!HELP.busy && !HELP.save)){ const ta = document.getElementById('help-text'); if(ta && !ta.disabled){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
}
document.addEventListener('click', e=>{
  const hb = e.target.closest('[data-help]');
  if(hb){ e.preventDefault(); e.stopPropagation(); const [cid,tid] = hb.dataset.help.split('|'); openHelpPhone(cid, tid); return; }
  const b = e.target.closest('#help [data-hp]'); if(!b || !HELP) return;
  const a = b.dataset.hp;
  if(a==='close'){ if(HELP.busy && !confirm('Claude is still answering. Close anyway?')) return; HELP = null; renderHelp(); }
  else if(a==='send'){ const ta = document.getElementById('help-text'); helpTurn(ta && ta.value).then(()=>{}); }
  else if(a==='sum') helpSummarize();
  else if(a==='plan') helpPlan();
  else if(a==='max'){ HELP.min = false; HELP.note = ''; renderHelp(); }
  else if(a==='unsave'){ HELP.save = null; renderHelp(); }
  else if(a==='apply') helpApply();
  else if(a==='pick') helpAddContext('pick');
  else if(a==='term') helpTermToggle();
  else if(a==='termgo') helpTermOpen(b.dataset.proj||'');
  else if(a==='termnew'){ const el = document.getElementById('help-termname'), v = el ? el.value.trim() : ''; if(v) helpTermOpen(v); else { HELP.term.msg = 'Type a project name first.'; renderHelp(); } }
  else if(a==='haiku' || a==='sonnet') helpSetModel(a);
  else if(a==='copy'){ const [i,j] = b.dataset.ci.split('|').map(Number), e2 = HELP.earlier[i], dr = e2 && (e2.d.drafts||[])[j]; if(dr && navigator.clipboard) navigator.clipboard.writeText(dr.text).then(()=>{ b.textContent = 'Copied'; }).catch(()=>{}); }
}, true);
document.addEventListener('input', e=>{
  if(!HELP) return; const el = e.target;
  if(el.id==='help-text') HELP.draft = el.value;
  if(el.id==='help-termname' && HELP.term) HELP.term.name = el.value;
  if(el.dataset && el.dataset.hs && HELP.save){ const k = el.dataset.hs; HELP.save[k] = el.type==='checkbox' ? el.checked : el.value; if(k==='done') renderHelp(); }
});
document.addEventListener('change', e=>{ const el = e.target; if(HELP && HELP.save && el.dataset && el.dataset.hs==='done'){ HELP.save.done = el.checked; renderHelp(); } });
document.addEventListener('keydown', e=>{
  if(!HELP) return;
  if(e.target.id==='help-text' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); helpTurn(e.target.value); }
  else if(e.key==='Escape' && !HELP.busy && !HELP.save && !HELP.min && document.getElementById('help')){ HELP = null; renderHelp(); }
});
/* A file dropped on the window would replace the page; only the help drop area takes drops. */
document.addEventListener('dragover', e=>{ e.preventDefault(); const z = document.getElementById('help-drop'); if(z) z.classList.toggle('over', !!e.target.closest('#help-drop')); });
document.addEventListener('dragleave', e=>{ const z = document.getElementById('help-drop'); if(z && !e.relatedTarget) z.classList.remove('over'); });
document.addEventListener('drop', e=>{
  e.preventDefault(); const z = e.target.closest('#help-drop'); const zz = document.getElementById('help-drop'); if(zz) zz.classList.remove('over');
  if(!z || !HELP) return;
  const files = [...(e.dataTransfer.files||[])];
  if(files.length) helpAddContext('files', files);
  else { const txt = e.dataTransfer.getData('text/plain'); if(txt && txt.trim()) helpAddContext('text', txt.trim()); }
});
