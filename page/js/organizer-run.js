/* The background organizer run (js/organize.js holds the pure organizer), splitting, planning runs and applying proposals. Part of page/index_v2.html; classic script, loaded in order. */
/* ---------- organizing the plan in the background: find the gaps, even the load ----------
   The organizer itself is js/organize.js (pure, tested in test/organize.test.js). This part gives it the day:
   free time at home on the clock, commute days, and the time now. Splitting is NOT done there: big work is split
   when a task is added or context is given (splitBig). */
const {PART_RE, partInfo, deadlineOf} = Organizer;
/* Busy times he told the planner about ("I'm busy Thursday", "no time tomorrow until 15:00"), stored in the plan as
   days/<YYYY-MM-DD> = {id, busy:[{from, to, note}]} (minutes). They take time out of freeAtHome like calendar events,
   so the organizer moves work off them and never fills them. */
let DAYS = {};
const busyOn = d => ((DAYS[d]||{}).busy||[]);
function saveDay(d){ const doc = DAYS[d]; if(!dbh || !doc) return; dbh.doc('days/'+d).set(JSON.parse(JSON.stringify(doc))).catch(e=>console.error('save failed', e)); scheduleOrganize(); }
function addBusy(day, from, to, note){ const doc = DAYS[day] = DAYS[day] || {id:day, busy:[]}; doc.busy = doc.busy.filter(b=>b.to<=from || b.from>=to).concat([{from, to, note:String(note||'').slice(0,120)}]).sort((a,b)=>a.from-b.from); saveDay(day); }
/* Classes he uses as work time: days/<YYYY-MM-DD>.classWork = [{course, from, to}] (minutes). Shown on the class and to the model. */
const classWorkOn = (d, cid) => (((typeof DAYS!=='undefined' && DAYS[d])||{}).classWork||[]).find(w=>!cid || w.course===cid) || null;
function addClassWork(day, w){ const doc = DAYS[day] = DAYS[day] || {id:day, busy:[]}; doc.classWork = (doc.classWork||[]).filter(x=>x.course!==w.course).concat([{course:w.course, from:w.from, to:w.to}]); saveDay(day); }
/* a class or event he will not attend (on) or will after all (off), kept in days/<day>.skip */
function setSkip(day, x, on){
  const doc = DAYS[day] = DAYS[day] || {id:day, busy:[]}, same = y => x.ev ? y.ev===x.ev : (!y.ev && y.c===x.c && y.s===x.s);
  doc.skip = (doc.skip||[]).filter(y=>!same(y));
  if(on) doc.skip.push(x.ev ? {ev:x.ev, t:String(x.title||'').slice(0,80)} : {c:x.c, s:x.s});
  if(!doc.skip.length) delete doc.skip;
  saveDay(day);
}
function removeBusy(day, i){ const doc = DAYS[day]; if(!doc) return; doc.busy.splice(i,1); saveDay(day); }
const busyLabel = b => b.from<=DAY_START && b.to>=DAY_END ? 'all day' : toHM(b.from)+'–'+toHM(b.to);
/* Time at home that work can use, on the clock: he wakes at 09:00 (DAY_START) and stops at 22:00 (DAY_END). Away time on class
   days (leaving 2.5 h before the first class until home), timed calendar events and busy times he told the planner about
   (BUSY, from "I'm busy Thursday" notes) are taken out, so early mornings are commute only and desk time before uni exists only
   when a class starts late. At most HEAVY hours of work a day. */
let DAY_START = RULES_CFG.dayStart, DAY_END = RULES_CFG.dayEnd;
const AWAY_TITLE = /\b(trip|travel|away|reise|urlaub|ferien|verreist|viaje|vacaciones|vacation|holiday|conference|konferenz|congreso|retreat|excursion|exkursion)\b/i;
function freeAtHome(d, from){
  let free = [[Math.max(DAY_START, from||0), DAY_END]].filter(([x,y])=>y>x);
  const cut = (a, b) => { free = free.flatMap(([x,y])=> b<=x || a>=y ? [[x,y]] : [[x,Math.min(a,y)],[Math.max(b,x),y]].filter(([p,q])=>q>p)); };
  const tm = dayTimes(d); if(tm) cut(tm.leave, tm.home);
  /* sessions online take their hours; in person elsewhere 1 h each way (homeAfterOther) */
  classesOn(d).filter(e=>e.o).forEach(e=>{ const a = toMin(e.s), b = e.e ? toMin(e.e) : a + 90, w = e.o==='near' ? RULES_CFG.homeAfterOther : 0; cut(a - w, b + w); });
  if(typeof HAS_CAL!=='undefined' && HAS_CAL) busyEventsOn(d).filter(e=>!e.allDay).forEach(e=>cut(evMin(e.start), String(e.end).slice(0,10)===d ? evMin(e.end) : DAY_END));
  /* an all-day trip, holiday or conference takes the whole day (19 Nov 2026 user test: work stayed on a Hamburg trip) */
  if(typeof HAS_CAL!=='undefined' && HAS_CAL && busyEventsOn(d).some(e=>e.allDay && AWAY_TITLE.test(String(e.title||'')))) cut(0, 24*60);
  busyOn(d).forEach(b=>cut(b.from, b.to));
  return free.reduce((s,[x,y])=>s+(y-x),0)/60;
}
const deskCap = d => Math.min(HEAVY, freeAtHome(d));
const q4 = x => Math.round(x*4)/4;
let AHEAD_DAYS = RULES_CFG.aheadDays;
onProfile(()=>{ DAY_START = RULES_CFG.dayStart; DAY_END = RULES_CFG.dayEnd; AHEAD_DAYS = RULES_CFG.aheadDays; }); /* today is topped up only from work planned this close */
const nowMinutes = () => { const nd = new Date(); return iso(nd)===TODAY ? Math.ceil((nd.getHours()*60+nd.getMinutes())/15)*15 : DAY_START; };
const orgEnv = () => ({today:TODAY, nowMin:nowMinutes(), freeAtHome, isCommute, homeMin: d => (dayTimes(d)||{}).home ?? null, heavy:HEAVY, commuteCap:COMMUTE_CAP, aheadDays:AHEAD_DAYS, dayEnd:DAY_END, maxEarly:RULES_CFG.maxEarly, levelTol:RULES_CFG.levelTol, fixedCourses:RULES_CFG.waitsForWeek});
const organizePlan = cs => Organizer.organizePlan(cs, orgEnv());
const organizeProblems = (real, copy, moves) => Organizer.organizeProblems(real, copy, moves, TODAY);

/* Background run, and one line on Today: what moved where, with Undo. */
let ORG = {last:null, key:''}, orgTimer = null;
const orgKey = () => allTasks().map(({t})=>t.id+':'+t.due+':'+t.est+':'+t.where+':'+t.status+':'+(t.pin||'')).sort().join('|') + '#' + JSON.stringify(DAYS);
/* after Undo it waits until a task is added or changed (ticking tasks done does not count) */
const orgShape = () => allTasks().map(({t})=>t.id+':'+t.title+':'+t.due+':'+t.est+':'+t.where).sort().join('|');
function scheduleOrganize(ms){ if(typeof IN_APP==='undefined' || !IN_APP) return; clearTimeout(orgTimer); orgTimer = setTimeout(runOrganize, ms||1500); }
/* Every organizer move is also kept in a change log (localStorage "orgLog", last 300): what moved, from where to where, when.
   Undo uses the moves, never a snapshot: it puts back only the day of tasks that are still where the organizer left them,
   so ticks, edits and new tasks made since are kept. */
const orgLog = () => { try{ return JSON.parse(lsGet('orgLog')||'[]'); }catch(e){ return []; } };
function logMoves(list){ lsSet('orgLog', JSON.stringify(list.concat(orgLog()).slice(0,300))); }
function runOrganize(){
  if(!courses.length || compose.busy){ scheduleOrganize(5000); return; }
  const key = orgKey(); if(key===ORG.key) return;
  if(lsGet('orgSkip') && orgShape()===lsGet('orgSkip')){ ORG.key = key; return; }
  lsSet('orgSkip', '');
  Organizer.orderParts(courses).forEach(save);     /* parts of one task in part order, pinned ones too */
  Organizer.setPlanDates(courses).forEach(save);   /* undated deliverables keep a planning date (soft deadline) */
  /* work on a copy; apply only if every safety check passes */
  const copy = JSON.parse(JSON.stringify(courses));
  const r0 = organizePlan(copy), bad = organizeProblems(courses, copy, r0.moves);
  if(bad.length){ console.warn('organizer result not applied:', bad); ORG.key = key; return; }
  const moves = r0.moves.map(m=>{ const c = cById(m.c.id), t = c && (c.tasks||[]).find(x=>x.id===m.t.id); t.due = m.to; if(m.t.pin===undefined) delete t.pin; else t.pin = m.t.pin; return {c, t, from:m.from, to:m.to, today:m.today, carried:m.carried, late:m.late}; });
  /* same order inside each course list as the copy (keeps the next run stable) */
  if(moves.length) copy.forEach(cc=>{ const c = cById(cc.id); if(!c || !c.tasks) return; const pos = new Map(cc.tasks.map((t,i)=>[t.id,i])); c.tasks.sort((a,b)=>pos.get(a.id)-pos.get(b.id)); });
  if(moves.length){
    const at = new Date().toISOString();
    const list = moves.map(m=>({at, course:m.c.id, id:m.t.id, title:m.t.title, from:m.from, to:m.to}));
    logMoves(list);
    ORG.last = {moves: list.concat(ORG.last ? ORG.last.moves : []).slice(0,80)};
    new Set(moves.map(m=>m.c)).forEach(save);
  }
  ORG.key = orgKey(); render();
}
function organizeNote(){
  const L = ORG.last; if(!L || !L.moves.length) return '';
  const n = L.moves.length;
  return '<details class="fold dupnote"><summary>Plan organized: moved '+n+' task'+(n===1?'':'s')+' into free time, nearest deadline first <button class="lnk" data-org="undo">Undo</button> <button class="lnk" data-org="ok">OK</button></summary>'
    + L.moves.slice().sort((a,b)=>a.to.localeCompare(b.to)).map(m=>'<div class="pch">'+esc(m.title)+' <span class="faint">'+esc(fmtShort(m.from))+' → </span>'+esc(fmtShort(m.to))+' <span class="muted">· '+esc(cnm(m.course))+'</span></div>').join('')+'</details>';
}
function organizeAct(act){
  if(act==='undo' && ORG.last){ Organizer.undoMoves(courses, ORG.last.moves).forEach(save); lsSet('orgSkip', orgShape()); }
  ORG.last = null; ORG.key = orgKey(); render();
}
/* Splitting happens when a task is defined: a new task over 2 h becomes parts of at most 2 h in the preview,
   on the next suitable days (commute days for train and metro work) before its deadline. Desk work whose size he gave himself
   stays in blocks of up to `blockAt` hours (18 Nov 2026: "two full days" became 12 parts). */
function splitBig(tasks, deadlineFor, blockAt){
  const out = [];
  tasks.forEach(t=>{
    const est = Number(t.est)||0;
    const at = t.stated && t.where==='desk' ? (blockAt || HEAVY) : RULES_CFG.splitAt;
    if(est <= at + 1e-6 || PART_RE.test(t.title)){ out.push(t); return; }
    const n = Math.ceil(est/at - 1e-6), each = q4(est/n), dl = deadlineFor(t) || '9999-12-31', commute = t.where==='train' || t.where==='phone';
    let day = t.due;
    for(let k=1;k<=n;k++){
      if(k>1){ const stop = addDays(day, 60); let d = addDays(day,1); while(d <= dl && d <= stop && commute && !isCommute(d)) d = addDays(d,1); if(d <= dl && d <= stop) day = d; }
      out.push(Object.assign({}, t, {title:t.title+' (part '+k+' of '+n+')', est:k<n ? each : q4(est - each*(n-1)), due:day, pinned: k===1 && !!t.pinned}));
    }
  });
  return out;
}
/* Live progress while planning: steps, seconds, and what the model has found so far. */
let PLAN_TIMER = null;
function planProgress(){
  const c = compose, sec = Math.floor((Date.now()-(c.t0||Date.now()))/1000);
  if(c.setup){ const st = ['Reading the documents','Claude Opus is reading','Sizing the readings from the books','Checking it against your plan'], at = Math.max(0, st.indexOf(c.setupStage));
    return '<div class="pbar2" aria-hidden="true"><i></i></div><ol class="psteps">'+st.map((x,i)=>'<li class="'+(i<at?'ok':i===at?'pcur':'')+'">'+(i<at?'✓ ':'')+esc(x)+(i===at?' <span class="mono muted">'+sec+' s</span>':'')+'</li>').join('')+'</ol>'+(sec>=40?'<div class="faint">Long documents take a minute. It is still working.</div>':''); }
  const who = llmOrder()[0]==='claude' && c.model==='sonnet' ? 'Claude Sonnet' : PROV[llmOrder()[0]] || 'the model';
  const steps = [['read','Read your plan'],['ask',(c.stage==='ask'&&c.stream?'Writing the plan':'Asking '+who)],['check','Checking it against your week']];
  if(c.stage==='fix') steps.splice(2, 0, ['fix','Fixing what did not fit (Claude Sonnet)']);
  const think = (String(c.stream||'').match(/"think"\s*:\s*"((?:[^"\\]|\\.)*)/)||[])[1];
  const at = steps.findIndex(x=>x[0]===c.stage);
  const titles = [...String(c.stream||'').matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m=>m[1].replace(/\\"/g,'"'));
  return '<div class="pbar2" aria-hidden="true"><i></i></div><ol class="psteps">'+steps.map((x,i)=>'<li class="'+(i<at?'ok':i===at?'pcur':'')+'">'+(i<at?'✓ ':'')+esc(x[1])+(i===at?' <span class="mono muted">'+sec+' s</span>':'')+'</li>').join('')+'</ol>'
    + (think?'<div class="pfound"><span class="muted">Reading it as</span><div>'+esc(think.replace(/\\"/g,'"').replace(/\\n/g,' '))+'</div></div>':'')
    + (titles.length?'<div class="pfound"><span class="muted">Found so far</span>'+titles.slice(-6).map(t=>'<div>'+esc(t)+'</div>').join('')+'</div>':'')
    + (sec>=20&&!titles.length?'<div class="faint">Longer than usual. It is still working.</div>':'');
}
function paintProgress(){ const el = document.getElementById('cmp-prog'); if(el) el.innerHTML = planProgress(); }
async function runCompose(){
  const text = compose.draft.trim(); if(!text || compose.busy) return;
  /* one chat for planning and setting up (onboard.js): an open set-up takes the answer; "set up <course>" starts one in code */
  if(compose.setup && !compose.proposal) return setupAnswer(text);
  if(typeof SETUP_RE!=='undefined' && SETUP_RE.test(text) && !compose.thread.length){ const ids = [...noteScope(text).cids].filter(id=>id!==ADMIN_ID || /admin/i.test(text));
    if(ids.length===1){ compose.thread = [{role:'user', text}]; compose.draft = ''; return chatSetup(ids[0], {keepThread:true, auto:true}); } }
  compose.thread.push({role:'user', text}); if(typeof WHATIF_RE!=='undefined' && WHATIF_RE.test(text)) compose.whatIf = true; compose.draft = ''; compose.busy = true; compose.error = ''; compose.done = ''; compose.questions = null;
  compose.t0 = Date.now(); compose.stage = 'read'; compose.stream = ''; render();
  clearInterval(PLAN_TIMER); PLAN_TIMER = setInterval(paintProgress, 500);
  const sid = 'plan'+Date.now();
  STREAM = {sid, on: t => { compose.stream += t; paintProgress(); }};
  try{
    const slot = compose.pendingSize || compose.prepared ? null : shortSlotFromNote(text);
    if(slot){
      const f = fillSlot(slot);
      if(!f.picked) throw new Error(f.summary);
      if(!f.updates.length){ compose.done = f.summary; compose.thread = []; clearInterval(PLAN_TIMER); compose.busy = false; render(); return; }
      compose.proposal = Object.assign(emptyProposal(f.summary), {updates:f.updates.map(u=>Object.assign(u, {pin:true}))});
      clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; render(); return;
    }
    /* Busy time and free time are read in code. A short note that is only that needs no model at all. */
    const said = compose.thread.filter(m=>m.role==='user').map(m=>m.text).join(' ');
    const busy = compose.pendingEvent || compose.pendingSize || compose.prepared ? null : (todayCapFromNote(text) || busyFromNote(text));
    const avail0 = busy || compose.pendingEvent || compose.pendingSize || compose.prepared ? null : freeTimeFromNote(text);
    const unb = busy || compose.pendingEvent || compose.pendingSize || compose.prepared ? [] : unbusyFromNote(text);
    if(unb.length && text.trim().split(/\s+/).length <= 20){
      compose.proposal = Object.assign(emptyProposal('No longer busy: '+[...new Set(unb.map(b=>fmtShort(b.day)+' '+busyLabel(b)))].join(', ')+'. The planner can use that time again.'), {unbusy:unb});
      clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; render(); return;
    }
    const evNote = eventFromNote(text);   /* a busy note that names what it is ("dentist at 14:00") is also an appointment: then the model runs too */
    /* days away or a day off are busy time even with a place in the note ("bin in Hamburg") */
    const away = busy && (busy.days.length > 1 || DAYOFF_RE.test(text));
    if((busy || avail0) && text.trim().split(/\s+/).length <= (away ? 30 : 14) && (away || !evNote || (busy && !busyTitle(evNote)))){
      compose.proposal = busy ? busyProposal(busy) : freeProposal(avail0);
      if(!hasChanges(compose.proposal)) throw new Error(compose.proposal.summary);
      clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; render(); return;
    }
    /* A class used as work time is filled in code. A short note that is only that needs no model. */
    const cw = compose.pendingEvent || compose.pendingSize ? null : classWorkFromNote(said);
    const cmiss = cw || compose.pendingEvent || compose.pendingSize ? '' : classWorkMiss(text);
    if(cmiss && text.trim().split(/\s+/).length <= 20){ compose.done = cmiss; compose.thread = []; clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; render(); return; }
    if(cw && text.trim().split(/\s+/).length <= 40 && !/\b(also|add|new task|deadline|moves?|remind)\b/i.test(text)){
      compose.proposal = classWorkProposal(cw);
      clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; render(); return;
    }
    /* The answer to "How long will it take?": read in code, put on the model's answer that was waiting for it. No model call. */
    const ps = compose.pendingSize; compose.pendingSize = null;
    let r, raw; compose.repaired = 0; compose.fixModel = '';
    if(ps){
      const hs = sizesFrom(text), list = ps.ask.map(i=>ps.raw.tasks[i]);
      if(!hs.length && SIZE_SKIP_RE.test(text)) list.forEach(t=>{ t.stated = false; });   /* "you guess": the model's estimate stays */
      else {
        const each = /\b(each|both|all|cada un[oa]?|cada|je|jeweils|beide)\b/i.test(text);   /* "1 h each" */
        const per = hs.length===list.length ? hs : list.length===1 && hs.length ? [hs.reduce((a,b)=>a+b,0)] : hs.length===1 && each ? list.map(()=>hs[0]) : null;
        if(!per){ compose.pendingSize = ps; compose.questions = [hs.length ? 'I read '+hs.length+' time'+(hs.length===1?'':'s')+' for '+list.length+' tasks. '+sizeQuestion(list) : sizeQuestion(list)]; compose.thread.push({role:'assistant', text:compose.questions[0]}); throw new Error(''); }
        list.forEach((t,i)=>{ t.minutes = Math.round(per[i]*60); t.fullDays = 0; t.asked = true; });
      }
      r = {provider: ps.provider}; raw = ps.raw; compose.repaired = ps.repaired || 0; compose.model = ps.model || ''; compose.fixModel = ps.fixModel || '';
    } else {
      const full = composePrompt(), red = redact(full);
      compose.stage = 'ask'; paintProgress();
      const model = needsSonnet(said) ? 'sonnet' : 'haiku'; compose.model = model;
      r = await APP.call('llm', {prompt: full, remotePrompt: red.text, sid, schema: PLAN_SCHEMA, order: llmOrder(), model});
      compose.model = r.model || '';
      compose.stage = 'check'; paintProgress();
      if(!r.text) throw new Error('No model answered. '+(r.errors||[]).join(' · '));
      raw = extractJSON(r.provider==='ollama' ? r.text : restore(r.text, red.map));
      compose.hidden = r.provider==='ollama' ? 0 : Object.keys(red.map).length;
      arr(raw && raw.tasks).forEach(t=>{ if(t && typeof t==='object') delete t.asked; });   /* "asked" is set only in code */
      /* Second look (19 Nov 2026, the user's question: why the helper "can't think how to solve little things"): what code could not
         use goes back to the model once, with the reasons, instead of ending as a warning. The fix is kept only if it leaves fewer problems. */
      const said0 = compose.thread.filter(m=>m.role==='user').map(m=>m.text).join(' ');
      const probs = raw && !(arr(raw.questions).length && !arr(raw.tasks).length) && !str(raw.answer).trim() ? repairList(raw, said0) : [];
      if(probs.length){
        compose.stage = 'fix'; paintProgress();
        try{
          const full2 = repairPrompt(full, raw, probs), red2 = redact(full2);
          const r2 = await APP.call('llm', {prompt: full2, remotePrompt: red2.text, sid: sid+'b', schema: PLAN_SCHEMA, order: [r.provider], model: 'sonnet'}); compose.fixModel = r2.model || '';
          const raw2 = r2.text ? extractJSON(r2.provider==='ollama' ? r2.text : restore(r2.text, red2.map)) : null;
          if(raw2){ arr(raw2.tasks).forEach(t=>{ if(t && typeof t==='object') delete t.asked; });
            const asks = arr(raw2.questions).length && !arr(raw2.tasks).length && !arr(raw2.updates).length && !arr(raw2.events).length;
            const left = asks ? 0 : repairList(raw2, said0).length;
            if(asks || left < probs.length){ raw = raw2; compose.repaired = probs.length - left; } }
        }catch(e){ /* the first answer stands */ }
      }
    }
    compose.provider = r.provider;
    /* An appointment read in code: from this note, or the one waiting for this answer. */
    const avail = avail0;
    /* notes the app writes itself ("What can I cut?", a help-session decision) are not read for appointments (19 Nov 2026 user
       test: "at least 5 h" became a 05:00 appointment question) */
    /* "it's not an appointment" ends the appointment question instead of asking it again (19 Nov 2026 user test) */
    if(compose.pendingEvent && /\b(not an? (?:appointment|event)|no appointment|kein(?:e|en)? termin|no es (?:una )?cita|no es un evento|keine zeit|no time|busy|ocupad[oa])\b/i.test(text)) compose.pendingEvent = null;
    const local = avail || compose.prepared ? null : ps ? ps.local : compose.pendingEvent ? fillEvent(compose.pendingEvent, text) : eventFromNote(text);
    const ask = qs => { compose.questions = qs; compose.thread.push({role:'assistant', text:qs.join(' ')}); };
    const cwork = cw || classWorkFromModel(raw.classWork);
    if(raw.whatIf===true) compose.whatIf = true;
    /* the model read the note as a set-up: code checks the course and reads its folder (prompt item 13) */
    const su = str(raw.setup).trim();
    if(su && cById(su) && !ps){ clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null; compose.busy = false; return chatSetup(su, {keepThread:true, auto:true}); }
    const noChange = !arr(raw.tasks).length && !arr(raw.updates).length && !arr(raw.events).length && !arr(raw.removes).length && !arr(raw.deadlineUpdates).length && !arr(raw.deliverables).length;
    /* a question about the plan that changes nothing gets a plain answer */
    if(str(raw.answer).trim() && noChange && !avail && !cwork && !local){ compose.done = str(raw.answer).trim(); compose.thread = []; compose.whatIf = false; }
    else if(!avail && !cwork && raw.questions && raw.questions.length && !(raw.tasks||[]).length && !(raw.updates||[]).length && !(raw.events||[]).length){ if(local) compose.pendingEvent = local; ask(raw.questions); }
    else if(!ps && (()=>{ sizeByPages(raw, said); const u = unsizedTasks(raw, said); if(!u.length) return false;
        compose.pendingSize = {raw, provider:r.provider, local, repaired:compose.repaired, model:compose.model, fixModel:compose.fixModel, ask:u.map(t=>raw.tasks.indexOf(t))}; ask([sizeQuestion(u)]); return true; })()){ /* asked how long */ }
    else { const p = normalize(raw, r.provider, said); p.repaired = compose.repaired || 0;
      /* a question the model asks next to a plan is shown, not dropped (19 Nov 2026 user test: the email part vanished) */
      arr(raw.questions).map(str).filter(q=>q.trim()).slice(0,3).forEach(q=>p.notes.push('Still open: '+q.trim())); if(unb.length) p.unbusy = unb; p.model = compose.model || ''; p.fixModel = compose.fixModel || ''; if(r.provider!=='claude') await dropRepeats(p);
      if(typeof sizeReadings==='function'){ compose.stage = 'check'; await sizeReadings(p); }
      /* Free time and busy time are decided in code: the model's day moves are replaced by the planner's */
      if(avail){ p.events = p.events.filter(x=>x.op!=='add'); const f = freeProposal(avail); p.updates = p.updates.map(u=>{ const ch = Object.assign({}, u.changes); delete ch.due; delete ch.where; return Object.assign({}, u, {changes:ch, pin:false}); }).filter(u=>Object.keys(u.changes).length).concat(f.updates); p.summary = f.summary + (p.summary ? ' ' + p.summary : ''); }
      if(cwork){ const k = classWorkProposal(cwork), ids = new Set(k.updates.map(u=>u.id)); p.updates = p.updates.filter(u=>!ids.has(u.id)).concat(k.updates); p.classWork = k.classWork; p.summary = k.summary + (p.summary ? ' ' + p.summary : ''); }
      if(busy){ const b = busyProposal(busy); p.updates = p.updates.map(u=>{ const ch = Object.assign({}, u.changes); if(!u.pin){ delete ch.due; delete ch.where; } return Object.assign({}, u, {changes:ch}); }).filter(u=>Object.keys(u.changes).length).concat(b.updates); p.busy = b.busy; p.summary = b.summary + (p.summary ? ' ' + p.summary : ''); }
      /* The model's new event with a made-up title ("Appointment") when the note never said what it is: ask. */
      const vague = p.events.findIndex(x=>x.op==='add' && (!x.title || GENERIC_TITLE.test(x.title.trim())) && !new RegExp('\\b'+String(x.title||'§').replace(/[^\p{L}]/gu,'')+'\\b','iu').test(said));
      let pending = null;
      if(vague >= 0){ const x = p.events.splice(vague,1)[0]; pending = Object.assign(x, {title: local && local.title || ''}); pending.missing = evMissing(pending); if(!pending.missing.length) p.events.push(pending), pending = null; }
      if(!pending && !evChangeCount(p) && !p.tasks.length && local){
        if(local.missing.length) pending = local;
        else if(!CAL.some(e=>evDay(e)===local.date && String(e.start).slice(11,16)===local.start)){ p.events.push(local); if(!hasChanges(p) || /no change|nothing|personal/i.test(p.summary)) p.summary = 'An appointment for your calendar.'; }
      }
      if(pending && !hasChanges(p)){ compose.pendingEvent = pending; ask([evQuestion(pending)]); }
      else {
        if(pending) compose.error = 'Not added to the calendar yet: '+evQuestion(pending);
        if(!hasChanges(p)) throw new Error((p.dropped||[]).length ? 'Already in your plan: '+p.dropped.map(d=>'"'+d.of.slice(0,70)+'"').join(', ')+'.' : (p.unused||[]).length ? 'Nothing changed. '+p.unused.join(' · ') : p.summary ? 'Nothing changed. Read as: '+p.summary : 'Nothing to change was found. Add a little more detail.');
        compose.pendingEvent = null; compose.proposal = p;
      }
    }
  }catch(e){ compose.error = e.message; if(!compose.questions && !compose.proposal){ compose.draft = text; compose.thread.pop(); compose.pendingSize = null; } }
  clearInterval(PLAN_TIMER); if(STREAM && STREAM.sid===sid) STREAM = null;
  compose.busy = false; render();
}
function applyProposal(p){
  const touched = new Set(), keyMap = {}, stamp = Date.now().toString(36), made = p._made = {tasks:[], deliverables:[]};   /* for Undo (actions.js) */
  p.deliverables.forEach((d,i)=>{ const c = cById(d.course); if(!c) return; const id = c.id+'-d'+stamp+i; keyMap[d.key] = id; made.deliverables.push({course:c.id, id}); c.deliverables = c.deliverables||[]; c.deliverables.push({id, title:d.title, date:d.date, state:d.date?'set':'tbd', note:d.note||''}); touched.add(c); });
  p.tasks.forEach((t,i)=>{ const c = cById(t.course); if(!c) return; c.tasks = c.tasks||[]; const nt = {id:c.id+'-t'+stamp+i, did:keyMap[t.did]||t.did||'', title:t.title, due:t.due, est:Number(t.est)||1, status:'todo', note:t.note||'', where:deskOnly(c) ? 'desk' : t.where}; if((t.files||[]).length) nt.files = t.files.slice(); if(t.waiting){ nt.status = 'blocked'; nt.waiting = t.waiting; } if(t.pages) nt.pages = t.pages; if(t.pinned) nt.pin = t.due; c.tasks.push(nt); made.tasks.push({course:c.id, id:nt.id}); touched.add(c); });
  p.updates.forEach(u=>{ const c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id); if(!t) return; const {status:st, ...rest} = u.changes; if(rest.did && keyMap[rest.did]) rest.did = keyMap[rest.did]; Object.assign(t, rest); if(rest.waiting===null) delete t.waiting; if(u.changes.due){ if(u.pin) t.pin = u.changes.due; else delete t.pin; } else if(u.pin && u.changes.where==='class') t.pin = t.due; if(st){ const w = t.waiting; setStatus(t, st); if(st==='blocked' && w) t.waiting = w; } touched.add(c); });
  /* busy time that ended: highest index first per day, so the others keep their place */
  (p.unbusy||[]).slice().sort((a,b)=>a.day.localeCompare(b.day) || b.i-a.i).forEach(b=>{ const doc = DAYS[b.day], x = doc && doc.busy[b.i]; if(x && x.from===b.from && x.to===b.to) removeBusy(b.day, b.i); });
  (p.busy||[]).forEach(b=>b.days.forEach(d=>addBusy(d, b.from, b.to, b.note)));
  /* setting up a course: its class times, its notes (grading, attendance, submission), and that it was set up */
  (p.sessions||[]).forEach(e=>{ const c = cById(e.c); if(!c) return; c.sessions = c.sessions||[]; if(c.sessions.some(x=>x.d===e.d && x.s===e.s)) return; const {c:_, ...rest} = e; c.sessions.push(rest); touched.add(c); });
  if(p.info && p.info.text && cById(p.info.course)){ const c = cById(p.info.course); c.info = p.info.text; touched.add(c); }
  if(p.onboard && cById(p.onboard)){ const c = cById(p.onboard); c.onboarded = TODAY; if(p.meets) c.meets = p.meets; touched.add(c); }
  (p.classWork||[]).forEach(w=>addClassWork(w.day, w));
  (p.skips||[]).forEach(x=>setSkip(x.day, x, !x.attend));
  (p.prios||[]).forEach(x=>{ const c = cById(x.course), d = c && (c.deliverables||[]).find(y=>y.id===x.id); if(!d) return; if(x.rank) d.prio = x.rank; else delete d.prio; touched.add(c); });
  p.dupdates.forEach(u=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(!d) return; d.date = u.changes.date; if(d.state==='tbd'||d.state==='likely') d.state = 'set'; touched.add(c); });
  (p.removes||[]).forEach(r=>{ const c = cById(r.course); if(!c) return; const n = (c.tasks||[]).length; c.tasks = (c.tasks||[]).filter(x=>x.id!==r.id); if(c.tasks.length!==n) touched.add(c); });
  touched.forEach(save);
  return applyCount(p);
}
/* Calendar part of a proposal, written to Calendar.app. Returns an error line for the ones that failed (the plan part still applies). */
async function applyEvents(p){
  if(!evChangeCount(p) || !IN_APP) return '';
  const fails = [];
  for(const x of p.events){
    try{
      let r;
      if(x.op==='add') r = await APP.call('eventSave', evPayload({title:x.title, date:x.date, allDay:!x.start, start:x.start, end:x.end, location:x.location, notes:undefined, calendarId:''}));
      else {
        const e = evByKey(x.key); if(!e) throw new Error('not found');
        if(x.op==='remove') r = await APP.call('eventDelete', {id:e.id, occ:e.start, span:'this'});
        else { const c = x.changes, v = {id:e.id, occ:e.start, title:c.title||e.title, date:c.date||evDay(e), allDay:!!e.allDay, start:c.start||String(e.start).slice(11,16), end:c.end||String(e.end).slice(11,16), location:c.location!==undefined?c.location:(e.location||''), notes:undefined, calendarId:'', span:'this', wasAllDay:!!e.allDay, orig:{date:evDay(e), endDate:String(e.end).slice(0,10), startT:String(e.start).slice(11,16), endT:String(e.end).slice(11,16)}};
          r = await APP.call('eventSave', evPayload(v)); }
      }
      if(r && r.error) throw new Error(r.error);
      if(x.op==='add' && r && r.id) x._id = r.id;   /* Undo deletes it again */
    }catch(err){ fails.push((x.title || (evByKey(x.key)||{}).title || 'event')+': '+err.message); }
  }
  refreshCal();
  return fails.length ? 'Calendar not changed for '+fails.join('; ') : '';
}

/* second brain */
let recTimer = null;
function startRecTimer(){ clearInterval(recTimer); recTimer = setInterval(()=>{ REC.seconds = (Date.now()-REC.started)/1000; const el = document.getElementById('rec-time'); if(el) el.textContent = clockLabel(REC.seconds); }, 1000); }
function md(s){
  const lines = esc(s||'').split('\n'); let out = '', list = false;
  const inline = t => t.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<i>$1</i>');
  let tbl = null;
  const flush = () => { if(!tbl) return; const rows = tbl.filter(r=>!/^\s*\|?\s*:?-{2,}/.test(r)).map(r=>r.replace(/^\s*\||\|\s*$/g,'').split('|').map(c=>inline(c.trim()))); out += '<table class="mdt"><thead><tr>'+rows[0].map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>'; tbl = null; };
  lines.forEach(l=>{
    if(/^\s*\|.*\|\s*$/.test(l)){ if(list){ out += '</ul>'; list = false; } (tbl = tbl || []).push(l); return; }
    flush();
    const li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if(li){ if(!list){ out += '<ul class="mlist2">'; list = true; } out += '<li>'+inline(li[1])+'</li>'; return; }
    if(list){ out += '</ul>'; list = false; }
    const hd = l.match(/^#{1,6}\s+(.*)/);
    if(hd) out += '<h3>'+inline(hd[1])+'</h3>'; else if(l.trim()) out += '<p>'+inline(l)+'</p>';
  });
  flush();
  return out + (list ? '</ul>' : '');
}
let draftTimer = null;
function saveDraft(now){ clearTimeout(draftTimer); const go = ()=>{ if(REC.recording) APP.call('recDraft', {title:REC.title, notes:REC.notes, course:REC.course||''}).catch(()=>{}); }; if(now) go(); else draftTimer = setTimeout(go, 600); }
