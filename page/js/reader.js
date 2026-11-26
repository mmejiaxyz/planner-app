/* PDF reader with a reading partner. Part of page/index_v2.html; classic script, loaded after help.js.
   The PDF is a native PDFView (main.swift, Reader) laid over #reader-pdf; underlines and highlights are saved into the file.
   The partner is Claude through the CLI (helpAsk with reading:true), in its own sandbox (help/Reader) that holds only this PDF:
   one redacted file per page and his marks. The page he is on and the passage he selected go with each message,
   so most answers need no tools. "Wrap up" writes reading notes into the course folder (Documents/Planner/<course>/Reading notes),
   where task help finds them later.
   On the iPhone (PHONE, since 21 Nov 2026): the PDF is a native PDFView in PhoneReader.swift, got from the Mac the first
   time ("phone:<course>|<file>", PFILES in sync.js). Marks are saved on the phone and sent to the Mac, which writes them
   into the real file. The partner is DeepSeek, called from the phone with his own key ("dsAsk"); it is stateless, so the
   conversation goes with each message (READ.msgs, the last RD_MSGS), and a document up to RD_WHOLE characters goes whole
   in the system message (same text every time, so DeepSeek's prefix cache keeps it cheap). Wrap up sends the notes to the
   Mac ("readNotes"), which saves them in the course's Reading notes folder. */
let READ = null;
const RD_KEEP_DAYS = 30, RD_PAGE_CHARS = 5000, RD_MSGS = 16, RD_WHOLE = 120000;
const phoneRef = path => { const s = String(path).replace(/^phone:/,''), i = s.indexOf('|'); return {cid:s.slice(0,i), file:s.slice(i+1)}; };
const rdStore = () => { try{ return JSON.parse(lsGet('readSessions')||'{}'); }catch(e){ return {}; } };
function rdKeep(){
  if(!READ) return; const all = rdStore(), from = addDays(TODAY,-RD_KEEP_DAYS);
  Object.keys(all).forEach(k=>{ if(!all[k].date || all[k].date<from) delete all[k]; });
  all[READ.path] = {session:READ.session, thread:READ.thread, map:READ.map, page:READ.page, date:TODAY, at:READ.lastAt||0, turns:READ.turns||0, usage:READ.usage||null, sent:[...READ.sent], cid:READ.cid||''};
  all[READ.path].anchor = READ.anchor||null; all[READ.path].topics = (READ.topics||[]).slice(-30);
  if(PHONE) all[READ.path].msgs = (READ.msgs||[]).slice(-RD_MSGS).map(m=>({role:m.role, content:String(m.content).slice(0,8000)}));
  lsSet('readSessions', JSON.stringify(all));
}
const rdRed = t => redact(t, {map:READ.map, terms:helpNames(), heuristics:false}).text;
const rdBack = t => restore(t, READ.map);
const rdCourse = () => READ && READ.cid ? cById(READ.cid) : null;
const rdName = () => READ ? READ.name.replace(/\.pdf$/i,'') : '';
/* Page references in answers, "(p. 12)" or "pp. 12–14", jump the PDF to that page. */
const rdLinks = html => html.replace(/\b(pp?\.)\s?(\d{1,4})(?:\s?[–-]\s?(\d{1,4}))?/g, (m,p,a,b)=>'<button class="lnk rpl" data-rp="'+a+'">'+m+'</button>');

async function openReader(path, ctx={}){
  if(!IN_APP && !PHONE) return;
  if(READ){ if(READ.path===path) return; await closeReader(true); if(READ) return; }
  const kept = rdStore()[path], from = addDays(TODAY,-RD_KEEP_DAYS);
  const ph = PHONE ? phoneRef(path) : null;
  const inFolder = ph ? cById(ph.cid) : courses.find(c=>folderOf(c) && path.startsWith(folderOf(c)+'/'));
  READ = {path, name:(ph ? ph.file : path).split('/').pop(), cid:ctx.cid || (inFolder&&inFolder.id) || (kept&&kept.cid) || '', tid:ctx.tid||'', page:1, pages:0, text:[], sel:null,
    thread:[], session:'', map:{}, sent:new Set(), model:lsGet('readModel')||'sonnet', busy:false, stream:null, tool:'', error:'', note:'', draft:'', wrap:null, marks:[], prepped:false, pen:!PHONE && lsGet('readPen')==='on', noting:null,
    phone:ph, msgs:[], ds:lsGet('readDs')||'chat', dsKey:true, hit:null, fetch:null,
    /* the Mac's book view (book.js) */
    mode:'text', book:null, bkState:null, hl:[], topics:[], panel:null, anchor:null, spread:0};
  if(!PHONE) READ.pen = false;   /* the highlighter pen is gone: the bubble highlights (reader redesign) */
  if(kept && kept.date>=from){ Object.assign(READ, {session:kept.session||'', thread:kept.thread||[], map:kept.map||{}, page:kept.page||1, lastAt:kept.at||0, turns:kept.turns||0, usage:kept.usage||null, sent:new Set(kept.sent||[]), msgs:kept.msgs||[], anchor:kept.anchor||null, topics:kept.topics||[]}); if(READ.thread.length) READ.note = 'Your session from '+fmtShort(kept.date)+' continues here.'; }
  /* opened from a reading sized from this book: start at its first page, unless the kept page is already inside it */
  const tk = ctx.cid && ctx.tid && ((cById(ctx.cid)||{}).tasks||[]).find(x=>x.id===ctx.tid);
  if(tk && tk.pages && path.endsWith('/'+tk.pages.file) && !(READ.page >= tk.pages.from && READ.page <= tk.pages.to)){ READ.page = tk.pages.from; READ.anchor = null; }
  rdSkeleton();
  if(ph){
    try{ READ.dsKey = !!(await APP.call('dsStatus')).key; }catch(e){}
    const x = (PFILES[ph.cid]||[]).find(y=>y.f===ph.file);
    /* only the text comes to the phone, never a PDF (27 Nov 2026, the user's rule: "I dont want to ever send the pdf to the
       phone, only text version"). A PDF copy from before stays readable here; nothing newer is fetched. */
    if(x && x.reading) return rdOpenText();
    if(!x || !x.cached){ rdFetch(); return; }
  }
  await rdOpenDoc();
}
async function rdOpenDoc(){
  if(!READ) return;
  const me = READ;
  try{
    const r = await APP.call('readerOpen', me.phone ? {cid:me.phone.cid, file:me.phone.file, rect:rdRect(), page:me.page} : {path:me.path, rect:rdRect(), page:me.page});
    if(READ!==me) return;
    Object.assign(READ, {pages:r.pages, page:r.page||1, title:r.title||'', fetch:null, newer:false, docOpen:true});
    if(READ.pen) APP.call('readerPen', {kind:'highlight'}).catch(()=>{});
    if(!PHONE) APP.call('readerPen', {kind:''}).catch(()=>{});
    await bkOpen(); if(READ!==me) return;
    rdRender();
    const t = await APP.call('readerPages');
    if(READ!==me) return;
    READ.text = t.pages||[]; READ.scanning = !!t.scanning;
    /* the phone: the whole text goes to DeepSeek when it is short enough and has text on (nearly) every page; scans are read page by page */
    if(PHONE){ const n = READ.text.join('').length, empty = READ.text.filter(x=>!String(x).trim()).length; READ.whole = n <= RD_WHOLE && n > 0 && empty <= Math.max(1, READ.pages/10); }
    if(t.scanning) READ.note = 'This PDF is a scan. Reading its pages on this Mac first (about 4 pages a second); you can read along meanwhile.';
    await rdMarks();
  }catch(e){ if(READ===me) READ.error = e.message; }
  rdRender();
}
/* the phone with only the text: the book reader without a PDF view; the original page is asked for when he opens it */
async function rdOpenText(){
  if(!READ || !READ.phone) return;
  const me = READ;
  try{
    await APP.call('readerOpenText', {cid:me.phone.cid, file:me.phone.file});
    if(READ!==me) return;
    READ.docOpen = false; READ.fetch = null;
    await bkOpen(); if(READ!==me) return;
    if(!READ.book){ rdFetch(); return; }
    READ.pages = READ.book.pages || 0; READ.text = bkPageTexts();
    const n = READ.text.join('').length, empty = READ.text.filter(x=>!String(x).trim()).length;
    READ.whole = n <= RD_WHOLE && n > 0 && empty <= Math.max(1, READ.pages/10);
    await rdMarks();
  }catch(e){ if(READ===me) READ.error = e.message; }
  rdRender();
}
/* the phone: ask the Mac for the text version (the Mac makes it first and sends it, never the PDF); it opens when it
   arrives (readerReading in book.js). A file the Mac cannot make text of is named in the plan snapshot (TEXTLESS). */
async function rdFetch(){
  if(!READ || !READ.phone) return;
  READ.fetch = {state:rdTextless() ? 'textless' : 'text', since:Date.now()}; READ.error = ''; rdRender();
  if(READ.fetch.state==='textless') return;
  const me = READ; setTimeout(()=>{ if(READ===me && READ.fetch) rdRender(); }, 121000);   /* shows Ask again after two minutes */
  try{ await APP.call('fileGet', {cid:READ.phone.cid, file:READ.phone.file}); }catch(e){ if(READ) READ.fetch = {state:'error', error:e.message}; }
  rdRender();
}
const rdTextless = () => !!(READ && READ.phone && typeof TEXTLESS!=='undefined' && TEXTLESS.has(READ.phone.cid+'/'+READ.phone.file));
function readerFileEvent(ev){
  if(!READ || !READ.phone || ev.key!==READ.phone.cid+'/'+READ.phone.file) return;
  if(READ.fetch && /^text/.test(READ.fetch.state||'')) return;   /* waiting for the text: PDF events no longer matter */
  if(READ.wantPage && !READ.fetch){   /* the original page asked for from the text */
    if(ev.ready){ READ.wantPage = false; READ.note = ''; rdOpenDoc().then(()=>{ if(READ && READ.book) bkMode('page'); }); }
    else if(ev.state==='error'){ READ.wantPage = false; READ.note = ev.error || 'The original page could not be got from the Mac.'; rdRender(); }
    else if(ev.state==='downloading'){ READ.note = 'Getting the original page from the Mac: '+Math.round(100*(ev.progress||0))+'%'; rdRender(); }
    return;
  }
  if(ev.ready){
    if(READ.fetch || !READ.pages){ READ.fetch = null; rdOpenDoc(); }
    else { READ.newer = true; READ.note = ''; rdRender(); }
    return;
  }
  if(READ.fetch || ev.state==='error'){ READ.fetch = {state:ev.state, progress:ev.progress, error:ev.error}; rdRender(); }
}
window.readerPick = async () => { const r = await APP.call('readerPick').catch(()=>({})); if(r && r.path) openReader(r.path); };
async function closeReader(quiet){
  if(!READ) return;
  if(!PHONE && READ.busy && !quiet && !confirm('Claude is still answering. Close anyway?')) return;
  if(!PHONE && READ.busy && quiet && !confirm('Claude is still answering. Open the other PDF anyway?')) return;
  if(READ.busy && PHONE) APP.call('dsStop', {sid:READ.sid}).catch(()=>{});
  if(typeof rtFlush==='function') rtFlush();   /* reading time (readtime.js) */
  rdKeep(); READ = null;
  if(PHONE) APP.call('readerQuiet', {on:false}).catch(()=>{});
  await APP.call('readerClose').catch(()=>{});
  const el = document.getElementById('reader'); if(el) el.remove();
}
function rdRect(){ const el = document.getElementById('reader-pdf'); if(!el) return {x:0,y:0,w:0,h:0}; const r = el.getBoundingClientRect(), v = PHONE && window.visualViewport;
  /* the phone: with the keyboard up the visual viewport moves; the native view goes where the box is on screen */
  return {x:r.left-(v?v.offsetLeft:0), y:r.top-(v?v.offsetTop:0), w:r.width, h:r.height}; }
let rdRO = null;
function rdSkeleton(){
  let host = document.getElementById('reader');
  if(!host){ host = document.createElement('div'); host.id = 'reader'; host.className = 'reader'; host.setAttribute('role','dialog'); host.setAttribute('aria-label','PDF reader'); document.body.appendChild(host); }
  bkSkeleton(host);
  if(rdRO) rdRO.disconnect();
  /* the Mac: the native PDF view is only on screen for the original page (the text is in the page) */
  rdRO = new ResizeObserver(()=>{ if(READ && READ.mode==='page' && READ.pages) APP.call('readerFrame', {rect:rdRect()}).catch(()=>{}); });
  rdRO.observe(document.getElementById('reader-pdf'));
  rdRender();
}
async function rdMarks(){ try{ READ.marks = (await APP.call('readerMarks')).marks||[]; }catch(e){} READ.prepped = false; }

/* ---------- sandbox and prompts ---------- */
async function rdPrepare(){
  const out = READ.text.map((t,i)=>({path:'pages/page '+String(i+1).padStart(3,'0')+'.txt', text:'[page '+(i+1)+' of '+READ.pages+']\n'+rdRed(t||'(no text on this page)')}));
  out.push({path:'marks.md', text:READ.marks.length ? '# Passages the student marked, and notes the student wrote\n'+READ.marks.map(m=>'- p. '+m.page+' ('+m.kind+'): '+rdRed(m.text)).join('\n') : 'No marks yet.'});
  await APP.call('helpSandbox', {course:'Reader', files:out});
  READ.prepped = true;
}
function rdOpening(){
  const c = rdCourse(), t = c && READ.tid ? (c.tasks||[]).find(x=>x.id===READ.tid) : null;
  return `You are my reading partner for this document: "${rdName()}"${READ.title && READ.title!==rdName() ? ' ('+READ.title+')' : ''}, ${READ.pages} pages${c ? ', for my course '+c.short+(c.name && c.name!==c.short ? ' ('+c.name+')' : '') : ''}.${t ? '\nI am reading it for this task: '+t.title+(t.note ? ' (note: '+t.note+')' : '') : ''}
Your job is to help me understand it well, like a good tutor who has read it closely:
- Explain ideas in plain words, with a short example when it helps. Then connect the passage to the document's larger argument.
- Point out key terms and how the author uses them, and the claims that the rest depends on.
- When I quiz myself or explain something back, tell me honestly what is right, what is missing and what is wrong.
- Stay on this document. Use general knowledge only to explain a concept, name or reference the text relies on, and mark it "Outside the text:". If I ask about something unrelated, say in one line that it is outside this document.
- Cite pages as (p. 12). Quote only words that are really in the pages; never invent quotes.
- Keep answers short: a few short paragraphs or bullets. At most one question back to me at a time.
${PHONE ? (READ.whole ? 'The whole document is below, page by page. The page I am on and any passage I selected come with each message.' : 'The text of the pages I am on comes with my messages, with any passage I selected. If a question needs pages you have not seen, say which ones.')
  : 'Files: pages/page 001.txt and so on, one per page; marks.md, passages I underlined or highlighted. The page I am on and any passage I selected come with each message, so usually you need no tools. Open other pages only when the question needs them: Grep first, then Read just those pages.'}`;
}
/* the phone: the system message for DeepSeek. The same text every time in a session, so its prefix cache holds it. */
function rdSystem(){
  let s = rdOpening();
  if(READ.marks.length) s += '\n\nPassages I marked and notes I wrote:\n'+READ.marks.slice(0,80).map(m=>'- p. '+m.page+' ('+m.kind+'): '+String(m.text).slice(0,300)).join('\n');
  if(!READ.msgs.length && READ.thread.length) s += '\n\n'+rdRecap();
  if(READ.whole) s += '\n\n--- The document ---\n'+READ.text.map((t,i)=>'[page '+(i+1)+']\n'+String(t||'').trim()).join('\n\n');
  return rdRed(s);
}
function rdRecap(){
  const cut = (t,n) => { t = String(t||'').trim(); return t.length>n ? t.slice(0,n)+' …' : t; };
  return READ.thread.length ? 'Earlier in this session (shortened):\n'+READ.thread.slice(-16).map(m=>(m.role==='user'?'Me: '+cut(m.text,300):'You: '+cut(m.text,600))).join('\n\n') : '';
}
/* The page he is on goes with a message once per session; later messages only name it. */
function rdContext(withSel){
  let s = '[I am on page '+READ.page+' of '+READ.pages+'.]';
  const pt = READ.text[READ.page-1]||'';
  if(pt.trim() && !READ.sent.has(READ.page) && !(PHONE && READ.whole)){ s += '\n[Text of page '+READ.page+':\n'+rdRed(pt.slice(0,RD_PAGE_CHARS))+']'; READ.sent.add(READ.page); }
  else if(!pt.trim()) s += READ.scanning ? ' [This page is still being read on this Mac; its text is not ready.]' : '';
  if(withSel && READ.sel && READ.sel.text) s += '\n[Passage I selected, p. '+READ.sel.page+': "'+rdRed(READ.sel.text)+'"]';
  return s;
}
/* A kept session older than an hour or past 12 replies is not resumed: a new one starts with a recap (as in task help). */
function rdFresh(){
  /* the phone: after an hour the conversation starts over, with a recap in the system message */
  if(PHONE){ if(READ.lastAt && Date.now()-READ.lastAt > HS_FRESH_MIN*60000 && READ.msgs.length){ READ.msgs = []; READ.sent = new Set(); } return; }
  if(READ.session && ((READ.lastAt && Date.now()-READ.lastAt > HS_FRESH_MIN*60000) || (READ.turns||0) >= HS_MAX_TURNS)){ READ.session = ''; READ.turns = 0; READ.recap = true; }
  if(!READ.session) READ.sent = new Set();
}
async function rdSend(prompt, shown){
  if(PHONE) return rdSendPhone(prompt, shown);
  if(!READ.session){ const rc = READ.recap ? rdRecap() : ''; READ.recap = false; prompt = rdRed(rdOpening()+(rc ? '\n\n'+rc : ''))+'\n\n'+prompt; }
  if(shown) READ.thread.push({role:'user', text:shown});
  READ.busy = true; READ.error = ''; READ.stream = ''; READ.tool = ''; const sid = 'r'+Date.now(); READ.sid = sid; rdRender();
  try{
    if(!READ.prepped) await rdPrepare();
    const r = await APP.call('helpAsk', {course:'Reader', prompt, session:READ.session, sid, model:READ.model, reading:true});
    if(!READ || READ.sid!==sid) return null;
    if(r.session) READ.session = r.session;
    READ.lastAt = Date.now(); READ.turns = (READ.turns||0)+1;
    const u = READ.usage = READ.usage || {tokens:0, cost:0}; u.tokens += r.tokens||0; u.cost += r.cost||0;
    READ.busy = false; READ.stream = null;
    if(r.stopped==='budget') READ.error = 'Stopped at the cost limit for one message. Ask about a smaller part.';
    return r.text||'';
  }catch(e){ if(READ && READ.sid===sid){ if(!READ.session) READ.sent = new Set(); READ.error = e.message; READ.busy = false; READ.stream = null; rdRender(); } return null; }
}
/* the phone: DeepSeek, with the conversation so far (its messages are kept as sent, page text included) */
async function rdSendPhone(prompt, shown){
  if(!READ.dsKey){ READ.error = 'Add your DeepSeek API key below first.'; rdRender(); return null; }
  if(shown) READ.thread.push({role:'user', text:shown});
  READ.busy = true; READ.error = ''; READ.stream = ''; READ.tool = ''; const sid = 'r'+Date.now(); READ.sid = sid; rdRender();
  try{
    if(READ.msgs.length > RD_MSGS){ READ.msgs = READ.msgs.slice(-RD_MSGS); READ.sent = new Set(); }
    const messages = [{role:'system', content:rdSystem()}].concat(READ.msgs, [{role:'user', content:prompt}]);
    const r = await APP.call('dsAsk', {messages, model:READ.ds, sid});
    if(!READ || READ.sid!==sid) return null;
    READ.busy = false; READ.stream = null;
    if(r.stopped==='cancel'){ rdRender(); return null; }
    READ.msgs.push({role:'user', content:prompt}, {role:'assistant', content:r.text||''});
    READ.lastAt = Date.now(); READ.turns = (READ.turns||0)+1;
    const u = READ.usage = READ.usage || {tokens:0, cost:0}; u.tokens += r.tokens||0;
    return r.text||'';
  }catch(e){ if(READ && READ.sid===sid){ READ.error = e.message; READ.busy = false; READ.stream = null; rdRender(); } return null; }
}
async function rdAsk(text, opts={}){
  text = String(text||'').trim(); if(!text || !READ || READ.busy) return;
  READ.draft = '';
  const useSel = opts.sel!==false && READ.sel && READ.sel.text;
  rdFresh();
  /* the phone: a scanned page is read on the phone when it is asked about */
  if(PHONE && READ.docOpen && !String(READ.text[READ.page-1]||'').trim()){ READ.tool = 'Reading the scanned page'; READ.busy = true; rdRender(); try{ READ.text[READ.page-1] = (await APP.call('readerOcr', {page:READ.page})).text||''; }catch(e){} if(!READ) return; READ.busy = false; READ.tool = ''; }
  const r = await rdSend(rdContext(useSel)+'\n\n'+rdRed(text), opts.shown || text);
  if(r!=null && READ){ READ.thread.push({role:'assistant', text:rdBack(r)}); if(useSel){ READ.sel = null; } rdKeep(); rdRender(); }
}
const RD_QUICK = {
  page: ['Explain this page', 'Explain the main point of this page in plain words, and how it fits the argument so far.'],
  sel:  ['Explain the selection', 'Explain the passage I selected: what it means, and why it matters here.'],
  ideas:['Key ideas so far', 'What are the key ideas up to this page? A short list, with pages.'],
  quiz: ['Quiz me', 'Quiz me on what I have read up to this page: one question at a time. Wait for my answer, then tell me what was right and what was missing.']
};
async function rdWrap(){
  if(!READ || READ.busy) return;
  await rdMarks();
  const marks = READ.marks.map(m=>'- p. '+m.page+' ('+m.kind+'): '+m.text).join('\n');
  rdFresh();
  const r = await rdSend(rdContext(false)+'\n\n'+rdRed(`We are done for now. Write my reading notes for this session in Markdown, in this order, no other text before or after:
## What it is about
Two or three lines on the document and its main argument (only as far as I have read).
## What I learned
4 to 8 bullets: the key ideas, each with its page, in my own words as much as possible.
## Concepts to remember
Each key term with its meaning in this text, one line each.
## Where I got stuck
What I asked about or got wrong, and how it was cleared up. Skip this heading if nothing.
## Questions to bring to class
Open questions this reading raises, 1 to 3.
## Check yourself
3 short questions to test myself later, no answers.
Base it on our conversation and on what I marked:
${marks || '(no marks)'}`), null);
  if(r==null || !READ) return;
  READ.wrap = {text:rdBack(r).trim(), cid:READ.cid, done:false};
  rdRender();
}
async function rdSaveNotes(){
  const w = READ && READ.wrap; if(!w) return;
  const c = cById(w.cid); if(!c){ READ.error = 'Pick the course these notes belong to.'; return rdRender(); }
  const marks = READ.marks.map(m=>'- p. '+m.page+(m.kind==='highlight'?' (highlight)':m.kind==='note'?' (my note)':'')+': '+m.text).join('\n');
  const text = '# '+rdName()+'\n'+c.short+' · '+TODAY+' · read up to p. '+READ.page+' of '+READ.pages+'\n\n'+w.text.trim()+'\n\n'
    +(marks ? '## My marks\n'+marks+'\n\n' : '')
    +'## Session\n\n'+READ.thread.map(m=>(m.role==='user'?'**Me:** ':'**Claude:** ')+m.text).join('\n\n')+'\n';
  if(PHONE){
    try{
      await APP.call('readNotes', {cid:c.id, name:rdName().slice(0,70)+' '+TODAY, text});
      const t = READ.tid ? (c.tasks||[]).find(x=>x.id===READ.tid) : null;
      if(w.done && t && t.status!=='done'){ setStatus(t, 'done'); save(c); render(); }
      READ.cid = c.id; READ.wrap = null; READ.note = 'Notes sent to the Mac. It saves them in Documents/Planner/'+c.short+'/Reading notes when Planner is open there.';
      rdKeep();
    }catch(e){ READ.error = e.message; }
    return rdRender();
  }
  try{
    const r = await APP.call('helpWrite', {name:c.short, sub:'Reading notes', file:rdName().slice(0,70)+' '+TODAY+'.md', text});
    const t = READ.tid ? (c.tasks||[]).find(x=>x.id===READ.tid) : null;
    if(w.done && t && t.status!=='done'){ setStatus(t, 'done'); save(c); render(); }
    READ.cid = c.id; READ.wrap = null; READ.note = 'Notes saved to '+(r.path||'Documents/Planner/'+c.short).replace(/^.*\/Documents\//,'Documents/')+'/Reading notes. Task help reads them too.';
    rdKeep();
  }catch(e){ READ.error = e.message; }
  rdRender();
}

/* ---------- notes: written here, saved into the PDF as sticky notes ---------- */
async function rdNoteStart(){
  if(!READ || READ.noting) return;
  const r = await APP.call('readerNoteStart').catch(()=>null); if(!r || !READ) return;
  READ.noting = {page:r.page||READ.page, quote:r.quote||'', text:'', focus:true}; READ.sel = null; rdRender();
}
async function rdNoteSave(){
  const n = READ && READ.noting; if(!n) return;
  if(n.ranges && n.ranges.length && READ.book && typeof bkNoteSave==='function') return bkNoteSave(n);   /* the text view */
  if(!n.text.trim()){ READ.noting = null; return rdRender(); }
  READ.noting = null;
  await APP.call('readerNoteAdd', {text:n.text}).catch(e=>{ READ.error = e.message; rdRender(); });
}

/* ---------- view: the book reader (book.js), on the Mac and the phone since 25 Nov 2026 ---------- */
function rdRender(){ if(READ) bkRender(); }
/* events from the app (routed from brain.js __appEvent; on the phone from sync.js) */
function readerEvent(ev){
  if(!READ) return;
  if(bkEvent(ev)) return;
  if(ev.type==='helpChunk'){
    if(READ.sid!==ev.sid) return; const s = String(ev.text||'');
    if(s[0]==='\u0001') READ.tool = {Grep:'Searching the PDF', Glob:'Looking at the pages', Read:'Reading a page', Think:'Thinking'}[s.slice(1)] || 'Working';
    else { READ.stream += s; READ.tool = ''; }
    const el = document.getElementById('reader-stream'); if(el) el.innerHTML = READ.stream ? bkLinks(md(rdBack(READ.stream))) : '<span class="muted">'+esc(READ.tool||'Reading')+'…</span>';
    const th = document.getElementById('reader-thread'); if(th) th.scrollTop = th.scrollHeight; return;
  }
  if(ev.type==='readerPage'){ READ.page = ev.page; const el = document.getElementById('reader-pg'); if(el) el.textContent = 'p. '+READ.page+' / '+READ.pages; clearTimeout(rdKeepTimer); rdKeepTimer = setTimeout(rdKeep, 1500); return; }
  if(ev.type==='readerSel'){ const had = !!(READ.sel && READ.sel.text); READ.sel = ev.text ? {text:ev.text, page:ev.page} : null; if(had || READ.sel) rdRender(); return; }
  if(ev.type==='readerNoteStart'){ rdNoteStart(); return; }
  if(ev.type==='readerMark'){ READ.hit = null; READ.note = ev.kind==='phone' ? 'Marks from your iPhone were added to this PDF (p. '+ev.page+').' : (ev.removed ? 'Mark removed.' : ({highlight:'Highlighted', note:'Note added', underline:'Underlined'}[ev.kind]||'Marked')+' on p. '+ev.page+'.')+(PHONE ? ' Saved on the phone; the Mac adds it to the PDF when Planner is open there.' : ' Saved in the PDF.'); READ.sel = null; rdMarks().then(rdRender); return; }
  if(ev.type==='readerHit'){ READ.hit = ev.page ? {page:ev.page, kind:ev.kind, text:ev.text} : null; rdRender(); return; }
  if(ev.type==='readerNote'){ READ.note = ev.text; rdRender(); return; }
  if(ev.type==='readerAsk'){ if(READ.sel && READ.sel.text) rdAsk(RD_QUICK.sel[1], {shown:RD_QUICK.sel[0]}); return; }
  if(ev.type==='readerOcr'){
    if(ev.done){ READ.ocr = ''; APP.call('readerPages').then(t=>{ if(!READ) return; READ.text = t.pages||[]; READ.scanning = false; READ.prepped = false; READ.note = 'All pages read. Claude can use the whole PDF now.'; rdRender(); }); return; }
    READ.ocr = 'page '+ev.page+' of '+ev.pages; const el = document.getElementById('reader-ocr'); if(el) el.textContent = 'Reading scanned pages on this Mac: '+READ.ocr; else rdRender();
  }
}
let rdKeepTimer = null;
document.addEventListener('click', e=>{
  const p = e.target.closest('#reader [data-rp]'); if(p && READ){ e.preventDefault(); if(READ.mode==='text' && READ.book){ if(PHONE && READ.panel) bkClosePanel(); bkGoPage(+p.dataset.rp); } else APP.call('readerGo', {page:+p.dataset.rp}).catch(()=>{}); return; }
  const q = e.target.closest('#reader [data-rq]'); if(q && READ){ const k = q.dataset.rq; rdAsk(RD_QUICK[k][1], {shown:RD_QUICK[k][0], sel:k==='sel'}); return; }
  const b = e.target.closest('#reader [data-rd]'); if(!b || !READ) return;
  const a = b.dataset.rd;
  if(a==='close') closeReader();
  else if(a==='send'){ const ta = document.getElementById('reader-text'); rdAsk(ta && ta.value); }
  else if(a==='underline' || a==='highlight') APP.call('readerMark', {kind:a}).catch(()=>{});
  else if(a==='pen'){ READ.pen = !READ.pen; lsSet('readPen', READ.pen?'on':''); APP.call('readerPen', {kind:READ.pen?'highlight':''}).catch(()=>{}); READ.note = READ.pen ? 'Highlighter on: select text in the PDF and it is highlighted.' : ''; rdRender(); }
  else if(a==='note') rdNoteStart();
  else if(a==='savenote') rdNoteSave();
  else if(a==='unnote'){ if(READ.panel==='note' && typeof bkClosePanel==='function') bkClosePanel(); else { READ.noting = null; rdRender(); } }
  else if(a==='preview') APP.call('readerPreview').catch(()=>{});
  else if(a==='wrap') rdWrap();
  else if(a==='unwrap'){ READ.wrap = null; rdRender(); }
  else if(a==='savenotes') rdSaveNotes();
  else if(a==='haiku' || a==='sonnet'){ READ.model = a; lsSet('readModel', a); rdRender(); }
  /* the phone */
  else if(a==='unmark') APP.call('readerUnmark').catch(()=>{});
  else if(a==='stop'){ APP.call('dsStop', {sid:READ.sid}).catch(()=>{}); }
  else if(a==='refetch') rdFetch();
  else if(a==='reload'){ READ.newer = false; rdOpenDoc(); }
  else if(a==='dschat' || a==='dsthink'){ READ.ds = a==='dsthink' ? 'think' : 'chat'; lsSet('readDs', READ.ds); rdRender(); }
  else if(a==='dskey'){ READ.keyForm = !READ.keyForm; rdRender(); }
  else if(a==='dssave' || a==='dsforget'){ const el = document.getElementById('reader-dskey'), v = a==='dsforget' ? '' : (el ? el.value.trim() : ''); if(a==='dssave' && !v){ READ.error = 'Paste the key first.'; return rdRender(); }
    APP.call('dsKey', {key:v}).then(r=>{ if(!READ) return; READ.dsKey = !!r.key; READ.keyForm = false; READ.error = ''; READ.note = r.key ? 'Key saved on this phone.' : 'Key removed.'; rdRender(); }).catch(err=>{ if(READ){ READ.error = err.message; rdRender(); } }); }
}, true);
document.addEventListener('input', e=>{
  if(!READ) return; const el = e.target;
  if(el.id==='reader-text') READ.draft = el.value;
  if(el.id==='reader-note' && READ.noting) READ.noting.text = el.value;
  if(el.dataset && el.dataset.rw && READ.wrap){ const k = el.dataset.rw; READ.wrap[k] = el.type==='checkbox' ? el.checked : el.value; if(k==='cid') READ.error = ''; }
});
document.addEventListener('change', e=>{ const el = e.target; if(READ && READ.wrap && el.dataset && el.dataset.rw){ const k = el.dataset.rw; READ.wrap[k] = el.type==='checkbox' ? el.checked : el.value; } });
document.addEventListener('keydown', e=>{ if(READ && e.target.id==='reader-note' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); rdNoteSave(); return; }
  if(READ && e.target.id==='reader-note' && e.key==='Escape'){ if(READ.panel==='note' && typeof bkClosePanel==='function') bkClosePanel(); else { READ.noting = null; rdRender(); } return; }
  if(READ && e.target.id==='reader-text' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); rdAsk(e.target.value); } });

/* the phone: the PDF gets smaller while he types, and the native view follows the box when the keyboard moves the page */
if(PHONE){
  const follow = () => { if(READ && READ.pages && READ.mode==='page') APP.call('readerFrame', {rect:rdRect()}).catch(()=>{}); };
  if(window.visualViewport){ visualViewport.addEventListener('resize', follow); visualViewport.addEventListener('scroll', follow); }
  document.addEventListener('focusin', e=>{ const r = document.getElementById('reader'); if(r && e.target.closest('#reader-side') && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)){ r.classList.add('typing'); setTimeout(follow, 50); } });
  document.addEventListener('focusout', ()=>{ const r = document.getElementById('reader'); if(r){ setTimeout(()=>{ if(!document.activeElement || !document.activeElement.closest('#reader-side')){ r.classList.remove('typing'); follow(); } }, 120); } });
}
