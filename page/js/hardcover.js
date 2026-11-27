/* Hardcover, the reading log (27 Nov 2026, the user's request: "keep track of what I am reading or read in hardcover"). Mac only;
   the key and the calls are native (Hardcover.swift, op "hardcover"), the page never sees the key.
   - A PDF that prints an ISBN (copyright page: the first or last pages of its reading version) is linked by itself: the
     edition is looked up, the book becomes Currently reading and a read starts today. Asked once per PDF (hc.tried).
   - Any other PDF: ☰ › Hardcover… in the reader searches by title; he picks the book (the user's answer: "A bit of both").
   - While linked, the number of pages he has read in it (readtime.js: pages with 15 s of reading, any device) goes to
     Hardcover as the read's progress, never the page he is on (27 Nov 2026, the user's rule: "reading selected chapters only
     increase the page count but should not mark a book as done"). It stays one page under the book's length, so
     Hardcover never finishes a book by itself; only Finished marks it Read.
   Stored on the PDF's reads/<id> as hc: {book, edition, title, ub (user_book id), read (user_book_read id), sent, status}.
   GraphQL as used by hardcoverapp.koplugin (MIT): status 1 want to read, 2 reading, 3 read, 5 did not finish. */
const HC = {key:null, busy:false, q:'', results:null, error:'', note:''};
const HC_BOOK = 'book_id: id title release_year pages contributions: cached_contributors';
async function hcCall(query, variables){
  const r = await APP.call('hardcover', {query, variables:variables||{}});
  if(r && r.errors && r.errors.length) throw new Error(r.errors[0].message || 'Hardcover error');
  return (r && r.data) || {};
}
async function hcHasKey(){ if(HC.key===null){ try{ HC.key = !!(await APP.call('hardcoverStatus')).key; }catch(e){ HC.key = false; } } return HC.key; }
window.hcChanged = () => { HC.key = null; HC.error = ''; if(READ && READ.panel==='hc') bkPanel(); };
let HC_ME = null;
async function hcMe(){ if(!HC_ME) HC_ME = (await hcCall('{ me { id account_privacy_setting_id } }')).me; return Array.isArray(HC_ME) ? HC_ME[0] : HC_ME; }

/* ISBN-13 or ISBN-10 with a valid check digit, from the text of the PDF's first 12 and last 6 pages */
function hcIsbn(){
  if(!READ || !READ.book) return '';
  const n = READ.book.sizes.length, near = b => { const pg = bkPageOf(b.i, 0); return pg <= 12 || pg > n - 6; };
  const text = READ.book.blocks.filter(b=>b.t && near(b)).map(b=>b.t).join('\n');
  for(const m of text.matchAll(/ISBN(?:-1[03])?[:\s]*((?:97[89][\s-]?)?[0-9][0-9\s-]{7,14}[0-9Xx])/g)){
    const d = m[1].replace(/[\s-]/g, '').toUpperCase();
    if(d.length===13 && /^\d{13}$/.test(d)){ const s = [...d].reduce((a,c,i)=>a + (+c)*(i%2 ? 3 : 1), 0); if(s % 10 === 0) return d; }
    if(d.length===10 && /^\d{9}[\dX]$/.test(d)){ const s = [...d].reduce((a,c,i)=>a + (c==='X' ? 10 : +c)*(10-i), 0); if(s % 11 === 0) return d; }
  }
  return '';
}
const hcDoc = () => { if(!READ || typeof rtKey!=='function') return null; const k = rtKey(), id = rtId(k); return READS[id] = READS[id] || {id, cid:k.split('|')[0], file:k.split('|').slice(1).join('|'), title:READ.title||'', sessions:[]}; };

/* links the open PDF to a Hardcover book: Currently reading, a read from today; an open read keeps its pages (never sent lower) */
async function hcLink(bookId, editionId, title, pages){
  const doc = hcDoc(); if(!doc) return;
  const me = await hcMe();
  const ub = (await hcCall('query ($id: Int!, $u: Int!) { user_books(where: {book_id: {_eq: $id}, user_id: {_eq: $u}}) { id status_id user_book_reads(order_by: {id: asc}) { id finished_at progress_pages } } }', {id:bookId, u:me.id})).user_books || [];
  let u = ub[0];
  if(!u){
    const r = await hcCall('mutation ($o: UserBookCreateInput!) { insert_user_book(object: $o) { error user_book { id status_id } } }',
      {o:Object.assign({book_id:bookId, status_id:2, privacy_setting_id:me.account_privacy_setting_id || 1}, editionId ? {edition_id:editionId} : {})});
    if(r.insert_user_book && r.insert_user_book.error) throw new Error(r.insert_user_book.error);
    u = Object.assign({user_book_reads:[]}, r.insert_user_book && r.insert_user_book.user_book);
  } else if(u.status_id!==2 && u.status_id!==3){
    await hcCall('mutation ($id: Int!) { update_user_book(id: $id, object: {status_id: 2}) { error } }', {id:u.id});
  }
  if(!u || !u.id) throw new Error('Hardcover did not add the book.');
  let read = (u.user_book_reads||[]).filter(x=>!x.finished_at).pop();
  if(!read){
    const r = await hcCall('mutation ($id: Int!, $p: Int, $e: Int, $s: date) { insert_user_book_read(user_book_id: $id, user_book_read: {progress_pages: $p, edition_id: $e, started_at: $s}) { error user_book_read { id } } }',
      {id:u.id, p:null, e:editionId || null, s:TODAY});
    read = r.insert_user_book_read && r.insert_user_book_read.user_book_read;
  }
  doc.hc = {book:bookId, edition:editionId||null, title:title||'', pages:pages||0, ub:u.id, read:read ? read.id : null, sent:(read && read.progress_pages) || 0, status:u.status_id===3 ? 3 : 2, tried:true};
  rtSave(doc); await hcProgress(doc);
}
/* once per PDF: an ISBN links it by itself */
async function hcAuto(){
  if(PHONE || !IN_APP || HC.busy || !READ || !READ.book) return;
  const doc = hcDoc(); if(!doc || doc.hc) return;
  if(!(await hcHasKey())) return;
  HC.busy = true;
  try{
    const isbn = hcIsbn();
    if(isbn){
      const f = isbn.length===13 ? 'isbn_13' : 'isbn_10';
      const ed = ((await hcCall('query ($i: String!) { editions(where: {'+f+': {_eq: $i}}, limit: 1) { id book_id title pages } }', {i:isbn})).editions || [])[0];
      if(ed){ await hcLink(ed.book_id, ed.id, ed.title, ed.pages); READ.note = 'On Hardcover: “'+ed.title+'”, currently reading.'; if(typeof bkFoot==='function') bkFoot(); }
    }
    if(!doc.hc) doc.hc = {tried:true, isbn:isbn||''};
    if(!doc.hc.book) rtSave(doc);
  }catch(e){ HC.error = e.message; }
  HC.busy = false;
}
/* pages read so far, when more than last sent; at most one under the book's length (never finishes it by itself) */
async function hcProgress(doc){
  if(PHONE || !IN_APP || !doc || !doc.hc || !doc.hc.read || doc.hc.status===3) return;
  let n = rtPagesRead(doc);
  if(doc.hc.pages > 1) n = Math.min(n, doc.hc.pages - 1);
  if(!n || n <= (doc.hc.sent||0)) return;
  try{
    await hcCall('mutation ($id: Int!, $p: Int) { update_user_book_read(id: $id, object: {progress_pages: $p}) { error } }', {id:doc.hc.read, p:n});
    doc.hc.sent = n; rtSave(doc);
  }catch(e){ HC.error = e.message; }
}
async function hcFinish(){
  const doc = hcDoc(); if(!doc || !doc.hc || !doc.hc.ub) return;
  if(doc.hc.read) await hcCall('mutation ($id: Int!, $d: date) { update_user_book_read(id: $id, object: {finished_at: $d}) { error } }', {id:doc.hc.read, d:TODAY});
  await hcCall('mutation ($id: Int!) { update_user_book(id: $id, object: {status_id: 3}) { error } }', {id:doc.hc.ub});
  doc.hc.status = 3; rtSave(doc);
}
async function hcSearch(q){
  const ids = ((await hcCall('query ($q: String!) { search(query: $q, per_page: 8, page: 1, query_type: "Book") { ids } }', {q})).search || {}).ids || [];
  if(!ids.length) return [];
  const books = (await hcCall('query ($ids: [Int!]) { books(where: {id: {_in: $ids}}) { '+HC_BOOK+' } }', {ids:ids.map(Number)})).books || [];
  return ids.map(i=>books.find(b=>b.book_id===+i)).filter(Boolean);
}

/* ---------- the panel (☰ › Hardcover…) ---------- */
function hcOpen(){ if(!READ) return; READ.pop = null; READ.panel = 'hc'; HC.q = HC.q && HC.for===rtKey() ? HC.q : (READ.title || rdName()).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '); HC.for = rtKey(); HC.results = null; HC.note = ''; if(READ.mode==='text' && READ.book){ const a = READ.anchor; bkFlow(); if(a) bkGo(a); } bkRender(); hcHasKey().then(()=>bkPanel()); }
const hcAuthors = b => (Array.isArray(b.contributions) ? b.contributions : []).map(c=>(c.author && c.author.name) || c.name || '').filter(Boolean).slice(0,2).join(', ');
function hcPanelHTML(){
  const doc = hcDoc(), hc = doc && doc.hc;
  let h = '<div class="bk-pt hcp">';
  if(HC.key===false) return h + '<p class="muted">Add your Hardcover API key in the menu bar: Planner › Hardcover API Key…</p></div>';
  if(hc && hc.book){
    h += '<div class="bk-sec mono">ON HARDCOVER</div><p><b>'+esc(hc.title||'This book')+'</b><br><span class="muted">'+(hc.status===3 ? 'Read' : 'Currently reading')+(hc.sent ? ' · '+esc(hc.sent)+' pages read'+(hc.pages ? ' of '+esc(hc.pages) : '') : '')+'</span></p>'
      + '<div class="crow">'+(hc.status===3 ? '' : '<button class="btn pri" data-hc="finish">Finished</button>')+'<button class="btn" data-hc="unlink">Unlink here</button></div>';
  } else {
    h += '<div class="bk-sec mono">FIND THIS BOOK ON HARDCOVER</div><div class="bk-in"><input id="hc-q" value="'+esc(HC.q)+'" autocomplete="off"><button class="bk-send" data-hc="search" aria-label="Search">'+BK_ICON.search+'</button></div>';
    if(HC.results) h += HC.results.length ? HC.results.map((b,i)=>'<button class="hcr" data-hc="pick" data-i="'+i+'"><b>'+esc(b.title)+'</b><span class="muted">'+esc([hcAuthors(b), b.release_year, b.pages ? b.pages+' pages' : ''].filter(Boolean).join(' · '))+'</span></button>').join('') : '<p class="muted">Nothing found. Try the title alone, or title and author.</p>';
    h += '<p class="muted">A course reader or a chapter is usually not on Hardcover: then leave it unlinked. Your reading time is kept either way.</p>';
  }
  if(HC.busy) h += '<p class="muted">Talking to Hardcover…</p>';
  if(HC.note) h += '<p class="muted">'+esc(HC.note)+'</p>';
  if(HC.error) h += '<div class="tag warn">'+ICON.warn+esc(HC.error)+'</div>';
  return h + '</div>';
}
async function hcAct(a, el){
  const doc = hcDoc(); HC.error = ''; HC.note = '';
  const run = async f => { HC.busy = true; bkPanel(); try{ await f(); }catch(e){ HC.error = e.message; } HC.busy = false; bkPanel(); };
  if(a==='search'){ const q = (document.getElementById('hc-q')||{}).value || HC.q; HC.q = q; return run(async()=>{ HC.results = await hcSearch(q); }); }
  if(a==='pick'){ const b = (HC.results||[])[+el.dataset.i]; if(b) return run(async()=>{ await hcLink(b.book_id, null, b.title, b.pages); HC.note = 'Linked. It is on Hardcover as Currently reading.'; }); }
  if(a==='finish') return run(async()=>{ await hcFinish(); HC.note = 'Marked Read on Hardcover.'; });
  if(a==='unlink' && doc){ doc.hc = {tried:true}; rtSave(doc); HC.note = 'Unlinked here. Hardcover keeps what it has.'; bkPanel(); }
}
document.addEventListener('click', e=>{ const b = e.target.closest('#reader [data-hc]'); if(!b || !READ) return; e.preventDefault(); hcAct(b.dataset.hc, b); });
document.addEventListener('keydown', e=>{ if(e.target.id==='hc-q' && e.key==='Enter'){ e.preventDefault(); hcAct('search'); } });
