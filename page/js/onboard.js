/* Setting up a course or project (19 Nov 2026, the user's request: "when I add a new project/class there should also be an onboarding
   process, asking for syllabus, documents etc"). Since 24 Nov 2026 it runs in the planner chat on Today (one chat for planning
   and setting up; the separate panel is gone). Part of page/index_v2.html; classic script, loaded after assist.js.
   1. Documents: the course folder (its linked folder or ~/Documents/Planner/<short>/), files dropped on the chat or added with
      Add files…, and text pasted into the chat.
   2. Where it meets: asked with buttons when the course has no answer: at the main place (commute day), elsewhere in person (1 h each
      way), online, or no classes.
   3. Claude Opus reads them (redacted) and reports facts: weekly class times, single dated sessions, deliverables with dates,
      weight and what is required, readings by week, first steps with estimates, course notes, and questions only for what
      the documents do not say.
   4. Code builds the rest (AI reads, code decides): class dates from weekday and range, week N on the Nth class, every date
      checked, duplicates left out, deadlines and steps through normalize() and placeNew like any note. The result is the
      usual editable preview, gated as read from documents (actions.js); nothing is saved before Apply. */
let SU = null;   /* the set-up being read now (compose.setup), for onbPrompt, onbSessions and onbProposal */
/* `thb` is the stored value for "at the main place" (old plans keep it); its label comes from the profile */
const ONB_MODES = [['thb','In person at campus','commute day: train and metro time, away from home'],['near','In person, somewhere else','1 h each way, no train time'],['online','Online','only the class hours'],['none','No classes','a project or self-study']];
onProfile(()=>{ ONB_MODES[0][1] = 'In person at '+placeShort(); });
const ONB_WD = {sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6};
const ONB_DOC_CHARS = 90000;   /* about 30 pages of syllabus and briefs; books are listed by name only */

const ONB_SCHEMA = (()=>{ const S = {type:'string'}, N = {type:'number'}, A = items => ({type:'array', items}), obj = props => ({type:'object', properties:props});
  return obj({think:S, questions:A(S), info:A(S),
    sessions:A(obj({weekday:{type:'string', enum:['mon','tue','wed','thu','fri','sat','sun']}, start:S, end:S, room:S, title:S, from:S, to:S, except:A(S)})),
    dates:A(obj({date:S, start:S, end:S, room:S, title:S})),
    deliverables:A(obj({key:S, id:S, title:S, date:{type:['string','null']}, week:{type:['number','null']}, assigned:{type:'boolean'}, weight:S, what:S})),
    tasks:A(obj({did:S, title:S, minutes:N, where:{type:'string', enum:['desk','train','phone']}}))}); })();

function onbPrompt(c, docs, books){
  const mode = (ONB_MODES.find(m=>m[0]===SU.mode)||[])[1] || 'not said';
  const known = allTasks().filter(x=>x.c===c && x.t.status!=='done').map(({t})=>'    '+t.title+' | '+(t.due||'no day')+' | '+t.est+' h').join('\n') || '    none';
  const dls = (c.deliverables||[]).map(d=>'    '+d.id+': '+d.title+' ['+(d.date||d.state||'no date')+']').join('\n') || '    none';
  const own = CLASSES.filter(e=>e.c===c.id && e.d >= TODAY).concat((c.sessions||[]).filter(e=>e.d >= TODAY));
  const times = own.length ? own.length+' class times from '+own[0].d+' (for example '+[...new Set(own.map(e=>fmt(e.d,{weekday:'short'})+' '+e.s+'–'+(e.e||'')))].slice(0,3).join(', ')+')' : 'none';
  return `You are setting up a course or project in a student's study planner. Read the documents and the student's answers and report what the planner needs. Use only facts from them: never invent a date, a time or a room.
Today is ${TODAY} (${fmt(TODAY,{weekday:'long'})}). The term runs ${TERM_START} to ${TERM_END}. Time zone ${profileTZ()}.

Course: ${c.id} · ${c.name||c.short}${c.kind==='project'?' (a project)':''}${c.note?' · '+c.note:''}
The student says it meets: ${mode}.
Already in the planner for it (never repeat these):
  deadlines:
${dls}
  open tasks:
${known}
  class times: ${times}

What to report:
1. "sessions": weekly class meetings: weekday, start and end (HH:MM), room, title (e.g. "Lecture", "Seminar"), first and last date if the documents give them, and dates without class in "except". "dates": single meetings on one date (block seminar, extra session, exam, consultation). Leave both empty when it has no classes or the times above already cover them.
2. "deliverables": everything to hand in, present or sit (assignments, presentations, reports, exams), with "date" when the documents or answers give one; an approximate date ("end of January", "Mitte Dezember", "a finales de enero") is the last day of that period (2027-01-31) or its middle (the 15th); else null, "weight" (points or percent) and "what" (one line: what is required, length, format, where to submit). If one is already in the planner above, give its "id" instead of a new "key", with the date only if the documents give a different one.
   Reading or preparation for one class date ("3 Dec: read Sterne pp. 1–30") is its own deliverable titled "Session <date, e.g. 3 Dec> · <topic>" with that class's date, so it is done before that class.
   Readings numbered by week or session without dates ("Week 2: …", folders "Week 1", "Week 2"): one deliverable per week, titled with its topic, "week" its number, "date" null; the planner puts it before that week's class. A reading list counts as documents: every text listed for a week is its own task "Read <author>, <title>, <chapter or pages>", one task per chapter or section ("Introduction and Chapters 1 and 3" is three tasks: "Read Haraway, TechnoFeminism, Introduction", "… Chapter 1", "… Chapter 3"); the planner finds the pages in the book and sizes them.
   Readings shared out among students in class ("readings will be divided between individuals or groups"): still one deliverable per week, with "assigned": true and every text of that week in "what", and no reading tasks for it: the planner adds a task to write down which ones are his after the class where they are shared out. Readings everyone reads are never "assigned".
   A deliverable held or handed in at a numbered class ("presentations at the 4th session", "in week 4") gets "week" with that number and "date" null; one with a date given later ("the essay is due later") has "date" null and no "week".
3. "tasks": the first steps for each deliverable, in order, 2 to 6 each, unless already planned above. Weekly work (a journal entry or an exercise sheet every week) is one task per week, titled with its week ("Write the journal entry for week of 26 Nov"), up to the deliverable's date. Short, start with a verb, concrete, in English. "did" is the deliverable's key or id. "minutes" is your honest estimate of the whole step. "where": "train" = laptop without internet, "phone" = reading or rehearsing in the metro, "desk" = at home with internet. Readings with pages: "Read <text> (pp. x–y)". Do not split steps into parts and do not pick days: the planner does both.
4. "info": up to 6 short lines the planner should remember: grading, attendance rule, how and where to submit, late policy, language. People by role only (the professor, the tutor).
5. "questions": only what the documents do not say and the planner needs, at most 3 (when the answer is one of a few choices, end the question with them in brackets: "Is the essay due before or after the break? [Before | After]"): when it meets (if it meets and no times are found), what has to be handed in and when (if nothing is found), and the date of a deliverable that has none (one question for all of them). If the documents or the answers already say it, do not ask.
Start with "think": one or two sentences on what the documents are, what you found and what is missing.

Reply with JSON only:
{"think":"...","questions":[],"info":["..."],"sessions":[{"weekday":"tue","start":"10:00","end":"12:00","room":"","title":"","from":"","to":"","except":[]}],"dates":[{"date":"YYYY-MM-DD","start":"","end":"","room":"","title":""}],"deliverables":[{"key":"d1","id":"","title":"...","date":"YYYY-MM-DD or null","weight":"","what":""}],"tasks":[{"did":"d1","title":"...","minutes":90,"where":"desk"}]}
${books.length ? '\nBooks in the folder (not included, too long; plan readings from them when the documents name the pages, chapters or sections to read; leave a book out only when nothing says what part to read):\n'+books.map(b=>'- '+b).join('\n')+'\n' : ''}
${SU.extra ? '\nAlso in the folder, not read (code projects, scenes, media; for context only, they are not readings):\n'+SU.extra+'\n' : ''}
Documents:
${docs.length ? docs.map(d=>'=== '+d.name+' ===\n'+d.text).join('\n\n') : '(none)'}
${SU.paste.trim() ? '\nPasted by the student:\n'+SU.paste.trim()+'\n' : ''}${SU.thread.length ? '\nQuestions asked and the student\'s answers:\n'+SU.thread.map(m=>(m.role==='user'?'Student: ':'Planner: ')+m.text).join('\n')+'\n' : ''}`;
}

/* weekly times -> dates in code: from the first date given (not before today) to the last (else the end of term), the weekday
   only, minus dates without class; single dates as given. Times checked; anything already in the timetable is left out. */
function onbSessions(c, raw){
  if(SU.mode==='none') return [];
  const hm = v => /^\d{1,2}:\d\d$/.test(str(v).trim()) ? str(v).trim().padStart(5,'0') : '', o = SU.mode==='thb' ? '' : SU.mode;
  const have = new Set(CLASSES.filter(e=>e.c===c.id).concat(c.sessions||[]).map(e=>e.d+'|'+e.s)), out = [];
  const push = (d, s, e, r, t) => { if(!validDate(d) || d < TODAY || !s || (e && e <= s)) return; const k = d+'|'+s; if(have.has(k)) return; have.add(k);
    out.push(Object.assign({d, s, e:e||'', c:c.id, t:t && t.toLowerCase()!==c.short.toLowerCase() ? c.short+' · '+t : c.short, r:r||''}, o ? {o} : {})); };
  const last = '2027-03-31';
  arr(raw.sessions).forEach(x=>{ const wd = ONB_WD[str(x.weekday).trim().slice(0,3).toLowerCase()]; if(wd==null) return;
    const from = validDate(x.from) && x.from > TODAY ? x.from : TODAY, to = validDate(x.to) && x.to <= last ? x.to : TERM_END, skip = new Set(arr(x.except).map(str));
    for(let d = from; d <= to && out.length < 300; d = addDays(d,1)) if(parse(d).getDay()===wd && !skip.has(d)) push(d, hm(x.start), hm(x.end), str(x.room).trim(), str(x.title).trim()); });
  arr(raw.dates).forEach(x=>push(str(x.date), hm(x.start), hm(x.end), str(x.room).trim(), str(x.title).trim()));
  return out.sort((a,b)=>(a.d+a.s).localeCompare(b.d+b.s));
}

/* The model's report -> the usual planner answer, through normalize() (deadlines, duplicates, sizes by pace, splitting, days). */
function onbProposal(c, raw, provider){
  const keys = {}, real = id => (c.deliverables||[]).some(d=>d.id===id);
  const dls = [], sessions = onbSessions(c, raw), drop = new Set(), assigned = [];
  /* "Week 2" readings -> the course's 2nd class date, in code (24 Nov 2026: a folder grouped as Week 1–3 with four dated
     Saturdays gave no reading tasks at all, the model saw no dates). Classes counted from the course's first one; a week
     whose class is past is left out with its tasks. */
  const classDays = [...new Set(CLASSES.filter(e=>e.c===c.id).concat(c.sessions||[], sessions).map(e=>e.d))].sort();
  const weekDate = n => Number.isInteger(n) && n >= 1 ? classDays[n-1] || null : null;
  arr(raw.deliverables).forEach((d,i)=>{ const title = str(d.title).trim(); if(!title) return; const id = str(d.id).trim();
    const note = [str(d.what).trim(), str(d.weight).trim()].filter(Boolean).join(' · ');
    if(id && real(id)){ keys[str(d.key)||id] = id; if(validDate(d.date)) dls.push({key:id, course:c.id, title:(c.deliverables.find(x=>x.id===id)||{}).title||title, date:d.date}); return; }
    const k = 'ob'+i; keys[str(d.key)||k] = k;
    const wk = validDate(d.date) ? null : weekDate(Number(d.week));
    if(wk && wk < TODAY){ drop.add(k); return; }
    const t2 = wk ? 'Session '+fmt(wk,{day:'numeric', month:'short'})+' · '+(title.replace(/^(week|woche|semana|session|sitzung|sesi[oó]n)\s*\d+\s*[:·—–-]?\s*/i,'') || title) : title;
    dls.push({key:k, course:c.id, title:t2, date:validDate(d.date) ? d.date : wk, note});
    if(d.assigned===true) assigned.push({key:k, date:validDate(d.date) ? d.date : wk, topic:t2.replace(/^Session [^·]*·\s*/,'')}); });
  const tasks = arr(raw.tasks).map(t=>({course:c.id, did: keys[str(t.did)] || (real(str(t.did)) ? str(t.did) : ''), title:str(t.title).trim(), minutes:Number(t.minutes)||60, stated:false, where:['desk','train','phone'].includes(t.where) ? t.where : 'desk', note:''})).filter(t=>t.title && !drop.has(t.did));
  /* weekly work ("journal entry for week of 26 Nov") cannot be done before its week: it goes on the day after that week's class
     (or the week's first day without one) and is pinned there; a week with no class gets none when the course has classes
     (19 Nov 2026 test: all eleven weekly entries were placed in November, and two fell in the Christmas weeks without class) */
  const meets = CLASSES.filter(e=>e.c===c.id).concat(c.sessions||[], sessions).map(e=>e.d);
  const pinDays = [];
  for(let i = tasks.length - 1; i >= 0; i--){ const t = tasks[i]; if(!/\bweek\b|\bwoche\b|\bsemana\b/i.test(t.title)) continue;
    const wk = noteDays(t.title).filter(d=>d >= addDays(TODAY,-6))[0]; if(!wk) continue;
    const week = []; for(let k=0;k<7;k++) week.push(addDays(wk,k));
    const cls = week.find(d=>meets.includes(d));
    if(meets.length && !cls && wk >= meets.slice().sort()[0] && wk <= meets.slice().sort().pop()){ tasks.splice(i,1); continue; }
    const day = cls ? addDays(cls,1) : wk, dl = (dls.find(d=>d.key===t.did)||{}).date;
    t.due = day < TODAY ? TODAY : dl && day > dl ? dl : day; pinDays.push(t.due); }
  /* steps after the weekly work of the same deliverable ("combine the entries into one PDF") wait for the last entry */
  const lastWeek = {}; tasks.forEach(t=>{ if(t.due && (!lastWeek[t.did] || t.due > lastWeek[t.did])) lastWeek[t.did] = t.due; });
  let seenWeek = {}; tasks.forEach(t=>{ if(t.due){ seenWeek[t.did] = true; return; } if(seenWeek[t.did] && lastWeek[t.did]){ t.due = lastWeek[t.did]; pinDays.push(t.due); } });
  /* readings shared out in class (24 Nov 2026, the user's words: "the readings would be assigned in class, meaning make a task to register
     the readings that I have to do, instead of randomly assigning readings"): no reading tasks for that week, one short task the
     day after the class before it (where they are shared out), pinned; he then tells the planner which texts are his */
  assigned.forEach(a=>{ for(let i = tasks.length - 1; i >= 0; i--) if(tasks[i].did===a.key) tasks.splice(i,1);
    if(!a.date) return; const before = classDays.filter(d=>d < a.date).pop(), day = before && addDays(before,1) > TODAY ? addDays(before,1) : TODAY;
    if(day >= a.date) return;
    tasks.push({course:c.id, did:a.key, title:'Write down which readings I was assigned for '+a.topic+' and tell the planner', minutes:15, stated:true, where:'desk', note:'', due:day}); pinDays.push(day); });
  const said = 'Set up from the syllabus. Deadlines: '+dls.map(d=>d.title).join('; ')+(pinDays.length ? '. Weekly work on '+[...new Set(pinDays)].join(', ') : '');
  let p; ONB_PENDING = sessions;   /* the new class times count while new work is placed */
  try{ p = normalize({summary:'', deliverables:dls, tasks, updates:[], removes:[], deadlineUpdates:[], events:[]}, provider, said); }
  finally{ ONB_PENDING = []; }
  p.sessions = sessions; p.onboard = c.id; p.meets = SU.mode;
  const info = (Array.isArray(raw.info) ? raw.info : [raw.info]).map(str).map(x=>x.trim()).filter(Boolean).slice(0,6);
  p.info = info.length ? {course:c.id, text:info.join('\n')} : null;
  const gs = sessGroups(sessions), weekly = gs.filter(g=>g.items.length > 1).length, single = gs.filter(g=>g.items.length===1).length;
  p.summary = 'Set up '+c.short+': '+[weekly ? weekly+' weekly time'+(weekly===1?'':'s')+' ('+gs.filter(g=>g.items.length>1).reduce((s,g)=>s+g.items.length,0)+' sessions)' : '', single ? single+' single session'+(single===1?'':'s') : '', p.deliverables.length ? p.deliverables.length+' deadline'+(p.deliverables.length===1?'':'s') : '', p.tasks.length ? p.tasks.length+' first step'+(p.tasks.length===1?'':'s')+' (estimates: change any hours below)' : ''].filter(Boolean).join(', ')+'.';
  return p;
}

/* Reads the folder and the answers for one set-up (S: compose.setup) and returns either
   {questions} or {proposal}. stage(text) reports progress; alive() is false once the run was cancelled or replaced. */
async function setupRead(c, S, stage, alive){
  SU = S;
  stage('Reading the documents');
  const folders = [...new Set([S.folder, folderOf(c)].filter(Boolean))];
  const src = await APP.call('helpSources', {folders, course:c.id}).catch(()=>({files:[]})); if(!alive()) return null;
  /* projects and media in the folder, one line each, so set up knows they exist without reading them */
  const fi = ((await APP.call('folderIndex', {folders}).catch(()=>null))||{}).folders || []; if(!alive()) return null;
  S.extra = folderIndexText(fi.map(f=>Object.assign({}, f, {docs:[]})), null, {other:5}).replace(/^## .*\n?/gm,'');
  const docs = [], books = []; let used = 0;
  (src.files||[]).filter(f=>!/^(Sessions|Reading notes)\//.test(f.name)).forEach(f=>{ const t = String(f.text||'');
    if(t.length > BOOK_CHARS){ books.push(f.name+' (about '+Math.round(t.length/PAGE_CHARS)+' pages)'); return; }
    if(used >= ONB_DOC_CHARS) return; const part = t.slice(0, ONB_DOC_CHARS - used); used += part.length; docs.push({name:f.name, text:part}); });
  if(!docs.length && (src.scanned||[]).length && !String(S.paste||'').trim()) throw new Error('The documents are scans and are being read with OCR now. Try again in a minute.');
  stage('Claude Opus is reading');
  SU = S; const full = onbPrompt(c, docs, books), red = redact(full);
  const r = await APP.call('llm', {prompt: full, remotePrompt: red.text, schema: ONB_SCHEMA, order: llmOrder(), model:'opus'});   /* Opus since 24 Nov 2026 (the user's choice): set up is rare and reads long documents */
  if(!alive()) return null;
  if(!r.text) throw new Error('No model answered. '+(r.errors||[]).join(' · '));
  const raw = extractJSON(restore(r.text, red.map));
  const qs = arr(raw.questions).map(str).filter(q=>q.trim()).slice(0,3);
  const found = arr(raw.sessions).length + arr(raw.dates).length + arr(raw.deliverables).length + arr(raw.tasks).length;
  /* questions first, once or twice; after that whatever was found is shown */
  if(qs.length && S.thread.filter(m=>m.role==='user').length < 2 && (!found || S.thread.length===0)) return {questions:qs, think:str(raw.think).trim()};
  SU = S; const p = onbProposal(c, raw, r.provider);
  /* readings sized from the book, as for planner notes (24 Nov 2026: Seminar's chapter readings were never sized or planned);
     the new class times count while the parts are placed */
  if(typeof sizeReadings==='function' && p.tasks.length){ stage('Sizing the readings from the books'); ONB_PENDING = p.sessions;
    try{ await sizeReadings(p); } finally{ ONB_PENDING = []; } if(!alive()) return null; }
  stage('Checking it against your plan');
  gateProposal(p, 'docs');   /* read from documents: it may only add (actions.js) */
  if(!hasChanges(p)) throw new Error('Nothing new for '+c.short+': '+(str(raw.think).trim() || 'the documents add nothing the planner does not already have.'));
  p.provider = r.provider; if(r.model) p.model = r.model;
  return {proposal:p};
}
/* ---------- Set up in the planner chat (24 Nov 2026, the user's request: one chat for planning and setting up) ----------
   compose.setup = {cid, mode, paste, thread, folder, files, run}. Started by "Set up" on Courses and after adding a course,
   by a note that asks for it ("set up Seminar": SETUP_RE in code, or the planner model's "setup" field), or by files
   dropped on the chat. "Where does it meet?" is asked with buttons when the course has no answer yet. What he types while
   a set-up is open is an answer (or pasted text) for it. The result is the usual preview, gated as read from documents. */
const tildePath = p => String(p||'').replace(/^\/Users\/[^/]+\//,'~/');
const SETUP_RE = /^\s*(?:please\s+|can you\s+|bitte\s+|por favor\s+)?(?:set\s?up|onboard|configura(?:r)?|prepara(?:r)?|einrichten|richte)\b/i;
async function chatSetup(cid, opts={}){
  const c = cById(cid); if(!c || typeof IN_APP==='undefined' || !IN_APP) return;
  if(!opts.keepThread){ compose = freshCompose(); compose.thread.push({role:'user', text:'Set up '+c.short}); }
  compose.setup = {cid, mode:c.meets || (CLASSES.some(e=>e.c===c.id) ? 'thb' : ''), paste:'', thread:[], folder:'', files:[], told:false};
  compose.questions = null; compose.proposal = null; compose.error = '';
  if(typeof chatOpen==='function') PCHAT.open = true;
  await setupFolder(c);
  if(opts.paths && opts.paths.length) await setupAddPaths(opts.paths, true);
  return setupStep(!!opts.auto);   /* a note that asks for it reads at once; the button and dropped files wait for Read and plan */
}
async function setupFolder(c){
  const S = compose.setup; if(!S) return;
  try{ const r = await APP.call('helpFolder', {name:c.short}); S.folder = r.path; if(!c.folder) CTX[c.id] = r.path;
    let files = (r.files||[]).filter(f=>!/^(Sessions|Reading notes)\//.test(f));
    if(c.folder && c.folder!==r.path) files = [...new Set((((await APP.call('listFiles', {path:c.folder})).files)||[]).concat(files))];
    S.files = files; }
  catch(e){ compose.error = 'The course folder could not be opened.'; }
}
function setupSay(text){ compose.thread.push({role:'assistant', text, kind:'note'}); }
/* auto: read as soon as where it meets is known and there is something to read; else wait with buttons */
async function setupStep(auto){
  const S = compose.setup, c = S && cById(S.cid); if(!c) return render();
  if(!S.told){ S.told = true; const n = S.files.length, where = tildePath(folderOf(c) || S.folder);
    setupSay(n ? 'Setting up '+c.short+'. I will read the '+n+' file'+(n===1?'':'s')+' in '+where+'. Drop more here or paste text; nothing is saved before you apply the preview.'
      : 'Setting up '+c.short+'. Its folder ('+where+') has no documents yet: drop the syllabus, briefs or readings here, link the folder you keep them in, or paste the text.'); }
  if(!S.mode){ const q = 'Where does '+c.short+' meet?'; compose.questions = [q]; compose.thread.push({role:'assistant', text:q});
    compose.chips = ONB_MODES.map(([k,l])=>({label:l, act:'mode', val:k})); return render(); }
  const something = S.files.length || String(S.paste||'').trim() || S.thread.some(m=>m.role==='user');
  if(!auto || !something){ compose.questions = null;
    compose.chips = [{label:'Read and plan', act:'go', pri:true}, {label:c.folder ? 'Link another folder…' : 'Link a folder…', act:'link'}, ...(c.folder ? [{label:'Unlink folder', act:'unlink'}] : []), {label:'Meets: '+((ONB_MODES.find(m=>m[0]===S.mode)||[])[1]||'?'), act:'remode'}];
    return render(); }
  return setupRun();
}
async function setupRun(){
  const S = compose.setup, c = S && cById(S.cid); if(!c || compose.busy) return;
  const run = S.run = (S.run||0) + 1, alive = () => compose.setup===S && S.run===run;
  compose.busy = true; compose.error = ''; compose.questions = null; compose.chips = null; compose.t0 = Date.now(); compose.setupStage = 'Reading the documents'; render();
  clearInterval(PLAN_TIMER); PLAN_TIMER = setInterval(paintProgress, 500);
  try{
    const res = await setupRead(c, S, t=>{ compose.setupStage = t; paintProgress(); }, alive);
    if(res && alive()){
      if(res.questions){ compose.questions = res.questions; S.thread.push({role:'assistant', text:res.questions.join(' ')}); compose.thread.push({role:'assistant', text:res.questions.join(' ')}); }
      else { compose.proposal = res.proposal; compose.provider = res.proposal.provider; }
    }
  }catch(e){ if(alive()) compose.error = e.message; }
  if(alive()){ clearInterval(PLAN_TIMER); compose.busy = false; render(); }
}
/* what he types while a set-up is open: where it meets, an answer, or pasted documents */
function setupAnswer(text){
  const S = compose.setup; compose.thread.push({role:'user', text}); compose.draft = ''; compose.chips = null;
  if(!S.mode){ const m = /\b(online|zoom|teams|remote|virtual)\b/i.test(text) ? 'online' : (/\b(campus|hochschule|universit\w*)\b/i.test(text) || atMainPlace(text)) ? 'thb' : /\b(no class|no classes|keine|ningun|project|projekt|proyecto|self.?study)\b/i.test(text) ? 'none' : /\b(in person|elsewhere|presencial|vor ort)\b/i.test(text) ? 'near' : '';
    if(!m){ compose.thread.push({role:'assistant', text:'Pick one of these, so the planner knows if it is a commute day.'}); return render(); }
    S.mode = m; return setupStep(true); }
  if(text.length > 400 || text.split('\n').length > 4) S.paste = (S.paste ? S.paste+'\n\n' : '') + text; else S.thread.push({role:'user', text});
  return setupRun();
}
async function setupAddPaths(paths, quiet){
  const S = compose.setup, c = S && cById(S.cid); if(!c) return;
  try{ const r = await APP.call('helpAddPaths', {name:c.short, dest:c.folder||'', paths}); S.files = (r.files||[]).filter(f=>!/^(Sessions|Reading notes)\//.test(f));
    if(!quiet) setupSay('Added '+paths.length+' file'+(paths.length===1?'':'s')+' to '+tildePath(folderOf(c) || S.folder)+'.'); }
  catch(e){ compose.error = 'Could not add the files: '+e.message; }
}
/* files dropped on the chat: into the set-up that is open, else the course they are for (asked with buttons) */
async function chatDrop(paths){
  if(compose.busy) return;
  if(compose.setup){ await setupAddPaths(paths); return setupStep(false); }
  const names = paths.map(p=>p.split('/').pop()), guess = names.map(n=>typeof flGuess==='function' ? flGuess(n) : '').find(Boolean) || (focusTask() ? focusTask().c.id : '');
  compose = Object.assign(freshCompose(), {dropped:paths});
  compose.thread.push({role:'user', text:'Dropped '+names.slice(0,3).join(', ')+(names.length>3?' and '+(names.length-3)+' more':'')});
  const q = 'Which course are they for? I will add them to its folder and set it up from them.'; compose.questions = [q]; compose.thread.push({role:'assistant', text:q});
  const order = courses.filter(c=>c.id!==ADMIN_ID).slice().sort((a,b)=>(b.id===guess)-(a.id===guess));
  compose.chips = order.map(c=>({label:c.short, act:'course', val:c.id, pri:c.id===guess})).concat([{label:'Only file them', act:'file'}]);
  render();
}
async function chipAct(ch){
  const S = compose.setup, c = S && cById(S.cid);
  if(ch.act==='course'){ const paths = compose.dropped || []; return chatSetup(ch.val, {keepThread:true, paths}); }
  if(ch.act==='file'){ const paths = compose.dropped || []; compose = freshCompose(); render(); return filesDropped({x:-1, y:-1, items:paths.map(path=>({path}))}); }
  if(!c) return;
  if(ch.act==='mode'){ S.mode = ch.val; compose.thread.push({role:'user', text:ch.label}); compose.questions = null; return setupStep(true); }
  if(ch.act==='remode'){ S.mode = ''; return setupStep(false); }
  if(ch.act==='go'){ compose.chips = null; return setupRun(); }
  if(ch.act==='add'){ try{ const r = await APP.call('helpAddFiles', {name:c.short, dest:c.folder||''}); const before = S.files.length; S.files = (r.files||[]).filter(f=>!/^(Sessions|Reading notes)\//.test(f)); if(S.files.length > before) setupSay('Added '+(S.files.length-before)+' file'+(S.files.length-before===1?'':'s')+'.'); }catch(err){ compose.error = err.message; } return setupStep(false); }
  if(ch.act==='unlink'){ const was = c.folder; delete c.folder; save(c); if(S.folder) CTX[c.id] = S.folder; try{ FILES[c.id] = (await APP.call('listFiles', {path:folderOf(c)})).files||[]; }catch(err){ FILES[c.id] = []; } await setupFolder(c); setupSay('Unlinked '+tildePath(was)+'. Its files stay where they are; '+c.short+' uses '+tildePath(S.folder)+' again.'); return setupStep(false); }
  if(ch.act==='link'){ try{ const r = await APP.call('pickFolder', {start:c.folder||''}); if(r && r.path){ c.folder = r.path; delete CTX[c.id]; save(c); FILES[c.id] = (await APP.call('listFiles', {path:c.folder})).files||[]; await setupFolder(c); setupSay('Linked '+tildePath(c.folder)+': '+S.files.length+' file'+(S.files.length===1?'':'s')+'. Nothing is moved.'); } }
    catch(err){ compose.error = /not found|unknown|unsupported/i.test(err.message||'') ? 'Linking folders needs the app rebuilt.' : err.message; } return setupStep(false); }
}
document.addEventListener('click', e=>{ const b = e.target.closest('[data-chip]'); if(!b || !compose.chips) return; e.preventDefault(); const ch = compose.chips[+b.dataset.chip]; if(ch) chipAct(ch); });

/* "Set up" / "Set up again" on Courses */
document.addEventListener('click', e=>{ const open = e.target.closest('[data-obopen]'); if(open){ e.preventDefault(); chatSetup(open.dataset.obopen); } });
