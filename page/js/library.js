/* Library (27 Nov 2026, the user's request: a little library for the Mac, agreed in Figma as "M7 Library — shelf first").
   Mac only. The shelf is the page: every reading of every course as a spine, course by course in the courses' order, the book
   you are on facing you as a cover; ‹ › (or the arrow keys) flip one book, and the shelf wraps round at its ends. On the left a
   search (title, author or course) and the index by course: the course you are in is open, the others are one line.
   No scroll: the shelf takes the window's height, the index folds.
   What counts as a reading (code, no model): a PDF in a course folder (folderIndex, with its page count) of at least LIB_MIN
   pages, not named like slides, exercises or a syllabus (LIB_SKIP), in a course that has at least one reading you started or
   one linked to a reading task. Pages read and the last day come from reading time (readtime.js, READS); the title from
   Hardcover when the book is linked there, else from the file name. Read opens the reader where you stopped. */
const LIB = {idx:{}, at:0, key:'', loading:false, sel:'', open:'', q:''};
const LIB_MIN = 3;
const LIB_SKIP = /syllab|übung|uebung|exercise|worksheet|slides|folien|organisator|handout|präsentation|presentation|\bconcept\b/i;
const libKey = (cid, f) => cid+'|'+f;
const libDoc = (cid, f) => (typeof READS!=='undefined' && typeof rtId==='function') ? READS[rtId(cid+'|'+String(f).split('/').pop())] : null;

/* page counts of every PDF in each course folder: again after 5 minutes, or when the course folders change (the Planner
   folders of courses without a linked one are known only after the first refresh, calendar.js) */
const libFolders = () => courses.map(c=>c.id+'='+folderOf(c)).join('\n');
async function libLoad(){
  if(LIB.loading || !IN_APP) return; LIB.loading = true;
  const idx = {}, key = libFolders();
  for(const c of courses){ const f = folderOf(c); if(!f) continue;
    try{ const r = ((await APP.call('folderIndex', {folders:[f]}))||{}).folders || [];
      idx[c.id] = ((r[0]||{}).docs||[]).filter(d=>/\.pdf$/i.test(d.path) && !/^(Sessions|Reading notes)\//.test(d.path)).map(d=>({f:d.path, pages:+d.pages||0}));
    }catch(e){ idx[c.id] = []; } }
  LIB.idx = idx; LIB.at = Date.now(); LIB.key = key; LIB.loading = false;
  if(tab==='library') render();
}

/* "Author Name - A Title" → A Title by Author Name; "The-Title_-Its-Subtitle" → The Title; "SomeTitle (An Author)" → Some Title */
function libName(f){
  let s = String(f).split('/').pop().replace(/\.pdf$/i, '');
  let au = '';
  const par = s.match(/\(([^)]+)\)\s*$/); if(par){ au = par[1]; s = s.slice(0, par.index); }
  const dash = s.split(/\s+-\s+/); if(dash.length===2 && dash[0].split(/\s+/).length<=3){ au = au || dash[0]; s = dash[1]; }
  s = s.split(/_-|:|\s—\s/)[0];
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b[0-9a-f]{7,}\b/gi, '').replace(/\bv\.?\d+\b/gi, '').replace(/\s\d$/, '').replace(/\s+/g, ' ').trim();
  return {title: s || String(f).split('/').pop(), author: au.trim()};
}
function libTitle(cid, f){
  const d = libDoc(cid, f), hc = d && d.hc && d.hc.title;
  const n = libName(f);
  if(hc) return {title: hc.split(':')[0].replace(/["“”]/g, '').trim(), author: n.author};
  return n;
}

/* the readings, course by course: [{c, f, pages, read, last, sec, title, author}] */
function libBooks(){
  const linked = new Set();
  for(const c of courses) for(const t of (c.tasks||[])){ if(!(typeof READ_RE!=='undefined' && READ_RE.test(t.title||'')) && !t.pages) continue;
    (t.files||[]).forEach(f=>linked.add(libKey(c.id, f))); if(t.pages && t.pages.file) linked.add(libKey(c.id, t.pages.file)); }
  const out = [];
  for(const c of courses){
    const rows = (LIB.idx[c.id]||[]).filter(x=>(x.pages===0 || x.pages>=LIB_MIN) && !LIB_SKIP.test(x.f.split('/').pop())).map(x=>{
      const d = libDoc(c.id, x.f), ss = (d && d.sessions) || [];
      const read = typeof rtPagesRead==='function' ? rtPagesRead(d) : 0;
      return Object.assign({c, f:x.f, pages:x.pages, read, sec:ss.reduce((a,s)=>a+(s.sec||0),0), last:ss.reduce((a,s)=>s.d>a?s.d:a,''), linked:linked.has(libKey(c.id, x.f))}, libTitle(c.id, x.f)); });
    if(!rows.some(b=>b.read>0 || b.linked)) continue;
    rows.sort((a,b)=>a.f.localeCompare(b.f, undefined, {numeric:true, sensitivity:'base'}));
    const seen = new Set();   /* one book per file name in a course (the same PDF in two week folders; reading time is kept by name too) */
    out.push(...rows.filter(b=>{ const n = b.f.split('/').pop().toLowerCase(); if(seen.has(n)) return false; seen.add(n); return true; }));
  }
  return out;
}
const libMatch = (b, q) => { const s = (b.title+' '+b.author+' '+b.c.short+' '+(b.c.name||'')+' '+b.f).toLowerCase(); return q.toLowerCase().split(/\s+/).filter(Boolean).every(w=>s.includes(w)); };

function viewLibrary(){
  if(!IN_APP) return '<div class="empty">The library is on the Mac.</div>';
  if(!LIB.at || Date.now()-LIB.at > 300000 || LIB.key!==libFolders()) libLoad();
  const books = libBooks();
  if(!books.length) return '<div class="cvbar"><h1 class="cvtitle">Library</h1></div><div class="empty">'+(LIB.at ? 'No readings yet. PDFs in a course folder show here once you start one or a reading task links it.' : 'Looking through the course folders…')+'</div>';
  const keys = books.map(b=>libKey(b.c.id, b.f));
  if(!keys.includes(LIB.sel)){ const r = books.filter(b=>b.last).sort((a,b)=>b.last.localeCompare(a.last))[0] || books[0]; LIB.sel = libKey(r.c.id, r.f); }
  const cur = books[keys.indexOf(LIB.sel)];
  const q = LIB.q.trim(), hits = q ? books.filter(b=>libMatch(b, q)) : null;
  const open = q ? null : (LIB.open || cur.c.id);
  const pagesRead = books.reduce((s,b)=>s+b.read, 0);
  let side = '<label class="lb-q"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4"/></svg>'
    + '<input id="lb-q" type="search" placeholder="Title, author or course" value="'+esc(LIB.q)+'" autocomplete="off" aria-label="Search the library"><span class="mono">⌘F</span></label><div class="lb-ix">';
  const cs = []; books.forEach(b=>{ if(!cs.includes(b.c)) cs.push(b.c); });
  for(const c of cs){
    const all = books.filter(b=>b.c===c), list = hits ? all.filter(b=>hits.includes(b)) : all;
    if(hits && !list.length) continue;
    const isOpen = hits ? true : open===c.id;
    side += '<button class="lb-ch'+(isOpen?' on':'')+'" data-lbc="'+esc(c.id)+'" aria-expanded="'+isOpen+'"><span>'+(isOpen?'▾':'▸')+'&nbsp; '+esc(c.short)+'</span><span class="mono">'+all.filter(b=>b.read>0).length+' / '+all.length+'</span></button>';
    if(isOpen) side += '<div class="lb-cl">'+list.map(b=>{ const k = libKey(c.id, b.f); return '<button class="lb-row'+(k===LIB.sel?' sel':'')+(b.read>0?' st':'')+'" data-lb="'+esc(k)+'" title="'+esc(b.f)+'">'+esc(b.title)+'</button>'; }).join('')+'</div>';
  }
  if(hits && !hits.length) side += '<div class="empty" style="padding:10px 0">Nothing matches.</div>';
  side += '</div>';
  const i = keys.indexOf(LIB.sel), ofC = books.filter(b=>b.c===cur.c), n = ofC.indexOf(cur)+1;
  const when = cur.last ? (cur.last===TODAY ? 'last read today' : 'last read '+fmtShort(cur.last)) : 'not started';
  const main = '<div class="lb-shelf" id="lb-shelf" aria-label="Shelf"></div>'
    + '<div class="lb-under"><button class="lb-fl" data-lbmove="-1" aria-label="Previous book">‹</button>'
    + '<button class="btn pri lb-read" data-file="'+esc(fileRef(cur.c, cur.f))+'" data-ctx="'+esc(cur.c.id+'|')+'">Read</button>'
    + '<button class="lb-fl" data-lbmove="1" aria-label="Next book">›</button></div>'
    + '<div class="lb-line mono">'+esc(cur.c.short)+' · '+n+' of '+ofC.length+' · '+esc(when)+'</div>';
  LIB._books = books; LIB._i = i;
  return '<div class="cvbar"><h1 class="cvtitle">Library<small>'+books.length+' readings · '+pagesRead+' pages read</small></h1></div>'
    + '<div class="lb"><aside class="lb-side">'+side+'</aside><section class="lb-main">'+main+'</section></div>';
}

/* the shelf: drawn after render, from the space it has */
function libLayout(){
  libHold();
  const el = document.getElementById('lb-shelf'), books = LIB._books; if(!el || !books || !books.length) return;
  const W = el.clientWidth, H = Math.max(240, Math.min(460, window.innerHeight - el.getBoundingClientRect().top - 130));
  el.style.height = (H+44)+'px';
  const ci = LIB._i, N = books.length, CW = Math.min(300, Math.round(W*0.34)), cx = Math.round(W/2 - CW/2), gap = 4, cgap = 22;
  const widthAt = d => Math.max(10, 48 - d*3.5);
  const spans = new Map(); const mark = (c, a, z) => { const s = spans.get(c) || [1e9, -1e9]; spans.set(c, [Math.min(s[0], a), Math.max(s[1], z)]); };
  let h = '';
  const spine = (b, x, w) => { const k = libKey(b.c.id, b.f), cls = b.read>0 ? (b.pages && b.read>=b.pages ? ' done' : ' st') : '';
    h += '<button class="lb-sp'+cls+'" data-lb="'+esc(k)+'" style="left:'+x+'px;width:'+w+'px;height:'+H+'px" title="'+esc(b.title+(b.author?' · '+b.author:''))+'">'+(w>=16?'<span style="font-size:'+Math.min(12, w*0.3).toFixed(1)+'px">'+esc(b.title)+'</span>':'')+'</button>'; };
  const cur = books[ci];
  mark(cur.c, cx, cx+CW);
  let x = cx - gap;
  for(let d = 1; d < N; d++){ const b = books[(ci-d+N)%N], nb = books[(ci-d+1+N)%N]; if(b.c!==nb.c) x -= cgap; const w = widthAt(d); x -= w; if(x < 0) break; spine(b, x, w); mark(b.c, x, x+w); x -= gap; }
  x = cx + CW + gap;
  for(let d = 1; d < N; d++){ const b = books[(ci+d)%N], pb = books[(ci+d-1)%N]; if(b.c!==pb.c) x += cgap; const w = widthAt(d); if(x+w > W) break; spine(b, x, w); mark(b.c, x, x+w); x += w + gap; }
  const pct = cur.pages ? Math.max(cur.read ? 1.5 : 0, Math.min(100, cur.read/cur.pages*100)) : 0;
  h += '<div class="lb-cov" style="left:'+cx+'px;width:'+CW+'px;height:'+H+'px"><b>'+esc(cur.title)+'</b>'+(cur.author?'<span class="lb-au">'+esc(cur.author)+'</span>':'')
    + '<span class="lb-pg"><i><i style="width:'+pct.toFixed(1)+'%"></i></i><span class="mono">'+(cur.pages ? cur.read+' of '+cur.pages+' pages read' : cur.read+' pages read')+'</span></span></div>';
  const ends = [-1e9, -1e9];
  [...spans.entries()].map(([c,[a,z]])=>({c, a:Math.max(0,a), z:Math.min(W,z)})).sort((p,q)=>p.a-q.a).forEach(s=>{
    h += '<i class="lb-bd" style="left:'+s.a+'px;width:'+(s.z-s.a)+'px;top:'+H+'px"></i>';
    const row = ends[0] < s.a-8 ? 0 : (ends[1] < s.a-8 ? 1 : 0), lw = s.c.short.length*7 + 8; ends[row] = s.a + lw;
    h += '<button class="lb-cn mono'+(s.c===cur.c?' on':'')+'" data-lbc="'+esc(s.c.id)+'" style="left:'+s.a+'px;top:'+(H+10+row*16)+'px">'+esc(s.c.short)+'</button>'; });
  el.innerHTML = h;
}
window.addEventListener('resize', ()=>{ if(tab==='library') libLayout(); });
/* No scroll up or down on the Library (27 Nov 2026, the user's words: "Library should not be scrollable from up down, but left ro
   right should allow me to see different books"): the page is held still while the tab is open, and a sideways swipe or
   scroll flips the shelf, one book for every LIB_STEP pixels. The index on the left scrolls on its own when a course is long. */
const LIB_STEP = 48;
let libWheel = 0, libWheelT = 0;
function libHold(){ document.documentElement.classList.toggle('lib-on', typeof tab!=='undefined' && tab==='library' && !(typeof PHONE!=='undefined' && PHONE)); }
window.addEventListener('wheel', e=>{
  if(tab!=='library' || (typeof READ!=='undefined' && READ)) return;
  if(e.target.closest && e.target.closest('.lb-ix, #pchat-host, .pchat')) return;   /* the index and the chat window scroll as usual */
  const x = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
  e.preventDefault();                                                      /* nothing moves up or down */
  if(!x) return;
  if(Date.now() - libWheelT > 400) libWheel = 0;                           /* a new swipe starts from nothing */
  libWheelT = Date.now(); libWheel += x;
  const n = Math.trunc(libWheel / LIB_STEP);
  if(n){ libWheel -= n * LIB_STEP; libMove(Math.max(-3, Math.min(3, n))); }
}, {passive:false});

function libGo(k){ LIB.sel = k; const b = (LIB._books||[]).find(x=>libKey(x.c.id, x.f)===k); if(b && !LIB.q) LIB.open = b.c.id; render(); }
function libMove(d){ const bs = LIB._books||[]; if(!bs.length) return; const i = (LIB._i + d + bs.length) % bs.length; libGo(libKey(bs[i].c.id, bs[i].f)); }
document.addEventListener('click', e=>{
  if(tab!=='library') return;
  const m = e.target.closest('[data-lbmove]'); if(m){ e.preventDefault(); libMove(+m.dataset.lbmove); return; }
  const b = e.target.closest('[data-lb]'); if(b){ e.preventDefault(); libGo(b.dataset.lb); return; }
  const c = e.target.closest('[data-lbc]'); if(c){ e.preventDefault(); const cid = c.dataset.lbc, first = (LIB._books||[]).find(x=>x.c.id===cid);
    const shown = LIB.open ? LIB.open : (LIB.sel.split('|')[0]);
    if(c.classList.contains('lb-ch') && !LIB.q && shown===cid){ LIB.open = '-'; render(); return; }   /* the index heading folds its course */
    LIB.q = ''; LIB.open = cid; if(first && !LIB.sel.startsWith(cid+'|')) LIB.sel = libKey(cid, first.f); render(); }
});
document.addEventListener('input', e=>{
  if(e.target.id!=='lb-q') return;
  LIB.q = e.target.value;
  const hit = LIB.q.trim() && (LIB._books||[]).find(b=>libMatch(b, LIB.q.trim())); if(hit) LIB.sel = libKey(hit.c.id, hit.f);
  render();
});
document.addEventListener('keydown', e=>{
  if(tab!=='library' || e.ctrlKey || e.altKey) return;
  if(typeof READ!=='undefined' && READ) return;
  if(typeof HELP!=='undefined' && HELP) return;
  if(e.metaKey && e.key.toLowerCase()==='f'){ const q = document.getElementById('lb-q'); if(q){ e.preventDefault(); q.focus(); q.select(); } return; }
  if(e.metaKey) return;
  const inQ = e.target.id==='lb-q';
  if(inQ && e.key==='Escape'){ e.preventDefault(); LIB.q = ''; e.target.blur(); render(); return; }
  if(inQ && e.key==='Enter'){ e.preventDefault(); e.target.blur(); return; }
  if(e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
  if(e.key==='ArrowLeft'){ e.preventDefault(); libMove(-1); }
  else if(e.key==='ArrowRight'){ e.preventDefault(); libMove(1); }
  else if(e.key==='Enter'){ const r = document.querySelector('.lb-read'); if(r){ e.preventDefault(); r.click(); } }
});
