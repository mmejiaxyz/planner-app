/* Book-style reader on the Mac (reader redesign, agreed in Figma 25 Nov 2026: design/reader-redesign/HANDOFF.md, frames B1–B8).
   Part of page/index_v2.html; classic script, loaded after reader.js, which keeps the session, Claude, the sandbox, reading
   notes and the phone. This file is the Mac view:
   - Text mode: the PDF's reading version (made ahead of time by Docling on this Mac, Reading.swift + mac-app/reading/convert.py)
     as a two-page spread in Literata, flowing in CSS columns. The top bar and the pointer controls show only while the
     pointer moves; the footer keeps the chapter and "pages left today".
   - A selection that stops shows a bubble at it: Explain · Define · Highlight (E D H). Highlight becomes a real PDF
     annotation (readerMarkRects: each character keeps the rectangle of its line); marks already in the PDF, from Preview or
     the phone, are shown in the text (readerMarkList), underlines too.
   - Explain opens a 540 px panel on the right (one column then, the passage stays in view): a session with Claude through
     helpAsk (reader.js rdSend). Each Explain is a topic in the same session. Define is a small card at the word (Haiku).
   - ☰: contents, Original page (⌥P: the native PDF view, as before), Reading notes (⌥N: Wrap up), Open in Preview. Aa: size
     and theme. Find (⌘F).
   - A PDF without a reading version yet opens as the original page with a note, and switches to the text when it is ready.
   On the iPhone (handoff step 5, 25 Nov 2026; Figma frames 21–30) the same view, phone-sized: the text scrolls as an
   e-book in pages like Habla's reader (the user's request, 25 Nov 2026: "more like the one in habla, not an infinite scroll"): a
   tap on the right side or a swipe left turns forward, the left side back, the middle shows the top bar (× · title ·
   Text|Page · find · ☰ · Aa) and the footer; the bubble when a selection stops (iOS's own menu is off in the text:
   readerQuiet); Explain is a full-screen sheet on DeepSeek that a swipe left or × closes.
   Define is the dictionary everywhere, no AI (the user's choice, same day): the Mac's Dictionary.app text in the card
   (dictDefine), Apple's dictionary page on the phone (dictShow). The reading version comes from the Mac with the
   PDFs (readSends). On the original page Explain · Define · Highlight are in iOS's selection menu (PhoneReader.swift).
   Rules kept: square edges, P15 palette shades only; AI reads, code decides (the text, paragraphs and marks are code). */

const BK_SIZES = [17, 18, 20, 22, 24, 26];
const BK_PANEL = 540;
const BK_EXPLAIN = 'Explain the passage I selected in plain words: what it says, the terms that matter, and why it matters for the argument here. A few short paragraphs, key terms in bold, no heading.';
const BK_CHIPS = {
  simpler: ['Simpler', 'Explain that again more simply, as if I were new to the topic.'],
  example: ['An example', 'Give me one concrete example that makes this passage clear.'],
  quiz: ['Quiz me', 'Ask me one question to check that I understood this passage. Wait for my answer, then tell me what was right and what was missing.']
};
const BK_ICON = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 5l-7 7 7 7"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  menu: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  explain: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
  define: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>',
  pen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 20h16M14.5 4.5l5 5L9 20H4v-5z"/></svg>',
  unpen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 20h16M14.5 4.5l5 5L9 20H4v-5zM3 3l18 18"/></svg>',
  note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16v12H10l-6 5z"/><path d="M8 9h8M8 12h5"/></svg>',
  mark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h12v18l-6-5-6 5z"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9l6 6 6-6"/></svg>'
};
/* Themes & Settings (the user's reference: Apple Books, 25 Nov 2026), in the P15 shades with square edges.
   Each theme: page colours and its own font; a font he picks in Customize wins. Dark themes use the dark shades. */
const BK_FONTS = {
  literata:['Literata', "'Literata','Iowan Old Style',Georgia,serif"], charter:['Charter', "Charter,'Bitstream Charter',Georgia,serif"],
  iowan:['Iowan Old Style', "'Iowan Old Style',Georgia,serif"], newyork:['New York', "ui-serif,'New York',Georgia,serif"],
  georgia:['Georgia', 'Georgia,serif'], inter:['Inter', "'Inter',system-ui,-apple-system,sans-serif"]
};
const BK_THEMES = {
  original:{name:'Original', bg:'#FDFCF8', ink:'#1A1A1A', font:'literata'},
  quiet:   {name:'Quiet',    bg:'#3F3F3C', ink:'#C9C8C3', font:'literata', dark:true},
  paper:   {name:'Paper',    bg:'#F1F0EB', ink:'#1A1A1A', font:'charter'},
  bold:    {name:'Bold',     bg:'#FDFCF8', ink:'#1A1A1A', font:'inter', bold:true},
  calm:    {name:'Calm',     bg:'#F4EFFA', ink:'#3F3F3C', font:'iowan'},
  focus:   {name:'Focus',    bg:'#FAF8F2', ink:'#1A1A1A', font:'inter'}
};
const BK_DEF = {size:PHONE ? 19 : 20, theme:'original', auto:true, font:'', bold:false, custom:false, lh:1.6, ls:0, ws:0, mg:0, cols:'auto', justify:false};
function bkPref(){
  let p = {}; try{ p = JSON.parse(lsGet('bkStyle')||'{}') || {}; }catch(e){}
  if(!p.size && BK_SIZES.includes(+lsGet('bkSize'))) p.size = +lsGet('bkSize');
  p = Object.assign({}, BK_DEF, p);
  if(!BK_THEMES[p.theme]) p.theme = 'original';
  return p;
}
const bkBoldOn = p => p.boldSet ? !!p.bold : !!BK_THEMES[p.theme].bold;   /* the theme's weight unless he set it */
function bkSetPref(ch){ lsSet('bkStyle', JSON.stringify(Object.assign(bkPref(), ch))); }
const bkNight = () => document.documentElement.classList.contains('dark');   /* the app's light / dark (header toggle, else the Mac) */

/* ---------- the reading version ---------- */
async function bkOpen(){
  const me = READ;
  let r;
  try{ r = await APP.call('readingGet', me.phone ? {cid:me.phone.cid, file:me.phone.file} : {path:me.path}); }catch(e){ r = {ready:false, state:'failed', error:e.message}; }
  if(READ!==me) return;
  if(r.ready){
    try{ bkLoad(r.data); }catch(e){ READ.book = null; READ.bkState = {state:'failed', error:'The reading version could not be read.'}; }
  } else { READ.book = null; READ.bkState = r; }
  if(READ.book){ await bkMarks(); bkMode('text'); }
  else { READ.autoText = true; bkMode('page'); }
}
function bkLoad(text){
  const d = JSON.parse(text);
  d.byPage = {};
  d.blocks.forEach((b,i)=>{
    b.i = i; b.t = b.t || '';
    b.L = [];
    (b.r||[]).forEach(r=>{ (r.ln||[]).forEach(l=>b.L.push({o:l[0], x0:l[1], y0:l[2], x1:l[3], y1:l[4], pg:r.pg})); (d.byPage[r.pg] = d.byPage[r.pg] || []).push(i); });
    b.L.sort((a,c)=>a.o-c.o);
  });
  Object.keys(d.byPage).forEach(k=>{ d.byPage[k] = [...new Set(d.byPage[k])]; });
  READ.book = d; READ.bkState = null;
  READ.hl = READ.hl || []; READ.topics = READ.topics || [];
}
/* the text of each PDF page from the reading version (the phone's reading partner, when the PDF is not on the phone) */
function bkPageTexts(){
  const d = READ.book, out = Array(d.pages||0).fill('');
  d.blocks.forEach(b=>{
    if(b.k==='fig') return;
    const rs = (b.r||[]).slice().sort((a,c)=>a.o-c.o);
    rs.forEach((r,j)=>{ const t = b.t.slice(r.o, j+1<rs.length ? rs[j+1].o : b.t.length); if(r.pg>=1 && r.pg<=out.length) out[r.pg-1] += (out[r.pg-1] ? '\n\n' : '')+t; });
  });
  return out;
}
const bkLabel = pg => { const b = READ && READ.book; return (b && b.labels && b.labels[String(pg)]) || String(pg); };
/* the page a place in the text is on: the run of the block that holds it */
function bkPageOf(b, o){
  const blk = READ.book.blocks[b]; if(!blk || !blk.r || !blk.r.length) return READ.page;
  let pg = blk.r[0].pg; for(const r of blk.r){ if(r.o <= o) pg = r.pg; } return pg;
}
/* the first place in the text on a PDF page (or the nearest page after it that has text) */
function bkPlaceOfPage(pg){
  const d = READ.book;
  for(let p = pg; p <= d.pages; p++){
    const ids = d.byPage[p]; if(!ids || !ids.length) continue;
    const b = d.blocks[ids[0]], r = (b.r||[]).find(x=>x.pg===p);
    return {b:ids[0], o:r ? r.o : 0};
  }
  return {b:0, o:0};
}
/* Marks in the PDF shown in the text: each mark rect is matched to the lines it covers, then snapped to whole words. */
async function bkMarks(){
  if(!READ || !READ.book) return;
  let list = [];
  try{ list = (await APP.call('readerMarkList', {sizes:READ.book.sizes})).marks || []; }catch(e){ return; }
  const out = [];
  list.forEach(m=>{ (m.rects||[]).forEach(r=>bkRectToRanges(m.page, r).forEach(x=>out.push(Object.assign(x, {kind:m.kind, name:m.name, pg:m.page, rects:m.rects, text:m.kind==='note' ? m.text||'' : undefined})))); });
  READ.hl = bkMerge(out);
}
function bkRectToRanges(pg, r){
  const d = READ.book, out = [];
  (d.byPage[pg]||[]).forEach(bi=>{
    const b = d.blocks[bi];
    b.L.forEach((l,j)=>{
      if(l.pg!==pg) return;
      const ov = Math.min(l.y1, r[3]) - Math.max(l.y0, r[1]);
      if(ov < 0.5*Math.min(l.y1-l.y0, r[3]-r[1])) return;
      const x0 = Math.max(l.x0, r[0]), x1 = Math.min(l.x1, r[2]); if(x1 - x0 < 2) return;
      const le = j+1 < b.L.length ? b.L[j+1].o : b.t.length, len = le - l.o, w = (l.x1 - l.x0) || 1;
      let s = l.o + Math.round((x0 - l.x0)/w*len), e = l.o + Math.round((x1 - l.x0)/w*len);
      s = Math.max(l.o, Math.min(s, le)); e = Math.max(s, Math.min(e, le));
      while(s > 0 && /\S/.test(b.t[s-1])) s--;   /* whole words, also a word joined across the line end */
      while(e < b.t.length && /\S/.test(b.t[e])) e++;
      while(s < e && /\s/.test(b.t[s])) s++;
      while(e > s && /\s/.test(b.t[e-1])) e--;
      if(e > s) out.push({b:bi, s, e});
    });
  });
  return out;
}
function bkMerge(list){
  list.sort((a,c)=>(a.kind+a.name).localeCompare(c.kind+c.name) || a.b-c.b || a.s-c.s);
  const out = [];
  list.forEach(x=>{ const p = out[out.length-1];
    if(p && p.b===x.b && p.kind===x.kind && p.name===x.name && x.s <= p.e+2){ p.e = Math.max(p.e, x.e); }
    else out.push(Object.assign({}, x)); });
  return out;
}
/* rects of a text range, per page, in the reading version's page space (for the PDF annotation) */
function bkRects(ranges){
  const by = {};
  ranges.forEach(({b, s, e})=>{
    const blk = READ.book.blocks[b];
    blk.L.forEach((l,j)=>{
      const le = j+1 < blk.L.length ? blk.L[j+1].o : blk.t.length, a = Math.max(s, l.o), z = Math.min(e, le);
      if(z <= a) return;
      const len = (le - l.o) || 1, w = l.x1 - l.x0;
      (by[l.pg] = by[l.pg] || []).push([l.x0 + w*(a-l.o)/len, l.y0, l.x0 + w*(z-l.o)/len, l.y1]);
    });
  });
  return by;
}

/* ---------- view ---------- */
function bkSkeleton(host){
  host.className = 'reader bk';
  host.innerHTML = '<div class="bk-top" id="bk-top"></div>'
    + '<div class="bk-view" id="bk-view"><div class="bk-flow" id="bk-flow"></div></div>'
    + '<div class="rpdf bk-pdf" id="reader-pdf"></div>'
    + '<aside class="bk-side" id="reader-side"></aside>'
    + '<div class="bk-foot" id="bk-foot"></div>'
    + '<div class="bk-pops" id="bk-pops"></div>';
  bkApplyPref();
}
function bkApplyPref(){
  const host = document.getElementById('reader'); if(!host) return;
  const p = bkPref(), t = BK_THEMES[p.theme], night = p.auto && bkNight() && !t.dark;
  const font = BK_FONTS[p.font] || BK_FONTS[t.font];
  host.style.setProperty('--bk-size', p.size+'px');
  host.style.setProperty('--bk-font', font[1]);
  host.style.setProperty('--bk-weight', bkBoldOn(p) ? '600' : '400');
  host.style.setProperty('--bk-lh', String(p.custom ? p.lh : 1.6));
  host.style.setProperty('--bk-ls', (p.custom ? p.ls/100 : 0)+'em');
  host.style.setProperty('--bk-ws', (p.custom ? p.ws/100 : 0)+'em');
  host.classList.toggle('bk-just', !!p.justify);
  host.classList.toggle('bk-dark', !!(t.dark || night)); host.classList.toggle('bk-light', !(t.dark || night));
  Object.keys(BK_THEMES).forEach(k=>host.classList.toggle('bkt-'+k, k===p.theme && !night));
}
/* a change to the text's look: same place in the text afterwards */
function bkRestyle(ch){
  if(ch) bkSetPref(ch);
  const a = READ && READ.anchor; bkApplyPref();
  if(READ && READ.mode==='text' && READ.book){ bkLayout(); if(a) bkGo(a, true); }
  bkPops();
}
if(window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ if(READ && !PHONE) bkApplyPref(); });
document.addEventListener('themechange', ()=>{ if(READ && !PHONE) bkApplyPref(); });
/* chrome: top bar, footer, side panel, popovers. The text itself only changes in bkFlow. */
function bkRender(){
  if(!READ) return;
  const host = document.getElementById('reader'); if(!host) return;
  host.classList.toggle('bk-page', READ.mode==='page');
  host.classList.toggle('bk-panel', !!READ.panel);
  host.classList.toggle('ui', READ.mode==='page' || !!READ.pop || !!READ.find || host.classList.contains('ui'));
  host.classList.toggle('bk-phone', !!PHONE);
  host.classList.toggle('bk-fetch', !!READ.fetch);
  if(READ.fetch){ const v = document.getElementById('bk-flow'), f = READ.fetch; if(v) v.innerHTML = '<div class="bk-wait">'+(f.state==='downloading' ? 'Getting the PDF from the Mac: '+Math.round(100*(f.progress||0))+'%'
      : f.state==='error' ? esc(f.error||'Could not get the PDF.')+'<div class="crow"><button class="btn pri" data-rd="refetch">Try again</button></div>'
      : 'This PDF is not on the phone yet. The Mac sends every course PDF whenever Planner is open there; this one is now first in line, and it opens here as soon as it arrives.'+(f.state==='late' ? '<div class="crow"><button class="btn" data-rd="refetch">Ask again</button></div>' : ''))+'</div>'; }
  const top = document.getElementById('bk-top');
  if(top) top.innerHTML = '<button class="bk-ib" data-bk="close" title="Back to the planner" aria-label="Close">'+(PHONE ? BK_ICON.close : BK_ICON.back)+'</button>'
    + '<div class="bk-title">'+esc(READ.title || rdName())+'</div>'
    + (PHONE && READ.book ? '<span class="bk-tp" role="group" aria-label="View"><button class="'+(READ.mode==='text'?'on':'')+'" data-bk="'+(READ.mode==='text'?'':'toggle')+'">Text</button><button class="'+(READ.mode==='page'?'on':'')+'" data-bk="'+(READ.mode==='page'?'':'toggle')+'">Page</button></span>' : '')
    + '<span class="bk-tools"><button class="bk-ib'+(READ.panel==='explain'?' on':'')+'" data-bk="reexplain" title="'+((READ.topics||[]).length || (READ.thread||[]).length ? 'Back to Explain (E): your session, nothing is sent' : 'Explain (E): ask about this text')+'">'+BK_ICON.explain+'</button>'+(READ.mode==='text' ? '<button class="bk-ib'+(READ.find?' on':'')+'" data-bk="find" title="Find (⌘F)">'+BK_ICON.search+'</button>' : '')
    + '<button class="bk-ib'+(READ.pop==='menu'?' on':'')+'" data-bk="menu" title="Contents and more">'+BK_ICON.menu+'</button>'
    + '<button class="bk-ib bk-aa'+(READ.pop==='aa'?' on':'')+'" data-bk="aa" title="Text size and theme">Aa</button></span>';
  bkFoot(); bkPanel(); bkPops();
}
function bkFoot(){
  const f = document.getElementById('bk-foot'); if(!f || !READ) return;
  let l = '', c = '', r = '';
  if(PHONE){
    const pl = READ.book ? bkLabel(READ.page) : String(READ.page);
    l = '<span class="mono">p. '+esc(pl)+(READ.mode==='page' ? ' · original page' : '')+'</span>';
    r = '<span class="mono">'+esc(bkLeft().replace(/^p\. .*/, ''))+'</span>';
    if(READ.mode==='page' && !READ.book && READ.bkState) r = '<span class="bk-sm">'+esc(bkStateLine())+'</span>';
    if(READ.mode==='page' && READ.hit) c = '<button class="lnk" data-rd="unmark">Remove this '+esc(READ.hit.kind||'mark')+'</button>';
    if(READ.newer) c = '<button class="lnk" data-rd="reload">A newer copy is here · open it</button>';
    f.innerHTML = '<div class="bk-prog"><i style="width:'+Math.round(100*READ.page/Math.max(1, READ.pages||1))+'%"></i></div><div class="bk-frow"><span class="bk-fl">'+l+'</span><span class="bk-fc">'+c+(!c && READ.note ? '<span class="bk-note">'+esc(READ.note)+'</span>' : '')+'</span><span class="bk-fr">'+r+'</span></div><div class="bk-fpg mono">'+esc(pl)+'</div>'
      ;
    if(READ.note){ clearTimeout(bkFoot.t); bkFoot.t = setTimeout(()=>{ if(READ && READ.note){ READ.note = ''; bkFoot(); } }, 6000); }
    bkFootRoom();
    return;
  }
  if(READ.mode==='text' && READ.book){
    const ch = bkChapter();
    l = esc(ch ? ch + ' · ' + (READ.title || rdName()) : (READ.title || rdName()));
    r = esc(bkLeft());
  } else {
    l = 'Original page · p. '+esc(READ.book ? bkLabel(READ.page) : String(READ.page))+(READ.pages ? ' <span class="faint">of '+READ.pages+'</span>' : '');
    r = READ.book ? '<button class="lnk" data-bk="text">Text <i>⌥P</i></button>' : esc(bkStateLine());
  }
  if(!c && READ.note) c = '<span class="bk-note">'+esc(READ.note)+'</span>';
  if(!c && READ.error && !READ.panel) c = '<span class="bk-note warn">'+esc(READ.error)+'</span>';
  f.innerHTML = '<span class="bk-fl">'+l+'</span><span class="bk-fc">'+c+'</span><span class="bk-fr">'+r+'</span>';
  if(READ.note){ clearTimeout(bkFoot.t); bkFoot.t = setTimeout(()=>{ if(READ && READ.note){ READ.note = ''; bkFoot(); } }, 6000); }
}
function bkFootRoom(){
  const f = document.getElementById('bk-foot'), pdf = document.getElementById('reader-pdf'); if(!f || !pdf) return;
  pdf.style.bottom = READ && READ.mode==='page' ? f.offsetHeight+'px' : '';
}
function bkStateLine(){
  const s = READ.bkState || {};
  if(s.state==='working') return 'Making the reading version'+(s.secs ? ' · '+s.secs+' s' : '')+' · the text opens here when it is ready';
  if(s.state==='queued') return 'Reading version next in line'+(s.ahead ? ' ('+s.ahead+' ahead)' : '');
  if(s.state==='missing') return 'Text mode needs Docling: uv tool install "docling[ocrmac]"';
  if(s.state==='phone') return 'The text version comes from the Mac with the next sync';
  if(s.state==='failed') return 'No reading version'+(s.error ? ': '+s.error : '');
  return '';
}
function bkChapter(){
  const d = READ.book, a = READ.anchor || {b:0}; let name = '';
  for(let i = Math.min(a.b, d.blocks.length-1); i >= 0; i--){ const b = d.blocks[i]; if(b.k==='chap' || b.k==='h'){ name = b.t.trim(); break; } }
  return name.length > 48 ? name.slice(0,46)+'…' : name;
}
/* "16 pages left today": the reading planned for today (a task with pages), else the printed page */
function bkLeft(){
  const c = rdCourse(), t = c && READ.tid ? (c.tasks||[]).find(x=>x.id===READ.tid) : null;
  if(t && t.pages && READ.path.endsWith('/'+t.pages.file) && t.status!=='done'){
    const n = t.pages.to - READ.page + 1;
    return n > 0 ? n+' page'+(n===1?'':'s')+' left today' : 'Today’s pages are read';
  }
  return 'p. '+bkLabel(READ.page);
}

/* the text, block by block; marks, Explain passages and find hits are spans over ranges */
function bkFlow(){
  const flow = document.getElementById('bk-flow'); if(!flow || !READ || !READ.book) return;
  flow.innerHTML = READ.book.blocks.map(bkBlockHTML).join('');
  bkLayout();
}
function bkRanges(bi){
  const out = [];
  (READ.hl||[]).forEach(m=>{ if(m.b===bi) out.push({s:m.s, e:m.e, cls:m.kind==='underline' ? 'ul' : m.kind==='note' ? 'hl nt' : 'hl', name:m.name, tip:m.kind==='note' ? m.text||'' : ''}); });
  (READ.topics||[]).forEach((t,ti)=>{ (t.ranges||[]).forEach(r=>{ if(r.b===bi) out.push({s:r.s, e:r.e, cls: ti===READ.topics.length-1 && READ.panel==='explain' ? 'tp cur' : 'tp'}); }); });
  if(READ.find) READ.find.hits.forEach((h,hi)=>{ if(h.b===bi) out.push({s:h.s, e:h.e, cls: hi===READ.find.i ? 'fh cur' : 'fh'}); });
  return out;
}
function bkBlockHTML(b){
  if(b.k==='fig'){
    const pg = b.r && b.r[0] ? b.r[0].pg : 1;
    return '<figure class="bk-fig" data-b="'+b.i+'"><button class="lnk" data-bk="orig" data-pg="'+pg+'">Figure on p. '+esc(bkLabel(pg))+' · show the original page</button>'+(b.t ? '<figcaption>'+esc(b.t)+'</figcaption>' : '')+'</figure>';
  }
  const t = b.t, rs = bkRanges(b.i), fn = b.fn || [];
  const cuts = new Set([0, t.length]);
  rs.forEach(r=>{ cuts.add(r.s); cuts.add(r.e); }); fn.forEach(f=>{ cuts.add(f[0]); cuts.add(f[0]+f[1]); });
  const pts = [...cuts].filter(x=>x>=0 && x<=t.length).sort((a,c)=>a-c);
  let h = '';
  for(let i = 0; i < pts.length-1; i++){
    const a = pts[i], z = pts[i+1]; if(z <= a) continue;
    const seg = esc(t.slice(a, z)), cls = [...new Set(rs.filter(r=>r.s<=a && r.e>=z).map(r=>r.cls))].join(' ');
    const f = fn.find(x=>x[0]<=a && x[0]+x[1]>=z);
    const tip = rs.find(r=>r.tip && r.s<=a && r.e>=z);   /* a note: its text on hover */
    let piece = cls ? '<span class="'+cls+'"'+(tip ? ' title="'+esc(tip.tip)+'"' : '')+'>'+seg+'</span>' : seg;
    if(f) piece = '<sup class="bk-fn" data-fn="'+f[2]+'" title="Footnote">'+piece+'</sup>';
    h += piece;
  }
  const lower = /^[a-zà-ÿ“"‘'(…\[]/.test(t);
  if(b.k==='chap') return '<div class="bk-chap" data-b="'+b.i+'">'+h+'</div>';
  if(b.k==='h') return '<h3 class="bk-h" data-b="'+b.i+'">'+h+'</h3>';
  if(b.k==='q') return '<blockquote class="bk-q" data-b="'+b.i+'">'+h+'</blockquote>';
  if(b.k==='li') return '<p class="bk-li" data-b="'+b.i+'">'+h+'</p>';
  return '<p class="bk-p'+(lower ? ' cont' : '')+'" data-b="'+b.i+'">'+h+'</p>';
}
function bkReblock(ids){
  [...new Set(ids)].forEach(i=>{ const el = document.querySelector('#bk-flow [data-b="'+i+'"]'); if(el && READ.book.blocks[i]) el.outerHTML = bkBlockHTML(READ.book.blocks[i]); });
}

/* Columns: two pages side by side (one with the Explain panel open or in a narrow window); a spread is one step to the left. */
function bkLayout(){
  const view = document.getElementById('bk-view'), flow = document.getElementById('bk-flow'), host = document.getElementById('reader');
  if(!view || !flow || !host || !READ) return;
  if(PHONE){   /* one page, Habla's margins */
    const W = host.clientWidth, H = host.clientHeight, side = 26, gap = 52, top = 34, bottom = 44;
    const viewW = W - 2*side;
    Object.assign(view.style, {left:side+'px', width:viewW+'px', top:top+'px', height:Math.max(200, H-top-bottom)+'px'});
    flow.style.columnCount = 1; flow.style.columnGap = gap+'px';
    READ.bkStep = viewW + gap; READ.bkTwo = false;
    READ.bkSpreads = Math.max(1, Math.ceil((flow.scrollWidth + gap - 2) / READ.bkStep));
    if(READ.anchor) bkGo(READ.anchor, true); else bkShow(0);
    return;
  }
  const W = host.clientWidth, H = host.clientHeight, avail = W - (READ.panel ? BK_PANEL : 0);
  const p = bkPref(), mg = p.custom ? p.mg/100 : 0;   /* margins -50 % … +50 % */
  const two = !READ.panel && (p.cols==='2' ? avail >= 760 : p.cols==='1' ? false : avail >= 1080);
  let viewW, left, gap;
  if(two){ const m = Math.round(Math.min(120, avail*0.083)*(1+mg)); gap = Math.max(48, m); viewW = avail - 2*m; left = m; }
  else { gap = 120; viewW = Math.round(Math.min(620*(1-mg*0.6), avail - 96)); left = Math.round((avail - viewW)/2); }
  const top = 96, bottom = 86;
  Object.assign(view.style, {left:left+'px', width:viewW+'px', top:top+'px', height:Math.max(200, H-top-bottom)+'px'});
  flow.style.columnCount = two ? 2 : 1; flow.style.columnGap = gap+'px';
  READ.bkStep = viewW + gap; READ.bkTwo = two;
  READ.bkSpreads = Math.max(1, Math.ceil((flow.scrollWidth + gap - 2) / READ.bkStep));
  if(READ.anchor) bkGo(READ.anchor, true); else bkShow(0);
}
/* slide: only a page turn moves (the phone); a jump (open, contents, find, Explain) is instant */
function bkShow(n, slide){
  const flow = document.getElementById('bk-flow'); if(!flow || !READ) return;
  n = Math.max(0, Math.min(n, (READ.bkSpreads||1)-1));
  READ.spread = n;
  flow.classList.toggle('still', !slide);
  flow.style.transform = 'translateX('+(-n*READ.bkStep)+'px)';
}
/* the place at the top of the (left) page: the first character whose box is inside the view, found by measuring the
   text (hit-testing a point was unreliable inside the moved columns) */
function bkAnchorNow(){
  const view = document.getElementById('bk-view'), flow = document.getElementById('bk-flow'); if(!view || !flow) return null;
  const v = view.getBoundingClientRect();
  const inView = r => r.width > 0 && r.left >= v.left - 4 && r.right <= v.right + 4 && r.bottom > v.top && r.top < v.bottom;
  const els = [...flow.querySelectorAll('[data-b]')];
  let i = Math.max(0, els.findIndex(e=>+e.dataset.b === (READ.anchor ? READ.anchor.b : 0)) - 40), el = null;
  /* blocks before the view end left of it; walk on to the first one with a line in view */
  for(; i < els.length; i++){ if([...els[i].getClientRects()].some(inView)){ el = els[i]; break; } }
  if(!el){ for(i = 0; i < els.length; i++){ if([...els[i].getClientRects()].some(inView)){ el = els[i]; break; } } }
  if(!el) return null;
  const r = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let at = 0;
  while(w.nextNode()){
    const n = w.currentNode; r.selectNodeContents(n);
    if([...r.getClientRects()].some(inView)){
      let lo = 0, hi = n.length - 1;
      const vis = k => { r.setStart(n, k); r.setEnd(n, Math.min(n.length, k+1)); const q = r.getClientRects()[0]; return q ? inView(q) : false; };
      while(lo < hi){ const mid = (lo + hi) >> 1; if(vis(mid)) hi = mid; else lo = mid + 1; }
      return {b:+el.dataset.b, o:at + lo};
    }
    at += n.length;
  }
  return {b:+el.dataset.b, o:0};
}
function bkTurn(d){
  if(!READ || !READ.book || READ.mode!=='text') return;
  const n = READ.spread + d; if(n < 0 || n >= READ.bkSpreads) return;
  bkHideSel(); bkShow(n, true);
  if(PHONE){ clearTimeout(READ.settleT); READ.settleT = setTimeout(()=>{ if(READ) bkSettle(); }, 260); }   /* after the slide */
  else bkSettle();
}
function bkSettle(){
  const a = bkAnchorNow(); if(!a) return;
  READ.anchor = a;
  const pg = bkPageOf(a.b, a.o);
  if(pg !== READ.page){ READ.page = pg; clearTimeout(rdKeepTimer); rdKeepTimer = setTimeout(rdKeep, 1500); }
  bkFoot();
}
/* shows the spread that holds a place in the text */
function bkGo(a, keep){
  const flow = document.getElementById('bk-flow'); if(!flow) return;
  const el = flow.querySelector('[data-b="'+a.b+'"]'); if(!el){ bkShow(0); return; }
  let rect = null;
  const nt = bkNodeAt(el, a.o);
  if(nt){ const r = document.createRange(); r.setStart(nt.node, nt.off); r.setEnd(nt.node, Math.min(nt.node.length, nt.off+1)); rect = r.getClientRects()[0] || r.getBoundingClientRect(); }
  if(!rect || (!rect.width && !rect.height)) rect = el.getClientRects()[0] || el.getBoundingClientRect();
  const fr = flow.getBoundingClientRect(); bkShow(Math.floor((rect.left - fr.left + 2) / READ.bkStep));
  if(keep){ READ.anchor = a; READ.page = bkPageOf(a.b, a.o); bkFoot(); } else bkSettle();
}
function bkGoPage(pg){ if(!READ.book) return; const a = bkPlaceOfPage(pg); bkGo(a); READ.anchor = a; READ.page = pg; bkFoot(); }

/* DOM position <-> place in the text: offsets count the characters of the block's text nodes */
function bkPos(node, off){
  const el = (node.nodeType===1 ? node : node.parentElement); if(!el) return null;
  const blk = el.closest('#bk-flow [data-b]'); if(!blk) return null;
  const b = +blk.dataset.b;
  if(node.nodeType===1){ /* an element boundary: count the text before child off */
    let o = 0; const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    const stop = node.childNodes[off] || null;
    while(w.nextNode()){ if(stop && (stop===w.currentNode || stop.contains(w.currentNode) || (stop.compareDocumentPosition(w.currentNode) & Node.DOCUMENT_POSITION_FOLLOWING))) break; if(!stop && !node.contains(w.currentNode)) break; o += w.currentNode.length; }
    return {b, o};
  }
  let o = 0; const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  while(w.nextNode()){ if(w.currentNode===node) return {b, o:o+off}; o += w.currentNode.length; }
  return {b, o};
}
function bkNodeAt(blk, o){
  const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT); let at = 0, last = null;
  while(w.nextNode()){ const n = w.currentNode; last = n; if(o < at + n.length) return {node:n, off:o-at}; at += n.length; }
  return last ? {node:last, off:last.length} : null;
}

/* ---------- selection and the bubble ---------- */
function bkSelNow(){
  const s = window.getSelection(); if(!s || s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0), a = bkPos(r.startContainer, r.startOffset), z = bkPos(r.endContainer, r.endOffset);
  if(!a || !z) return null;
  const text = s.toString().replace(/\s+/g,' ').trim(); if(!text) return null;
  const ranges = [];
  for(let b = a.b; b <= z.b; b++){
    const blk = READ.book.blocks[b]; if(!blk || blk.k==='fig') continue;
    let s0 = b===a.b ? a.o : 0, e0 = b===z.b ? z.o : blk.t.length;
    while(s0 < e0 && /\s/.test(blk.t[s0])) s0++; while(e0 > s0 && /\s/.test(blk.t[e0-1])) e0--;
    if(e0 > s0) ranges.push({b, s:s0, e:e0});
  }
  if(!ranges.length) return null;
  const rects = [...r.getClientRects()].filter(x=>x.width>1);
  return {text:text.slice(0,3000), ranges, page:bkPageOf(ranges[0].b, ranges[0].s), rect:rects[0] || r.getBoundingClientRect(), last:rects[rects.length-1] || r.getBoundingClientRect()};
}
function bkSelEnd(){
  if(!READ || READ.mode!=='text' || !READ.book) return;
  const sel = bkSelNow();
  if(!sel){ if(READ.bsel && !READ.bsel.mark) bkHideSel(); return; }
  const m = (READ.hl||[]).find(h=>sel.ranges.length===1 && h.b===sel.ranges[0].b && h.s<=sel.ranges[0].s && h.e>=sel.ranges[0].e);
  READ.bsel = Object.assign(sel, {mark:m||null}); READ.define = null; READ.pop = null;
  bkPops();
}
function bkHideSel(){ if(!READ) return; READ.bsel = null; READ.define = null; bkPops(); }
function bkPops(){
  const host = document.getElementById('bk-pops'); if(!host || !READ) return;
  let h = '';
  const W = window.innerWidth, Hh = window.innerHeight;
  if(READ.bsel && READ.mode==='text' && !READ.define){
    const r = READ.bsel.rect, bw = PHONE ? 336 : 416, bh = 64;
    let x = Math.round(r.left + r.width/2 - bw/2), y = Math.round(r.top - bh - 12), below = false;
    if(y < 56){ y = Math.round(READ.bsel.last.bottom + 12); below = true; }
    x = Math.max(12, Math.min(x, W - bw - 12 - (READ.panel ? BK_PANEL : 0)));
    const tail = Math.max(14, Math.min(bw-14, Math.round(r.left + r.width/2 - x)));
    const m = READ.bsel.mark;
    h += '<div class="bk-bubble'+(below?' below':'')+'" style="left:'+x+'px;top:'+y+'px;--tail:'+tail+'px" role="toolbar" aria-label="Selection">'
      + '<button data-bk="explain">'+BK_ICON.explain+'<span>Explain</span><i>E</i></button>'
      + '<button data-bk="define">'+BK_ICON.define+'<span>Define</span><i>D</i></button>'
      + '<button data-bk="note"'+(m && m.kind==='note' && m.text ? ' title="'+esc(m.text)+'"' : '')+'>'+BK_ICON.note+'<span>'+(m && m.kind==='note' ? 'Your note' : 'Note')+'</span><i>N</i></button>'
      + (m ? '<button data-bk="unhl">'+BK_ICON.unpen+'<span>Remove</span><i>H</i></button>' : '<button data-bk="hl">'+BK_ICON.pen+'<span>Highlight</span><i>H</i></button>')
      + '</div>';
  }
  if(READ.define){
    const d = READ.define, cw = PHONE ? W - 24 : 380;
    let x = Math.round(d.x), y = Math.round(d.y + 8);
    x = Math.max(12, Math.min(x, W - cw - 12 - (READ.panel ? BK_PANEL : 0)));
    if(y > Hh - 220) y = Math.max(60, Math.round(d.top - 200));
    h += '<div class="bk-define" style="left:'+x+'px;top:'+y+'px" role="dialog" aria-label="Definition">'
      + '<div class="bk-dh"><b>'+esc(d.word.length>60 ? d.word.slice(0,60)+'…' : d.word)+(d.data && d.data.head && d.data.head.toLowerCase()!==d.word.toLowerCase() ? ' <span class="faint">→ '+esc(d.data.head)+'</span>' : '')+'</b><span class="faint">'+esc(d.data ? d.data.pos||'' : '')+'</span></div>'
      + (d.error ? '<div class="faint">'+esc(d.error)+'</div>' : d.data ? '<div class="bk-dd bk-dict">'+esc(d.data.def||'')+'</div>' : '<div class="faint">Looking it up…</div>')
      + '<div class="bk-dl mono"><button class="lnk" data-bk="dictopen" data-v="'+esc(d.word)+'">Open in Dictionary</button></div></div>';
  }
  if(READ.fnote!=null && READ.book){
    const n = READ.book.notes[READ.fnote], cw = 420;
    if(n){ const x = Math.max(12, Math.min(Math.round(READ.fnoteAt.x), W - cw - 12)), y = Math.round(READ.fnoteAt.y + 8);
      h += '<div class="bk-define bk-fnote" style="left:'+x+'px;top:'+Math.min(y, Hh-240)+'px" role="dialog" aria-label="Footnote"><div class="bk-dh"><b>Note '+esc(n.m||'')+'</b><span class="faint mono">p. '+esc(bkLabel(n.pg))+'</span></div><div class="bk-dd">'+esc(n.t)+'</div></div>'; }
  }
  if(READ.pop==='menu') h += bkMenuHTML();
  if(READ.pop==='aa') h += READ.aaView==='custom' ? bkCustomHTML() : bkThemesHTML();
  if(READ.find){
    const f = READ.find;
    h += '<div class="bk-find" role="search"><input id="bk-find" placeholder="Find in the text" value="'+esc(f.q)+'" autocomplete="off" spellcheck="false"><span class="mono faint">'+(f.q ? (f.hits.length ? (f.i+1)+' / '+f.hits.length+(f.more?'+':'') : 'none') : '')+'</span>'
      + '<button class="bk-ib" data-bk="fprev" title="Previous (⇧↩)">'+BK_ICON.up+'</button><button class="bk-ib" data-bk="fnext" title="Next (↩)">'+BK_ICON.down+'</button><button class="bk-ib" data-bk="fclose" title="Close (Esc)">'+BK_ICON.close+'</button></div>';
  }
  const had = document.activeElement && document.activeElement.id==='bk-find';
  host.innerHTML = h;
  if(READ.find && (READ.find.focus || had)){ READ.find.focus = false; const el = document.getElementById('bk-find'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}
const BK_SUN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 7V5M5.6 10.6 4.2 9.2M18.4 10.6l1.4-1.4"/></svg>';
const BK_GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';
function bkThemesHTML(){
  const p = bkPref();
  return '<div class="bk-menu bk-aapop" role="dialog" aria-label="Themes and settings"><div class="bk-aah">Themes &amp; Settings</div>'
    + '<div class="bk-aarow"><div class="bk-seg"><button data-bk="smaller" aria-label="Smaller text" title="Smaller ('+p.size+')"><span style="font-size:14px">A</span></button><button data-bk="bigger" aria-label="Bigger text" title="Bigger ('+p.size+')"><span style="font-size:21px">A</span></button></div>'
    + '<button class="bk-sun'+(p.auto?' on':'')+'" data-bk="autodark" role="switch" aria-checked="'+p.auto+'" title="Dark when the Mac is dark">'+BK_SUN+'</button></div>'
    + '<div class="bk-tiles">'+Object.keys(BK_THEMES).map(k=>{ const t = BK_THEMES[k], f = BK_FONTS[t.font][1];
        return '<button class="bk-tile'+(p.theme===k?' on':'')+'" data-bk="theme" data-v="'+k+'" style="background:'+t.bg+';color:'+t.ink+'" aria-pressed="'+(p.theme===k)+'"><span class="aa" style="font-family:'+esc(f)+';font-weight:'+(t.bold?700:400)+'">Aa</span><span style="font-family:'+esc(f)+';font-weight:'+(t.bold?700:400)+'">'+t.name+'</span></button>'; }).join('')+'</div>'
    + '<button class="bk-cust" data-bk="custom">'+BK_GEAR+'<span>Customize</span></button></div>';
}
function bkCustomHTML(){
  const p = bkPref(), t = BK_THEMES[p.theme];
  const sw = (k, on, label) => '<div class="bk-cr"><span>'+label+'</span><button class="bk-sw'+(on?' on':'')+'" data-bk="sw" data-v="'+k+'" role="switch" aria-checked="'+on+'" aria-label="'+label+'"><i></i></button></div>';
  const sl = (k, label, min, max, step, val, show) => '<div class="bk-sl"><div class="bk-sll mono">'+label+'</div><div class="bk-slr"><input type="range" data-bkp="'+k+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"'+(p.custom?'':' disabled')+' aria-label="'+label+'"><span class="mono">'+show+'</span></div></div>';
  return '<div class="bk-menu bk-aapop bk-custom" role="dialog" aria-label="Customize theme"><div class="bk-aah"><button class="bk-ib" data-bk="aaback" aria-label="Back">'+BK_ICON.back+'</button><span>Customize Theme</span><span style="width:34px"></span></div>'
    + '<div class="bk-sec mono">TEXT</div><div class="bk-box">'
    + '<div class="bk-cr"><span>Font</span><select data-bkp="font"><option value="">'+esc(BK_FONTS[t.font][0])+' (theme)</option>'+Object.keys(BK_FONTS).map(k=>'<option value="'+k+'"'+(p.font===k?' selected':'')+'>'+esc(BK_FONTS[k][0])+'</option>').join('')+'</select></div>'
    + sw('bold', bkBoldOn(p), 'Bold text')+'</div>'
    + '<div class="bk-sec mono">LAYOUT</div><div class="bk-box">'+sw('custom', p.custom, 'Customize')
    + sl('lh', 'LINE SPACING', 1.2, 2.2, 0.05, p.lh, (+p.lh).toFixed(2))
    + sl('ls', 'CHARACTER SPACING', -5, 10, 1, p.ls, p.ls+'%')
    + sl('ws', 'WORD SPACING', -20, 60, 5, p.ws, p.ws+'%')
    + sl('mg', 'MARGINS', -50, 50, 5, p.mg, p.mg+'%')+'</div>'
    + '<div class="bk-box"><div class="bk-cr"><span>Columns</span><select data-bkp="cols">'+[['auto','Auto'],['1','One'],['2','Two']].map(([v,l])=>'<option value="'+v+'"'+(p.cols===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'
    + sw('justify', p.justify, 'Justify text')+'</div>'
    + '<button class="bk-cust bk-reset" data-bk="reset">Reset theme</button></div>';
}
function bkMenuHTML(){
  let h = '<div class="bk-menu" role="menu" aria-label="Contents">';
  if(READ.book){
    const d = READ.book, a = READ.anchor || {b:0};
    /* numbered chapters when the book has them (front matter headings are noise then), else the headings */
    const chaps = d.blocks.filter(b=>b.k==='chap' && b.t.trim());
    const items = (chaps.length >= 3 ? chaps : d.blocks.filter(b=>(b.k==='chap' || b.k==='h') && b.t.trim().length > 2 && !/©|copyright/i.test(b.t))).slice(0, 80);
    let cur = -1; items.forEach((b,i)=>{ if(b.i <= a.b) cur = i; });
    if(items.length){
      h += '<div class="bk-ml mono">CONTENTS</div><div class="bk-toc">'+items.map((b,i)=>{ const pg = b.r && b.r[0] ? b.r[0].pg : 1;
        return '<button class="bk-mi'+(i===cur?' on':'')+'" data-bk="toc" data-b="'+b.i+'"><span>'+esc(b.t.length>40 ? b.t.slice(0,38)+'…' : b.t)+'</span><span class="faint">p. '+esc(bkLabel(pg))+'</span></button>'; }).join('')+'</div><div class="bk-rule"></div>';
    }
  } else if(READ.bkState) h += '<div class="bk-ml mono">READING VERSION</div><div class="bk-mstate">'+esc(bkStateLine() || 'Not made yet.')+'</div><div class="bk-rule"></div>';
  h += (READ.book ? '<button class="bk-mi" data-bk="toggle"><span>'+(READ.mode==='page' ? 'Text' : 'Original page')+'</span><span class="mono faint">⌥P</span></button>' : '')
    + '<button class="bk-mi" data-bk="notes"><span>Reading notes</span><span class="mono faint">⌥N</span></button>'
    + '<button class="bk-mi" data-bk="preview"><span>Open in Preview</span></button>'
    + (IN_APP && !PHONE ? '<button class="bk-mi" data-bk="hc"><span>Hardcover…</span></button>' : '')+'</div>';
  return h;
}

/* ---------- actions ---------- */
async function bkHighlight(sel){
  if(!sel || !READ.book) return;
  const by = bkRects(sel.ranges), made = [];
  for(const pg of Object.keys(by)){
    try{
      const r = await APP.call('readerMarkRects', {page:+pg, rects:by[pg], size:READ.book.sizes[+pg-1], text:sel.text.slice(0,1500), kind:'highlight'});
      if(r && r.name) made.push({pg:+pg, name:r.name, rects:r.rects});
    }catch(e){ READ.error = e.message; }
  }
  if(!made.length){ bkFoot(); return; }
  sel.ranges.forEach(x=>{ const pg = bkPageOf(x.b, x.s), m = made.find(y=>y.pg===pg) || made[0]; READ.hl.push({b:x.b, s:x.s, e:x.e, kind:'highlight', name:m.name, pg:m.pg, rects:m.rects, parts:made}); });
  READ.hl = bkMerge(READ.hl);
  window.getSelection().removeAllRanges();
  READ.bsel = null; bkReblock(sel.ranges.map(x=>x.b)); bkPops();
  READ.note = 'Highlighted. Saved in the PDF.'; bkFoot();
}
async function bkUnhighlight(m){
  if(!m) return;
  const parts = m.parts || [{pg:m.pg, name:m.name, rects:m.rects}];
  for(const p of parts){ try{ await APP.call('readerUnmarkName', {page:p.pg, name:p.name||'', rects:p.name ? [] : (p.rects||[]), size:READ.book.sizes[p.pg-1]}); }catch(e){} }
  const gone = READ.hl.filter(h=>h===m || (m.name && h.name===m.name) || (!m.name && h.pg===m.pg && h.rects===m.rects));
  READ.hl = READ.hl.filter(h=>!gone.includes(h));
  window.getSelection().removeAllRanges();
  READ.bsel = null; bkReblock(gone.map(h=>h.b)); bkPops();
  READ.note = 'Highlight removed.'; bkFoot();
}
function bkSentence(sel){
  const r = sel.ranges && sel.ranges[0]; if(!r) return sel.text;
  const t = READ.book.blocks[r.b].t;
  let a = r.s, z = r.e;
  while(a > 0 && !/[.!?]\s/.test(t.slice(a-2, a))) a--;
  while(z < t.length && !/[.!?]/.test(t[z-1] || '')) z++;
  return t.slice(Math.max(0, a), Math.min(t.length, z)).slice(0, 900);
}
/* Define: the dictionary on this device (Apple's), no AI. A word or a short phrase. */
const bkTerm = t => String(t||'').trim().replace(/^[“"‘'(\[]+|[”"’'),.;:!?\]]+$/g, '').slice(0, 80);
async function bkDict(word){
  if(word.split(/\s+/).length > 4) return {error:'Select a word or a short phrase to look it up.'};
  try{ const t = String((await APP.call('dictDefine', {term:word})).text||'').trim(); return t ? bkDictParse(t) : {error:'“'+word+'” is not in the dictionary.'}; }
  catch(e){ return {error:e.message}; }
}
/* Dictionary.app text: "head | pronunciation | part of speech 1 sense … 2 sense …" → part of speech and the senses, one a line */
function bkDictParse(t){
  const parts = t.split(/\s*\|\s*/);
  /* the entry's headword: the words before the syllabified form ("content 2 con·tent" → content) */
  const headTok = []; for(const w of (parts[0]||'').split(/\s+/)){ if(/·|^\d+$/.test(w)) break; headTok.push(w); }
  const head = headTok.join(' ');
  let body = (parts.length >= 3 ? parts.slice(2).join(' | ') : parts.length === 2 ? parts[1] : t).trim();
  body = body.split(/\s(?=ORIGIN|PHRASES|PHRASAL VERBS|DERIVATIVES|USAGE|TYPISCHE VERBINDUNGEN|GRAMMATIK|WORTBILDUNG)\b/)[0];
  const POS = /^((?:\([^)]{0,60}\)\s*)?)(noun|verb|adjective|adverb|pronoun|preposition|conjunction|exclamation|determiner|abbreviation|prefix|suffix|phrase|Substantiv|Verb|Adjektiv|Adverb|sustantivo|nombre|verbo|adjetivo|adverbio)\b\s*/i;
  const m = body.match(POS), pos = m ? m[2] : '';
  if(m) body = (m[1] ? m[1].trim()+' ' : '') + body.slice(m[0].length);
  body = body.replace(/\s(\d{1,2}) (?=[a-z(\[“"‘'])/g, '\n$1 ').replace(/\s(?=(noun|verb|adjective|adverb)\s\d? ?[a-z(])/g, '\n').replace(/\s•\s/g, '\n• ');
  if(body.length > 700) body = body.slice(0, body.lastIndexOf(' ', 690)) + ' …';
  return {pos, head, def:body.trim()};
}
async function bkDefine(sel, at){
  if(!sel || !sel.text) return;
  const word = bkTerm(sel.text);
  if(PHONE){   /* Apple's dictionary page */
    READ.bsel = null; bkPops();
    APP.call('dictShow', {term:word}).catch(()=>{});
    return;
  }
  if(READ.mode==='page') return bkDefinePage(sel, word);
  const rect = at || sel.last || sel.rect;
  READ.define = {word, x:rect.left, y:rect.bottom, top:rect.top, data:null};
  READ.bsel = null; bkPops();
  const me = READ.define, o = await bkDict(word);
  if(!READ || READ.define!==me) return;
  if(o.error) me.error = o.error; else me.data = o;
  bkPops();
}
/* the Mac's original page: the native card at the selection */
async function bkDefinePage(sel, word){
  const me = READ.defSeq = (READ.defSeq||0) + 1;
  APP.call('readerCard', {word, note:'Looking it up…'}).catch(()=>{});
  const o = await bkDict(word);
  if(!READ || READ.defSeq!==me || READ.mode!=='page') return;
  APP.call('readerCard', o.error ? {word, note:o.error} : {word:o.head && o.head.toLowerCase()!==word.toLowerCase() ? word+' → '+o.head : word, pos:o.pos, def:o.def}).catch(()=>{});
}
async function bkExplain(sel){
  if(!sel || !sel.text || !READ) return;
  if(READ.busy){ READ.note = 'Claude is still answering. Ask again in a moment.'; bkFoot(); return; }
  const pg = sel.page || READ.page;
  READ.topics = READ.topics || [];
  READ.topics.push({q:sel.text.slice(0,700), page:pg, label: READ.book ? bkLabel(pg) : String(pg), ranges:sel.ranges||[]});
  const ti = READ.topics.length-1;
  READ.panel = 'explain'; READ.compact = false; READ.wrap = null; READ.noting = null;
  READ.bsel = null; READ.define = null;
  try{ window.getSelection().removeAllRanges(); }catch(e){}
  if(READ.mode==='text' && READ.book){ READ.anchor = sel.ranges && sel.ranges[0] ? {b:sel.ranges[0].b, o:sel.ranges[0].s} : READ.anchor; bkFlow(); }
  bkRender(); bkScrollTopic(ti);
  READ.sel = {text:sel.text, page:pg};
  rdFresh();
  const r = await rdSend(rdContext(true)+'\n\n'+rdRed(BK_EXPLAIN), null);
  if(r!=null && READ){ READ.thread.push({role:'assistant', text:rdBack(r), tp:ti}); READ.sel = null; rdKeep(); }
  if(READ) bkPanel();
}
async function bkAsk(text, shown){
  text = String(text||'').trim(); if(!text || !READ || READ.busy) return;
  const tp = (READ.topics||[]).length ? READ.topics.length-1 : undefined;
  READ.draft = ''; READ.compact = true;
  READ.thread.push({role:'user', text:shown||text, tp});
  rdFresh();
  const r = await rdSend(rdContext(false)+'\n\n'+rdRed(text), null);
  if(r!=null && READ){ READ.thread.push({role:'assistant', text:rdBack(r), tp}); rdKeep(); }
  if(READ) bkPanel();
}
/* the passage of the topic open now: highlighted in the PDF, or kept as a PDF note with the last answer */
async function bkTopicMark(kind){
  const t = READ.topics && READ.topics[READ.topics.length-1]; if(!t) return;
  if(!t.ranges || !t.ranges.length || !READ.book){ READ.note = 'Open the text to mark this passage.'; return bkFoot(); }
  if(kind==='highlight') return bkHighlight({text:t.q, ranges:t.ranges});
  const ans = [...READ.thread].reverse().find(m=>m.role==='assistant' && m.tp===READ.topics.length-1);
  const by = bkRects(t.ranges), pg = +Object.keys(by)[0];
  try{
    await APP.call('readerMarkRects', {page:pg, rects:by[pg], size:READ.book.sizes[pg-1], text:('Explain: “'+t.q.slice(0,300)+'”\n\n'+(ans ? ans.text : '')).slice(0,1500), kind:'note'});
    READ.note = 'Saved as a note on p. '+bkLabel(pg)+' (in the PDF and your reading notes).';
  }catch(e){ READ.error = e.message; }
  bkFoot();
}
/* Explain again without asking anything (27 Nov 2026, the user's request: "open back the explain without sending a query"):
   the session's topics and answers as they were, the follow-up box ready. Nothing goes to the model until he writes. */
function bkReopen(){
  if(!READ) return;
  READ.panel = 'explain'; READ.compact = true; READ.pop = null; READ.noting = null; READ.define = null; READ.bsel = null;
  if(READ.mode==='text' && READ.book){ const a = READ.anchor; bkFlow(); if(a) bkGo(a); }
  bkRender(); READ.askFocus = !PHONE; bkPanel();
  const th = document.getElementById('reader-thread'); if(th) th.scrollTop = th.scrollHeight;
}
/* Notes (27 Nov 2026, the user's request: "make notes in the reader"): Note at the selection opens the note box beside the text;
   saved, the passage is highlighted with the note as its comment (Reader.textNote), shown on hover and in Preview.
   A note's own bubble says "Your note": edit it, or empty it to remove it. */
function bkNoteStart(sel){
  if(!sel || !sel.text || !READ || !READ.book) return;
  const m = sel.mark && sel.mark.kind==='note' ? sel.mark : null;
  const rg = m ? READ.hl.filter(h=>h.name && h.name===m.name).map(h=>({b:h.b, s:h.s, e:h.e})) : (sel.ranges||[]);
  const quote = m ? rg.map(x=>READ.book.blocks[x.b].t.slice(x.s, x.e)).join(' ') : sel.text;
  READ.noting = {page:sel.page||READ.page, quote:quote.slice(0,700), text:m ? m.text||'' : '', focus:true, ranges:rg.length ? rg : (sel.ranges||[]), edit:m};
  READ.panel = 'note'; READ.bsel = null; READ.define = null; READ.pop = null;
  try{ window.getSelection().removeAllRanges(); }catch(e){}
  if(READ.mode==='text'){ const r0 = READ.noting.ranges[0]; if(r0) READ.anchor = {b:r0.b, o:r0.s}; bkFlow(); }
  bkRender();
}
async function bkNoteSave(n){
  READ.noting = null; READ.panel = null;
  const text = String(n.text||'').trim();
  if(n.edit) await bkUnhighlight(n.edit);
  const done = msg => { if(!READ) return; const a = READ.anchor; if(READ.mode==='text'){ bkFlow(); if(a) bkGo(a); } bkRender(); READ.note = msg; bkFoot(); };
  if(!text) return done(n.edit ? 'Note removed.' : '');
  const by = bkRects(n.ranges), made = [];
  for(const pg of Object.keys(by)){
    try{
      const r = await APP.call('readerMarkRects', {page:+pg, rects:by[pg], size:READ.book.sizes[+pg-1], text:text.slice(0,1500), kind:'note'});
      if(r && r.name) made.push({pg:+pg, name:r.name, rects:r.rects});
    }catch(e){ READ.error = e.message; }
  }
  if(!made.length) return done('The note was not saved.');
  n.ranges.forEach(x=>{ const pg = bkPageOf(x.b, x.s), m = made.find(y=>y.pg===pg) || made[0]; READ.hl.push({b:x.b, s:x.s, e:x.e, kind:'note', text, name:m.name, pg:m.pg, rects:m.rects, parts:made}); });
  READ.hl = bkMerge(READ.hl);
  done('Note saved on p. '+bkLabel(made[0].pg)+'. In the PDF and your reading notes.');
}
function bkScrollTopic(ti){ const el = document.querySelector('#reader-side [data-tp="'+ti+'"]'); if(el) el.scrollIntoView({block:'start'}); }

/* ---------- the side panel: Explain, Reading notes, a note ---------- */
function bkPanel(){
  const side = document.getElementById('reader-side'); if(!side || !READ) return;
  if(READ.panel==='notes' && !READ.wrap && !READ.busy) READ.panel = null;
  if(READ.panel==='note' && !READ.noting) READ.panel = null;
  const host = document.getElementById('reader'); if(host) host.classList.toggle('bk-panel', !!READ.panel);
  if(!READ.panel){ side.innerHTML = ''; return; }
  const ae = document.activeElement, hadFocus = ae && ae.id==='bk-ask';
  const kind = READ.panel==='notes' ? 'READING NOTES' : READ.panel==='note' ? 'NOTE' : READ.panel==='hc' ? 'HARDCOVER' : 'EXPLAIN';
  let h = '<div class="bk-ph"><button class="bk-ib" data-bk="pclose" title="Back to the book (Esc)" aria-label="Close">'+BK_ICON.close+'</button><span class="mono bk-pk">'+kind+(READ.panel==='note' || READ.panel==='hc' ? '' : ' · '+(PHONE ? 'DEEPSEEK' : 'CLAUDE'))+'</span><span class="bk-pa">'
    + (READ.panel==='explain' ? '<button class="bk-ib" data-bk="xhl" title="Highlight this passage">'+BK_ICON.pen+'</button><button class="bk-ib" data-bk="xnote" title="Save to notes: the passage and the answer, as a note in the PDF">'+BK_ICON.mark+'</button>' : '')+'</span></div>';
  if(READ.panel==='explain'){
    const topics = READ.topics||[], last = topics.length-1;
    h += '<div class="bk-pt" id="reader-thread">';
    const old = READ.thread.filter(m=>m.tp==null);
    if(old.length) h += '<details class="bk-old"><summary class="mono">Earlier in this session · '+old.length+'</summary>'+old.map(bkMsg).join('')+'</details>';
    topics.forEach((t,i)=>{
      h += '<section class="bk-topic" data-tp="'+i+'"><div class="bk-src mono">p. '+esc(t.label)+' · '+esc(bkSource())+'</div>'
        + '<div class="bk-qt'+(i<last || READ.compact ? ' sm' : '')+'">“'+esc(t.q.length>420 ? t.q.slice(0,420)+' …' : t.q)+'”</div>'
        + READ.thread.filter(m=>m.tp===i).map(bkMsg).join('')+'</section>';
    });
    if(READ.busy) h += '<div class="msg ma bk-a" id="reader-stream">'+(READ.stream ? bkLinks(md(rdBack(READ.stream))) : '<span class="muted">'+esc(READ.tool||'Reading')+'…</span>')+'</div>';
    h += '</div>';
    if(READ.error) h += '<div class="tag warn">'+ICON.warn+esc(READ.error)+'</div>';
    if(PHONE && (!READ.dsKey || READ.keyForm)) h += '<div class="hsave rkey bk-wrap"><div class="bk-sec mono">DEEPSEEK API KEY</div><div class="muted">From platform.deepseek.com › API keys. It stays in this phone’s Keychain and goes only to DeepSeek.</div>'
      + '<input id="reader-dskey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…"><div class="crow"><button class="btn pri" data-rd="dssave">Save key</button>'+(READ.dsKey ? '<button class="lnk" data-rd="dskey">Cancel</button>' : '')+'</div></div>';
    h += '<div class="bk-chips">'+Object.keys(BK_CHIPS).map(k=>'<button class="bk-chip" data-bk="chip" data-v="'+k+'"'+(READ.busy?' disabled':'')+'>'+BK_CHIPS[k][0]+'</button>').join('')+'</div>'
      + '<div class="bk-in"><input id="bk-ask" placeholder="Ask a follow-up…" value="'+esc(READ.draft||'')+'" autocomplete="off"><button class="bk-send" data-bk="ask" aria-label="Send"'+(READ.busy?' disabled':'')+'>'+BK_ICON.send+'</button></div>'
      + '<div class="bk-hint">'+(PHONE ? 'Swipe left or × to go back to p. '+esc(READ.book ? bkLabel(READ.page) : String(READ.page)) : 'Esc or × to go back to the book')+(PHONE ? ' · <button class="lnk" data-bk="dsmode">'+(READ.ds==='think'?'Think harder':'Fast')+'</button>' : '')+'</div>';
  } else if(READ.panel==='notes'){
    h += '<div class="bk-pt" id="reader-thread">';
    if(READ.busy) h += '<div class="msg ma bk-a" id="reader-stream">'+(READ.stream ? md(rdBack(READ.stream)) : '<span class="muted">Writing your reading notes…</span>')+'</div>';
    h += '</div>';
    if(READ.error) h += '<div class="tag warn">'+ICON.warn+esc(READ.error)+'</div>';
    if(READ.wrap){
      const w = READ.wrap, c = rdCourse(), t = c && READ.tid ? (c.tasks||[]).find(x=>x.id===READ.tid && x.status!=='done') : null;
      h += '<div class="hsave bk-wrap"><textarea data-rw="text" rows="16">'+esc(w.text)+'</textarea>'
        + (cById(w.cid) ? '' : '<label>Course<select data-rw="cid"><option value="">Pick a course</option>'+courses.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.short)+'</option>').join('')+'</select></label>')
        + (t ? '<label class="evchk"><input type="checkbox" data-rw="done"'+(w.done?' checked':'')+'> Mark “'+esc(t.title)+'” done</label>' : '')
        + '<div class="crow"><button class="btn pri" data-rd="savenotes">'+(PHONE ? 'Send notes to the Mac' : 'Save notes')+'</button><button class="btn" data-rd="unwrap">Back to the book</button></div></div>';
    }
  } else if(READ.panel==='hc' && typeof hcPanelHTML==='function'){
    h += hcPanelHTML();
  } else if(READ.panel==='note' && READ.noting){
    const n = READ.noting;
    h += '<div class="hsave rnote bk-wrap"><div class="bk-src mono">p. '+esc(READ.book ? bkLabel(n.page) : String(n.page))+'</div>'+(n.quote ? '<div class="bk-qt sm">“'+esc(n.quote.length>200?n.quote.slice(0,200)+' …':n.quote)+'”</div>' : '')
      + '<textarea id="reader-note" rows="6" placeholder="Your note">'+esc(n.text)+'</textarea>'
      + '<div class="crow"><button class="btn pri" data-rd="savenote">Save note</button><button class="btn" data-rd="unnote">Cancel</button><span class="muted">⌘↩ saves</span></div></div>';
  }
  side.innerHTML = h;
  if(READ.noting && READ.noting.focus){ READ.noting.focus = false; const ta = document.getElementById('reader-note'); if(ta) ta.focus(); }
  const th = document.getElementById('reader-thread'); if(th && READ.busy) th.scrollTop = th.scrollHeight;
  if(hadFocus || READ.askFocus){ READ.askFocus = false; const el = document.getElementById('bk-ask'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}
const bkMsg = m => m.role==='user' ? '<div class="bk-u">'+esc(m.text)+'</div>' : '<div class="bk-a">'+bkLinks(md(m.text))+'</div>';
/* Claude cites PDF pages; the book shows printed pages. Links keep the PDF page and show the printed one. */
const bkLinks = html => !READ.book ? rdLinks(html) : html.replace(/\b(pp?\.)\s?(\d{1,4})(?:\s?[–-]\s?(\d{1,4}))?/g, (m,p,a,b)=>'<button class="lnk rpl" data-rp="'+a+'">'+p+' '+esc(bkLabel(+a))+(b ? '–'+esc(bkLabel(+b)) : '')+'</button>');
function bkSource(){ const n = READ.title || rdName(); return n.length > 44 ? n.slice(0,42)+'…' : n; }
function bkClosePanel(){
  if(!READ || !READ.panel) return;
  const was = READ.panel; READ.panel = null; READ.compact = false;
  if(was==='note') READ.noting = null;
  if(READ.mode==='text' && READ.book){ const a = READ.anchor; bkFlow(); if(a) bkGo(a); }
  bkRender();
}
function bkNotes(){
  if(!READ) return;
  READ.panel = 'notes'; READ.pop = null;
  if(READ.mode==='text' && READ.book) bkLayout();
  bkRender();
  if(!READ.wrap && !READ.busy) rdWrap().then(()=>{ if(READ) bkPanel(); });
}

/* ---------- modes ---------- */
function bkMode(mode){
  if(!READ) return;
  /* the phone with only the text: the original page comes from the Mac when he asks for it */
  if(mode==='page' && READ.phone && !READ.docOpen){
    if(!READ.wantPage){ READ.wantPage = true; READ.note = 'Getting the original page from the Mac. It opens when it arrives.'; APP.call('fileGet', {cid:READ.phone.cid, file:READ.phone.file}).catch(e=>{ if(READ){ READ.wantPage = false; READ.note = e.message; bkRender(); } }); }
    return bkRender();
  }
  READ.mode = mode; READ.pop = null; READ.bsel = null; READ.define = null;
  if(PHONE) APP.call('readerQuiet', {on:mode==='text'}).catch(()=>{});
  if(mode==='page'){
    READ.find = null;
    bkRender();
    requestAnimationFrame(()=>{ if(!READ) return; APP.call('readerFrame', {rect:rdRect()}).catch(()=>{}); APP.call('readerGo', {page:READ.page}).catch(()=>{}); });
  } else {
    APP.call('readerHide').catch(()=>{});
    READ.sel = null;
    const pg = READ.page;
    bkRender(); bkFlow();
    const a = READ.anchor && bkPageOf(READ.anchor.b, READ.anchor.o)===pg ? READ.anchor : bkPlaceOfPage(pg);
    READ.anchor = a; bkGo(a);
  }
}
function bkToggle(){
  if(!READ) return;
  if(READ.mode==='text') return bkMode('page');
  if(READ.book){ READ.autoText = false; bkMarks().then(()=>bkMode('text')); }
}

/* ---------- find ---------- */
function bkFind(q){
  const f = READ.find; f.q = q; f.hits = []; f.more = false;
  const s = q.trim().toLowerCase();
  if(s.length >= 2){
    for(const b of READ.book.blocks){
      if(b.k==='fig') continue;
      const t = b.t.toLowerCase(); let i = t.indexOf(s);
      while(i >= 0){ f.hits.push({b:b.i, s:i, e:i+s.length}); if(f.hits.length >= 500){ f.more = true; break; } i = t.indexOf(s, i+s.length); }
      if(f.more) break;
    }
  }
  const a = READ.anchor || {b:0, o:0};
  f.i = Math.max(0, f.hits.findIndex(h=>h.b > a.b || (h.b===a.b && h.s >= a.o)));
  bkFlow(); bkFindShow();
}
function bkFindShow(){ const f = READ.find; if(f && f.hits.length){ const h = f.hits[f.i]; bkFlow(); bkGo({b:h.b, o:h.s}); } bkPops(); }
function bkFindStep(d){ const f = READ.find; if(!f || !f.hits.length) return; f.i = (f.i + d + f.hits.length) % f.hits.length; bkFindShow(); }

/* ---------- make reading versions ahead of time: every course PDF, files linked to open tasks first ---------- */
function bkAhead(){
  if(!IN_APP || PHONE || typeof FILES==='undefined') return;
  const first = [], rest = [];
  courses.forEach(c=>{
    const dir = folderOf(c); if(!dir) return;
    const linked = new Set((c.tasks||[]).filter(t=>t.status!=='done').flatMap(t=>t.files||[]).concat((c.tasks||[]).filter(t=>t.status!=='done' && t.pages).map(t=>t.pages.file)));
    (FILES[c.id]||[]).filter(f=>/\.pdf$/i.test(f)).forEach(f=>(linked.has(f) ? first : rest).push(dir+'/'+f));
  });
  APP.call('readingAhead', {paths:[...new Set(first.concat(rest))]}).catch(()=>{});
}

/* ---------- events ---------- */
/* app events for the Mac view; true when handled here */
function bkEvent(ev){
  if(!READ) return false;
  if(ev.type==='readerReading'){
    if(READ.phone ? ev.key!==READ.phone.cid+'/'+READ.phone.file : ev.path!==READ.path) return true;
    if(ev.ready && READ.phone && (READ.fetch || (!READ.docOpen && !READ.book))){ rdOpenText(); return true; }   /* the text came before the PDF */
    if(ev.ready){
      APP.call('readingGet', READ.phone ? {cid:READ.phone.cid, file:READ.phone.file} : {path:READ.path}).then(async r=>{
        if(!READ || !r.ready) return;
        bkLoad(r.data); await bkMarks();
        if(READ.mode==='page' && READ.autoText){ READ.autoText = false; READ.note = 'The reading version is ready.'; bkMode('text'); }
        else bkRender();
      }).catch(()=>{});
    } else { READ.bkState = {state:'failed', error:ev.error||''}; bkRender(); }
    return true;
  }
  if(ev.type==='readerKey'){
    const k = ev.key;
    if(k==='altp') bkToggle();
    else if(k==='altn') bkNotes();
    else if(k==='escape'){ if(ev.had) return true; if(READ.define || READ.fnote!=null){ READ.define = null; READ.fnote = null; bkPops(); } else if(READ.panel) bkClosePanel(); else closeReader(); }   /* Esc with nothing open leaves the reader (26 Nov 2026, the user's request) */
    else if(READ.sel && READ.sel.text) bkPageAct(k);
    return true;
  }
  if(ev.type==='readerHit'){ READ.hit = ev.page ? {page:ev.page, kind:ev.kind, text:ev.text} : null; bkFoot(); return true; }
  if(ev.type==='readerPage'){ if(typeof RT!=='undefined') RT.last = Date.now(); if(READ.mode==='page'){ READ.page = ev.page; bkFoot(); clearTimeout(rdKeepTimer); rdKeepTimer = setTimeout(rdKeep, 1500); } return true; }
  if(ev.type==='readerSel'){ if(READ.mode!=='page') return true; READ.sel = ev.text ? {text:ev.text, page:ev.page} : null; bkFoot(); return true; }
  if(ev.type==='readerNoteStart'){ rdNoteStart().then(()=>{ if(READ && READ.noting){ READ.panel = 'note'; bkRender(); } }); return true; }
  if(ev.type==='readerMark'){ READ.note = ev.kind==='phone' ? 'Marks from your iPhone were added to this PDF (p. '+ev.page+').' : ev.removed ? 'Mark removed.' : ({highlight:'Highlighted', note:'Note added', underline:'Underlined'}[ev.kind]||'Marked')+' on p. '+ev.page+'. Saved in the PDF.'; READ.sel = null;
    if(READ.panel==='note') READ.panel = null;
    rdMarks().then(()=>{ if(READ && READ.book) return bkMarks().then(()=>{ if(READ.mode==='text') bkFlow(); }); }).then(()=>bkRender()); return true; }
  if(ev.type==='readerAsk'){ if(READ.sel && READ.sel.text) bkPageAct('e'); return true; }
  return false;
}
/* E D H on a selection in the original page */
function bkPageAct(k){
  const s = READ.sel; if(!s || !s.text) return;
  if(k==='h'){ APP.call('readerMark', {kind:'highlight'}).catch(()=>{}); return; }
  const sel = {text:s.text, page:s.page, ranges:[], context:s.text};
  if(k==='e') bkExplain(sel);
  if(k==='d') bkDefine(sel);
}

/* controls show while the pointer moves, hide 2.5 s after */
let bkUiTimer = null;
document.addEventListener('mousemove', e=>{
  const host = document.getElementById('reader'); if(!host || !READ || PHONE || !host.classList.contains('bk')) return;
  host.classList.add('ui'); clearTimeout(bkUiTimer);
  bkUiTimer = setTimeout(()=>{ if(!READ || READ.mode==='page' || READ.pop || READ.find) return; const t = document.getElementById('bk-top'); if(t && t.matches(':hover')) return; host.classList.remove('ui'); }, 2500);
});
document.addEventListener('mouseup', e=>{
  if(!READ || PHONE || READ.mode!=='text') return;
  if(e.target.closest('#bk-pops')) return;
  if(e.target.closest('#bk-flow')) setTimeout(bkSelEnd, 0);
});
document.addEventListener('mousedown', e=>{
  if(!READ || PHONE || !document.getElementById('bk-pops')) return;
  if(e.target.closest('.bk-bubble')){ e.preventDefault(); return; }   // keep the selection
  if(!e.target.closest('#bk-pops')){
    let ch = false;
    if(READ.define){ READ.define = null; ch = true; }
    if(READ.fnote!=null){ READ.fnote = null; ch = true; }
    if(READ.pop && !e.target.closest('[data-bk="menu"],[data-bk="aa"]')){ READ.pop = null; ch = true; bkRender(); }
    if(READ.bsel && !e.target.closest('#bk-flow')){ READ.bsel = null; ch = true; }
    if(ch) bkPops();
  }
});
document.addEventListener('wheel', e=>{
  if(!READ || PHONE || READ.mode!=='text' || !e.target.closest('#bk-view')) return;
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  READ.wheel = (READ.wheel||0) + d;
  if(Date.now() < (READ.wheelLock||0)) return;
  if(Math.abs(READ.wheel) > 40){ bkTurn(READ.wheel > 0 ? 1 : -1); READ.wheel = 0; READ.wheelLock = Date.now() + 450; }
}, {passive:false});
window.addEventListener('resize', ()=>{ if(READ && !(PHONE && READ.panel) && READ.mode==='text' && READ.book && document.getElementById('bk-flow')){ const a = READ.anchor; bkLayout(); if(a) bkGo(a, true); bkHideSel(); } });
document.addEventListener('click', e=>{
  if(!READ || !document.getElementById('bk-top')) return;
  const fn = e.target.closest('#bk-flow .bk-fn');
  if(fn){ const r = fn.getBoundingClientRect(); READ.fnote = +fn.dataset.fn; READ.fnoteAt = {x:r.left-20, y:r.bottom}; bkPops(); return; }
  const hl = e.target.closest('#bk-flow .hl, #bk-flow .ul');
  if(hl && window.getSelection().isCollapsed){
    const p = bkPos(hl.firstChild || hl, 0), m = p && (READ.hl||[]).find(h=>h.b===p.b && h.s<=p.o && h.e>p.o);
    if(m){ const t = READ.book.blocks[m.b].t.slice(m.s, m.e), r = hl.getBoundingClientRect(); READ.bsel = {text:t, ranges:[{b:m.b, s:m.s, e:m.e}], page:m.pg, rect:r, last:r, mark:m}; bkPops(); return; }
  }
  const b = e.target.closest('#reader [data-bk]');
  if(!b || !b.dataset.bk) return;
  const a = b.dataset.bk;
  e.preventDefault();
  if(a==='close') closeReader();
  else if(a==='explain') bkExplain(READ.bsel);
  else if(a==='define') bkDefine(READ.bsel);
  else if(a==='hl') bkHighlight(READ.bsel);
  else if(a==='note') bkNoteStart(READ.bsel);
  else if(a==='reexplain'){ READ.panel==='explain' ? bkClosePanel() : bkReopen(); }
  else if(a==='unhl') bkUnhighlight(READ.bsel && READ.bsel.mark);
  else if(a==='menu' || a==='aa'){ READ.pop = READ.pop===a ? null : a; READ.aaView = 'main'; bkRender(); }
  else if(a==='toc'){ READ.pop = null; const bi = +b.dataset.b; READ.anchor = {b:bi, o:0}; if(READ.mode==='page'){ READ.page = bkPageOf(bi, 0); bkMode('text'); } else bkGo({b:bi, o:0}); bkRender(); }
  else if(a==='toggle' || a==='text'){ READ.pop = null; bkToggle(); }
  else if(a==='orig'){ READ.page = +b.dataset.pg || READ.page; bkMode('page'); }
  else if(a==='notes') bkNotes();
  else if(a==='hc' && typeof hcOpen==='function') hcOpen();
  else if(a==='preview'){ READ.pop = null; APP.call('readerPreview').catch(()=>{}); bkRender(); }
  else if(a==='smaller' || a==='bigger'){ const p = bkPref(), i = Math.max(0, BK_SIZES.indexOf(p.size)), n = BK_SIZES[Math.max(0, Math.min(BK_SIZES.length-1, i + (a==='bigger'?1:-1)))]; bkRestyle({size:n}); }
  else if(a==='theme') bkRestyle({theme:b.dataset.v, font:'', bold:false, boldSet:false});
  else if(a==='autodark') bkRestyle({auto:!bkPref().auto});
  else if(a==='custom' || a==='aaback'){ READ.aaView = a==='custom' ? 'custom' : 'main'; bkPops(); }
  else if(a==='sw'){ const k = b.dataset.v, p = bkPref(); bkRestyle(k==='bold' ? {bold:!bkBoldOn(p), boldSet:true} : {[k]:!p[k]}); }
  else if(a==='reset'){ const p = bkPref(); bkRestyle(Object.assign({}, BK_DEF, {size:p.size, theme:p.theme, auto:p.auto, boldSet:false})); }
  else if(a==='find'){ READ.find = READ.find ? null : {q:'', hits:[], i:0, focus:true}; READ.pop = null; if(!READ.find) bkFlow(); bkRender(); }
  else if(a==='fnext') bkFindStep(1);
  else if(a==='fprev') bkFindStep(-1);
  else if(a==='fclose'){ READ.find = null; bkFlow(); bkRender(); }
  else if(a==='pclose') bkClosePanel();
  else if(a==='chip'){ const k = b.dataset.v; bkAsk(BK_CHIPS[k][1], BK_CHIPS[k][0]); }
  else if(a==='ask'){ const el = document.getElementById('bk-ask'); READ.askFocus = true; bkAsk(el && el.value); }
  else if(a==='xhl') bkTopicMark('highlight');
  else if(a==='xnote') bkTopicMark('note');
  else if(a==='pexplain') bkPageAct('e');
  else if(a==='pdefine') bkPageAct('d');
  else if(a==='phl') bkPageAct('h');
  else if(a==='dictopen'){ APP.call('dictOpen', {term:b.dataset.v}).catch(()=>{}); READ.define = null; bkPops(); }
  else if(a==='dsmode'){ READ.ds = READ.ds==='think' ? 'chat' : 'think'; lsSet('readDs', READ.ds); bkPanel(); }
});
document.addEventListener('input', e=>{
  if(!READ || !document.getElementById('bk-top')) return;
  if(e.target.id==='bk-ask') READ.draft = e.target.value;
  const k = e.target.dataset && e.target.dataset.bkp;
  if(k){ const v = k==='font' || k==='cols' ? e.target.value : +e.target.value; bkSetPref({[k]:v});
    const out = e.target.parentElement.querySelector('span.mono'); if(out) out.textContent = k==='lh' ? (+v).toFixed(2) : k==='font' || k==='cols' ? '' : v+'%';
    clearTimeout(READ.styleT); READ.styleT = setTimeout(()=>{ if(!READ) return; const a = READ.anchor; bkApplyPref(); if(READ.mode==='text' && READ.book){ bkLayout(); if(a) bkGo(a, true); } }, 60); }
  if(e.target.id==='bk-find' && READ.find){ clearTimeout(READ.findT); const v = e.target.value; READ.findT = setTimeout(()=>{ if(READ && READ.find) bkFind(v); }, 180); }
});
document.addEventListener('keydown', e=>{
  if(!READ || !document.getElementById('bk-top')) return;
  const tag = e.target.tagName, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
  if(e.target.id==='bk-ask' && e.key==='Enter' && !e.shiftKey){ e.preventDefault(); READ.askFocus = !PHONE; bkAsk(e.target.value); if(PHONE) e.target.blur(); return; }
  if(e.target.id==='bk-find'){
    if(e.key==='Enter'){ e.preventDefault(); bkFindStep(e.shiftKey ? -1 : 1); return; }
    if(e.key==='Escape'){ e.preventDefault(); READ.find = null; bkFlow(); bkRender(); return; }
    return;
  }
  if(PHONE) return;
  if(e.key==='Escape'){
    if(READ.define || READ.fnote!=null){ READ.define = null; READ.fnote = null; bkPops(); }
    else if(READ.bsel){ bkHideSel(); window.getSelection().removeAllRanges(); }
    else if(READ.pop || READ.find){ READ.pop = null; if(READ.find){ READ.find = null; bkFlow(); } bkRender(); }
    else if(READ.panel) bkClosePanel();
    else if(!typing) closeReader();   /* nothing open: Esc leaves the reader (26 Nov 2026, the user's request: "esc should get me out the reader") */
    else return;
    e.preventDefault(); return;
  }
  if(e.altKey && !e.metaKey && e.code==='KeyP'){ e.preventDefault(); bkToggle(); return; }
  if(e.altKey && !e.metaKey && e.code==='KeyN'){ e.preventDefault(); bkNotes(); return; }
  if(e.metaKey && !e.altKey && e.key.toLowerCase()==='f' && READ.mode==='text' && READ.book){ e.preventDefault(); READ.find = READ.find || {q:'', hits:[], i:0}; READ.find.focus = true; bkRender(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(READ.bsel && READ.mode==='text'){
    const k = e.key.toLowerCase();
    if(k==='e'){ e.preventDefault(); bkExplain(READ.bsel); return; }
    if(k==='d'){ e.preventDefault(); bkDefine(READ.bsel); return; }
    if(k==='n'){ e.preventDefault(); bkNoteStart(READ.bsel); return; }
    if(k==='h'){ e.preventDefault(); READ.bsel.mark ? bkUnhighlight(READ.bsel.mark) : bkHighlight(READ.bsel); return; }
  }
  if(e.key.toLowerCase()==='e' && !READ.bsel && READ.panel!=='explain'){ e.preventDefault(); bkReopen(); return; }   /* E with nothing selected: back to the Explain session, nothing sent */
  if(READ.mode!=='text' || !READ.book) return;
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){ e.preventDefault(); bkTurn(1); }
  else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){ e.preventDefault(); bkTurn(-1); }
  else if(e.key==='Home'){ e.preventDefault(); bkShow(0); bkSettle(); }
  else if(e.key==='End'){ e.preventDefault(); bkShow(READ.bkSpreads-1); bkSettle(); }
});
document.addEventListener('keyup', e=>{ if(READ && !PHONE && READ.mode==='text' && e.shiftKey && /^Arrow/.test(e.key)) bkSelEnd(); });

/* ---------- the phone ---------- */
/* a selection that stops: finger lifted and the handles left alone for a moment */
let bkSelT = null;
document.addEventListener('selectionchange', ()=>{
  if(!PHONE || !READ || READ.mode!=='text' || !READ.book) return;
  clearTimeout(bkSelT); bkSelT = setTimeout(bkSelEnd, 550);
});
/* Pages as in Habla: a tap on the right 28 % or a swipe left turns forward, the left 28 % or a swipe right back, the
   middle shows or hides the bars. A tap while something is selected or open only closes it. */
let bkTouch = null;
document.addEventListener('touchstart', e=>{
  if(!PHONE || !READ || READ.mode!=='text' || !READ.book || e.touches.length!==1) return;
  if(!e.target.closest('#bk-view') || e.target.closest('#reader-side')) return;
  const t = e.touches[0]; bkTouch = {x:t.clientX, y:t.clientY, at:Date.now(), sel:!window.getSelection().isCollapsed};
}, {passive:true});
document.addEventListener('touchend', e=>{
  const t0 = bkTouch; bkTouch = null; if(!t0 || !READ) return;
  const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, dt = Date.now() - t0.at;
  const selNow = !window.getSelection().isCollapsed;
  if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)*1.3 && !selNow && !t0.sel){ bkHideSel(); bkTurn(dx < 0 ? 1 : -1); return; }
  if(dt > 350 || Math.abs(dx) > 10 || Math.abs(dy) > 10) return;          /* a press-and-hold selects text */
  if(e.target.closest('.hl,.ul,.bk-fn,button')) return;                    /* the click handler takes those */
  if(READ.bsel || READ.define || READ.fnote!=null || selNow || t0.sel){ window.getSelection().removeAllRanges(); READ.bsel = null; READ.define = null; READ.fnote = null; bkPops(); return; }
  if(READ.pop || READ.find){ READ.pop = null; bkRender(); return; }
  const x = t.clientX / window.innerWidth, host = document.getElementById('reader');
  if(x > 0.72) bkTurn(1); else if(x < 0.28) bkTurn(-1); else if(host) host.classList.toggle('ui');
});
/* Explain: a swipe left (or ×) goes back to the same place on the page */
let bkSwipe = null;
document.addEventListener('touchstart', e=>{
  const side = e.target.closest && e.target.closest('#reader-side'); if(!PHONE || !READ || !side || READ.panel!=='explain' || /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
  const t = e.touches[0]; bkSwipe = {x:t.clientX, y:t.clientY, dx:0, on:false, el:side};
}, {passive:true});
document.addEventListener('touchmove', e=>{
  if(!bkSwipe) return; const t = e.touches[0], dx = t.clientX - bkSwipe.x, dy = t.clientY - bkSwipe.y;
  if(!bkSwipe.on){ if(Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)*1.5 && dx < 0) bkSwipe.on = true; else if(Math.abs(dy) > 14){ bkSwipe = null; return; } }
  if(bkSwipe.on){ bkSwipe.dx = Math.min(0, dx); bkSwipe.el.style.transition = 'none'; bkSwipe.el.style.transform = 'translateX('+bkSwipe.dx+'px)'; }
}, {passive:true});
document.addEventListener('touchend', ()=>{
  if(!bkSwipe) return; const s = bkSwipe; bkSwipe = null; if(!s.on) return;
  s.el.style.transition = 'transform .2s ease-out';
  if(s.dx < -80){ s.el.style.transform = 'translateX(-100%)'; setTimeout(()=>{ s.el.style.transform = ''; s.el.style.transition = ''; bkClosePanel(); }, 200); }
  else { s.el.style.transform = ''; setTimeout(()=>{ s.el.style.transition = ''; }, 220); }
});
