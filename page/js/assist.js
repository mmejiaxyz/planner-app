/* Planner assistant extras (9 Nov 2026, the user's request): deadlines short of time, "what if" questions, waiting on others, and
   readings sized from the book. Part of page/index_v2.html; classic script, loaded after organizer-run.js.
   As everywhere in the planner: the model reads (which change a question means, where a chapter is when the book has no
   contents, the wording of a message), code decides (hours, pages, splits, days, what is short). */

const daysBetween = (a, b) => Math.round((new Date(b+'T12:00') - new Date(a+'T12:00'))/864e5);

/* ---------- a drafted message: a follow-up, an extension request ----------
   Same model setting as the planner input (Claude with names, links and numbers hidden, unless Local or offline). Never sent:
   he copies it. */
let DRAFTS = {};
async function draftMessage(key, ask){
  DRAFTS[key] = {busy:true, text:'', error:''}; render();
  const who = profileInstitution(), me = profileName();
  const prompt = 'Write a short, polite message for a university student'+(who ? ' ('+who+')' : '')+'. Write only the message: a greeting, two to four sentences, and a sign-off'+(me ? ' with the first name '+me : '')+'. English, unless the context below is in German. No subject line and no placeholders in brackets.\n\n'+ask;
  const red = redact(prompt);
  try{
    const r = await APP.call('llm', {prompt, remotePrompt: red.text, order: llmOrder()});
    if(!r.text) throw new Error('No model answered. '+(r.errors||[]).join(' · '));
    DRAFTS[key].text = String(restore(r.text, red.map)).trim();
  }catch(e){ DRAFTS[key].error = e.message; }
  DRAFTS[key].busy = false; render();
}
function draftBlock(key){
  const d = DRAFTS[key]; if(!d) return '';
  if(d.busy) return '<div class="draft muted" role="status">Writing a draft…</div>';
  if(d.error) return '<div class="draft"><span class="tag warn">'+ICON.warn+esc(d.error)+'</span> <button class="lnk" data-draft="close" data-k="'+esc(key)+'">Close</button></div>';
  return '<div class="draft"><textarea rows="6" data-draftk="'+esc(key)+'" aria-label="Draft message">'+esc(d.text)+'</textarea>'
    + '<div class="crow"><button class="btn sm" data-draft="copy" data-k="'+esc(key)+'">Copy</button><button class="lnk" data-draft="close" data-k="'+esc(key)+'">Close</button><span class="faint">Nothing is sent. Copy it into your mail.</span></div></div>';
}

/* ---------- 3. deadlines short of time ----------
   Organizer.deadlineRisks (organize.js, tested): all open work due by a deadline against all the time there is until then.
   Shown on Today with three ways out: cut or shrink steps (the planner suggests, the preview shows how much it saves),
   use a class of that course as work time, or ask for more time (a drafted email). */
let RISK = {key:'', list:[], open:''};
function risksNow(){
  const k = orgKey()+'#'+TODAY+'#'+new Date().getHours()+'#'+CAL.length;
  if(RISK.key!==k){ RISK.key = k; try{ RISK.list = Organizer.deadlineRisks(courses, orgEnv(), RULES_CFG.riskTol); }catch(e){ console.warn('deadline check', e); RISK.list = []; } }
  return RISK.list;
}
function riskClasses(r){
  const out = [], c = cById(r.course), d = c && (c.deliverables||[]).find(x=>x.id===r.did); if(!d) return out;
  const by = Organizer.isSession(c, d) ? Organizer.sessionLast(c, d) : d.date, now = nowMinutes();
  for(let day = TODAY; day <= by; day = addDays(day,1)) classesOn(day).forEach((e,i)=>{ if(e.c===r.course && (day > TODAY || toMin(e.e||e.s) > now) && !classWorkOn(day, r.course)) out.push({day, i, e}); });
  return out;
}
/* Dismiss (10 Nov 2026, the user's request): a dismissed deadline stays hidden until it is more than riskTol hours shorter than
   when he dismissed it (localStorage "riskHide": {course|did: hours short then}). Past deadlines are dropped from the list. */
const riskHidden = () => { try{ return JSON.parse(lsGet('riskHide')||'{}'); }catch(e){ return {}; } };
const riskShown = r => { const h = riskHidden()[r.course+'|'+r.did]; return h==null || r.short > h + RULES_CFG.riskTol; };
function riskDismiss(k){
  const r = risksNow().find(x=>x.course+'|'+x.did===k); if(!r) return;
  const h = riskHidden(), live = new Set(risksNow().map(x=>x.course+'|'+x.did)); Object.keys(h).forEach(x=>{ if(!live.has(x)) delete h[x]; });
  h[k] = r.short; lsSet('riskHide', JSON.stringify(h));
}
function risksBlock(){
  if(!IN_APP) return '';
  const all = risksNow(), list = all.filter(r=>!r.inherited && riskShown(r)); if(!list.length) return '';
  let h = '<section class="risks" aria-label="Deadlines short of time"><h2>Short of time</h2>';
  list.forEach(r=>{
    const c = cById(r.course), k = r.course+'|'+r.did, later = all.filter(x=>x.inherited && x.date >= r.date && all.filter(y=>!y.inherited && y.date<=x.date).pop()===r);
    h += '<div class="risk"><div><b>'+esc(c?c.short:r.course)+' · '+esc(r.title)+'</b>'+(r.prio?' '+prioMark({prio:r.prio}):'')+' <span class="muted">· '+esc(fmtShort(r.date))+'</span> <span class="tag warn">'+ICON.warn+esc(r1(r.short))+' h short</span></div>'
      + '<div class="pch">'+(r.byPrio ? 'Your priority deadlines go first; after them, '+esc(r1(r.work))+' h of work is due by then and there are '+esc(r1(r.room))+' h until then.' : esc(r1(r.work))+' h of work is due by then, across your courses, and there are '+esc(r1(r.room))+' h until then.')+(later.length?' Later deadlines are short because of it: '+later.map(x=>esc((cById(x.course)||{}).short||x.course)+' · '+esc(x.title)).join(', ')+'.':'')+'</div>'
      + '<div class="crow"><button class="btn sm" data-risk="cut" data-k="'+esc(k)+'">What can I cut?</button><button class="btn sm" data-risk="class" data-k="'+esc(k)+'">Use class time</button><button class="btn sm" data-risk="ask" data-k="'+esc(k)+'">Ask for more time</button><button class="lnk" data-risk="hide" data-k="'+esc(k)+'" title="Hide until it gets more than '+esc(r1(RULES_CFG.riskTol))+' h worse">Dismiss</button></div>';
    if(RISK.open===k){ const cl = riskClasses(r);
      h += cl.length ? '<div class="pch">Use a '+esc(c?c.short:'')+' class as work time:</div><div class="crow">'+cl.map(x=>'<button class="lnk" data-riskcls="'+esc(x.day+'|'+x.i)+'">'+esc(fmtShort(x.day))+' '+esc(x.e.s)+(x.e.e?'–'+esc(x.e.e):'')+'</button>').join('')+'</div>'
        : '<div class="pch muted">No '+esc(c?c.short:'')+' class before the deadline.</div>'; }
    h += draftBlock('risk:'+k) + '</div>';
  });
  return h + '</section>';
}
function riskAct(b){
  const r = risksNow().find(x=>x.course+'|'+x.did===b.dataset.k), c = r && cById(r.course); if(!r || !c) return render();
  const a = b.dataset.risk;
  if(a==='hide'){ riskDismiss(b.dataset.k); if(RISK.open===b.dataset.k) RISK.open = ''; return render(); }
  if(a==='class'){ RISK.open = RISK.open===b.dataset.k ? '' : b.dataset.k; return render(); }
  if(a==='cut'){
    compose = freshCompose(); compose.risk = {course:r.course, did:r.did, short:r.short}; compose.prepared = true;   /* written by the app: no appointments read from it */
    compose.draft = 'The deadline "'+r.title+'" ('+c.short+') on '+fmtShort(r.date)+' is '+r1(r.short)+' h short of time. Which of its open steps can be cut, or made smaller, to save at least '+r1(r.short)+' h? Keep the steps that make what is handed in. Put cut steps in "removes" with the reason and smaller steps in "updates" with fewer minutes.';
    runCompose(); window.scrollTo({top:0, behavior:'smooth'}); return;
  }
  if(a==='ask'){
    const extra = Math.max(2, Math.ceil(r.short/4));
    return draftMessage('risk:'+b.dataset.k, 'Write an email to the teacher of the course "'+(c.name||c.short)+'" asking for a short extension for "'+r.title+'", due '+fmt(r.date,{weekday:'long', day:'numeric', month:'long'})+'. The reason: the work left does not fit in the time before then, about '+r1(r.short)+' hours short. Suggest '+fmt(addDays(r.date, extra),{weekday:'long', day:'numeric', month:'long'})+' as the new date. Do not over-explain.');
  }
}
/* In the preview of a "What can I cut?" answer: how much the cuts save against the shortfall. */
function riskSaveLine(p){
  const k = compose.risk; if(!k) return '';
  let saved = 0;
  (p.removes||[]).forEach(x=>{ const c = cById(x.course), t = c && (c.tasks||[]).find(y=>y.id===x.id); if(t && t.status!=='done') saved += Number(t.est)||0; });
  (p.updates||[]).forEach(u=>{ const c = cById(u.course), t = c && (c.tasks||[]).find(y=>y.id===u.id); if(t && u.changes.est!=null && u.changes.est < t.est) saved += t.est - u.changes.est; });
  (p.tasks||[]).forEach(t=>{ saved -= Number(t.est)||0; });
  saved = r1(saved);
  return '<div class="pch">'+(saved >= k.short ? 'Saves <b>'+saved+' h</b>: enough for the '+r1(k.short)+' h short.' : '<span class="tag warn">'+ICON.warn+'Saves '+Math.max(0,saved)+' h of the '+r1(k.short)+' h short</span> Say what else can go, or use class time.')+'</div>';
}

/* ---------- 4. waiting on others ----------
   A blocked task can say what it waits for: t.waiting = {what, who, since}. Set from the planner input ("waiting for the lab
   files from the TA"); cleared by setStatus as soon as the task moves on. After RULES_CFG.followUpDays without a change the
   task offers a drafted follow-up. */
const waitDays = t => t.waiting && t.waiting.since ? Math.max(0, daysBetween(t.waiting.since, TODAY)) : 0;
const followUpDue = t => t.status==='blocked' && t.waiting && waitDays(t) >= RULES_CFG.followUpDays;
function waitTag(c,t){
  if(!t.waiting || t.status!=='blocked') return '';
  const n = waitDays(t), due = followUpDue(t), w = t.waiting;
  return '<span class="tag'+(due?' warn':'')+'">'+(due?ICON.warn:'')+'Waiting'+(n?' '+n+' day'+(n===1?'':'s'):'')+': '+esc(w.what)+(w.who?' ('+esc(w.who)+')':'')+'</span>'
    + (due && IN_APP && !DRAFTS['wait:'+t.id] ? '<button class="lnk" data-wait="'+esc(c.id+'|'+t.id)+'">Draft follow-up</button>' : '');
}
const waitDraft = t => DRAFTS['wait:'+t.id] ? draftBlock('wait:'+t.id) : '';
function waitingBlock(){
  const list = allTasks().filter(({t})=>t.status==='blocked' && t.waiting).sort((a,b)=>waitDays(b.t)-waitDays(a.t));
  if(!list.length) return '';
  const due = list.filter(({t})=>followUpDue(t)).length;
  return '<details class="fold"'+(due?' open':'')+'><summary>Waiting on others <span class="muted">· '+list.length+(due?' · '+due+' to follow up':'')+'</span></summary><div class="mx-list">'+list.map(({c,t})=>tkRow(c,t)).join('')+'</div></details>';
}
function waitAct(b){
  const [cid, tid] = b.dataset.wait.split('|'), c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid); if(!t || !t.waiting) return;
  const w = t.waiting, dl = deadlineOf(c,t);
  return draftMessage('wait:'+t.id, 'Write a short, friendly follow-up to '+(w.who||'the person')+' about '+w.what+', which the student has been waiting for since '+fmt(w.since,{weekday:'long', day:'numeric', month:'long'})+' ('+waitDays(t)+' days). It is needed for "'+t.title+'" in the course "'+(c.name||c.short)+'"'+(dl?', due '+fmt(dl,{weekday:'long', day:'numeric', month:'long'}):'')+'. Ask when it can be expected.');
}

/* ---------- 2. what if ----------
   "What if I take Thursday off?", "what happens if the Design deadline moves to the 18th?": the change is read like any note
   (code for busy and free time, the model for the rest), then applied to a copy of the plan, and the organizer runs on the copy
   exactly as it would after saving. The answer is what would move, which days change, and which deadlines get short or
   stop being short. Nothing is saved until he picks Do it, which opens the usual preview. */
const WHATIF_RE = /\b(what if|what happens if|what would happen|was wäre,? wenn|was passiert,? wenn|qué pasa si)\b|^\s*(?:can|could) i (?:take|skip|drop|move|have|push)\b/i;
function simApply(p, cs, days){
  const C = id => cs.find(x=>x.id===id), T = (cid, id) => { const c = C(cid); return c && (c.tasks||[]).find(x=>x.id===id); };
  const day = d => days[d] = days[d] || {id:d, busy:[]};
  const keyMap = {};
  (p.deliverables||[]).forEach(d=>{ const c = C(d.course); if(!c) return; keyMap[d.key] = 'sim-'+d.key; (c.deliverables = c.deliverables||[]).push({id:'sim-'+d.key, title:d.title, date:d.date, state:d.date?'set':'tbd'}); });
  (p.tasks||[]).forEach((t,i)=>{ const c = C(t.course); if(!c) return; const nt = {id:'sim-t'+i, did:keyMap[t.did]||t.did||'', title:t.title, due:t.due, est:Number(t.est)||1, status:t.waiting?'blocked':'todo', where:t.where}; if(t.pinned) nt.pin = t.due; (c.tasks = c.tasks||[]).push(nt); });
  (p.updates||[]).forEach(u=>{ const t = T(u.course, u.id); if(!t) return; const {status:st, ...rest} = u.changes; Object.assign(t, rest);
    if(u.changes.due){ if(u.pin) t.pin = u.changes.due; else delete t.pin; } else if(u.pin && u.changes.where==='class') t.pin = t.due;
    if(st){ if(st==='done'){ t.doneOn = TODAY; if(t.due > TODAY) t.due = TODAY; } t.status = st; } });
  (p.busy||[]).forEach(b=>b.days.forEach(d=>day(d).busy.push({from:b.from, to:b.to})));
  (p.classWork||[]).forEach(w=>{ const x = day(w.day); x.classWork = (x.classWork||[]).concat([{course:w.course, from:w.from, to:w.to}]); });
  (p.dupdates||[]).forEach(u=>{ const c = C(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(d) d.date = u.changes.date; });
  (p.removes||[]).forEach(r=>{ const c = C(r.course); if(c) c.tasks = (c.tasks||[]).filter(x=>x.id!==r.id); });
  /* a new timed event takes its time like a busy time; moving or deleting events is not simulated */
  (p.skips||[]).forEach(x=>{ const doc = day(x.day), same = y => x.ev ? y.ev===x.ev : (!y.ev && y.c===x.c && y.s===x.s); doc.skip = (doc.skip||[]).filter(y=>!same(y)); if(!x.attend) doc.skip.push(x.ev ? {ev:x.ev} : {c:x.c, s:x.s}); });
  (p.events||[]).forEach(x=>{ if(x.op==='add' && x.date && x.start){ const s = toMin(x.start); day(x.date).busy.push({from:s, to:x.end ? toMin(x.end) : s+60}); } });
}
function simulate(p){
  const keep = DAYS, base = JSON.parse(JSON.stringify(courses)), alt = JSON.parse(JSON.stringify(courses));
  const altDays = JSON.parse(JSON.stringify(DAYS)); simApply(p, alt, altDays);
  const run = (cs, days) => { DAYS = days; try{ Organizer.setPlanDates(cs); Organizer.organizePlan(cs, orgEnv()); return Organizer.deadlineRisks(cs, orgEnv(), RULES_CFG.riskTol); } finally { DAYS = keep; } };
  const r0 = run(base, JSON.parse(JSON.stringify(keep))), r1_ = run(alt, altDays);
  const map = cs => { const m = new Map(); cs.forEach(c=>(c.tasks||[]).forEach(t=>m.set(c.id+'|'+t.id, {c, t}))); return m; };
  const A = map(base), B = map(alt), asked = new Set((p.updates||[]).map(u=>u.course+'|'+u.id));
  const moved = [], added = [], removed = [];
  B.forEach((y,k)=>{ const x = A.get(k); if(!x){ added.push(y); return; } if(y.t.status!=='done' && x.t.due!==y.t.due) moved.push({c:y.c, t:y.t, from:x.t.due, to:y.t.due, asked:asked.has(k)}); });
  A.forEach((x,k)=>{ if(!B.has(k) && x.t.status!=='done') removed.push(x); });
  const load = (m, d) => { let h = 0; m.forEach(({t})=>{ if(t.status!=='done' && t.due===d && t.where!=='class') h += Number(t.est)||0; }); return r1(h); };
  const days = []; for(let i=0;i<28;i++){ const d = addDays(TODAY,i), a = load(A,d), b = load(B,d); if(Math.abs(a-b) >= 0.5) days.push({d, a, b}); }
  const key = r => r.course+'|'+r.did, before = new Map(r0.map(r=>[key(r), r])), after = new Map(r1_.map(r=>[key(r), r]));
  const worse = r1_.filter(r=>!before.has(key(r)) || r.short > before.get(key(r)).short + 0.25), better = r0.filter(r=>!after.has(key(r)));
  return {moved, added, removed, days, worse, better, calNote: (p.events||[]).some(x=>x.op!=='add')};
}
function whatIfBlock(p){
  const s = compose.sim || (compose.sim = simulate(p));
  const line = x => esc(x.t.title)+' <span class="muted">· '+esc(x.c.short)+'</span>';
  let h = '<div class="prop whatif"><div class="plabel">What if</div>'+(p.summary?'<p class="psum">'+esc(p.summary)+'</p>':'');
  if(s.worse.length) h += '<div class="pwarn">'+s.worse.map(r=>'<span class="tag warn">'+ICON.warn+esc((cById(r.course)||{}).short||r.course)+' · '+esc(r.title)+' ('+esc(fmtShort(r.date))+') would be '+esc(r1(r.short))+' h short</span>').join('')+'</div>';
  if(s.better.length) h += '<div class="pch">No longer short of time: '+s.better.map(r=>esc((cById(r.course)||{}).short||r.course)+' · '+esc(r.title)).join(', ')+'</div>';
  const mv = s.moved.slice().sort((a,b)=>String(a.to).localeCompare(String(b.to)));
  if(mv.length) h += '<div class="plabel">Would move</div>'+mv.map(x=>'<div class="prow"><span>'+line(x)+'<br><span class="pch">'+esc(x.from?fmtShort(x.from):'no day')+' → <b>'+esc(x.to?fmtShort(x.to):'no day')+'</b>'+(x.asked?'':' · by the planner')+'</span></span></div>').join('');
  if(s.added.length) h += '<div class="plabel">Would be added</div>'+s.added.map(x=>'<div class="prow"><span>'+line(x)+' <span class="pch">· '+esc(x.t.due?fmtShort(x.t.due):'no day')+' · '+esc(x.t.est)+' h</span></span></div>').join('');
  if(s.removed.length) h += '<div class="plabel">Would be removed</div>'+s.removed.map(x=>'<div class="prow"><span><s>'+line(x)+'</s></span></div>').join('');
  if(s.days.length) h += '<div class="plabel">Days that change</div><div class="pch">'+s.days.map(x=>esc(fmtShort(x.d))+' <span class="mono">'+x.a+' → '+(x.b>HEAVY?'<b class="warn">'+x.b+' h</b>':x.b+' h')+'</span>').join(' · ')+'</div>';
  if(!mv.length && !s.added.length && !s.removed.length && !s.worse.length) h += '<div class="pch">Nothing else changes: the plan absorbs it.</div>';
  if(s.calNote) h += '<div class="faint">Moving or deleting calendar events is not included in this check.</div>';
  return h + '<div class="crow"><button class="btn pri" data-wi="do">Do it</button><button class="btn" data-wi="no">Never mind</button><span class="faint">Nothing is saved until you pick Do it.</span></div></div>';
}
function whatIfAct(b){
  if(b.dataset.wi==='do'){ compose.whatIf = false; compose.sim = null; }
  else compose = freshCompose();
  render();
}

/* ---------- 1. readings sized from the book ----------
   A reading task with a book (linked in t.files, or found by name) gets its pages from the book: the chapter is found in the
   PDF's contents (outline) by its title, or, without contents, the model reads the contents pages and code maps printed page
   numbers to PDF pages. Hours = pages / his reading pace (learned from finished readings, RULES_CFG.readPace until then).
   Parts of at most RULES_CFG.splitAt hours, ending at section starts where one is close. Titles carry the printed pages:
   "Read The Culture Industry pp. 39–45 (part 1 of 2)". t.pages = {file, from, to} (PDF pages, 1-based); Open PDF starts there.
   Runs only when a reading is defined or a book is linked to it, never in the background. */
const READ_RE = /^\s*(?:read|re-?read|skim|finish reading|lesen)\b/i;
const PP_RE = /\s*\bpp?\.\s*[\dixvlc]+\s*(?:[–-]\s*[\dixvlc]+)?/i;
const readBase = title => String(title).replace(PART_RE,'').replace(PP_RE,'').trim();
const readWant = title => readBase(title).replace(READ_RE,'').replace(/^\s*(?:the\s+)?(?:chapter|text|essay|reading)\s*(?:on|about|:)?\s*/i,'').trim();
function readPace(cid){
  /* measured while reading (readtime.js, 27 Nov 2026): this course's own pace first, then finished readings, then all reading */
  const own = typeof trackedPace==='function' ? trackedPace(cid) : null; if(own) return Math.min(60, Math.max(4, own));
  const rows = allTasks().filter(({t})=>t.status==='done' && t.pages && Number(t.spent)>0), mine = rows.filter(x=>x.c.id===cid);
  const all = typeof trackedPace==='function' ? trackedPace(null) : null;
  const use = mine.length >= 3 ? mine : rows.length >= 5 ? rows : null; if(!use) return all ? Math.min(60, Math.max(4, all)) : RULES_CFG.readPace;
  const pages = use.reduce((s,{t})=>s+(t.pages.to-t.pages.from+1),0), hours = use.reduce((s,{t})=>s+Number(t.spent),0);
  return Math.min(60, Math.max(4, pages/hours));
}
const PDFINFO = {};
const bookInfo = path => PDFINFO[path] || (PDFINFO[path] = APP.call('pdfInfo', {path}).catch(e=>({error:e.message})));
const pageLabel = (info, n) => { const l = (info.labels||[])[n-1]; return l && /^(\d+|[ivxlc]+)$/i.test(l) ? l : String(n); };
/* the chapter in the outline whose title holds the reading's words; it ends where the next entry at its level (or above) starts */
function outlineRange(info, want){
  const w = titleWords(want); if(!w.size) return null;
  const o = info.outline||[]; let best = null, bestS = 0;
  o.forEach((x,i)=>{ const tw = titleWords(x.title); let n = 0; w.forEach(k=>{ if(tw.has(k)) n++; }); const s = n/w.size; if(s > bestS + 1e-9 || (best && Math.abs(s-bestS)<1e-9 && x.title.length < o[best].title.length)){ bestS = s; best = i; } });
  if(best==null || bestS < (w.size <= 2 ? 0.99 : 0.6)) return null;
  const e = o[best], next = o.slice(best+1).find(x=>x.level <= e.level && x.page > e.page);
  const to = next ? next.page-1 : info.pages;
  return {from:e.page, to:Math.max(e.page, to), title:e.title, breaks:o.slice(best+1).filter(x=>x.level > e.level && x.page > e.page && x.page <= to).map(x=>x.page)};
}
/* printed page number -> PDF page: the page labels when the PDF has them, else the page whose first or last line is that number */
function printedToPdf(info, n){
  const labels = info.labels||[]; let i = labels.findIndex(l=>l===String(n)); if(i>=0) return i+1;
  const offs = {}; (info.edges||[]).forEach((e,j)=>e.split(' | ').forEach(line=>{ if(/^\d{1,4}$/.test(line.trim())) { const o = j+1-Number(line.trim()); offs[o] = (offs[o]||0)+1; } }));
  const o = Object.entries(offs).sort((a,b)=>b[1]-a[1])[0]; return o && o[1] >= 3 ? Number(n)+Number(o[0]) : null;
}
async function modelRange(info, want){
  if(!info.front) return null;
  const prompt = 'These are the first pages of a book. Find the reading "'+want+'" in its table of contents. Reply with JSON only: {"start":"printed page number where it starts","end":"printed page number where it ends"}, or {"start":null} if it is not listed.\n\n'+String(info.front).slice(0, 30000);
  try{
    const red = redact(prompt, {heuristics:false}), r = await APP.call('llm', {prompt, remotePrompt: red.text, order: llmOrder()});
    const j = extractJSON(restore(r.text, red.map)), a = printedToPdf(info, parseInt(j.start,10)), b = printedToPdf(info, parseInt(j.end,10));
    return a && b && b >= a ? {from:a, to:b, title:want, breaks:[]} : null;
  }catch(e){ return null; }
}
/* split pages into parts of at most splitAt hours, each ending just before a section start when one is near the even split */
function pageParts(from, to, pace, breaks){
  const pages = to-from+1, n = Math.max(1, Math.ceil(pages/pace/RULES_CFG.splitAt - 1e-6)), size = pages/n, out = []; let s = from;
  for(let k=1;k<n;k++){ const ideal = Math.round(from + k*size), near = (breaks||[]).filter(b=>b > s+1 && Math.abs(b-ideal) <= size*0.25).sort((a,b)=>Math.abs(a-ideal)-Math.abs(b-ideal))[0];
    const cut = near || ideal; out.push([s, cut-1]); s = cut; }
  out.push([s, to]); return out;
}
async function bookRange(path, want, given){
  const info = await bookInfo(path); if(!info || info.error || !info.pages) return null;
  /* pages he (or the planner) named in the title win: "Read Hall pp. 151–165" */
  const m = given && /\bpp?\.\s*(\d{1,4})\s*[–-]\s*(\d{1,4})/i.exec(given), a = m && printedToPdf(info, +m[1]), b = m && printedToPdf(info, +m[2]);
  const r = (a && b && b >= a ? {from:a, to:b, title:want, breaks:[]} : null) || outlineRange(info, want) || await modelRange(info, want); if(!r) return null;
  return Object.assign(r, {info});
}
/* Sizing for one reading: the task and its sibling parts (existing, in part order) or the new parts in p.tasks. */
async function sizeGroup(c, base, file, given){
  const path = folderOf(c)+'/'+file, want = readWant(base) || base;
  const r = await bookRange(path, want, given); if(!r) return {miss:'Could not find "'+want+'" in the contents of '+file.split('/').pop().replace(/\.pdf$/i,'')+'; its hours are as before.'};
  const pace = readPace(c.id), parts = pageParts(r.from, r.to, pace, r.breaks), n = parts.length, lab = x => pageLabel(r.info, x);
  const items = parts.map(([a,b],k)=>({title:base+' pp. '+lab(a)+'–'+lab(b)+(n>1?' (part '+(k+1)+' of '+n+')':''), est:Math.max(0.25, q4((b-a+1)/pace)), pages:{file, from:a, to:b}}));
  const pages = r.to-r.from+1;
  return {items, note:'Sized from the book: '+want+', pp. '+lab(r.from)+'–'+lab(r.to)+' ('+pages+' pages, '+r1(pages/pace)+' h at '+r1(pace)+' pages an hour).'};
}
const isPdf = f => /\.pdf$/i.test(String(f||''));
async function sizeReadings(p){
  if(typeof IN_APP==='undefined' || !IN_APP) return;
  const notes = [];
  /* new readings in this answer */
  const groups = {};
  (p.tasks||[]).forEach((t,i)=>{ if(!READ_RE.test(t.title) || !t.course || t.pages) return; const k = t.course+'|'+readBase(t.title); (groups[k] = groups[k]||[]).push(i); });
  const replace = [];
  for(const k of Object.keys(groups)){
    const idx = groups[k], first = p.tasks[idx[0]], c = cById(first.course); if(!c) continue;
    const file = (first.files||[]).find(isPdf) || pdfsFor(c, {title:first.title}).find(isPdf); if(!file) continue;
    const g = await sizeGroup(c, readBase(first.title), file, first.title);
    if(g.miss){ (p.unused = p.unused||[]).push(g.miss); continue; }
    replace.push({idx, parts:g.items.map(x=>Object.assign({}, first, x, {files:[file], due:first.pinned?first.due:'', estNote:''}))}); notes.push(g.note);
  }
  if(replace.length){ const drop = new Set(replace.flatMap(r=>r.idx)); const add = replace.flatMap(r=>r.parts); p.tasks = p.tasks.filter((t,i)=>!drop.has(i)).concat(add); p.tasks.forEach(t=>{ if(!t.pinned) t.due = ''; }); placeNew(p); p.tasks.forEach(t=>{ if(!t.due) t.due = TODAY; }); }
  /* a book linked to an existing reading: that reading and its other open parts are sized again */
  for(const u of (p.updates||[]).slice()){
    const c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id); if(!t || !READ_RE.test(u.changes.title||t.title)) continue;
    const file = (u.changes.files||[]).find(isPdf); if(!file || (t.pages && t.pages.file===file)) continue;
    const s = await sizeExisting(c, t, file); if(!s) continue;
    if(s.miss){ (p.unused = p.unused||[]).push(s.miss); continue; }
    p.updates = p.updates.filter(x=>!s.ids.has(x.id)).concat(s.updates); p.tasks = (p.tasks||[]).concat(s.tasks); p.removes = (p.removes||[]).concat(s.removes.filter(r=>!(p.removes||[]).some(x=>x.id===r.id)));
    if(s.tasks.length) placeNew(p);
    notes.push(s.note);
  }
  if(notes.length) p.summary = [p.summary].concat(notes).filter(Boolean).join(' ');
}
/* the existing open parts of a reading, sized from the book: reused in part order, extra parts added, parts left over removed */
async function sizeExisting(c, t, file){
  const base = readBase(t.title), sib = (c.tasks||[]).filter(x=>x.status!=='done' && x.did===t.did && readBase(x.title)===base)
    .sort((a,b)=>((partInfo(a)||{n:0}).n-(partInfo(b)||{n:0}).n) || String(a.due).localeCompare(String(b.due)));
  if(!sib.includes(t)) sib.push(t);
  const g = await sizeGroup(c, base, file, sib.some(x=>x.pages) ? '' : t.title); if(g.miss) return {miss:g.miss};
  const ids = new Set(sib.map(x=>x.id)), updates = [], tasks = [], removes = [];
  g.items.forEach((x,k)=>{
    const o = sib[k];
    if(o){ const ch = {title:x.title, est:x.est, pages:x.pages}; const had = Array.isArray(o.files) ? o.files : []; if(!had.includes(file)) ch.files = had.concat([file]); updates.push({course:c.id, id:o.id, changes:ch, pin:false}); }
    else tasks.push({course:c.id, did:t.did, title:x.title, due:'', pinned:false, est:x.est, where:t.where, note:'', files:[file], pages:x.pages, estNote:''});
  });
  sib.slice(g.items.length).forEach(o=>removes.push({course:c.id, id:o.id, reason:'Fewer parts after sizing from the book'}));
  return {ids, updates, tasks, removes, note:g.note};
}
/* After a book is tagged to a reading in the filing panel: the sizing opens as the usual preview on Today. */
async function sizeFromFiling(cid, tid, rel){
  const c = cById(cid), t = c && (c.tasks||[]).find(x=>x.id===tid);
  if(!t || !READ_RE.test(t.title) || !isPdf(rel) || compose.busy || compose.proposal || (t.pages && t.pages.file===rel)) return;
  const s = await sizeExisting(c, t, rel); if(!s) return;
  if(s.miss){ flToast(s.miss); return; }
  const p = emptyProposal(s.note); p.updates = s.updates; p.tasks = s.tasks; p.removes = s.removes;
  if(p.tasks.length) placeNew(p);
  compose = freshCompose(); compose.proposal = p; render();
}

/* clicks and edits */
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-risk],[data-riskcls],[data-wait],[data-wi],[data-draft],[data-unskip]'); if(!b) return;
  e.preventDefault();
  if(b.dataset.unskip){ const [day, i] = b.dataset.unskip.split('|'), doc = DAYS[day]; if(doc && doc.skip && doc.skip[+i]){ doc.skip.splice(+i,1); if(!doc.skip.length) delete doc.skip; saveDay(day); } return render(); }
  if(b.dataset.risk) return riskAct(b);
  if(b.dataset.riskcls){ const [day, i] = b.dataset.riskcls.split('|'), e2 = classesOn(day)[+i]; if(!e2) return; RISK.open = ''; compose = freshCompose(); compose.proposal = classWorkProposal(classWorkOf(day, e2)); render(); window.scrollTo({top:0, behavior:'smooth'}); return; }
  if(b.dataset.wait) return waitAct(b);
  if(b.dataset.wi) return whatIfAct(b);
  if(b.dataset.draft==='close'){ delete DRAFTS[b.dataset.k]; return render(); }
  if(b.dataset.draft==='copy'){ const d = DRAFTS[b.dataset.k]; if(d && navigator.clipboard) navigator.clipboard.writeText(d.text).then(()=>{ b.textContent = 'Copied'; }).catch(()=>{}); }
});
document.addEventListener('input', e=>{ const k = e.target && e.target.dataset && e.target.dataset.draftk; if(k && DRAFTS[k]) DRAFTS[k].text = e.target.value; });
