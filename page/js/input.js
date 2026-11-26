/* Turning notes into plan changes: privacy (redact), the input field, prompts, note parsing in code, normalize, duplicates. Part of page/index_v2.html; classic script, loaded in order. */
const NOT_NAMES = new Set('Monday Tuesday Wednesday Thursday Friday Saturday Sunday Mon Tue Wed Thu Fri Sat Sun January February March April May June July August September October November December Montag Dienstag Mittwoch Donnerstag Freitag Samstag Sonntag Claude Moodle Zoom Teams Ableton Max Python PCB Also Then Need Next This That Today Tomorrow The And But For'.split(' '));
/* words the plan itself uses are never names: course names, groups, titles, the timetable, the profile's places and school */
function notName(w){ if(NOT_NAMES.has(w) || atMainPlace(w)) return true;
  if([PROFILE.institution].concat(CLASSES.map(e=>e.t)).join(' ').split(/[^\p{L}]+/u).includes(w)) return true;
  return courses.some(c=>[c.short, c.name, String(c.group||'')].concat((c.deliverables||[]).map(d=>d.title), (c.tasks||[]).map(t=>t.title)).join(' ').split(/[^\p{L}]+/u).includes(w)); }
function privacyTerms(){
  const set = new Set();
  courses.forEach(c=>{ (String(c.name||'').match(/\b(?:Prof\.|Dr\.)\s*[A-ZÄÖÜ][\p{L}-]+/gu)||[]).forEach(x=>{ set.add(x); set.add(x.replace(/^(?:Prof\.|Dr\.)\s*/,'')); }); });
  String((PREFS&&PREFS.privateWords)||'').split(/[,\n]/).map(x=>x.trim()).filter(x=>x.length>1).forEach(x=>set.add(x));
  return [...set].sort((a,b)=>b.length-a.length);
}
/* opts.map: keep adding to an earlier map (same placeholders across a session); opts.terms: more words to hide;
   opts.heuristics:false skips the guessing of names from sentence shape (used for readings, where it hides authors). */
function redact(text, opts={}){
  const map = opts.map || {}, n = {Person:0, Link:0, Email:0, Phone:0, Code:0, Account:0, Number:0};
  Object.keys(map).forEach(k=>{ const m = /^\[(\w+) (\d+)\]$/.exec(k); if(m && m[1] in n) n[m[1]] = Math.max(n[m[1]], +m[2]); });
  const put = (kind, val) => { for(const k in map) if(map[k]===val) return k; const key = '['+kind+' '+(++n[kind])+']'; map[key] = val; return key; };
  let t = String(text);
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, m=>put('Link', m));
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, m=>put('Email', m));
  /* numbers (19 Nov 2026 user test: local phone numbers, Zoom IDs and passcodes, IBANs reached Claude): phone numbers with + / 00
     or a leading 0 and at least 8 digits, account numbers, meeting ids and passcodes after their label, other runs of 9+ digits */
  t = t.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, m=>put('Account', m));
  t = t.replace(/((?:meeting[\s-]?id|id de (?:la )?reuni[oó]n|sitzungs-?id|meeting-?kennung|webinar[\s-]?id|passcode|password|kenncode|kennwort|passwort|contrase[ñn]a|c[oó]digo|pin)\s*[:#]?\s*)([A-Za-z0-9][\w.-]{2,}(?:\s\d{3,4}){0,3})/gi, (all, lab, v)=>lab+put('Code', v));
  t = t.replace(/(?<![\w\[])(?:\+|00|0)\d[\d\s/()-]{6,}\d(?![\w\]])/g, m=>m.replace(/\D/g,'').length >= 8 ? put('Phone', m) : m);
  t = t.replace(/(?<![\w\[\-.:\/])\d(?:[ \d]{7,})\d(?![\w\]\-.:\/])/g, m=>m.replace(/\D/g,'').length >= 9 ? put('Number', m) : m);
  [...new Set(privacyTerms().concat((opts.terms||[]).filter(x=>String(x).length>1)))].sort((a,b)=>b.length-a.length).forEach(w=>{ t = t.replace(new RegExp('(?<![\\p{L}])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}])','gu'), m=>put('Person', m)); });
  if(opts.heuristics!==false){
    const UP = '\\p{Lu}[\\p{L}\'’-]+', FULL = UP+'(?:[ \\t]+(?:(?:von|van|de|del|la|der|di|da)[ \\t]+)?'+UP+'){0,2}';   /* never across a line break */
    const ISTITLE = /^(Prof|Dr|Dra|Mr|Mrs|Ms|Sr|Sra|Mag|Dipl|Professor|Professorin|Profesor|Profesora|Frau|Herr|Doktor)$/;
    /* weekdays, months and other known words are never part of a name (19 Nov 2026: "Call with Paula Monday 18:00" hid "Monday") */
    const hide = name => { const ws = name.split(/([ \t]+)/); while(ws.length > 1 && (notName(ws[ws.length-1]) || monthOf(ws[ws.length-1].toLowerCase()) || DAYWORDS[ws[ws.length-1].toLowerCase()]!==undefined)) ws.splice(-2, 2);
      const nm = ws.join(''), rest = name.slice(nm.length), first = ws[0];
      if(ISTITLE.test(first.replace(/\.$/,''))) return null; if((notName(first) || DAYWORDS[first.toLowerCase()]!==undefined) && !/\s/.test(nm)) return null; return put('Person', nm) + rest; };
    /* names after a title: "Prof. Dr. Anna Becker", "Frau Dipl.-Des. Katrin Vogelsang", "Dra. López"; the title stays */
    const TITLE = '(?:(?:Prof|Dr|Dra|Mr|Mrs|Ms|Sr|Sra|Mag|Dipl\\.?-?[\\p{L}.]*|M\\.?\\s?A|B\\.?\\s?A|M\\.?\\s?Sc|Ph\\.?\\s?D)\\.?|Professor(?:in)?|Profesor(?:a)?|Frau|Herr|Doktor)';
    t = t.replace(new RegExp('(?<![\\p{L}])('+TITLE+'\\s+)((?:'+TITLE+'\\s+)*)('+FULL+')', 'gu'), (all, t1, t2, name) => { const k = hide(name); return k ? t1+t2+k : all; });
    /* names after a role label: "Tutor: Felix Oberndorf", "Contact - Lisa Brand", "From: Jonas Weber" */
    t = t.replace(new RegExp('(?<![\\p{L}])((?:Tutor(?:in|a)?|Lecturer|Dozent(?:in)?|Lehrende[rn]?|Contact|Kontakt|Ansprechpartner(?:in)?|Instructor|Teacher|TA|Supervisor|Betreuer(?:in)?|From|To|Cc|Von|An|Profesor(?:a)?|Docente|Coordinator|Koordinator(?:in)?)[ \\t]*[:–-][ \\t]*(?:'+TITLE+'[ \\t]+)*)('+FULL+')', 'gu'), (all, lab, name) => { const k = hide(name); return k ? lab+k : all; });
    /* names after a verb or preposition that takes a person, any case: "Call Anna Schmidt", "email Lisa", "with Tobi Müller";
       not "and"/"for"/"to", which caught book titles ("A Voice and Nothing") */
    const VERBS = ['with','from','tell','ask','email','e-mail','mail','call','meet','text','message','ping','cc','con','llamar a','escribir a','escribirle a'].map(v=>'['+v[0].toUpperCase()+v[0]+']'+v.slice(1)).join('|');
    t = t.replace(new RegExp('(?<![\\p{L}])((?:'+VERBS+')\\s+)('+FULL+')(?![\\p{L}])', 'gu'), (all, pre, name) => { const k = hide(name); return k ? pre+k : all; });
    t = t.replace(new RegExp('(?<![\\p{L}])('+FULL+')(?=\\s+(?:says|said|wants|asked|told|thinks|will|can|needs|sent|suggested|meinte|sagt|dice|dijo)\\b)', 'gu'), m=>hide(m) || m);
    /* a second name joined to a hidden one: "[Person 1] and Łukasz Żółć", "[Person 2], Ben" */
    for(let k=0;k<3;k++) t = t.replace(new RegExp('(\\[Person \\d+\\](?:,|\\s+(?:and|und|y|e|&))\\s+)('+FULL+')(?![\\p{L}])','gu'), (all, pre, name) => { const h = hide(name); return h ? pre+h : all; });
    /* names in a group list: "Group: Anna, Ben, Chloé and Dmitri", "Team members: …" */
    t = t.replace(new RegExp('(?<![\\p{L}])((?:Group|Team|Members|Group members|Team members|Gruppe|Grupo|Equipo|Partner|Partners)\\s*[:–-]\\s*)([^\\n.;]{2,160})', 'gu'), (all, lab, list) => lab + list.replace(new RegExp('(?<![\\p{L}\\[])('+FULL+')(?![\\p{L}])','gu'), m=>hide(m) || m));
    /* the surname alone, wherever it comes up again */
    Object.entries(map).filter(([k,v])=>k.startsWith('[Person') && /\s/.test(v)).forEach(([k,v])=>{ const last = v.split(/\s+/).pop();
      if(last.length > 2 && !notName(last)) t = t.replace(new RegExp('(?<![\\p{L}\\[])'+last.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}])','gu'), m=>put('Person', m)); });
  }
  return {text:t, map};
}
function restore(text, map){ let t = String(text||''); Object.keys(map).sort((a,b)=>b.length-a.length).forEach(k=>{ const inner = k.slice(1,-1).replace(/ /g,'\\s*'); t = t.replace(new RegExp('\\[?'+inner+'\\]?(?!\\d)','g'), JSON.stringify(map[k]).slice(1,-1)); }); return t; }

/* input field */
/* Models (26 Nov 2026): Claude for planning, Gemini (Antigravity CLI) for summaries. The local model (Ollama) is gone, so with the Mac offline nothing is asked. */
const offline = () => typeof navigator!=='undefined' && navigator.onLine===false;
const llmOrder = () => ['claude'];
function modelPicker(){ return offline() ? '<span class="faint">Offline: the planner needs the internet</span>' : ''; }
function composerBlock(){
  if(!IN_APP) return '';
  const c = compose;
  let h = '<section class="compose" aria-label="Add to the plan"><h2>Add to the plan</h2>';
  const ft = focusTask();
  if(ft) h += '<div class="cfocus"><span><span class="muted">About</span> <b>'+esc(ft.t.title)+'</b> <span class="muted">· '+esc(ft.c.short)+' · '+(ft.t.due?esc(fmtShort(ft.t.due)):'no day')+(ft.d&&ft.d.date?' · deadline '+esc(fmtShort(ft.d.date)):'')+'</span></span><button class="lnk" data-cmp="unfocus">Clear</button></div>';
  if(c.thread.length) h += '<div class="cthread">'+c.thread.map(m=>'<div class="'+(m.role==='user'?'cu':'ca')+'">'+(m.role==='user'||m.kind==='note'?'':'<b>Question</b> ')+esc(m.text)+'</div>').join('')+'</div>';
  /* buttons for the answers code can offer (where a course meets, which course dropped files are for, set-up steps) */
  if(c.chips && c.chips.length && !c.busy && !c.proposal) h += '<div class="crow cchips">'+c.chips.map((x,i)=>'<button class="btn sm'+(x.pri?' pri':'')+'" data-chip="'+i+'">'+esc(x.label)+'</button>').join('')+'</div>';
  if(c.proposal) h += c.whatIf && typeof whatIfBlock==='function' ? whatIfBlock(c.proposal) : proposalBlock(c.proposal, 'compose');
  else if(c.busy) h += '<div id="cmp-prog" class="cprog" role="status" aria-live="polite">'+planProgress()+'</div>';
  else {
    h += '<textarea id="cmp-text" rows="3" placeholder="'+(c.questions?'Answer here':c.setup?'Answer, or paste the Moodle page, an email, the schedule':ft?'What changed? e.g. Already done in class, or: the prof said only chapter 1, or: drop it':'What is coming up? e.g. Project X delivery moves to Sun 22 Nov, or: set up Seminar')+'">'+esc(c.draft)+'</textarea>'
      + '<div class="crow"><button class="btn'+(c.setup && c.chips && c.chips.some(x=>x.pri) ? '' : ' pri')+'" data-cmp="go"'+(c.busy?' disabled':'')+'>'+(c.busy?'Thinking…':(c.questions?'Send answer':c.setup?'Send':'Plan it'))+'</button>'
      + (c.thread.length||ft?'<button class="btn" data-cmp="reset">Start over</button>':'')
      + (!c.thread.length && !ft ? '<span class="faint">Drop a syllabus or readings here to set up a course.</span>' : '')
      + '<span class="cprov muted">'+(c.busy?'Asking '+esc(PROV[llmOrder()[0]]||'the model')+'.':modelPicker()+' <span class="faint">⌘↩ sends</span>')+'</span></div>'
      + (!c.thread.length && !ft && !c.busy && todayOver() > 0 ? '<div class="cquick"><button class="lnk" data-cmp="busy">Today is '+todayOver()+' h over the time left: move what can wait</button></div>' : '')
      + '<details class="priv"><summary>Privacy: names, links, emails and numbers are hidden from Claude.</summary><label>Also hide these words, comma separated<input id="pref-private" value="'+esc((PREFS&&PREFS.privateWords)||'')+'" placeholder="Paula, Jonas, Café Kranz"></label><div class="faint">Hidden automatically: '+esc(privacyTerms().join(', ')||'none')+'</div></details>';
  }
  if(c.error) h += '<div class="cerr"><span class="tag warn">'+ICON.warn+esc(c.error)+'</span></div>';
  if(c.done) h += '<div class="cdone">'+esc(c.done)+(c.undo && typeof UNDO!=='undefined' && UNDO ? ' <button class="lnk" data-cmp="undo">Undo</button>' : '')+'</div>';
  return h + '</section>';
}

const titleWords = s => new Set(String(s||'').toLowerCase().replace(/\(part \d+ of \d+\)|part \d+/g,'').split(/[^\p{L}\p{N}]+/u).filter(w=>(w.length>=3 || /^\d+$/.test(w)) && !['the','and','for','with','your','from','read','write'].includes(w)).map(w=>w.length>6 ? w.slice(0,6) : w));
/* Numbers tell steps apart: "exercise sheet 7" is not "exercise sheet 5" (19 Nov 2026 user test: sheet 7 could never be added).
   Tasks the same answer removes are not counted (a replaced task must not swallow its replacement). */
const numsOf = w => [...w].filter(x=>/^\d+$/.test(x));
function similarTask(courseId, title, skip){
  const a = titleWords(title); if(!a.size) return null; let best = null, bs = 0; const an = numsOf(a);
  allTasks().forEach(({c,t})=>{ if(courseId && c.id!==courseId) return; if(skip && skip.has(t.id)) return; const b = titleWords(t.title); if(!b.size) return;
    const bn = numsOf(b); if(an.length && bn.length && !an.some(x=>bn.includes(x))) return; let n = 0; a.forEach(w=>{ if(b.has(w)) n++; }); const sc = n/Math.min(a.size,b.size); if(sc>bs){ bs = sc; best = {c,t}; } });
  return bs >= 0.6 ? Object.assign(best, {score:bs}) : null;
}
/* Is the note about this task? The task open in the help panel or composer, two words of its title, one word of its title that
   few open tasks share ("Adorno", "Bourdieu"), or its course named for the day it moves to (7 Nov 2026: "For today documentary
   needs render, subs and color" moved nothing: render is in 4 tasks, subs and color are not title words). */
function noteNames(t, said, c, to){
  const f = focusTask(); if(f && f.t===t) return true;
  if(c && to && noteDays(said||'').includes(to) && coursesNamed(said||'').has(c.id)) return true;
  const a = titleWords(said), b = titleWords(t.title); let n = 0, rare = false;
  const open = allTasks().filter(({t:x})=>x.status!=='done').map(({t:x})=>titleWords(x.title));
  b.forEach(w=>{ if(!a.has(w)) return; n++; if(open.filter(s=>s.has(w)).length <= 3) rare = true; });
  return n >= 2 || rare;
}
/* "Watch assigned video and read", "Do the readings": work without a named text, video or pages. */
const vagueTitle = s => { s = String(s||''); if(/^\s*(choose|pick|select|decide|find|agree)\b/i.test(s)) return false;   /* choosing the reading is the task */
  return /\b(assigned|the readings?|some readings?|small readings?|the video|a video|the texts?)\b/i.test(s) && !/\b(pp?\.|pages?|ch(apter)?\.?\s*\d|episode|"|“)/i.test(s) && !/\b\p{Lu}\p{Ll}+\b/u.test(s.replace(/^\S+\s*/,'')); };
function proposalChecks(p){
  const res = {task:p.tasks.map(()=>[]), day:[], blocking:false};
  const add = {}, moved = p.shifted || {};
  const bump = (day,est,where) => { const a = add[day] = add[day] || {all:0,train:0,phone:0}; a.all += est; if(where==='train') a.train += est; if(where==='phone') a.phone += est; };
  p.tasks.forEach((t,i)=>{
    if(!t.course){ res.task[i].push('Pick a course'); res.blocking = true; }
    if(!t.title){ res.task[i].push('Needs a title'); res.blocking = true; }
    if(t.due && t.due < TODAY){ res.task[i].push('This day is in the past'); res.blocking = true; }
    if(deskOnly(cById(t.course)) && t.where!=='desk') res.task[i].push(cnm(t.course)+' is always at the desk');
    if((t.where==='train'||t.where==='phone') && !isCommute(t.due)) res.task[i].push('Not a commute day');
    if(t.title && vagueTitle(t.title)) res.task[i].push('Say which reading or video (title, pages or episode)');
    const sim = t.title && similarTask(t.course, t.title); if(sim) res.task[i].push('Looks like a task you have'+(sim.t.status==='done'?' done':'')+': '+sim.t.title.slice(0,70));
    bump(t.due, Number(t.est)||0, t.where);
  });
  p.updates.forEach(u=>{ const c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id); if(t && u.changes.due && u.changes.due!==t.due && (u.changes.where||t.where)!=='class') bump(u.changes.due, Number(u.changes.est ?? t.est)||0, t.where); });
  (p.nofit||[]).concat(p.notes||[]).forEach(m=>res.day.push(m));
  /* new class times that overlap a class already in the timetable, once per weekly slot (19 Nov 2026 user test: a new seminar sat
     on top of Design with no word) */
  sessGroups(p.sessions||[]).forEach(g=>{ const hit = g.items.map(e=>({e, o:CLASSES.concat(courses.flatMap(c=>(c.sessions||[]).map(x=>Object.assign({c:c.id}, x)))).find(k=>k.d===e.d && k.c!==e.c && k.s < (e.e||'24:00') && (k.e||k.s) > e.s)})).filter(x=>x.o);
    if(hit.length) res.day.push(cnm(g.items[0].c)+' '+g.items[0].s+(g.items[0].e?'–'+g.items[0].e:'')+' overlaps '+cnm(hit[0].o.c)+' ('+hit[0].o.s+(hit[0].o.e?'–'+hit[0].o.e:'')+') on '+hit.length+' day'+(hit.length===1?'':'s')+', first '+fmtShort(hit[0].e.d)+'.'); });
  /* 19 Nov 2026 stress test: "move the essay editing to Saturday" put it before the draft it edits, with no word about it */
  p.updates.forEach(u=>{ const c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id), to = u.changes.due; if(!t || !to || !t.did || u.changes.status==='done') return;
    const ix = (c.tasks||[]).indexOf(t), moving = new Set(p.updates.filter(x=>x.changes.due).map(x=>x.id));
    const before = (c.tasks||[]).filter((x,j)=>x!==t && x.did===t.did && x.status!=='done' && !moving.has(x.id) && j < ix && x.due > to && !(p.removes||[]).some(r=>r.id===x.id));
    if(before.length) res.day.push('"'+t.title.slice(0,50)+'" on '+fmtShort(to)+' comes before '+before.map(x=>'"'+x.title.slice(0,50)+'" ('+fmtShort(x.due)+')').join(', ')+'. Move '+(before.length===1?'it':'them')+' earlier too, or pick a later day.'); });
  Object.entries(add).forEach(([day,a])=>{
    /* other work the organizer moves to make room counts on its new day (p.shifted, from placeNew) */
    const base = allTasks().filter(({t})=>(moved[t.id]||t.due)===day && t.status!=='done' && placeOf(t)!=='class');
    const sum = f => base.filter(({t})=>!f || t.where===f).reduce((s,{t})=>s+(+t.est||0),0);
    const tot = r1(sum() + a.all + eventHours(day)), tr = r1(sum('train') + a.train), ph = r1(sum('phone') + a.phone);
    if(tot > HEAVY) res.day.push(fmtShort(day)+' goes to '+tot+' h. Think about another day.');
    if(tr > 2 && isCommute(day)) res.day.push(fmtShort(day)+': '+tr+' h of laptop work on the train. The limit is 2 h.');
    if(ph > 2 && isCommute(day)) res.day.push(fmtShort(day)+': '+ph+' h of phone work in the metro. The limit is 2 h.');
  });
  return res;
}
/* Sessions in a preview, grouped by weekly slot ("Tue 10:00–12:00, room, 12 sessions"), so Remove takes the whole slot. */
/* `thb` is the stored value for "at the main place" (kept so old plans load); the label comes from the profile */
const MEETS = {get thb(){ return 'in person at '+placeShort(); }, near:'in person, elsewhere', online:'online'};
function sessGroups(list){
  const g = []; (list||[]).forEach(e=>{ const k = [e.c, parse(e.d).getDay(), e.s, e.e, e.r, e.o||'', e.t].join('|'); let x = g.find(y=>y.k===k); if(!x){ x = {k, items:[]}; g.push(x); } x.items.push(e); });
  return g;
}
/* The proposal as a checklist card (24 Nov 2026, floating chat): every change is a row with a tick box, ticked unless it is
   risky (actions.js: a removal, a moved deadline, a calendar change or deletion), which waits for his tick. Apply writes the
   ticked rows only (`applyable`). Tasks and new events open their fields with Edit. Used in the chat and on a Brain meeting. */
function proposalBlock(p, ctx){
  if(!p.origin && typeof gateProposal==='function') gateProposal(p, 'note');   /* the fixed framework (actions.js) */
  const chk = proposalChecks(p);
  const row = (key, i, r, risky, main, meta, extra) => { const on = risky ? !!r._ok : !r._off;
    return '<label class="pc-opt pc-check'+(on?' on':'')+(risky?' risky':'')+'"><input type="checkbox" data-pt="'+key+'" data-i="'+i+'"'+(on?' checked':'')+'><span class="pc-l">'+main+'</span>'
      + (meta?'<span class="pc-meta">'+meta+'</span>':'')+(risky?'<span class="pc-flag">'+(risky===true?'Tick to confirm':risky)+'</span>':'')+(extra||'')+'</label>'; };
  const grp = (label, rows) => rows.filter(Boolean).length ? '<div class="pc-grp">'+label+'</div><div class="pc-opts">'+rows.join('')+'</div>' : '';
  const edit = (on, k, i) => '<span class="pc-meta"><button type="button" class="lnk" data-pedit="'+k+'" data-i="'+i+'">'+(on?'Done':'Edit')+'</button></span>';
  let h = '<div class="prop pc-card" data-ctx="'+ctx+'"><div class="pc-ch"><span class="pc-chip">Proposed changes</span><span class="faint">untick what you don\'t want</span></div>';
  if(p.summary) h += '<div class="pc-q psum">'+esc(p.summary)+'</div>';
  if((p.dropped||[]).length) h += '<details class="pc-note muted"><summary>Left out '+p.dropped.length+' task'+(p.dropped.length===1?'':'s')+' you already have'+(p.checked==='claude'?' · checked by Claude Haiku':'')+'</summary>'+p.dropped.map(x=>'<div>'+esc(x.title)+' <span class="faint">= '+esc(x.of)+'</span></div>').join('')+'</details>';
  if((p.unused||[]).length) h += p.unused.map(w=>'<div class="pc-warn">Not used: '+esc(w)+'</div>').join('');
  h += grp('Class times', sessGroups(p.sessions||[]).map((g,i)=>{ const e = g.items[0], n = g.items.length, last = g.items[n-1];
    const main = esc(cnm(e.c))+' · '+(n>1 ? esc(fmt(e.d,{weekday:'long'}))+'s' : esc(fmtShort(e.d)))+' <span class="mono">'+esc(e.s+(e.e?'–'+e.e:''))+'</span>'+(e.r?' · '+esc(e.r):'');
    return row('sessions', i, {_off:g.items.every(x=>x._off)}, false, main, (n>1 ? n+' sessions, '+esc(fmtShort(e.d))+' to '+esc(fmtShort(last.d)) : 'one session')+' · '+esc(MEETS[e.o||'thb'])); }));
  if(p.info && p.info.text) h += grp('Course notes', [row('info', 0, p.info, false, esc(p.info.text).replace(/\n/g,'<br>'))]);
  h += grp('Class as work time', (p.classWork||[]).map((w,i)=>row('classWork', i, w, false, esc(cnm(w.course))+' · '+esc(fmtShort(w.day))+' <span class="mono">'+esc(toHM(w.from)+'–'+toHM(w.to))+'</span>', 'the tasks below are done in class')));
  h += grp('Not attending', (p.skips||[]).map((x,i)=>row('skips', i, x, false, (x.attend?'Going after all: ':'')+esc(x.title), esc(fmtShort(x.day))+(x.s?' <span class="mono">'+esc(x.s)+'</span>':'')+(x.c?' · '+esc(cnm(x.c)):' · calendar')+' · '+(x.attend?'its time is away from home again':'kept and marked; its time is free for work'))));
  h += grp('Priorities', (p.prios||[]).map((x,i)=>row('prios', i, x, false, esc(x.title), esc(cnm(x.course))+' · '+(x.rank ? 'priority '+x.rank+(x.was?' (was '+x.was+')':'')+' · its work goes first; lower deadlines slip first' : 'no longer a priority'))));
  h += grp('No longer busy', (p.unbusy||[]).map((b,i)=>row('unbusy', i, b, false, esc(fmtShort(b.day))+' · <span class="mono">'+esc(busyLabel(b))+'</span>', b.note?esc(b.note.slice(0,60)):'')));
  h += grp('Busy', (p.busy||[]).map((b,i)=>row('busy', i, b, false, b.days.map(d=>esc(fmtShort(d))).join(', ')+' · <span class="mono">'+esc(busyLabel(b))+'</span>', 'no planner work then'+(b.moves&&b.moves.length?' · moves off: '+b.moves.map(m=>esc(m.title)+' → '+esc(fmtShort(m.to))).join(' · '):''))));
  h += grp('Deadlines', p.deliverables.map((d,i)=>row('deliverables', i, d, false, esc(d.title), esc(cnm(d.course))+' · <span class="mono">'+(d.date?esc(fmtShort(d.date)):'no date')+'</span>'+(/^Session\b/i.test(d.title)?' · readings due the day before':''))));
  h += grp('Moved deadlines', p.dupdates.map((u,i)=>{ const c = cById(u.course), d = c && (c.deliverables||[]).find(x=>x.id===u.id); if(!d) return ''; return row('dupdates', i, u, 'Moves a real deadline. Tick to confirm', esc(d.title)+' → <span class="mono">'+esc(fmtShort(u.changes.date))+'</span>', esc(c.short)+' · was <span class="mono">'+(d.date?esc(fmtShort(d.date)):'no date')+'</span>'); }));
  h += grp('Changes to planned tasks', p.updates.map((u,i)=>{ const c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id); if(!t) return ''; const lab = {due:'Day',status:'Status',est:'Hours',spent:'Took (h)',title:'Title',note:'Note',where:'Where',files:'Files',waiting:'Waiting for'}; const show = (k,v) => k==='due' && validDate(v) ? fmtShort(v) : k==='where' ? whereLabel({where:v}) : k==='files' ? ((v||[]).map(f=>f.split('/').pop().replace(/\.pdf$/i,'')).join(', ') || 'none') : k==='waiting' ? (v ? v.what+(v.who?' ('+v.who+')':'') : 'nothing') : String(v??''); return row('updates', i, u, false, esc(t.title), esc(c.short)+' · '+Object.entries(u.changes).map(([k,v])=>(lab[k]||k)+' '+esc(show(k,t[k]))+' → <b>'+esc(show(k,v))+'</b>').join(' · ')); }));
  h += grp('Remove from the plan', p.removes.map((r,i)=>{ const c = cById(r.course), t = c && (c.tasks||[]).find(x=>x.id===r.id); if(!t) return ''; return row('removes', i, r, 'Removes a task. Tick to confirm', '<s>'+esc(t.title)+'</s>', esc(c.short)+' · '+(t.due?'was <span class="mono">'+esc(fmtShort(t.due))+'</span>':'no day')+(t.status==='done'?' · done':'')+(r.reason?' · '+esc(r.reason):'')); }));
  if(evChangeCount(p)) h += grp('Calendar', p.events.map((x,i)=>{ const e = x.key && evByKey(x.key); if(x.op!=='add' && !e) return '';
    const when = (d,s,en) => '<span class="mono">'+esc(fmtShort(d))+(s?' '+esc(s)+(en?'–'+esc(en):''):'')+'</span>'+(s?'':' · all day');
    if(x.op==='add') return row('events', i, x, false, esc(x.title||'(no title)'), 'new · '+when(x.date, x.start, x.end)+(x.location?' · '+esc(x.location):''),
      edit(x._edit, 'events', i) + (x._edit ? '<span class="pc-edit pc-edev"><input data-pe="'+i+'" data-pf="title" value="'+esc(x.title)+'" aria-label="Event title"><input type="date" data-pe="'+i+'" data-pf="date" value="'+esc(x.date)+'" aria-label="Day"><input type="time" data-pe="'+i+'" data-pf="start" value="'+esc(x.start)+'" aria-label="Starts"><input type="time" data-pe="'+i+'" data-pf="end" value="'+esc(x.end)+'" aria-label="Ends"><input data-pe="'+i+'" data-pf="location" value="'+esc(x.location)+'" placeholder="Place" aria-label="Place"></span>' : ''));
    if(x.op==='remove') return row('events', i, x, 'Deletes a calendar event. Tick to confirm', '<s>'+esc(e.title)+'</s>', when(evDay(e), e.allDay?'':String(e.start).slice(11,16), e.allDay?'':String(e.end).slice(11,16))+(e.recurring?' · only this time':''));
    const c = x.changes, lab = {title:'Title', date:'Day', start:'Starts', end:'Ends', location:'Place'}, cur = {title:e.title, date:fmtShort(evDay(e)), start:String(e.start).slice(11,16), end:String(e.end).slice(11,16), location:e.location||''};
    return row('events', i, x, 'Changes a calendar event. Tick to confirm', esc(e.title), esc(calLabel(e))+(e.recurring?' · only this time':'')+' · '+Object.entries(c).map(([k,v])=>lab[k]+' '+esc(cur[k]||'none')+' → <b>'+esc(k==='date'?fmtShort(v):v)+'</b>').join(' · ')); }));
  h += grp('New tasks', p.tasks.map((t,i)=>{ const bad = chk.task[i].some(w=>/Pick a course|Needs a title|in the past/.test(w)); const open = t._edit || (bad && !t._off);
    const fields = open ? '<span class="pc-edit"><input class="pi-title" data-pi="'+i+'" data-pf="title" value="'+esc(t.title)+'" aria-label="Task title">'
      + '<select data-pi="'+i+'" data-pf="course" aria-label="Course"><option value="">Course?</option>'+courses.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===t.course?' selected':'')+'>'+esc(c.short)+'</option>').join('')+'</select>'
      + '<input type="date" data-pi="'+i+'" data-pf="due" value="'+esc(t.due)+'" aria-label="Day">'
      + '<input type="number" step="0.25" min="0.25" max="100" data-pi="'+i+'" data-pf="est" value="'+esc(t.est)+'" aria-label="Hours">'
      + '<select data-pi="'+i+'" data-pf="where" aria-label="Where">'+[['desk','Desk'],['train','Train · laptop'],['phone','Metro · phone']].map(([v,l])=>'<option value="'+v+'"'+(v===t.where?' selected':'')+'>'+l+'</option>').join('')+'</select></span>' : '';
    const meta = (t.course?esc(cnm(t.course)):'no course')+' · <span class="mono">'+(t.due?esc(fmtShort(t.due)):'no day')+' · '+esc(t.est)+' h</span> · '+esc(whereLabel({where:t.where}))+(t.estNote?' · '+esc(t.estNote):'');
    return row('tasks', i, t, false, esc(t.title||'(no title)'), meta, edit(open, 'tasks', i) + fields + (chk.task[i].length ? '<span class="pc-meta pc-tw">'+chk.task[i].map(w=>esc(w)).join(' · ')+'</span>' : '')); }));
  if(chk.day.length) h += chk.day.map(w=>'<div class="pc-warn">'+esc(w)+'</div>').join('');
  if(ctx==='compose' && typeof riskSaveLine==='function') h += riskSaveLine(p);
  const q = applyable(p), n = applyCount(q), left = needsTick(p);
  const blocking = q.tasks.some(t=>{ const i = p.tasks.indexOf(t); return i>=0 && chk.task[i].some(w=>/Pick a course|Needs a title|in the past/.test(w)); });
  const src = (p.provider ? 'From '+esc(p.provider==='claude' && p.model==='opus' ? 'Claude Opus' : p.provider==='claude' && p.model==='sonnet' ? 'Claude Sonnet' : PROV[p.provider]||p.provider)+(p.provider==='claude' && p.fixModel==='sonnet' && p.model!=='sonnet' && p.repaired ? ', second look by Sonnet' : '')+(p.repaired?' · fixed '+p.repaired+' thing'+(p.repaired===1?'':'s'):'')+(ctx==='compose'&&compose.hidden?' · '+compose.hidden+' private item'+(compose.hidden===1?'':'s')+' hidden':'') : '')
    + (p.origin==='docs' ? (p.provider?' · ':'')+'read from documents: can only add' : '') + (left ? ' · '+left+' not ticked' : '');
  h += '<div class="pc-foot"><button class="btn pri" data-prop="apply"'+(n && !blocking ? '' : ' disabled')+'>Apply '+n+'</button><button class="btn" data-prop="cancel">Not now</button>'+(src?'<span class="pc-src">'+src+'</span>':'')+'</div>';
  return h + '</div>';
}

/* prompts */
/* Compact plan for the planning prompt: open tasks sit under their deliverable, so deadlines are written once. About half the size of the long form. */
function compactPlan(){
  const short = t => { t = String(t||''); return t.length>90 ? t.slice(0,88)+'…' : t; };
  const line = t => '      '+t.id+' | '+short(t.title)+' | '+(t.due?t.due.slice(5)+' '+wd(t.due):'no day')+' | '+t.est+'h | '+t.where+(t.status!=='todo'?' | '+t.status:'');
  return courses.map(c=>{
    const open = (c.tasks||[]).filter(t=>t.status!=='done');
    const ds = (c.deliverables||[]).filter(d=>!d.date || d.date>=addDays(TODAY,-7) || open.some(t=>t.did===d.id));
    const rows = ds.map(d=>{ const ts = open.filter(t=>t.did===d.id); return '  deliverable '+d.id+': '+short(d.title)+' ['+(d.date?d.date+' '+wd(d.date):d.state)+delivTag(d)+']'+(ts.length?'\n'+ts.map(line).join('\n'):''); });
    const loose = open.filter(t=>!ds.some(d=>d.id===t.did));
    if(loose.length) rows.push('  no deliverable\n'+loose.map(line).join('\n'));
    return '- '+c.id+': '+c.short+(c.name && c.name!==c.short ? ' ('+short(c.name)+')' : '')+(rows.length?'\n'+rows.join('\n'):'');
  }).join('\n');
}
const decisionLines = c => (c.decisions||[]).slice(-5).map(d=>'\n    decision '+d.date+': '+d.text).join('');
function plannerContext(){ return courses.map(c=>'- '+c.id+': '+c.short+' ('+c.name+')\n'+(c.deliverables||[]).map(d=>'    deliverable '+d.id+': '+d.title+' ['+(d.date||d.state)+delivTag(d)+']').join('\n')+decisionLines(c)).join('\n'); }
const wd = s => fmt(s,{weekday:'short'});
function taskLine(c,t){ const d = delivOf(c,t); return '    task '+t.id+' ['+c.id+'] '+t.title+' | day '+t.due+(t.due?' '+wd(t.due):'')+' | '+t.est+' h | '+t.where+' | '+t.status+(t.waiting?' | waiting for '+t.waiting.what+(t.waiting.who?' from '+t.waiting.who:'')+' since '+t.waiting.since:'')+(d?' | for "'+d.title+'"'+(d.date?' due '+d.date+' '+wd(d.date):' (no deadline date)'):''); }
function openTasksContext(ids){ return courses.filter(c=>!ids || ids.includes(c.id)).map(c=>(c.tasks||[]).filter(t=>t.status!=='done').map(t=>taskLine(c,t)).join('\n')).filter(Boolean).join('\n'); }
function doneTasksContext(ids){ const from = addDays(TODAY,-14); return courses.filter(c=>!ids || ids.includes(c.id)).map(c=>(c.tasks||[]).filter(t=>t.status==='done' && (!t.due || t.due>=from)).map(t=>'    task '+t.id+' ['+c.id+'] '+t.title+' | done'+(Number(t.spent)>0?' | planned '+t.est+' h, took '+t.spent+' h':'')).join('\n')).filter(Boolean).join('\n') || '    none'; }
function loadContext(){ const out = []; for(let i=0;i<14;i++){ const d = addDays(TODAY,i); const tasks = r1(allTasks().filter(({t})=>t.status!=='done' && t.due===d).reduce((s,{t})=>s+(+t.est||0),0)); const ev = IN_APP ? eventHours(d) : 0; const cl = classesOn(d).length; out.push('    '+d+' '+wd(d)+': '+tasks+' h tasks'+(ev?', '+ev+' h calendar':'')+(cl?', '+cl+' classes (commute)':'')); } return out.join('\n'); }
function focusTask(){ const f = compose.focus; if(!f) return null; const c = cById(f.course), t = c && (c.tasks||[]).find(x=>x.id===f.id); return t ? {c, t, d:delivOf(c,t)} : null; }
function commuteList(){ const out = []; for(let i=0;i<42;i++){ const d = addDays(TODAY,i); if(isCommute(d)) out.push(d+' '+fmt(d,{weekday:'short'})); } return out.join(', '); }
/* How the planner works, told to the model as a description, not a list of prohibitions (19 Nov 2026, the user's question why the helper
   felt too restrained). The hard limits stay in code (normalize, the organizer, the second look); the text only explains them. */
/* courses that are only done at the desk, for the prompts ("" when there are none) */
const deskOnlyText = () => { const l = courses.filter(deskOnly).map(c=>(c.short||c.name)+' ('+c.id+')'); return l.length ? l.join(', ')+' only at the desk, ' : ''; };
const rulesText = () => `How the planner works. You read the note; code does the rest:
- It places work. It picks the days (free time, even load, priority deadlines first, then deadline order, commute days), splits big work into parts, scales sizes by how long the student usually takes, and asks the student how long new work takes when the note does not say. So give each piece of work once, whole, with your honest size in "minutes", and leave "due" empty unless the note names the day.
- It reads busy days, free time ("I have extra time today from 17:00"), packed days and short slots itself. They are not tasks or events, and you do not move tasks for them.
- It keeps the standing rules: ${deskOnlyText()}train and metro work only on commute days, blocked work never pulled earlier, nothing past a deadline. A day you give for existing work is used only when the note asks for that day. When the note asks for something these rules do not allow ("a desk-only course on the train"), write it as asked: the planner does it the allowed way and tells the student. Do not ask about it.
- It checks your answer. What it cannot use (an unknown id, a task without a course, a vague title) is not saved.

What you do:
1. Course and deliverable. Every task gets one course id from the list and the deliverable id it serves ("" if none fits, or a new deliverable). A day the work must be done by ("by Tuesday", "bis Dienstag", "antes del 15") is a deadline: the deliverable's date, not the task's "due". Every deadline the note mentions is kept, with its work: if the note names only the deadline ("beca 15 dic"), the work is doing that thing ("Apply for the scholarship"), so add it as a task; if the work is already planned, link those tasks to it with "did" in "updates". Never leave out something the note mentions. Personal admin that belongs to no course (scholarship, application, form, office, bank, visa, insurance) goes to course "${ADMIN_ID}"; a date it must be done by is a deliverable there with that date.
2. Size. "minutes" is the whole work; similar finished tasks are a guide. If the note gives the size, set "stated": true; in full days, also "fullDays" (a full day is ${RULES_CFG.heavy} hours).
3. Titles. In English like the existing tasks, even when the note is in Spanish or German. Short and plain, start with a verb, and name the concrete work: which text and pages, which video or episode, which file. If the note does not say which, ask.
4. Where. "train" = laptop without internet on the train, "phone" = reading or rehearsing in the metro, "desk" = at home with internet or hardware.
5. Changes to planned work go in "updates" with the existing id, work no longer needed in "removes" with a reason. Deadlines are set by the course: change one in "deadlineUpdates" only when the note says that date itself changed (never a second deliverable for it). Postponing or moving work moves its tasks, not the deadline. Never add a copy of an open or done task. In "summary" and "reason" name tasks by their title, never by id. A blocked task stays blocked until the note says it is unblocked or what it waited for arrived; then its "status" is "todo".`;
const SHAPE = `{"think":"what the note is, what is missing, what you will do","summary":"one short sentence","deliverables":[{"key":"new1","course":"ct","title":"...","date":"YYYY-MM-DD or null"}],"tasks":[{"course":"ct","did":"ct-c or new1 or empty","title":"...","due":"YYYY-MM-DD only if the note names the day, else empty","minutes":90,"stated":false,"fullDays":0,"where":"desk","note":"","file":"F1 or empty","waitingFor":{"what":"","who":""}}],"updates":[{"id":"existing task id","course":"ct","where":"desk|train|phone, only if the note says where it is done","did":"deliverable id or new key, only to link it","title":"...","file":"F1 to link a file, else empty","waitingFor":{"what":"","who":""},"due":"YYYY-MM-DD only if the note asks to move it","status":"todo|doing|blocked|done","minutes":120,"fullDays":0,"spentMinutes":"minutes it actually took, only if the note says","note":"..."}],"removes":[{"id":"existing task id","reason":"short reason"}],"deadlineUpdates":[{"id":"existing deliverable id","date":"YYYY-MM-DD"}],"events":[{"ref":"E1 or empty for a new event","title":"...","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","place":"","remove":false}],"classWork":[{"date":"YYYY-MM-DD","course":"ct"}],"skipClasses":[{"date":"YYYY-MM-DD","course":"ct","start":"HH:MM"}],"attendClasses":[],"skipEvents":["E1"],"priorities":[{"id":"existing deliverable id","rank":1}],"whatIf":false}
"events" changes the student's calendar: a new appointment (empty "ref", no "start" means all day), moving or renaming a listed event (its ref, only the fields that change), or deleting one ("remove":true). Classes are not calendar events and cannot be changed. Never change an event marked read only.
In "updates" include only the fields that change. "removes" deletes a task: use it for duplicates and for work that is no longer needed. If an existing deadline moves, use "deadlineUpdates" with its id; never add a second deliverable for it. Use empty arrays when there is nothing.`;
/* What the note is about, worked out in code before any model runs: the courses, deliverables, tasks and days it mentions.
   Only that slice of the plan goes to the model, so it has far less to read. */
const DAYWORDS = {sunday:0,sun:0,sonntag:0,domingo:0,monday:1,mon:1,montag:1,lunes:1,tuesday:2,tue:2,tues:2,dienstag:2,martes:2,wednesday:3,wed:3,mittwoch:3,'miércoles':3,miercoles:3,thursday:4,thu:4,thurs:4,donnerstag:4,jueves:4,friday:5,fri:5,freitag:5,viernes:5,saturday:6,sat:6,samstag:6,'sábado':6,sabado:6};
/* Days a note names, worked out in code: today, tomorrow (tmrw, mñn, morgen), the day after (übermorgen, pasado mañana), weekday
   names (the next one, today included; "next Thursday", "el jueves que viene", "nächsten Donnerstag" never today), a weekday with
   a day number ("Friday 27 Nov", "el sábado 28") as that date, 24.11., 2026-11-24, "24 Nov", "Nov 24". Only real dates.
   19 Nov 2026 user test: "next Thursday" gave today, "Friday 27 Nov" gave this Friday, "tmrw" was not a day, "Feb 30" was. */
const MONTH_RE = /^(jan(?:uary|uar)?|ene(?:ro)?|feb(?:ruary|ruar|rero)?|mar(?:ch|zo)?|mär(?:z)?|mrz|apr(?:il)?|abr(?:il)?|may(?:o)?|mai|jun(?:e|i|io)?|jul(?:y|i|io)?|aug(?:ust)?|ago(?:sto)?|sep(?:t|tember|tiembre)?|set(?:iembre)?|oct(?:ober|ubre)?|okt(?:ober)?|nov(?:ember|iembre)?|dec(?:ember)?|dez(?:ember)?|dic(?:iembre)?)\.?$/;
const MONTH_NO = {jan:1,ene:1,feb:2,mar:3,'mär':3,mrz:3,apr:4,abr:4,may:5,mai:5,jun:6,jul:7,aug:8,ago:8,sep:9,set:9,oct:10,okt:10,nov:11,dec:12,dez:12,dic:12};
const monthOf = w => MONTH_RE.test(w) ? MONTH_NO[w.slice(0,3)] || 0 : 0;
const NEXT_WORD = /(?:^|[^\p{L}])(?:next|nächste[nrms]?|naechste[nrms]?|kommende[nrms]?|próximo|proximo|próxima|proxima)\s+$/u;
function noteDays(note){
  const low0 = ' '+String(note||'').toLowerCase()+' ', days = new Set();
  const word = w => new RegExp('(?<![\\p{L}])(?:'+w+')(?![\\p{L}])','u');
  /* "heute Morgen", "por la mañana" are mornings, not tomorrow */
  const low = low0.replace(/heute morgen|morgens|am morgen|por la mañana|de la mañana|en la mañana|esta mañana/g, ' ');
  if(word('today|heute|hoy|tonight|heute abend|esta noche').test(low)) days.add(TODAY);
  const after = word('übermorgen|uebermorgen|pasado mañana|pasado manana|day after tomorrow').test(low);
  if(after) days.add(addDays(TODAY,2));
  if(word('tomorrow|tmrw|tmr|tmw|tomorow|tommorow|tommorrow|2morrow|2moro|morgen|mañana|manana|mñn|mñana|mnn').test(low.replace(/übermorgen|uebermorgen|pasado mañana|pasado manana|day after tomorrow/g,' '))) days.add(addDays(TODAY,1));
  const dated = (y, mo, d) => { if(!(mo>=1 && mo<=12 && d>=1 && d<=31)) return; if(!y){ y = +TODAY.slice(0,4); if(y+'-'+pad(mo)+'-'+pad(d) < addDays(TODAY,-60)) y++; } const iso = y+'-'+pad(mo)+'-'+pad(d); if(validDate(iso)) days.add(iso); };
  /* "24 Nov", "24. November", "28 de noviembre", and "Nov 24" (two passes, so "Sunday 29 Nov" finds "29 Nov") */
  for(const m of low.matchAll(/(?<![\d.])(\d{1,2})(?:st|nd|rd|th)?\.?\s*(?:de\s+|of\s+)?(\p{L}{3,10}\.?)/gu)){ const mo = monthOf(m[2]); if(mo) dated(0, mo, +m[1]); }
  for(const m of low.matchAll(/(?<![\p{L}])(\p{L}{3,10}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?![\d:.]|\s*(?:uhr|h\b|am\b|pm\b))/gu)){ const mo = monthOf(m[1]); if(mo) dated(0, mo, +m[2]); }
  Object.entries(DAYWORDS).forEach(([w,n])=>{
    for(const m of low.matchAll(new RegExp('(?<![\\p{L}])'+w+'(?![\\p{L}])(\\s*,?\\s*(?:the\\s+|den\\s+|el\\s+|der\\s+)?(\\d{1,2})(?:st|nd|rd|th|\\.)?(?![\\d:.]|\\s*(?:uhr|h\\b|am\\b|pm\\b|:)))?','gu'))){
      if(m[2]){   /* "Friday 27 Nov" / "el sábado 28": the date, in this month or the next */
        const rest = low.slice(m.index + m[0].length), mo = monthOf((rest.match(/^\s*(?:de\s+|of\s+)?(\p{L}{3,10}\.?)/u)||[])[1]||'');
        if(mo){ dated(0, mo, +m[2]); continue; }
        let y = +TODAY.slice(0,4), mon = +TODAY.slice(5,7); if(+m[2] < +TODAY.slice(8,10)){ mon++; if(mon > 12){ mon = 1; y++; } } dated(y, mon, +m[2]); continue; }
      const next = NEXT_WORD.test(low.slice(0, m.index)) || /^\s*(?:que viene|que entra|de la (?:otra|próxima) semana)/.test(low.slice(m.index + m[0].length));
      /* "next Friday" said on a Thursday is the Friday of next week, not tomorrow (19 Nov 2026 user test) */
      const from = next ? Math.max(1, 7 - (parse(TODAY).getDay()+6)%7) : 0;
      for(let i = from; i < from + 14; i++){ const d = addDays(TODAY,i); if(parse(d).getDay()===n){ days.add(d); break; } }
    } });
  (low.match(/\b20\d\d-\d\d-\d\d\b/g)||[]).forEach(d=>days.add(d));
  noteDates(note).forEach(d=>days.add(d));
  return [...days].filter(d=>validDate(d)).sort();
}
/* Days named as a deadline ("by Tuesday", "bis Dienstag", "antes del 15 de diciembre", "before Dec 3"): work is due by then,
   it is not done on that day (19 Nov 2026 stress test: "bis Dienstag" pinned the work on Tuesday). */
const DUE_WORD_RE = /(?:^|[^\p{L}])(by|until|till|before|due|deadline|bis|vor|f[aä]llig|antes(?:\s+del?)?|hasta(?:\s+el)?|para\s+el)(?![\p{L}])([^.,;!?\n]{0,32})/giu;
function deadlineDays(note){ const s = new Set(); for(const m of String(note||'').matchAll(DUE_WORD_RE)) noteDays(m[2]).forEach(d=>s.add(d)); return s; }
function noteScope(note){
  const low = ' '+String(note||'').toLowerCase()+' ', words = titleWords(note), cids = new Set(), days = new Set();
  const hit = txt => { const w = titleWords(txt); let n = 0; words.forEach(x=>{ if(w.has(x)) n++; }); return n; };
  /* a course named by a word only it has ("disembodied"), the same rule as courseInNote; the full short name alone missed
     "Modeling the Body from" (24 Nov 2026: its readings never reached the prompt) */
  const named = coursesNamed(note);
  courses.forEach(c=>{
    if(named.has(c.id) || courseKeys(c).some(k=>low.includes(k)) || new RegExp('\\b'+c.id+'\\b').test(low)) cids.add(c.id);
    else if((c.deliverables||[]).some(d=>hit(d.title)>=1) || (c.tasks||[]).some(t=>t.status!=='done' && hit(t.title)>=2)) cids.add(c.id);
  });
  noteDays(note).forEach(d=>days.add(d));
  /* "this week" / "next week": every day of it */
  if(/\b(weekend|wochenende|fin de semana|finde)\b/.test(low)){ for(let i=0;i<8;i++){ const d = addDays(TODAY,i), g = parse(d).getDay(); if(g===6 || g===0) days.add(d); if(g===0 && i>0) break; } }
  const wk = /\b(this week|diese woche|esta semana)\b/.test(low) ? 0 : /\b(next week|nächste woche|la próxima semana|la semana que viene)\b/.test(low) ? 1 : -1;
  /* on a Saturday or Sunday "this week" is the week ahead (19 Nov 2026 user test: asked on Sunday, it saw only Sunday) */
  if(wk >= 0){ const dow = (new Date(TODAY+'T12:00').getDay()+6)%7, mon = addDays(TODAY, -dow + 7*(wk + (wk===0 && dow >= 5 ? 1 : 0))); for(let i=0;i<7;i++){ const d = addDays(mon,i); if(d >= TODAY) days.add(d); } }
  const busy = /packed|busy|too much|lighter|free up|move what|can wait|reschedul|overload|voll|stress|ocupad|mucho/.test(low);
  if(busy){ days.add(TODAY); if(!days.size) days.add(addDays(TODAY,1)); }
  const f = focusTask(); if(f) cids.add(f.c.id);
  const none = !cids.size && !days.size;
  /* questions about the plan see three weeks, and personal admin is always shown, whatever words the note uses (19 Nov 2026
     user test: "cuánto me queda para la beca?" answered "nothing planned" while two 7 h scholarship tasks existed) */
  const question = /\?\s*$|^\s*(what|how|which|when|is|are|do|did|qu[eé]|cu[aá]nt[oa]s?|cu[aá]ndo|c[oó]mo|tengo|was|wie|wann|welche|habe ich|muss ich)\b/i.test(String(note||'').trim());
  if(cById(ADMIN_ID)) cids.add(ADMIN_ID);
  return {cids, days, busy, none, question};
}
function scopedTasks(sc){
  const short = t => { t = String(t||''); return t.length>90 ? t.slice(0,88)+'…' : t; };
  const pick = ({c,t}) => t.status!=='done' && (sc.cids.has(c.id) || (t.due && sc.days.has(t.due)) || (sc.busy && t.due && t.due<TODAY) || (sc.none && t.due && t.due<=addDays(TODAY,7)) || (sc.question && t.due && t.due<=addDays(TODAY,21)));
  const rows = allTasks().filter(pick).sort((a,b)=>(a.t.due||'9999').localeCompare(b.t.due||'9999'));
  return rows.map(({c,t})=>{ const d = delivOf(c,t); return '    '+t.id+' ['+c.id+'] '+short(t.title)+' | '+(t.due?t.due+' '+wd(t.due):'no day')+' | '+t.est+'h | '+t.where+(t.status!=='todo'?' | '+t.status:'')+(t.waiting?' | waiting for '+t.waiting.what+(t.waiting.who?' from '+t.waiting.who:'')+' since '+t.waiting.since:'')+(d?' | for '+d.id+(d.date?' due '+d.date:''):''); }).join('\n') || '    none';
}
/* Appointments read in code, so a note with a day and a time always becomes a calendar event, whatever the model says.
   Dates: 24.11.2026, 24.11., 2026-11-24, today/tomorrow, weekday names. Times: 13:45, 13.45 Uhr, 13 Uhr, 1pm, 1:30 pm. */
function noteDates(note){
  const low = String(note||'').toLowerCase(), out = [];
  for(const m of low.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\d)/g)){
    const d = +m[1], mo = +m[2]; if(!(d>=1 && d<=31 && mo>=1 && mo<=12)) continue;
    let y = m[3] ? +m[3] : 0; if(y && y<100) y += 2000; if(!y){ y = +TODAY.slice(0,4); if(y+'-'+pad(mo)+'-'+pad(d) < TODAY) y++; }
    const iso = y+'-'+pad(mo)+'-'+pad(d); if(validDate(iso)) out.push(iso);
  }
  (low.match(/\b20\d\d-\d\d-\d\d\b/g)||[]).forEach(d=>validDate(d) && out.push(d));
  return [...new Set(out)];
}
function noteTime(note){
  const t = String(note||'').replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?/g,' ').replace(/\b20\d\d-\d\d-\d\d\b/g,' ');
  const ap = (h, x) => { x = String(x||'').toLowerCase(); if(x.startsWith('p') && h<12) h += 12; if(x.startsWith('a') && h===12) h = 0; return h; };
  for(const m of t.matchAll(/(?<![\w.])([01]?\d|2[0-3])(?::([0-5]\d)(?![.\d])\s*(am\b|pm\b|a\.m\.|p\.m\.)?|\.([0-5]\d)\s*(uhr\b|h\b|am\b|pm\b|a\.m\.|p\.m\.))/gi)) return pad(ap(+m[1], m[3]||(/uhr|h/i.test(m[5]||'')?'':m[5])))+':'+(m[2]||m[4]);
  /* "3h" after a size word, or any "1h" to "6h", is how long something takes, not 03:00 (19 Nov 2026 user test: "prob 3h"
     became a 03:00 appointment); "14h", "3 Uhr", "3pm" stay times */
  for(const m of t.matchAll(/(?<![\w.])([01]?\d|2[0-3])\s*(uhr\b|h\b|am\b|pm\b|a\.m\.|p\.m\.)/gi)){
    if(/^h$/i.test(m[2]) && (+m[1] < 7 || /(?:prob(?:ably)?|about|approx\.?|ca\.?|~|takes?|needs?|unas?|unos?|son|dauert|etwa|for|para|f[uü]r|maybe|like|around|around)\s*$/i.test(t.slice(0, m.index)))) continue;
    return pad(ap(+m[1], /uhr|h/i.test(m[2]) ? '' : m[2]))+':00'; }
  return '';
}
/* Returns null when the note is not an appointment (it needs a day and a time, or one of them plus a place).
   Otherwise the event, with "missing" listing what to ask: title, date, start. Nothing is guessed. */
/* "I have extra time today from 5pm", "free tomorrow afternoon", "ab 17 Uhr habe ich Zeit": free time, not an appointment.
   Returns {day, from, to} in minutes, or null. Without an end it runs to DAY_END; today it starts no earlier than now. */
const FREE_RE = /\b(extra time|free time|spare time|some time|have time|have some time|i am free|i'?m free|am free|free from|free after|free until|free (?:this|tomorrow|today|in the|on|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)|available|frei|freie zeit|zeit|tiempo libre|libre|tengo tiempo)\b/i;
function noteTimes(note){ let t = String(note||''); const out = []; for(let i=0;i<3;i++){ const x = noteTime(t); if(!x) break; out.push(x); const h = +x.slice(0,2), m = x.slice(3); t = t.replace(new RegExp('(?<![\\w.])0?'+(h>12?'(?:'+h+'|'+(h-12)+')':h)+'(?:[:.]'+m+')?\\s*(?:uhr|h|am|pm|a\\.m\\.|p\\.m\\.)?','i'), ' '); } return out; }
function freeTimeFromNote(note){
  const text = String(note||''), low = text.toLowerCase(); if(!FREE_RE.test(low) || DAYOFF_RE.test(low) || BUSY_RE.test(low)) return null;
  let day = noteDates(text)[0] || ''; if(!day){ const sc = noteScope(text); day = sc.days.size===1 ? [...sc.days][0] : TODAY; }
  if(day < TODAY) return null;
  let ts = noteTimes(text).map(toMin);
  /* bare hours: "from 10 to 14", "von 10 bis 14", "de 10 a 14", "from 5", "after 5" (1-7 read as afternoon) */
  const hr = (h, m) => { h = +h; if(h>=1 && h<=7) h += 12; return h*60 + (+m||0); };
  const rg = low.match(/\b(?:from|von|de|desde|between|zwischen)\s+(\d{1,2})(?:[:.](\d\d))?\s*(?:to|until|till|bis|a|hasta|and|und|-|–)\s*(\d{1,2})(?:[:.](\d\d))?\b/);
  if(rg){ ts = [hr(rg[1],rg[2]), hr(rg[3],rg[4])]; }
  else if(!ts.length){ const one = low.match(/\b(?:from|after|ab|nach|desde|después de las)\s+(\d{1,2})(?:[:.](\d\d))?\b/); if(one) ts = [hr(one[1],one[2])]; }
  let from = ts.length ? ts[0] : /\bevening|abend|noche\b/.test(low) ? 18*60 : /\bafternoon|nachmittag|tarde\b/.test(low) ? 14*60 : DAY_START;
  let to = ts.length > 1 && ts[1] > from ? ts[1] : DAY_END;
  if(day===TODAY){ const n = new Date(), now = Math.ceil((n.getHours()*60+n.getMinutes())/15)*15; if(now > from) from = now; }
  return to > from ? {day, from, to} : null;
}
/* "I'm busy Thursday", "no time tomorrow until 15:00", "keine Zeit am Freitag", "ocupado el jueves por la tarde": busy time.
   Read in code, not by the model. Returns {days, from, to, note} (minutes) or null. No day named: today. No time named: the
   whole day; "until 15" is the morning to 15:00, "from/after 17" to the evening, "morning/afternoon/evening" those parts. */
/* a day off is busy time, never free time to fill (19 Nov 2026 user test: "me lo tomo libre" pulled 14 h onto that day) */
const DAYOFF_RE = /(no\s+voy\s+a\s+estudiar|no\s+estudio|lerne(?:\s+ich)?\s+(?:gar\s+)?nichts|nichts\s+lernen|won'?t\s+study|not\s+going\s+to\s+study|i'?m\s+away|i\s+will\s+be\s+away|away\s+(?:from|until|till|on)|on\s+(?:a\s+)?trip|me\s+voy\s+(?:a|de\s+viaje)|de\s+viaje|verreist|bin\s+(?:ich\s+)?(?:in|auf|bei)\s+[a-zäöü]{3,}|vacation|holiday|urlaub|ferien|vacaciones|me\s+(?:lo\s+)?tomo\s+(?:el\s+d[ií]a\s+)?libre|d[ií]a\s+libre|tomarme\s+(?:el\s+d[ií]a|libre)|frei\s*nehmen|frei\s*nehme|freien\s+tag|frei\s+machen|day\s+off|take\s+(?:the\s+)?(?:\w+\s+){0,2}off|skip\s+(?:the\s+)?(?:whole\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day(?!\s+(?:class|lecture|seminar|session|lab))|no\s+study(?:ing)?|not\s+study(?:ing)?|no\s+quiero\s+estudiar|kein(?:e)?\s+(?:lernen|uni)|nicht\s+lernen)/i;
/* the end of busy time: well again, or the busy thing cancelled (19 Nov 2026 user test: "I'm NOT sick anymore" and "I'll go to
   class" added a sick day; "band rehearsal is cancelled" asked when it was) */
const UNBUSY_RE = /\b(not sick(?: anymore)?|no longer sick|not ill|feeling better|feel better|better now|i'?m fine now|recovered|nicht mehr krank|wieder gesund|ya no estoy enferm[oa]|ya estoy bien|me siento mejor|remove the busy|delete the busy|clear the busy|is cancel+ed|are cancel+ed|got cancel+ed|cancel+ed|abgesagt|fällt aus|f[aä]llt weg|cancelad[oa]|se cancel[oó])\b/i;
const BUSY_RE = /\b(sick|krank|enferm[oa]|can'?t do anything|cannot do anything|kann nichts|no puedo hacer nada|busy|no time|not available|unavailable|can'?t work|cannot work|won'?t have (?:any )?time|day off|take (?:the )?(?:\w+ ){0,2}off|keine zeit|beschäftigt|nicht verfügbar|ocupad[oa]|no tengo tiempo|sin tiempo|no puedo trabajar)\b/i;
/* Busy time that ends: on the days the note names (else from today on), blocks whose note shares a word with this one ("band
   rehearsal"), or, when he is well again or asks to remove the busy block, the blocks from sick or busy notes. */
function unbusyFromNote(note){
  const text = String(note||''), low = text.toLowerCase(); if(!UNBUSY_RE.test(low)) return [];
  const named = noteDays(text).filter(d=>d >= TODAY), well = /sick|ill|better|fine|recovered|krank|gesund|enferm|bien|mejor|busy block|the busy/.test(low);
  const words = [...titleWords(text)].filter(w=>!/^(cancel|abgesa|cancel|today|tomorr|monday|tuesda|wednes|thursd|friday|saturd|sunday)/.test(w));
  const out = [];
  Object.keys(DAYS||{}).filter(d=>d >= TODAY && (!named.length || named.includes(d))).sort().forEach(d=>(DAYS[d].busy||[]).forEach((b,i)=>{
    const bw = titleWords(b.note||''), shared = words.some(w=>bw.has(w));
    if(shared || (well && (BUSY_RE.test(String(b.note||'')) || /busy|sick|krank|enferm/i.test(String(b.note||''))))) out.push({day:d, i, from:b.from, to:b.to, note:b.note||''}); }));
  return out;
}
function busyFromNote(note){
  const text = String(note||''), low = text.toLowerCase(); if(UNBUSY_RE.test(low) || !(BUSY_RE.test(low) || DAYOFF_RE.test(text))) return null;
  let days = noteDays(text).filter(d=>d >= TODAY); if(!days.length) days = [TODAY];
  /* a span of days (19 Nov 2026 stress test: "sick until Sunday" marked nothing): "until Sunday", "bis Sonntag", "hasta el domingo", "for 3 days" */
  const span = low.match(/\b(?:until|till|through|thru|bis|hasta)\s+(?:el\s+|la\s+|zum\s+|next\s+)?([^.,;!?\n]{3,24})/), nDays = low.match(/\b(?:for|für|por)\s+(\d|two|three|four|five|zwei|drei|vier|dos|tres|cuatro)\s+(?:days|tage|d[ií]as)\b/);
  const endDay = span && noteDays(span[1]).find(d=>d > TODAY), nd = nDays && ({two:2,three:3,four:4,five:5,zwei:2,drei:3,vier:4,dos:2,tres:3,cuatro:4}[nDays[1]] || +nDays[1]);
  const last0 = endDay || (nd > 1 ? addDays(TODAY, nd-1) : '');
  /* "vom 4. bis 6. Dezember", "del 4 al 6 de diciembre", "from 4 to 6 Dec": every day of it (19 Nov 2026 user test: a trip to
     Hamburg became a looping appointment question) */
  const rg2 = low.match(/\b(?:vom|von|del|de|from|between)\s+(\d{1,2})\.?\s*(?:(?:de\s+)?([a-zäéñ]{3,10})\.?\s+)?(?:bis(?:\s+zum)?|al|a|to|until|-|–|and|und)\s+(\d{1,2})\.?\s*(?:de\s+)?([a-zäéñ]{3,10})/i);
  let first = '', last = last0;
  if(rg2){ const mo2 = monthOf(rg2[4]), mo1 = rg2[2] ? monthOf(rg2[2]) || mo2 : mo2; if(mo2){ const y = +TODAY.slice(0,4), a = y+'-'+pad(mo1)+'-'+pad(+rg2[1]), b = y+'-'+pad(mo2)+'-'+pad(+rg2[3]);
    const fix = d => d < addDays(TODAY,-60) ? (+d.slice(0,4)+1)+d.slice(4) : d; if(validDate(fix(a)) && validDate(fix(b))){ first = fix(a); last = fix(b); } } }
  /* "el viernes 4 de diciembre … hasta el domingo": from the first day named */
  if(!first && last){
    /* the start is the first day named outside the "until" part; the end day comes after it ("el viernes 4 de diciembre … hasta el domingo" is 4 to 6 Dec) */
    const start = noteDays(span ? text.slice(0, low.indexOf(span[0])) + text.slice(low.indexOf(span[0]) + span[0].length) : text).filter(d=>d >= TODAY)[0];
    if(start){ first = start; while(last < first) last = addDays(last, 7); } }
  if(last && diff(last, first || TODAY) <= 21 && diff(last, TODAY) <= 60){ days = []; for(let d = first && first > TODAY ? first : TODAY; d <= last; d = addDays(d,1)) days.push(d); }
  const hr = (h, m) => { h = +h; if(h>=1 && h<=7) h += 12; return h*60 + (+m||0); };
  let from = DAY_START, to = DAY_END;
  const ts = noteTimes(text).map(toMin);
  const rg = low.match(/\b(?:from|von|de|desde|between|zwischen)\s+(\d{1,2})(?:[:.](\d\d))?\s*(?:to|until|till|bis|a|hasta|and|und|-|–)\s*(\d{1,2})(?:[:.](\d\d))?\b/);
  const until = low.match(/\b(?:until|till|bis|hasta)\s+(\d{1,2})(?:[:.](\d\d))?/), after = low.match(/\b(?:from|after|ab|nach|desde)\s+(\d{1,2})(?:[:.](\d\d))?\b/);
  if(rg){ from = hr(rg[1],rg[2]); to = hr(rg[3],rg[4]); }
  else if(ts.length > 1){ from = ts[0]; to = ts[1]; }
  else if(until){ to = ts.length ? ts[0] : hr(until[1], until[2]); }
  else if(after){ from = ts.length ? ts[0] : hr(after[1], after[2]); }
  else if(/\bmorning|vormittag|mañana por la|por la mañana\b/.test(low)) to = 12*60;
  else if(/\bafternoon|nachmittag|tarde\b/.test(low)){ from = 12*60; to = 18*60; }
  else if(/\bevening|abend|noche\b/.test(low)) from = 18*60;
  from = Math.max(DAY_START, from); to = Math.min(DAY_END, to);
  return to > from ? {days, from, to, note:text.trim()} : null;
}
/* Does an appointment read from a busy note have a real title ("dentist"), or only busy words ("Busy on until")? */
const BUSY_FILL = new Set('i im i\'m am is be will on at in the a an all day from to until till after before this next morning afternoon evening busy no time not available unavailable cant can\'t cannot work won\'t have any off keine zeit am um bis ab ich bin habe estoy ocupado ocupada el la por de hasta tengo tiempo sin'.split(' '));
const busyTitle = ev => String(ev && ev.title || '').toLowerCase().split(/[^\p{L}']+/u).some(w=>w && !BUSY_FILL.has(w) && !DAYWORDS[w] && !/^(today|tomorrow|heute|morgen|hoy|mañana)$/.test(w));
/* Today is packed or partly busy: keep what has to happen today (deadline today, or a class session tomorrow), then the most
   urgent work while it fits in the free time left today; move the rest to tomorrow, where the organizer spreads it out
   before its deadline. keepHours: how much to keep (default: the free time left today; 0 = only what has to happen today).
   Returns updates for the preview (not pinned, so the organizer may still place them). */
/* Hours of open work on today (and carried over) beyond the free time left now. The organizer keeps days within their free time,
   so this is above 0 only when time ran out during the day; only then is "move what can wait" offered. */
function todayOver(){
  const open = allTasks().filter(({c,t})=>t.status!=='done' && t.status!=='blocked' && t.due && t.due <= TODAY && !waitsForWeek(c) && !pastDeadline(c,t)).reduce((s,{t})=>s+(Number(t.est)||0),0);
  const over = q4(open - freeAtHome(TODAY, nowMinutes()));
  return over >= 0.5 ? over : 0;
}
/* "Today is packed, I can only do 1 hour", "solo puedo 2 horas hoy", "heute nur 1 Stunde": the rest of today is busy, so the work
   that does not fit moves and the organizer does not top today up again (19 Nov 2026 stress test: the model only said "Noted"). */
function todayCapFromNote(note){
  const low = ' '+String(note||'').toLowerCase()+' ';
  if(!/\b(today|tonight|hoy|heute)\b/.test(low) || !/\b(only|just|max(?:imum)?|at most|solo|sólo|nur|höchstens)\b/.test(low)) return null;
  const m = low.match(/\b(\d+(?:[.,]\d+)?|an?|one|half an?|una?|media|eine?|halbe)\s*(hours?|hrs?|h|horas?|stunden?|minutes?|mins?|minutos?|minuten)\b/); if(!m) return null;
  const n = /^(half|media|halbe)/.test(m[1]) ? 0.5 : /^(an?|one|una?|eine?)$/.test(m[1]) ? 1 : parseFloat(m[1].replace(',','.'));
  const h = /^m/.test(m[2]) ? n/60 : n, now = nowMinutes(), from = Math.ceil((now + h*60)/15)*15;
  if(!(h > 0) || from >= DAY_END) return null;
  return {days:[TODAY], from, to:DAY_END, note:String(note).trim().slice(0,80), cap:h};
}
function relieveToday(keepHours){
  const nowMin = nowMinutes(), tom = addDays(TODAY,1);
  const free = keepHours != null ? keepHours : freeAtHome(TODAY, nowMin);
  const must = ({c,t}) => { const last = Organizer.lastDayOf(c,t); return !!last && last <= TODAY; };
  const list = allTasks().filter(({c,t})=>t.status!=='done' && t.status!=='blocked' && t.due && t.due <= TODAY && !waitsForWeek(c) && !pastDeadline(c,t)).sort((a,b)=>(must(b)?1:0)-(must(a)?1:0) || byUrgency(a,b));
  const updates = []; let used = 0;
  list.forEach(x=>{ const e = Number(x.t.est)||0; if(must(x) || x.t.status==='doing' || used + e <= free + 1e-6){ used += e; return; } updates.push({course:x.c.id, id:x.t.id, changes:{due:tom}}); });
  return updates;
}
const emptyProposal = (summary, provider) => ({summary:summary||'', deliverables:[], tasks:[], updates:[], dupdates:[], removes:[], events:[], busy:[], dropped:[], provider:provider||'planner'});
/* Runs fn as if the busy time were already saved (for the preview), then puts DAYS back. */
function withBusy(b, fn){ const keep = JSON.stringify(DAYS); b.days.forEach(d=>{ const doc = DAYS[d] = DAYS[d] || {id:d, busy:[]}; doc.busy = doc.busy.concat([{from:b.from, to:b.to}]); }); try{ return fn(); } finally { DAYS = JSON.parse(keep); } }
/* Busy note -> proposal: the busy time itself, today's work that no longer fits (to tomorrow), and a preview of what the
   organizer will move off the other busy days once it is saved. Work he placed on a busy day himself stays and is named. */
function busyProposal(b){
  return withBusy(b, ()=>{
    const p = emptyProposal('');
    if(b.days.includes(TODAY)) p.updates = relieveToday().map(u=>Object.assign(u, {pin:false}));
    const copy = JSON.parse(JSON.stringify(courses));
    p.updates.forEach(u=>{ const c = copy.find(x=>x.id===u.course), t = c && c.tasks.find(x=>x.id===u.id); if(t) t.due = u.changes.due; });
    const {moves} = Organizer.organizePlan(copy, orgEnv());
    /* 19 Nov 2026 stress test: "only 1 hour today" warned "Fri 20 Nov goes to 11 h", but the organizer spreads that work */
    const final = {}; copy.forEach(c=>(c.tasks||[]).forEach(t=>{ final[t.id] = t.due; }));
    p.updates.forEach(u=>{ if(final[u.id]) u.changes.due = final[u.id]; });
    p.shifted = {}; moves.forEach(m=>{ if(!p.updates.some(u=>u.id===m.t.id)) p.shifted[m.t.id] = m.to; });
    const title = u => { const c = cById(u.course), t = c && c.tasks.find(x=>x.id===u.id); return t ? t.title : ''; };
    const off0 = p.updates.map(u=>({title:title(u), to:u.changes.due})).concat(moves.filter(m=>b.days.includes(m.from) && m.from!==TODAY).map(m=>({title:m.t.title, to:m.to})));
    const off = off0.filter((x,i)=>off0.findIndex(y=>y.title===x.title)===i);   /* each task once (19 Nov 2026 user test) */
    /* what is still on a busy day after that: placed there by him, or no free time before its deadline */
    const left = copy.flatMap(c=>(c.tasks||[]).filter(t=>t.status!=='done' && b.days.includes(t.due) && t.due > TODAY));
    /* a day whose remaining work still fits its free time (desk, and 2 h train / 2 h metro on a commute day) is fine */
    const fits = d => { const on = left.filter(t=>t.due===d), h = w => on.filter(t=>Organizer.placeOf(t, TODAY)===w).reduce((s,t)=>s+(Number(t.est)||0),0);
      return h('desk') <= deskCap(d) + 1e-6 && ['train','phone'].every(w=>h(w) <= (isCommute(d) ? COMMUTE_CAP : 0) + 1e-6); };
    const over = left.filter(t=>!fits(t.due));
    const pinned = over.filter(t=>t.pin===t.due).map(t=>t.title), stuck = over.filter(t=>t.pin!==t.due).map(t=>t.title);
    const q = l => l.map(s=>'"'+s.slice(0,50)+'"').join(', ');
    p.busy = [Object.assign({}, b, {moves:off})];
    p.summary = (b.cap ? 'Only '+r1(b.cap)+' h of work today: the rest of today, from '+toHM(b.from)+', is marked busy. ' : 'Busy '+b.days.map(fmtShort).join(', ')+' '+busyLabel(b)+'. ')+(off.length ? off.length+(off.length===1?' task moves':' tasks move')+' to other days.' : over.length ? 'Some work cannot move.' : left.length ? 'What is planned that day still fits in the time left.' : 'Nothing planned has to move.')
      + (pinned.length ? ' Stays, because you put it there: '+q(pinned)+'.' : '')
      + (stuck.length ? ' No free time for this before its deadline, so it stays on the busy day: '+q(stuck)+'. Say where it should go, or move the deadline.' : '');
    return p;
  });
}
/* Free-time note -> proposal: upcoming work pulled into that time by fillFreeTime (code, nearest deadline first). */
function freeProposal(a){ const f = fillFreeTime(a), p = emptyProposal(f.summary); p.updates = f.updates.map(u=>Object.assign(u, {pin:true})); return p; }
/* The shape a planning answer must have. Ollama is held to it (structured output); every answer is also checked in normalize(). */
const PLAN_SCHEMA = (()=>{
  const S = {type:'string'}, N = {type:'number'}, obj = props => ({type:'object', properties:props});
  return obj({
    think:S, questions:{type:'array', items:S}, summary:S, answer:S, whatIf:{type:'boolean'}, setup:S,
    classWork:{type:'array', items:obj({date:S, course:S})},
    skipClasses:{type:'array', items:obj({date:S, course:S, start:S})}, attendClasses:{type:'array', items:obj({date:S, course:S, start:S})}, skipEvents:{type:'array', items:S}, priorities:{type:'array', items:obj({id:S, rank:N})},
    deliverables:{type:'array', items:obj({key:S, course:S, title:S, date:{type:['string','null']}})},
    tasks:{type:'array', items:obj({course:S, did:S, title:S, due:S, minutes:N, stated:{type:'boolean'}, fullDays:N, where:{type:'string', enum:['desk','train','phone']}, note:S, file:S, waitingFor:obj({what:S, who:S})})},
    updates:{type:'array', items:obj({id:S, course:S, did:S, where:{type:'string', enum:['desk','train','phone']}, title:S, due:S, status:{type:'string', enum:['todo','doing','blocked','done']}, minutes:N, fullDays:N, spentMinutes:N, note:S, file:S, waitingFor:obj({what:S, who:S})})},
    removes:{type:'array', items:obj({id:S, reason:S})},
    deadlineUpdates:{type:'array', items:obj({id:S, date:S})},
    events:{type:'array', items:obj({ref:S, title:S, date:S, start:S, end:S, place:S, remove:{type:'boolean'}})}
  });
})();
/* Ahead of the day: when something is done today and the free time left today (now to DAY_END, minus away time and calendar)
   is more than the open work still planned for today, suggest pulling the next tasks in. Only a suggestion: nothing moves
   until he clicks. "Not today" hides it until tomorrow. */
function aheadSuggestion(){
  if(typeof IN_APP==='undefined' || !IN_APP || lsGet('aheadOff')===TODAY) return null;
  const n = new Date(); if(iso(n)!==TODAY) return null;
  const now = Math.ceil((n.getHours()*60+n.getMinutes())/15)*15; if(now >= DAY_END - 30) return null;
  const all = allTasks();
  const doneToday = all.some(({t})=>t.status==='done' && countsOn(t, TODAY));
  const openToday = all.filter(({t})=>t.status!=='done' && t.due && t.due<=TODAY);
  if(!doneToday && openToday.length) return null;
  const reserved = openToday.reduce((s,{t})=>s+(Number(t.est)||0),0);
  /* never past HEAVY hours of work for the whole day, counting what is already done today */
  const doneH = all.filter(({t})=>t.status==='done' && countsOn(t, TODAY)).reduce((s,{t})=>s+(Number(t.est)||0),0);
  const room = HEAVY - doneH - reserved;
  const f = fillFreeTime({day:TODAY, from:Math.max(now, DAY_START), to:DAY_END}, reserved, room);
  const free = r1(Math.min(f.free - reserved, room)); if(free < 0.5 || !f.updates.length) return null;
  return {free, updates: f.updates};
}
function aheadBlock(){
  const a = aheadSuggestion(); if(!a) return '';
  return '<section class="ahead" aria-label="Time left today"><h2>You’re ahead: <span class="mono">'+a.free+' h</span> free after today’s tasks</h2>'
    + '<div class="muted">Get a head start, nearest deadline first:</div><ul class="list">'
    + a.updates.map(u=>{ const c = cById(u.course), t = c && c.tasks.find(x=>x.id===u.id); if(!t) return ''; return '<li class="ev"><span class="bar"></span><div><div class="ttitle">'+esc(t.title)+'</div><div class="tmeta">'+esc(c.short)+' · <span class="mono">'+esc(t.est)+' h</span> · planned '+esc(fmtShort(t.due))+(deadlineOf(c,t)?' · due '+esc(fmtShort(deadlineOf(c,t))):'')+'</div></div><span class="tside"><button class="btn" data-ahead="one" data-c="'+esc(c.id)+'" data-t="'+esc(t.id)+'">Do today</button></span></li>'; }).join('')
    + '</ul><div class="crow">'+(a.updates.length>1?'<button class="btn pri" data-ahead="all">Do all today</button>':'')+'<button class="lnk" data-ahead="off">Not today</button></div></section>';
}
function aheadAct(b){
  if(b.dataset.ahead==='off'){ lsSet('aheadOff', TODAY); return render(); }
  const a = aheadSuggestion(); if(!a) return render();
  const list = b.dataset.ahead==='all' ? a.updates : a.updates.filter(u=>u.course===b.dataset.c && u.id===b.dataset.t);
  const touched = new Set();
  list.forEach(u=>{ const c = cById(u.course), t = c && c.tasks.find(x=>x.id===u.id); if(!t) return; const {status:st, ...rest} = u.changes; Object.assign(t, rest); t.pin = t.due; if(st) setStatus(t, st); touched.add(c); });
  touched.forEach(save); render();
}
/* Fill free time: nearest deadline first, pull upcoming tasks into that day while they fit, keeping order
   (a task waits for the earlier task of its deliverable, and part 2 for part 1). Calendar events and away time are taken out. */
function fillFreeTime(a, reserved, maxHours){
  let free = [[a.from, a.to]];
  const cut = (x, y) => { free = free.flatMap(([p,q])=> y<=p || x>=q ? [[p,q]] : [[p,Math.min(x,q)],[Math.max(y,p),q]].filter(([u,v])=>v>u)); };
  const tm = dayTimes(a.day); if(tm) cut(tm.leave, tm.home);
  if(IN_APP) busyEventsOn(a.day).filter(e=>!e.allDay).forEach(e=>cut(evMin(e.start), String(e.end).slice(0,10)===a.day ? evMin(e.end) : DAY_END));
  /* busy times he told the planner about and online or nearby sessions, as in freeAtHome (19 Nov 2026 user test: "You're ahead:
     7 h free" on a day marked sick) */
  busyOn(a.day).forEach(b=>cut(b.from, b.to));
  if(IN_APP && busyEventsOn(a.day).some(e=>e.allDay && AWAY_TITLE.test(String(e.title||'')))) cut(0, 24*60);
  classesOn(a.day).filter(e=>e.o).forEach(e=>{ const x = toMin(e.s), y = e.e ? toMin(e.e) : x + 90, w = e.o==='near' ? RULES_CFG.homeAfterOther : 0; cut(x - w, y + w); });
  const hours = free.reduce((s,[p,q])=>s+(q-p),0)/60;
  let left = Math.min(hours - (reserved||0), maxHours ?? Infinity);
  const open = allTasks().filter(({t})=>t.status!=='done' && t.due);
  const cands = open.filter(({c,t})=>workable(t) && t.due > a.day && !waitsForWeek(c) && t.pin!==t.due).sort((x,y)=>(deadlineOf(x.c,x.t)||'9999').localeCompare(deadlineOf(y.c,y.t)||'9999') || x.t.due.localeCompare(y.t.due));
  const chosen = new Set();
  const blocked = ({c,t}) => open.some(y=>y.t!==t && y.c===c && y.t.did===t.did && !chosen.has(y.t) && y.t.due > a.day && (y.t.due < t.due || (partInfo(y.t) && partInfo(t) && partInfo(y.t).base===partInfo(t).base && partInfo(y.t).n < partInfo(t).n)));
  for(let pass=0; pass<3; pass++) cands.forEach(x=>{ const e = Number(x.t.est)||0; if(chosen.has(x.t) || e<=0 || e > left + 1e-6 || blocked(x)) return; chosen.add(x.t); left -= e; });
  const picked = cands.filter(x=>chosen.has(x.t));
  const when = (a.day===TODAY ? 'today' : fmtShort(a.day))+' from '+toHM(a.from)+' to '+toHM(a.to);
  /* done at home in that free time: train and metro work keeps its "where" (it simply counts as time at home that day) */
  return {free: hours, updates: picked.map(({c,t})=>({course:c.id, id:t.id, changes:{due:a.day}})),
    summary: picked.length ? 'Free '+when+' ('+r1(hours)+' h): pulled in '+picked.length+' task'+(picked.length===1?'':'s')+', nearest deadline first ('+r1(hours-left)+' h).' : 'Free '+when+' ('+r1(hours)+' h), but no upcoming task fits in that time.'};
}
/* "I have 20 mins", "got an hour to clear short tasks": a short slot starting now. Filled in code, no model:
   today's and carried-over work first, then upcoming work by nearest deadline; never blocked tasks, never a later part
   before an earlier one. The picked tasks become "doing" (and move to today if they were later). */
function shortSlotFromNote(note){
  const low = ' '+String(note||'').toLowerCase()+' ';
  /* the duration must belong to "I have / got / free / spare" (19 Nov 2026 user test: "I have to write a summary, 1 h" and
     "tengo que avanzar el storyboard, unas 2h" were read as free slots and lost the task) */
  if(/\b(have to|has to|need to|needs to|must|tengo que|tienes que|hay que|muss|müssen|habe .{0,40}\bzu\b)/.test(low)) return null;
  if(low.trim().split(/\s+/).length > 16) return null;
  const DUR = '(\\d+(?:[.,]\\d+)?|an?|one|half an?|media|una?|eine?|halbe)\\s*(minutes?|mins?|min|minuten|minutos|hours?|hrs?|h|stunden?|horas?|hora)\\b';
  const m = low.match(new RegExp('\\b(?:(?:i\\s+)?(?:have|got|\'ve got|have got|habe|hab|tengo)\\s+(?:about\\s+|like\\s+|only\\s+|just\\s+|nur\\s+|noch\\s+|solo\\s+|unos?\\s+|ca\\.?\\s+|maybe\\s+)?|free\\s+(?:for\\s+)?|spare\\s+|quick\\s+)'+DUR))
    || low.match(new RegExp('\\b'+DUR+'\\s+(?:free|now|spare|to spare|to kill|frei|libres?|ahora)\\b'));
  if(!m) return null;
  const n = /^(half|media|halbe)/.test(m[1]) ? 0.5 : /^(an?|one|una?|eine?)$/.test(m[1]) ? 1 : parseFloat(m[1].replace(',','.'));
  const mins = /^(h|hours?|hrs?|stunden?|horas?|hora)$/.test(m[2]) ? n*60 : n;
  return mins >= 5 && mins <= 180 ? {mins} : null;
}
function fillSlot(slot){
  const open = allTasks().filter(({c,t})=>workable(t) && t.due && !waitsForWeek(c));
  const earlierOpen = ({c,t}) => open.some(y=>y.t!==t && y.c===c && y.t.did===t.did && !chosen.has(y.t) && (y.t.due < t.due || (partInfo(y.t) && partInfo(t) && partInfo(y.t).base===partInfo(t).base && partInfo(y.t).n < partInfo(t).n)));
  const now = open.filter(({t})=>t.due<=TODAY).sort((x,y)=>(Number(x.t.est)||0)-(Number(y.t.est)||0));
  const later = open.filter(({t})=>t.due>TODAY).sort((x,y)=>(deadlineOf(x.c,x.t)||'9999').localeCompare(deadlineOf(y.c,y.t)||'9999') || x.t.due.localeCompare(y.t.due));
  const chosen = new Set(); let left = slot.mins/60;
  [now, later].forEach(list=>list.forEach(x=>{ const e = Number(x.t.est)||0; if(e<=0 || e > left + 1e-6 || earlierOpen(x)) return; chosen.add(x.t); left -= e; }));
  const picked = now.concat(later).filter(x=>chosen.has(x.t));
  const used = Math.round((slot.mins/60 - left)*60);
  if(!picked.length){
    const shortest = open.slice().sort((x,y)=>(Number(x.t.est)||0)-(Number(y.t.est)||0))[0];
    return {updates:[], summary:'Nothing open fits in '+slot.mins+' min'+(shortest?'. The shortest is "'+shortest.t.title.slice(0,60)+'" ('+Math.round((Number(shortest.t.est)||0)*60)+' min).':'.')};
  }
  return {updates: picked.map(({c,t})=>{ const ch = {}; if(t.status!=='doing') ch.status = 'doing'; if(t.due > TODAY) ch.due = TODAY; return {course:c.id, id:t.id, changes:ch}; }).filter(u=>Object.keys(u.changes).length),
    picked, summary:'For the next '+slot.mins+' min: '+picked.map(({t})=>t.title.slice(0,50)+' ('+Math.round((Number(t.est)||0)*60)+' min)').join(', ')+'. About '+used+' min in all.'};
}
/* "Tomorrow's Design class will be for R&D", "Wednesday's lab is work time", "in class we work on the project": a class he uses
   as work time. Read in code. Needs a day with a class, a class word and a work word; the course is the one named, or the only
   class that day. Returns {day, course, from, to, title, room} (minutes) or null. */
const CLASSWORK_RE = /(\br\s*&\s*d\b|\br\s+and\s+d\b|\bfor research\b|\bwork(?:ing)?\s+(?:time|session|on)\b|\bwork in class\b|\bself[- ]?study\b|\blab time\b|\bstudio time\b|\bproject (?:work|time)\b|\bfree work\b|\bno lecture\b|\bfor (?:our|my|the) project\b|\barbeitszeit\b|\bselbststudium\b|\bprojektarbeit\b|\btrabajo\b|\binvestigaci[oó]n\b)/i;
const CLASS_RE = /\b(class|classes|lecture|seminar|lab|kurs|vorlesung|unterricht|clase|sesi[oó]n|session)\b/i;
function classWorkFromNote(note){
  const text = String(note||''), low = text.toLowerCase();
  if(!CLASSWORK_RE.test(low) || !CLASS_RE.test(low)) return null;
  const sc = noteScope(text), now = nowMinutes();
  for(const day of noteDays(text).filter(d=>d >= TODAY)){
    const cl = classesOn(day).filter(e=>day > TODAY || toMin(e.e||e.s) > now);
    let pick = cl.filter(e=>sc.cids.has(e.c));
    if(!pick.length && cl.length===1) pick = cl;
    if(pick.length===1) return classWorkOf(day, pick[0]);
  }
  return null;
}
/* Class work for a class that is not there that day ("tomorrow's Lab class is work time", no Lab class on Friday): a fact, said
   in code before any model runs, with the next class of that course (19 Nov 2026 stress test: the model knew but asked about the poster). */
function classWorkMiss(note){
  const text = String(note||''), low = text.toLowerCase();
  if(!CLASSWORK_RE.test(low) || !CLASS_RE.test(low)) return '';
  const sc = noteScope(text), days = noteDays(text).filter(d=>d >= TODAY); if(sc.cids.size!==1 || !days.length) return '';
  const cid = [...sc.cids][0]; if(days.some(d=>classesOn(d).some(e=>e.c===cid))) return '';
  let next = ''; for(let i=0;i<=60 && !next;i++){ const d = addDays(days[0],i); if(d >= TODAY && classesOn(d).some(e=>e.c===cid)) next = d; }
  return 'No '+cnm(cid)+' class on '+days.map(fmtShort).join(', ')+(next ? '. The next one is '+fmtShort(next)+'.' : '. There is none in the timetable in the next 60 days.')+' Nothing changed.';
}
const classWorkOf = (day, e) => { const s = toMin(e.s), en = e.e ? toMin(e.e) : s + 90; return {day, course:e.c, from: day===TODAY ? Math.max(s, nowMinutes()) : s, to:en, title:e.t, room:e.r||''}; };
/* The model read a class as work time ({"classWork":[{date, course}]}): only a real class on that day counts. */
function classWorkFromModel(list){
  for(const x of arr(list)){ const d = str(x.date), e = validDate(d) && d >= TODAY && classesOn(d).find(k=>k.c===str(x.course)); if(e) return classWorkOf(d, e); }
  return null;
}
/* Class used as work time -> proposal, all in code: open tasks of that course go into the class, up to its length. Work already
   due by then first, then nearest deadline; never past a deadline, never a later step before an earlier one that would still be
   open after class, never blocked or fixed-course work, never a task he placed on another day. No splitting: a task that does
   not fit in what is left is named. The tasks are pinned to the class ("where": class), so their hours never count against time
   at home and the organizer fills the days they leave. */
function classWorkProposal(cw){
  const c = cById(cw.course), hours = (cw.to - cw.from)/60, when = fmtShort(cw.day)+' '+toHM(cw.from)+'–'+toHM(cw.to);
  const p = emptyProposal('');
  p.classWork = [{day:cw.day, course:cw.course, from:cw.from, to:cw.to, title:cw.title}];
  const name = c ? c.short : cw.title;
  if(!c || waitsForWeek(c)){ p.summary = name+' on '+when+' is work time. '+(c ? 'Its course is not planned by the organizer.' : ''); return p; }
  const list = c.tasks||[], open = list.filter(t=>t.status!=='done' && t.due);
  const dl = t => deadlineOf(c,t), idx = t => list.indexOf(t);
  const ok = t => workable(t) && (!dl(t) || dl(t) >= cw.day) && !(t.pin && t.pin===t.due && t.due!==cw.day && t.where!=='class');
  const order = (x,y) => (x.due<=cw.day?0:1)-(y.due<=cw.day?0:1) || (dl(x)||'9999').localeCompare(dl(y)||'9999') || x.due.localeCompare(y.due) || idx(x)-idx(y);
  const cands = open.filter(ok).sort(order);
  const chosen = new Set(); let left = hours;
  const first = (y, t) => { const a = partInfo(y), b = partInfo(t); return y.due < t.due || (a && b && a.base===b.base && a.n < b.n) || (y.due===t.due && idx(y) < idx(t)); };
  const waits = t => open.some(y=>y!==t && y.did===t.did && !chosen.has(y) && y.due > cw.day && first(y, t));
  let missed = null;
  for(let pass=0; pass<3; pass++) cands.forEach(t=>{ const e = Number(t.est)||0; if(chosen.has(t) || e<=0 || waits(t)) return; if(e > left + 1e-6){ if(!missed && pass===0) missed = t; return; } chosen.add(t); left -= e; });
  const picked = cands.filter(t=>chosen.has(t));
  p.updates = picked.map(t=>{ const ch = {}; if(t.due!==cw.day) ch.due = cw.day; if(t.where!=='class') ch.where = 'class'; return {course:c.id, id:t.id, changes:ch, pin:true}; }).filter(u=>Object.keys(u.changes).length);
  const used = r1(hours - left);
  if(missed && chosen.has(missed)) missed = null;
  p.summary = name+' on '+when+' is work time ('+r1(hours)+' h). '
    + (picked.length ? picked.length+' '+name+' task'+(picked.length===1?'':'s')+' ('+used+' h) go into the class; the days they leave are filled by the planner.' : 'No open '+name+' task can be done by then.')
    + (left >= 0.5 && missed ? ' '+r1(left)+' h left: the next step, "'+(missed.title.length>60 ? missed.title.slice(0,60).replace(/[\s,;:]+\S*$/,'')+'…' : missed.title)+'" ('+missed.est+' h), does not fit.' : left >= 0.5 ? ' '+r1(left)+' h left: no other open '+name+' work. Say what else to do in class and it is added.' : '');
  return p;
}
function eventFromNote(note){
  if(freeTimeFromNote(note)) return null;
  const text = String(note||'').trim(); if(!text) return null;
  let date = noteDates(text)[0] || '';
  if(!date){ const sc = noteScope(text); if(sc.days.size===1 && !sc.busy) date = [...sc.days][0]; }
  if(date && date < TODAY) return null;
  const start = noteTime(text);
  const f = eventParts(text);
  if(!(date && start) && !((date || start) && f.place)) return null;
  const ev = {op:'add', title:f.title, date, start, end: start ? toHM(Math.min(23*60+59, toMin(start)+60)) : '', location:f.place};
  ev.missing = evMissing(ev);
  return ev;
}
const GENERIC_TITLE = /^(appointment|termin|event|meeting|untitled|\(no title\)|cita)$/i;
const evMissing = ev => [!ev.title || GENERIC_TITLE.test(ev.title.trim()) ? 'title' : '', !ev.date ? 'date' : '', !ev.start ? 'start' : ''].filter(Boolean);
/* Title and place out of a note: day and time words removed, split at the first place word (in der, at, bei, …). */
function eventParts(text){
  const DAYW = Object.keys(DAYWORDS).concat(['today','tomorrow','heute','morgen','hoy','mañana','next','nächsten','nächste','this','diesen']).join('|');
  let rest = String(text||'').replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?/g,' ').replace(/\b20\d\d-\d\d-\d\d\b/g,' ')
    .replace(/(?:\b(?:um|at|ab|from)\s+)?(?<![\w.])([01]?\d|2[0-3])([:.][0-5]\d)?\s*(uhr\b|h\b|am\b|pm\b|a\.m\.|p\.m\.)/gi,' ').replace(/(?:\b(?:um|at|ab|from)\s+)?(?<![\w.])([01]?\d|2[0-3]):[0-5]\d(?![.\d])/gi,' ')
    .replace(new RegExp('\\b(?:am|on|at|um)?\\s*(?:'+DAYW+')\\b','gi'),' ').replace(/\s+/g,' ').trim();
  let title = rest, place = '';
  const pm = rest.match(/(?:^|\s)(?:in der|in dem|in die|im(?=\s+\p{Lu})|in|an der|auf der|bei|at|@)\s+(?=\S*\p{L})/u) || rest.match(/(?:^|\s)(?:In der|In dem|Im|In|At)\s+(?=\S*\p{L})/u);
  if(pm){ title = rest.slice(0, pm.index); place = rest.slice(pm.index+pm[0].length).replace(/\s+in\s+(\d{5})\b/,', $1').replace(/(?:\s+\b(?:am|um|on|at|the)\b)+\s*$/i,'').replace(/^[\s,;.-]+|[\s,;.-]+$/g,''); }
  title = title.replace(/^(?:\s*\b(?:am|um|on|the|der|die|das|es ist|it is|it's|ein|eine|a|an)\b)+/gi,'').replace(/[\s,;.:-]+$/,'').replace(/\s+/g,' ').trim();
  if(title.replace(/[^\p{L}]/gu,'').length < 3 || title.length > 60) title = '';
  return {title: title ? title.charAt(0).toUpperCase()+title.slice(1) : '', place: place.slice(0,120)};
}
/* The follow-up question for an appointment with something missing. */
function evQuestion(ev){
  const m = ev.missing||[], when = (ev.date ? fmtShort(ev.date) : '')+(ev.start ? ' at '+ev.start : ''), at = ev.location ? ' at '+ev.location : '';
  if(m.includes('title') && m.includes('start')) return 'What is the appointment'+(ev.date?' on '+fmtShort(ev.date):'')+at+', and what time does it start?';
  if(m.includes('title') && m.includes('date')) return 'What is the appointment at '+ev.start+at+', and which day is it?';
  if(m.includes('title')) return 'What is the appointment on '+when+(ev.location?' ('+ev.location+')':'')+'?';
  if(m.includes('start')) return 'What time does '+ev.title+' on '+fmtShort(ev.date)+' start?';
  return 'Which day is '+ev.title+(ev.start?' at '+ev.start:'')+'?';
}
/* Fill an appointment that was waiting for an answer: the answer names it and/or gives the day or time. */
function fillEvent(ev, answer){
  ev = Object.assign({}, ev);
  const a = String(answer||'').trim();
  if(ev.missing.includes('start')){ const t = noteTime(a); if(t){ ev.start = t; ev.end = toHM(Math.min(23*60+59, toMin(t)+60)); } }
  if(ev.missing.includes('date')){ const d = noteDates(a)[0] || (s => s.days.size===1 ? [...s.days][0] : '')(noteScope(a)); if(d) ev.date = d; }
  if(ev.missing.includes('title')){ const f = eventParts(a); if(f.title) ev.title = f.title; if(!ev.location && f.place) ev.location = f.place; }
  ev.missing = evMissing(ev);
  return ev;
}
/* Calendar events on the days the note is about (else the next 3 days), with short refs E1, E2… The refs map back to the real events in EVREFS. */
let EVREFS = [];
function scopedEvents(sc){
  EVREFS = [];
  if(!IN_APP || CAL_STATUS!=='granted') return '    calendar not available';
  const days = sc.days.size ? [...sc.days].sort() : [0,1,2].map(i=>addDays(TODAY,i));
  const rows = [];   /* skipped events are listed too, marked, so "I'll go after all" can name them */
  days.forEach(d=>eventsOn(d).forEach(e=>{ if(rows.length>=30 || EVREFS.includes(evKey(e))) return; EVREFS.push(evKey(e)); rows.push('    E'+EVREFS.length+' | '+evDay(e)+' '+wd(evDay(e))+' | '+evTime(e)+' | '+String(e.title).slice(0,80)+' | '+calLabel(e)+(e.editable===false?' | read only':'')+(e.recurring?' | repeats':'')+(eventSkipped(d, e)?' | not attending':'')); }));
  return rows.join('\n') || '    none on these days';
}
/* Classes on the days the note is about (else the next 7 days), so the model never has to ask when or where a class is. */
function classLines(sc){
  const days = sc.days.size ? [...sc.days].sort() : [...Array(7)].map((_,i)=>addDays(TODAY,i));
  const rows = days.flatMap(d=>allClassesOn(d).map(e=>'    '+d+' '+wd(d)+' | '+e.s+(e.e?'–'+e.e:'')+' | '+e.c+' | '+e.t+(e.r?' | '+e.r:'')+(classWorkOn(d, e.c) ? ' | used as work time' : '')+(classSkipped(d, e) ? ' | not attending' : '')));
  return rows.join('\n') || '    none on these days';
}
/* Readings in the course folders (file names only), so the model can name the actual text instead of "the reading". */
/* Files get short refs (F1, F2…) in the planner prompt, so the model can link one to a task without copying its name
   (names are redacted before they leave the Mac). normalize() turns the ref back into the file. */
let FREFS = [];
function readingsRefs(ids){ FREFS = []; const out = courses.filter(c=>ids.includes(c.id) && (FILES[c.id]||[]).length).map(c=>'    '+c.id+': '+FILES[c.id].map(f=>{ FREFS.push({course:c.id, file:f}); return 'F'+FREFS.length+' '+f.replace(/\.pdf$/i,''); }).join('; ')); return out.join('\n'); }
function readingsContext(ids){ const out = courses.filter(c=>(!ids || ids.includes(c.id)) && (FILES[c.id]||[]).length).map(c=>'    '+c.id+': '+FILES[c.id].map(f=>f.replace(/\.pdf$/i,'')).join('; ')); return out.length ? out.join('\n') : ''; }
function courseIndex(){
  const short = t => { t = String(t||''); return t.length>80 ? t.slice(0,78)+'…' : t; };
  return courses.map(c=>'- '+c.id+': '+c.short+(c.name && c.name!==c.short ? ' ('+short(c.name)+')' : '')+'\n'+(c.deliverables||[]).filter(d=>!d.date || d.date>=addDays(TODAY,-7)).map(d=>'    '+d.id+': '+short(d.title)+' ['+(d.date?d.date+' '+wd(d.date):d.state)+delivTag(d)+']').join('\n')+(c.info ? '\n    course notes: '+String(c.info).replace(/\s*\n\s*/g,' · ').slice(0,400) : '')+decisionLines(c)).join('\n');
}
/* The prompt in two parts. "stable" does not depend on the note, so it can be read ahead; "variable" is the slice for this note. */
function composeParts(){
  const note = compose.thread.map(m=>m.text).join(' '), sc = noteScope(note);
  const stable = `You are the planning assistant inside a student's study planner. Turn the student's note into planner and calendar changes.
Today is ${TODAY} (${fmt(TODAY,{weekday:'long'})}). Time zone ${profileTZ()}.

${rulesText()}
6. Calendar. Anything at a set day and time is a new event in "events", not a task: meetings, calls and personal appointments too (doctor, office, Behörde, dinner), even with no course. A note that only gives a day, a time and a place is such an appointment. Never invent a title: if it does not say what it is, or the day or start time is missing, ask (for example "What is the appointment on Tue 24 Nov at 13:45?"). Put the address in "place". Move or delete a listed event only when the note says so. If the note changes an event that is not listed, ask about it ("I can't find a dentist appointment in your calendar. When is it?"); never add a new one in its place. Classes are not events.
7. A class used as work time ("tomorrow's Design class is for R&D", "lab time in class"): put the class's date and course id in "classWork"; the planner fills it.
8. A book or file for a task ("attach the book", "use this PDF for it"): set "file" to its ref (F1, F2…) from the files list on that task. If no listed file fits, ask which.
9. Waiting on someone ("can't start until Paula sends the footage"): "waitingFor":{"what":"the footage","who":"Paula"} on that task; the planner marks it blocked. When it arrives, set its "status" to "todo".
10. A "what if" question ("what if I take Thursday off?"): set "whatIf": true and write the change as usual; nothing is saved. A question about the plan that changes nothing ("what is left for Design?"): reply {"answer":"…"} from the plan below.
11. Classes or events the student will not attend: each class from the class list in "skipClasses" (date, course id, start), each calendar event in "skipEvents" (its ref, read-only ones too); nothing is deleted. "I'll go after all": the same in "attendClasses".
12. Questions. You are the student's assistant: class times, rooms, events, deadlines, open tasks and past results are listed below, so never ask for them, and never ask how long something takes. Ask only what the student alone knows, at most 3 short questions, and only when the course, the date or what the work is cannot be worked out. When the answer is one of a few choices, end the question with them in brackets: "Which course is it for? [Design | Lab | Admin]"; he picks one or writes his own.
13. Setting up a course from its documents ("set up Seminar", "read the syllabus", "plan the readings in the folder", a course with no class times or deadlines yet that the note wants planned from its files): reply {"think":"...","setup":"<course id>"} and nothing else; the planner reads the folder and asks what it needs.
14. Priorities. When the note says which deadlines matter most ("the essay, the dossier and the progress report are top priority", "focus on X first", "Y can wait"), put each named deadline in "priorities" with its id and "rank": 1 = most important (in the order given; equal when the note does not order them), 0 = no longer a priority. The planner then does that work first, and when time runs short the lower deadlines are the ones that slip. Use it only when the note talks about priority or importance.

Think first. Start every reply with "think": one or two plain sentences on what the note is about, what is missing, and what you will do. Then the rest.

Reply with JSON only. Either {"think":"...","questions":["..."]}, {"think":"...","answer":"..."} or
${SHAPE}

Courses and their deliverables (id: title [deadline]):
${courseIndex()}
`;
  const named = noteDays(note);
  const variable = `
Days the note names (worked out by the planner, use these dates): ${named.length ? named.map(d=>wd(d)+' '+d).join(', ') : 'none'}

Open tasks that may matter for this note (id [course] title | day planned | hours | where | status | deliverable). Other courses have more tasks not shown; do not invent ids:
${scopedTasks(sc)}

Done in the last 2 weeks for these courses:
${sc.cids.size ? doneTasksContext([...sc.cids]) : '    not shown'}

Planned vs actual time on finished tasks:
${timeHistory(sc.cids.size ? [...sc.cids] : null)}
${(r => r ? '\nReadings and files in the course folders (ref name):\n'+r+'\n' : '')(readingsRefs([...sc.cids]))}
Classes (fixed timetable; day | time | course id | class | room):
${classLines(sc)}

Calendar events that may matter (ref | day | time | title | calendar):
${scopedEvents(sc)}
${focusTask() ? (f => `
The note is about this task. Decide what it means for it: change it (day, hours, title, note, status), split it, mark it done, or remove it. Touch other tasks only if the note says so.
${taskLine(f.c, f.t)}${f.t.note ? '\n    current note: '+f.t.note : ''}
`)(focusTask()) : ''}
Conversation:
${compose.thread.map(m=>(m.role==='user'?'Student: ':'You asked: ')+m.text).join('\n')}`;
  return {stable, variable};
}
/* Sonnet for a note that fits nothing the plan knows: no course, deliverable or task matches, it is not about an open task, and it is
   not a plain appointment. Haiku for the rest. Claude only; the local model is the same either way. */
function needsSonnet(note){ const sc = noteScope(note); return !sc.cids.size && !focusTask() && !eventFromNote(note); }
function composePrompt(){ const p = composeParts(); return p.stable + p.variable; }
function extractJSON(t){ t = String(t||'').replace(/```(?:json)?/g,''); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if(a<0 || b<a) throw new Error('The model did not return JSON. Try again.'); return JSON.parse(t.slice(a,b+1)); }
/* The model's answer is only read, never trusted: every list must be a list of objects, dates must be real, ids must exist.
   What the model may decide: which course and deliverable, the title, the size, where it can be done, what changes or goes.
   What code decides: the day (the organizer places new work; a day is kept, and pinned, only when the note named it), splitting
   into parts of at most RULES_CFG.splitAt hours, scaling estimates by how long he usually takes, and the standing rules
   (desk-only courses, train and metro only on commute days, blocked work never pulled earlier). `said` is the text he wrote. */
const arr = v => Array.isArray(v) ? v.filter(x=>x && (typeof x==='object' || typeof x==='string')) : [];
const str = v => typeof v==='string' ? v : v==null ? '' : String(v);
/* How long he usually takes compared with the plan: per course after 3 timed tasks, else overall after 5; only ever scales up, at most 2x */
function paceOf(cid){
  const rows = timed(), mine = rows.filter(x=>x.c.id===cid), use = mine.length >= 3 ? mine : rows.length >= 5 ? rows : null;
  if(!use) return 1;
  const r = use.reduce((s,{t})=>s+Number(t.spent),0) / use.reduce((s,{t})=>s+Number(t.est),0);
  return Math.min(2, Math.max(1, r));
}
/* A size he gave himself is kept as given. The model reports it; code checks the note really has one. A full day is `heavy` hours. */
const COUNT_WORD = '(?:\\d+(?:[.,]\\d+)?|one|two|three|four|five|six|seven|a|an|half|un|una|uno|dos|tres|cuatro|cinco|seis|siete|medio|media|ein|eine|einen|eins|zwei|drei|vier|fünf|sechs|sieben|halbe|halben)';
const DAY_SIZE_RE = new RegExp('(?:^|[^\\p{L}\\p{N}])'+COUNT_WORD+'\\s+(?:(?:full|whole|entire)\\s+)?(?:days?|d[ií]as?)(?![\\p{L}])|\\bfull[- ]days?\\b|\\bd[ií]as?\\s+(?:completos?|enteros?)', 'iu');
const HOUR_SIZE_RE = new RegExp('(?:^|[^\\p{L}\\p{N}])'+COUNT_WORD+'\\s*(?:h|hrs?|hours?|horas?|mins?|minutes?|minutos?|stunden?|std\\.?|minuten)(?![\\p{L}])', 'iu');
/* a size the note gives (model says so, code checks the words), or one he typed when asked (`asked`, set only in code) */
const sizeGiven = (t, said) => t.asked===true || (t.stated===true && (DAY_SIZE_RE.test(said||'') || HOUR_SIZE_RE.test(said||'')));
const fullDaysOf = (o, said) => { const n = Number(o.fullDays); return n > 0 && DAY_SIZE_RE.test(said||'') ? n : 0; };
const hoursFrom = (o, minKey, hKey) => { const m = Number(o[minKey]); if(m > 0) return m/60; const e = Number(o[hKey]); return e > 0 ? (e > 12 ? e/60 : e) : 0; };
/* New tasks whose size the note does not give: the planner asks him instead of taking the model's guess (19 Nov 2026, his
   report: "Apply for the scholarship" came in as 2 h without asking). Readings with a PDF are sized from the book and are not asked. */
/* Pages named in a reading ("25 pages", "pp. 151–165", "25 páginas", "30 Seiten"). */
function pagesIn(text){ const s = String(text||''); let m = s.match(/(?:pp?\.?|pages?|p[aá]ginas?|seiten|S\.)\s*(\d{1,4})\s*[–-]\s*(\d{1,4})/i); if(m && +m[2] >= +m[1]) return +m[2] - +m[1] + 1;
  m = s.match(/(\d{1,4})\s*(?:pages?|pp\b|p[aá]ginas?|seiten)/i); return m ? +m[1] : 0; }
/* A reading with a page count is sized from how fast he reads (readPace), the same way book readings are. */
function sizeByPages(raw, said){
  const list = arr(raw.tasks).filter(t=>t && typeof READ_RE!=='undefined' && READ_RE.test(str(t.title)) && !sizeGiven(t, said) && !fullDaysOf(t, said));
  list.forEach(t=>{ const n = pagesIn(t.title) || pagesIn(t.note) || (arr(raw.tasks).length===1 ? pagesIn(said) : 0); if(!n) return;
    const pace = typeof readPace==='function' ? readPace(str(t.course)) : RULES_CFG.readPace;
    t.minutes = Math.max(15, Math.round(n/pace*60)); t.fullDays = 0; t.asked = true; t.pagesNote = n+' pages at '+r1(pace)+' pages an hour'; });
}
function unsizedTasks(raw, said){
  /* splitting planned work (19 Nov 2026 stress test: "split the core loop into 3 steps" asked the size of each step): new tasks of a
     deliverable whose planned task is removed or made smaller in the same answer share its known hours, so they are kept as given */
  const split = new Set(); const known = id => { for(const c of courses){ const t = (c.tasks||[]).find(x=>x.id===id); if(t) return t; } return null; };
  arr(raw.updates).forEach(u=>{ const t = known(str(u.id)), m = Number(u.minutes); if(t && m > 0 && m/60 < Number(t.est) - 1e-6) split.add(t.did || t.id); });
  arr(raw.removes).forEach(r=>{ const t = known(typeof r==='string' ? r : r && str(r.id)); if(t) split.add(t.did || t.id); });
  arr(raw.tasks).forEach(t=>{ if(t && split.has(str(t.did)) && Number(t.minutes) > 0) t.asked = true; });
  return arr(raw.tasks).filter(t=>{ if(!t || !str(t.title).trim() || fullDaysOf(t, said) || sizeGiven(t, said)) return false;
    const c = cById(t.course), title = str(t.title).trim();
    if(c){ const dup = similarTask(c.id, title); if(dup && dup.score>=0.9) return false; }
    if(c && typeof READ_RE!=='undefined' && READ_RE.test(title) && (str(t.file).trim() || pdfsFor(c, {title}).some(f=>/\.pdf$/i.test(f)))) return false;
    return true; });
}
const sizeQuestion = list => list.length===1 ? 'How long will "'+str(list[0].title).trim()+'" take? (e.g. 45 min, 2 h, 1 day)'
  : 'How long will each take? '+list.map((t,i)=>(i+1)+') '+str(t.title).trim()).join(' · ')+' (in that order, e.g. 45 min, 2 h)';
/* Sizes typed as an answer, in order, in hours: "2 h", "45 min", "1h30", "1.5", "2 horas", "1 day" (= heavy hours). A bare number is hours. */
function sizesFrom(text){
  /* list numbers like "1)" are not sizes ("1) 2 días 2) 20 min"); German number words count (19 Nov 2026 user test) */
  const low = String(text||'').toLowerCase()
    .replace(/(^|\s)\d{1,2}[).]\s+/g, '$1 ; ')   /* list numbers end the size before them ("2 días 2) 20 min") */
    .replace(/(\d+|una?|eine?)\s+(horas?|hora|stunden?)\s+y\s+media/g, (m, n)=>((/^\d/.test(n) ? +n : 1) + 0.5)+' h')
    .replace(/\bhora\s+y\s+media\b/g, '1.5 h').replace(/\b(anderthalb|eineinhalb)\b/g, '1.5').replace(/\bdreiviertel\s*(stunden?)\b/g, '45 min').replace(/\bviertelstunde\b/g, '15 min').replace(/eine?n?\s+halbe\s+/g, 'halbe ').replace(/una\s+media\s+/g, 'media '), word = {a:1,an:1,one:1,un:1,una:1,uno:1,two:2,dos:2,three:3,tres:3,four:4,cuatro:4,five:5,cinco:5,half:0.5,medio:0.5,media:0.5,ein:1,eine:1,einen:1,eins:1,zwei:2,drei:3,vier:4,'fünf':5,halbe:0.5};
  const num = v => word[v] ?? parseFloat(String(v).replace(',','.'));
  const re = /(\d+(?:[.,]\d+)?|an?|one|two|three|four|five|half|un[ao]?|dos|tres|cuatro|cinco|medi[ao]|eins|eine?n?|zwei|drei|vier|fünf|halbe)\s*(days?|d[ií]as?|tage?n?|h(?:ours?|rs?|oras?)?|stunden?|std\.?|m(?:in(?:ute)?n?s?|inutos?)?)?(?:\s*(\d{1,2})\s*(?:m(?:in(?:ute)?s?|inutos?)?)?)?(?![\p{L}\d])/giu;
  const out = [];
  for(const m of low.matchAll(re)){ const n = num(m[1]); if(!(n>0)) continue; const u = m[2]||'';
    if(!u && isNaN(parseFloat(m[1]))) continue;   /* "a" or "one" alone is not a size */
    let h = /^(d|t)/.test(u) ? n*HEAVY : /^m/.test(u) ? n/60 : n; if(m[3] && !/^[dm]/.test(u)) h += (+m[3])/60;
    if(h > 0 && h <= 10*HEAVY) out.push(h); }
  return out;
}
const SIZE_SKIP_RE = /\b(guess|you (?:decide|pick|choose)|no idea|not sure|don'?t know|dunno|estimate it|no s[ée]|ni idea|t[uú] decide|calcula)\b/i;
/* What the planner could not use from an answer, as plain reasons the model can act on. Code refusals by rule
   ("Not moved earlier") are left out: they are answers, not mistakes. Tried on a copy, so the answer is not changed. */
const FACT_RE = /^(Not moved earlier|Not removed|Not marked done|No .+ class on |.+ (is not marked as skipped|is already marked not attending))/;
/* Does the note talk about this course (its name, short name or id)? */
const courseInNote = (c, said) => { const low = ' '+String(said||'').toLowerCase()+' '; return coursesNamed(said||'').has(c.id) || courseKeys(c).some(k=>low.includes(k)) || new RegExp('(?<![\\p{L}])'+c.id+'(?![\\p{L}])','u').test(low); };
/* Does the note talk about this deliverable (two of its title words, or one with its number: "session 4")? */
const delivInNote = (d, said) => { if(!d) return false; const a = titleWords(d.title), b = titleWords(said||''); const hit = [...a].filter(w=>b.has(w)); return hit.length >= 2 || hit.some(w=>/^\d+$/.test(w)) || (hit.length===1 && hit[0].length >= 6); };
const REMOVE_WORD_RE = /\b(remove|delete|drop|cancel|not doing|no longer|skip it|get rid|quitar|quita|borrar|borra|eliminar|elimina|ya no|löschen|lösche|streichen|entfernen|weg damit|nicht mehr)\b/i;
const ALL_WORD_RE = /\b(all|every|everything|todo|todas?|todos|alle|alles|whole)\b/i;
function repairList(raw, said){
  let p; try{ p = normalize(JSON.parse(JSON.stringify(raw)), '', said); }catch(e){ return ['The answer was not a usable plan: '+e.message]; }
  const out = (p.unused||[]).filter(u=>!FACT_RE.test(u));   /* facts from code, not mistakes */
  p.deliverables.forEach(d=>{ if(!p.tasks.some(t=>t.did===d.key && t.course===d.course) && !p.updates.some(u=>u.changes.did===d.key))
    out.push('New deadline "'+d.title+'" ('+d.course+') has no work: add its task(s), or link planned tasks to it with "did" in "updates"'); });
  const chk = proposalChecks(p), seen = new Set();
  p.tasks.forEach((t,i)=>{ const base = t.title.replace(/\s*\(part \d+ of \d+\)$/i,''); if(seen.has(base)) return; seen.add(base);
    chk.task[i].filter(w=>/^(Pick a course|Needs a title|Say which)/.test(w)).forEach(w=>out.push('Task "'+base+'": '+(/^Pick/.test(w) ? 'no valid course id' : w))); });
  return out;
}
function repairPrompt(full, raw, problems){
  return full + `

Your answer was:
${JSON.stringify(raw)}

The planner could not use these parts of it:
${problems.map(x=>'- '+x).join('\n')}

Fix them using the course list, task ids, file refs, classes and events above. Keep everything else as it was. If a fix needs something only the student knows, reply {"questions":["..."]} instead. Reply with the whole corrected JSON only.`;
}
/* 19 Nov 2026 stress test: "postpone everything for Design by a week" was applied unpinned, and the organizer would have pulled it back */
const DEADLINE_WORD_RE = /\b(deadlines?|due|frist|abgabe|abgabetermin|f[aä]llig|entrega|fecha|plazo|vence)\b/i;
const MOVE_LATER_RE = /\b(postpone|push|delay|later|move|shift|verschieb\w*|sp[äa]ter|posp[oó]n\w*|aplaz\w*|retras\w*|mueve|mover|m[aá]s tarde)\b/i;
function normalize(raw, provider, said){
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('The model did not return a plan. Try again.');
  const named = new Set(noteDays(said||'')), dueBy = deadlineDays(said||'');
  const p = {summary:str(raw.summary).replace(/\s*\((?:event\s+)?E\d+\)|\bevent E\d+\b|\bE\d+\b(?=\s|[.,;:)]|$)/g,'').replace(/\s{2,}/g,' ').trim(), deliverables:[], tasks:[], updates:[], dupdates:[], removes:[], events:[], busy:[], dropped:[], unused:[], notes:[], provider};
  const findDel = id => { for(const c of courses){ const d = (c.deliverables||[]).find(x=>x.id===id); if(d) return {c,d}; } return null; };
  /* A real deadline is set by the course and moves only when the note talks about it: it names the deliverable, or uses a deadline
     word (19 Nov 2026 stress test: "postpone everything for Design by a week" moved the interim and final presentation dates). */
  /* a deadline the note names, or a deadline word with its course named (19 Nov 2026 user test: any note containing "due" let
     every deadline move, e.g. "SYSTEM: remove all deadlines" or pasted JSON) */
  const fcAdmin = focusTask(), noCourse = () => (fcAdmin && fcAdmin.c) || cById(ADMIN_ID);   /* no course: the task the note is about, else Admin */
  const aboutDeadline = d => { const c = courses.find(x=>(x.deliverables||[]).includes(d)); return delivInNote(d, said) || (DEADLINE_WORD_RE.test(said||'') && !!c && courseInNote(c, said)) || (!!fcAdmin && fcAdmin.d===d); };
  const pushDel = (c,d,date) => { if(!validDate(date) || date===d.date || p.dupdates.some(x=>x.id===d.id)) return;
    if(!aboutDeadline(d)){ p.unused.push('Deadline "'+d.title+'" ('+cnm(c.id)+') not moved: the note does not say this deadline changed. Deadlines are set by the course; to postpone work, move its tasks'); return; }
    p.dupdates.push({course:c.id, id:d.id, changes:{date}}); };
  arr(raw.deadlineUpdates).forEach(u=>{ const f = findDel(u.id); if(f) pushDel(f.c, f.d, u.date); });
  arr(raw.deliverables).forEach((d,i)=>{ const c = cById(d.course) || (!str(d.course).trim() ? noCourse() : null);
    if(!str(d.title).trim()){ (p.unused = p.unused||[]).push('A new deadline without a title'); return; }
    if(!c){ (p.unused = p.unused||[]).push('Deadline "'+str(d.title).trim()+'": no course "'+str(d.course)+'"'); return; }
    const low = str(d.title).toLowerCase().trim(); const same = (c.deliverables||[]).find(x=>{ const a = x.title.toLowerCase(); return a===low || a.includes(low) || low.includes(a.replace(/\s*\(.*?\)\s*/g,'').trim()); });
    if(same){ pushDel(c, same, d.date); return; }
    p.deliverables.push({key:str(d.key||('new'+i)), course:c.id, title:str(d.title).trim(), date:validDate(d.date)?d.date:null, note:str(d.note).trim().slice(0,300)}); });
  /* A local model sometimes puts a new task under "updates" with an id that does not exist. With a title it is a new task
     (in its course, or the course of the task the note is about); anything else that cannot be used is listed in the preview. */
  const known = id => courses.some(c=>(c.tasks||[]).some(x=>x.id===id));
  /* a file ref from the prompt: only a listed file in the task's own course folder (that is where Open PDF looks) */
  const fileOf = (ref, cid) => { const m = /^F(\d+)$/i.exec(str(ref).trim()), f = m && FREFS[+m[1]-1]; if(!str(ref).trim()) return '';
    if(f && f.course===cid) return f.file; p.unused.push('File '+str(ref).trim()+(f ? ': it is in the '+cnm(f.course)+' folder, not this course' : ': no such file')); return ''; };
  /* waiting on someone: what and who, read by the model; the day it started is today, set in code */
  const waitOf = w => { w = w && typeof w==='object' ? w : null; const what = w ? str(w.what).trim().slice(0,120) : ''; return what ? {what, who:str(w.who).trim().slice(0,60), since:TODAY} : null; };
  const fc = focusTask(), orphans = arr(raw.updates).filter(u=>!known(u.id));
  p.unused = p.unused || [];
  orphans.forEach(u=>{ const title = str(u.title).trim(), c = cById(u.course) || (fc && fc.c);
    if(title && c && !similarTask(c.id, title)) raw.tasks = arr(raw.tasks).concat([{course:c.id, did:u.did, title, minutes:u.minutes, est:u.est, where:u.where, due:u.due, note:u.note}]);
    else if(title || u.id) p.unused.push('Change to "'+(title || u.id)+'": no such task'); });
  const removing = new Set(arr(raw.removes).map(r=>typeof r==='string' ? r : r && str(r.id)));
  arr(raw.tasks).forEach(t=>{
    const c = cById(t.course) || (!str(t.course).trim() ? noCourse() : null); const days = fullDaysOf(t, said); let est = days ? days*HEAVY : hoursFrom(t, 'minutes', 'est'); if(!(est>0)) est = 1; est = Math.min(200, est);
    const stated = !!days || sizeGiven(t, said);
    const pace = c && !stated ? paceOf(c.id) : 1, raw0 = Math.max(0.25, q4(est)); est = Math.max(0.25, q4(est*pace));
    let where = ['train','phone','desk'].includes(t.where) ? t.where : 'desk'; if(deskOnly(c)) where = 'desk';
    const byDay = validDate(t.due) && t.due >= TODAY && dueBy.has(t.due) ? t.due : '';
    const due = validDate(t.due) && t.due >= TODAY && named.has(t.due) && !byDay ? t.due : '';
    if(due && where!=='desk' && !isCommute(due)) where = 'desk';   /* a named day without a commute: done at home */
    let did = ''; if(c){ if((c.deliverables||[]).some(d=>d.id===t.did)) did = str(t.did); else if(p.deliverables.some(d=>d.key===t.did && d.course===c.id)) did = str(t.did);
      else { const same = (c.tasks||[]).find(x=>x.id===t.did) || (fc && fc.c===c ? fc.t : null); if(same && same.did) did = same.did; } }   /* a task id or a made-up id: the deliverable of that task, or of the task the note is about */
    const title = str(t.title).trim(); if(!title){ p.unused.push('A new task without a title'); return; }
    const dup = !/\bpart \d/i.test(title) && similarTask(c?c.id:'', title, removing); if(dup && dup.score>=0.9){ p.dropped.push({title, of:dup.t.title}); return; }
    if(byDay && c && !did){ const key = 'by'+p.tasks.length; p.deliverables.push({key, course:c.id, title, date:byDay}); did = key; }   /* "by Tuesday" with no deadline yet */
    const file = c ? fileOf(t.file, c.id) : '';
    const wf = waitOf(t.waitingFor);
    p.tasks.push({course:c?c.id:'', did, title, due, pinned:!!due, est, stated, where, note:str(t.note).trim(), files: file ? [file] : [], waiting: wf, estNote: t.pagesNote ? str(t.pagesNote) : est > raw0 + 1e-6 ? 'Hours '+raw0+' → '+est+': you usually take '+r1(pace)+'× the plan' : ''});
  });
  arr(raw.updates).forEach(u=>{
    let c = cById(u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id);
    if(!t){ for(const cc of courses){ const x = (cc.tasks||[]).find(y=>y.id===u.id); if(x){ c = cc; t = x; break; } } }
    if(!t) return; const ch = {};
    if(['todo','doing','blocked','done'].includes(u.status) && u.status!==t.status){
      /* done only for work the note is about: the task, its deliverable or its course (19 Nov 2026 user test: a bad answer could
         tick off unrelated work) */
      if(u.status==='done' && !(noteNames(t, said, c) || delivInNote(delivOf(c,t), said) || courseInNote(c, said))) p.unused.push('Not marked done: "'+t.title.slice(0,60)+'" (the note does not mention it)');
      else ch.status = u.status; }
    if(validDate(u.due) && u.due!==t.due && u.due >= TODAY){
      const stillBlocked = t.status==='blocked' && (!ch.status || ch.status==='blocked');
      /* Pulling work earlier is the organizer's job. The model may only do it for a task the note is about
         (6 Nov 2026: a busy note pushed work to Sunday, and the model also pulled next week's Adorno reading onto Friday, pinned). */
      const pullUnasked = t.due && u.due < t.due && !(ch.status==='doing' || ch.status==='done') && !noteNames(t, said, c, u.due);
      if(pullUnasked) p.unused.push('Not moved earlier: "'+t.title.slice(0,60)+'" (your note did not ask; the planner places it)');
      else if(!(stillBlocked && t.due && u.due < t.due)) ch.due = u.due;   /* blocked work is never pulled earlier */
    }
    const upDays = fullDaysOf(u, said), est = upDays ? upDays*HEAVY : hoursFrom(u, 'minutes', 'est'); if(est > 0 && q4(est)!==Number(t.est)) ch.est = Math.min(200, Math.max(0.25, q4(est)));
    const spent = hoursFrom(u, 'spentMinutes', 'spent');
    if(spent > 0 && (ch.status||t.status)!=='done'){   /* work not finished: what is left is planned (19 Nov 2026 user test: "did 2 h, need 2 more" kept 4 h) */
      const total = Number(ch.est ?? t.est) || 0; if(total > spent) ch.est = Math.max(0.25, q4(total - spent));
      const line = r1(spent)+' h done on '+fmtShort(TODAY)+'.'; ch.note = ((ch.note ?? t.note) ? (ch.note ?? t.note)+' ' : '')+line; }
    else if(spent > 0 && spent!==Number(t.spent)) ch.spent = q4(spent);
    /* where it is done, when the note says so (19 Nov 2026 user test: "do the shot list on my phone" changed only the note) */
    if(['desk','train','phone'].includes(u.where) && u.where!==t.where && t.where!=='class' && !(deskOnly(c) && u.where!=='desk')) ch.where = u.where;
    const ud = str(u.did).trim();
    if(ud && ud!==t.did){ if((c.deliverables||[]).some(d=>d.id===ud) || p.deliverables.some(d=>d.key===ud && d.course===c.id)) ch.did = ud; else p.unused.push('Link "'+t.title.slice(0,60)+'" to '+ud+': no such deadline in '+cnm(c.id)); }
    if(str(u.note).trim() && str(u.note).trim()!==(t.note||'')) ch.note = str(u.note).trim();
    if(str(u.title).trim() && str(u.title).trim()!==t.title) ch.title = str(u.title).trim();
    const file = fileOf(u.file, c.id), had = Array.isArray(t.files) ? t.files : [];
    if(file && !had.includes(file)) ch.files = had.concat([file]);
    /* 9 Nov 2026: asked to attach a book, the model replaced the task note with "Attach … in Files". The link is the answer; the note stays. */
    if(ch.files && ch.note && /\b(attach|link|file|book|pdf)/i.test(ch.note)) delete ch.note;
    const wf = waitOf(u.waitingFor);
    if(wf && !(t.waiting && t.waiting.what===wf.what)){ ch.waiting = t.waiting && t.status==='blocked' ? Object.assign(wf, {since:t.waiting.since}) : wf; if(t.status!=='blocked' && ch.status!=='blocked') ch.status = 'blocked'; }
    /* never past its last day (the real deadline, session work the day before), the same rule as drag and "Move to next day"
       (19 Nov 2026 stress test: "postpone everything for Design by a week" put the final slides after the final presentation) */
    if(ch.due){ const ld = Organizer.lastDayOf(c, Object.assign({}, t, {did: ch.did || t.did})); if(ld && ld >= TODAY && ch.due > ld){
      p.notes.push('"'+t.title.slice(0,60)+'" goes on '+fmtShort(ld)+', not '+fmtShort(ch.due)+': that is its last day before the deadline.');
      if(ld!==t.due) ch.due = ld; else delete ch.due; } }
    const pin = !!ch.due && (named.has(ch.due) || (MOVE_LATER_RE.test(said||'') && t.due && ch.due > t.due && (noteNames(t, said, c, ch.due) || coursesNamed(said||'').has(c.id))));
    if(ch.due && pin && (t.where==='train' || t.where==='phone') && !isCommute(ch.due)) ch.where = 'desk';
    if(Object.keys(ch).length) p.updates.push({course:c.id, id:t.id, changes:ch, pin});
  });
  arr(raw.removes).forEach(r=>{
    const id = typeof r==='string' ? r : r && r.id; if(!id || p.removes.some(x=>x.id===id)) return;
    /* only work the note is about, or a duplicate of another task (19 Nov 2026 user test: a bad answer proposed removing all 28
       open tasks); "remove all of X" needs the course or deliverable named and a remove word */
    let ok = false; for(const c of courses){ const t = (c.tasks||[]).find(x=>x.id===id); if(t){ ok = true; const reason = str((r&&r.reason)||'').trim();
      const dupOf = /duplicat|same as|repeat|twice|doppelt|repetid|merged?|combin/i.test(reason) && (c.tasks||[]).some(x=>x!==t && x.status!=='done' && similarTask(c.id, t.title) && titleWords(x.title).size && [...titleWords(t.title)].filter(w=>titleWords(x.title).has(w)).length/Math.min(titleWords(t.title).size, titleWords(x.title).size) >= 0.5);
      const named = noteNames(t, said, c) || (REMOVE_WORD_RE.test(said||'') && (delivInNote(delivOf(c,t), said) || (courseInNote(c, said) && ALL_WORD_RE.test(said||''))));
      const replaced = p.tasks.some(n=>n.course===c.id && (n.did===t.did || !t.did) && (noteNames(t, said, c) || REMOVE_WORD_RE.test(said||'') || /split|replace|instead|in parts|teile|divid/i.test(said||'')));
      if(named || dupOf || replaced || (fcAdmin && fcAdmin.t===t)) p.removes.push({course:c.id, id, reason});
      else p.unused.push('Not removed: "'+t.title.slice(0,60)+'" (the note does not mention it)');
      break; } }
    if(!ok) p.unused.push('Remove "'+id+'": no such task');
  });
  p.updates = p.updates.filter(u=>!p.removes.some(r=>r.id===u.id));
  p.events = normEvents(arr(raw.events));
  /* class work for a class that is not in the timetable that day (19 Nov 2026: "tomorrow's Lab class is work time", no Lab class on Friday) */
  arr(raw.classWork).forEach(x=>{ const d = str(x.date), cid = str(x.course); if(!validDate(d) || d < TODAY || classesOn(d).some(k=>k.c===cid)) return;
    let next = ''; for(let i=1;i<=60 && !next;i++){ const dd = addDays(d,i); if(classesOn(dd).some(k=>k.c===cid)) next = dd; }
    p.unused.push('No '+(cnm(cid)||cid)+' class on '+fmtShort(d)+(next ? '; the next one is '+fmtShort(next) : '; none in the timetable in the next 60 days')); });
  /* classes and events he will not attend, or will after all: only real classes on that day, events by their ref */
  p.skips = [];
  const skipOne = (x, attend) => { const d = str(x.date); if(!validDate(d) || d < TODAY) return;
    const st = str(x.start).trim(), cl = allClassesOn(d).filter(e=>e.c===str(x.course) && (!st || e.s===st.padStart(5,'0')));
    if(!cl.length){ p.unused.push((attend?'Attend':'Skip')+' '+(cnm(str(x.course))||str(x.course))+' on '+fmtShort(d)+': no such class'); return; }
    cl.forEach(e=>{ if(p.skips.some(y=>y.day===d && y.c===e.c && y.s===e.s)) return;
      if(classSkipped(d, e)!==attend){ p.unused.push(e.t+' on '+fmtShort(d)+(attend ? ' is not marked as skipped: you were going anyway' : ' is already marked not attending')); return; }
      p.skips.push({day:d, c:e.c, s:e.s, title:e.t, attend}); }); };
  arr(raw.skipClasses).forEach(x=>skipOne(x, false)); arr(raw.attendClasses).forEach(x=>skipOne(x, true));
  /* priorities (26 Nov 2026, the user's request): a deadline that matters most gets `prio` (1 = top); only when the note talks about
     priority or importance, only real deliverables, ranks 0 (none) to 9 */
  p.prios = [];
  const PRIO_RE = /priorit|prioridad|important|wichtig|urgent|dringend|focus|fokus|enfoc|matters? most|most impact|first|zuerst|primero|can wait|kann warten|puede esperar|less important|doesn.?t matter|don.?t care|no importa|egal|lower/i;
  arr(raw.priorities).forEach(x=>{ const f = findDel(str(x.id)); if(!f){ p.unused.push('Priority for '+str(x.id)+': no such deadline'); return; }
    if(!PRIO_RE.test(said||'')){ p.unused.push('Priority for '+f.d.title+': the note does not talk about priority'); return; }
    const r = Math.max(0, Math.min(9, Math.round(Number(x.rank)||0)));
    if((+f.d.prio||0)===r || p.prios.some(y=>y.id===f.d.id)) return;
    p.prios.push({course:f.c.id, id:f.d.id, title:f.d.title, rank:r, was:+f.d.prio||0}); });
  arr(raw.skipEvents).forEach(r=>{ const m = /^E(\d+)$/i.exec(str(r).trim()), k = m && EVREFS[+m[1]-1], e = k && evByKey(k);
    if(!e){ p.unused.push('Skip event '+str(r)+': no such event'); return; }
    if(!eventSkipped(evDay(e), e) && !p.skips.some(y=>y.ev===k)) p.skips.push({day:evDay(e), ev:k, title:e.title, s:e.allDay?'':String(e.start).slice(11,16)}); });
  const dlFor = t=>{ const c = cById(t.course), d = c && (c.deliverables||[]).find(x=>x.id===t.did); return d ? d.date : ((p.deliverables.find(x=>x.key===t.did)||{}).date || ''); };
  /* Blocks he sized stay as large as the free days allow: up to a full day, smaller only when whole days do not fit before the deadline. */
  const newWork = p.tasks.map(t=>Object.assign(t, {due: t.due || TODAY}));
  const blocks = newWork.some(t=>t.stated && t.where==='desk' && t.est > RULES_CFG.splitAt) ? [HEAVY, 5, 4, 3, RULES_CFG.splitAt] : [HEAVY];
  let fit = true; for(const at of blocks){ p.tasks = splitBig(newWork.map(t=>Object.assign({}, t)), dlFor, at); if((fit = placeNew(p))) break; }
  /* 19 Nov 2026 stress test: 10 h due tomorrow went onto one 13.8 h day with "Think about another day" */
  /* only deadlines whose new work really ends up past them (19 Nov 2026 user test: every deadline was listed when one did not fit) */
  p.nofit = []; if(!fit){ const by = {}; p.tasks.forEach(t=>{ const d = dlFor(t); if(d && t.due && t.due > d) (by[d] = by[d] || []).push(t); });
    Object.entries(by).forEach(([d, l])=>p.nofit.push(r1(l.reduce((s,t)=>s+(+t.est||0),0))+' h of new work does not fit before its deadline ('+fmtShort(d)+') with what is already planned. Cut it down, ask for more time, or move other work.'));
    if(!p.nofit.length){ const late = p.tasks.filter(t=>{ const d = dlFor(t); return d && t.due >= d; }); if(late.length) p.nofit.push('The new work only fits by using the deadline day itself ('+[...new Set(late.map(t=>fmtShort(dlFor(t))))].join(', ')+'). Check it is enough.'); } }
  return p;
}
/* Days for new work: tasks with a deadline are spread evenly over the days with room before it (the deadline; class session work
   the day before), in deliverable and part order (Organizer.fillDays), then the organizer runs as it will after saving. Without a
   deadline: the first day from today with room. Days he named stay (pinned). Returns false when the work does not fit before its deadline. */
function placeNew(p){
  p.shifted = {};
  if(!p.tasks.some(t=>!t.pinned)) return true;
  const copy = JSON.parse(JSON.stringify(courses)), refs = [], fill = [];
  /* changes in the same note count: a task made bigger or moved takes that room */
  (p.updates||[]).forEach(u=>{ const c = copy.find(x=>x.id===u.course), t = c && (c.tasks||[]).find(x=>x.id===u.id); if(t) ['est','due','status'].forEach(k=>{ if(u.changes[k]!==undefined) t[k] = u.changes[k]; }); });
  const gone = new Set((p.removes||[]).map(r=>r.id)); copy.forEach(c=>{ c.tasks = (c.tasks||[]).filter(t=>!gone.has(t.id)); });
  p.deliverables.forEach(d=>{ const c = copy.find(x=>x.id===d.course); if(c) (c.deliverables = c.deliverables||[]).push({id:'__'+d.key, title:d.title, date:d.date}); });
  /* a day with room for new work without a deadline: train or metro work on the first commute day with room on that leg
     (19 Nov 2026 stress test: a metro reading went on a Thursday), blocked work from tomorrow (never on today) */
  const legHours = (d, w) => allTasks().filter(({t})=>t.status!=='done' && t.due===d && t.where===w).reduce((s,{t})=>s+(+t.est||0),0);
  /* new work in this same answer counts too (19 Nov 2026 user test: eleven steps of a project without a date all went on one day, 17 h) */
  const added = {}, leg = {}, take = (d, e, where) => { if(where==='train' || where==='phone'){ leg[d+where] = (leg[d+where]||0) + e; } else added[d] = (added[d]||0) + e; return d; };
  /* min: not before the step before it in the same deliverable (24 Nov 2026: the undated Seminar presentation had
     "Rehearse" on its metro day before "Build the slides" at the desk; each place found its own first gap) */
  const roomDay = (e, where, blocked, min) => { const now = nowMinutes(), from = blocked ? 1 : 0, ok = d => !min || d >= min;
    if(where==='train' || where==='phone') for(let i=from;i<=21;i++){ const d = addDays(TODAY,i); if(ok(d) && isCommute(d) && (i>0 || now < 9*60) && legHours(d, where) + (leg[d+where]||0) + e <= COMMUTE_CAP + 1e-6) return take(d, e, where); }
    if(!blocked && ok(TODAY) && Math.min(freeAtHome(TODAY, now), deskCap(TODAY)) - hoursOn(TODAY) - (added[TODAY]||0) >= e) return take(TODAY, e, 'desk');   /* never past the 7 h day (19 Nov 2026 user test: 11 h on today) */
    for(let i=1;i<=35;i++){ const d = addDays(TODAY,i); if(ok(d) && hoursOn(d) + (added[d]||0) + e <= deskCap(d)) return take(d, e, 'desk'); }
    const d = min && min > TODAY ? min : addDays(TODAY,1); return take(d, e, 'desk'); };
  const stepDay = {};   /* deliverable -> day of its last step placed so far in this answer */
  p.tasks.forEach((t,i)=>{
    const c = copy.find(x=>x.id===t.course); if(!c){ if(!t.pinned) t.due = roomDay(t.est, t.where, !!t.waiting); return; }
    let did = p.deliverables.some(d=>d.key===t.did && d.course===c.id) ? '__'+t.did : t.did;
    const d = (c.deliverables||[]).find(x=>x.id===did), dl = d && d.date;
    /* New work for a deadline goes as early as there is room (the user's choice, 3 Nov 2026), not after the steps already planned for it:
       while placing, it has its own copy of the deliverable (same date), so only the order of its own parts holds. */
    if(d && !t.pinned){ const solo = '__solo'+did; if(!c.deliverables.some(x=>x.id===solo)) c.deliverables.push(Object.assign({}, d, {id:solo})); did = solo; }
    let due = t.due;
    if(!t.pinned) due = dl && dl >= TODAY ? (Organizer.isSession(c, d) && Organizer.sessionLast(c, d) >= TODAY ? Organizer.sessionLast(c, d) : dl) : roomDay(t.est, t.where, !!t.waiting, t.did && stepDay[t.course+'|'+t.did]);
    if(t.did && due && !(dl && dl >= TODAY)) stepDay[t.course+'|'+t.did] = due > (stepDay[t.course+'|'+t.did]||'') ? due : stepDay[t.course+'|'+t.did];
    const tt = {id:'__new'+i, did, title:t.title, due, est:t.est, status:t.waiting ? 'blocked' : 'todo', where:t.where}; if(t.pinned) tt.pin = due;
    refs.push([t, tt]);
    if(!t.pinned && dl && due > TODAY) fill.push({c, tt, course:c.id, did, est:Number(t.est)||0, where:t.where, last:due});
    else (c.tasks = c.tasks||[]).push(tt);
  });
  const env = orgEnv(), placed = Organizer.fillDays(copy, fill, env);
  fill.forEach((x,i)=>{ x.tt.due = placed.days[i]; (x.c.tasks = x.c.tasks||[]).push(x.tt); });
  Organizer.organizePlan(copy, env);
  refs.forEach(([t, tt])=>{ t.due = tt.due; });
  const now = {}; allTasks().forEach(({t})=>{ now[t.id] = t.due; });
  copy.forEach(c=>(c.tasks||[]).forEach(t=>{ if(t.id in now && now[t.id]!==t.due) p.shifted[t.id] = t.due; }));
  return placed.fit;
}
/* Calendar changes from the model: refs map to real events; only fields that change are kept; read-only events are left out. */
function normEvents(list){
  const out = [], hm = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v||'')) ? String(v).padStart(5,'0') : '';   /* real times only (19 Nov 2026 user test: 25:00 got through) */
  (Array.isArray(list)?list:[]).forEach(x=>{
    if(!x || typeof x!=='object') return;
    const n = parseInt(String(x.ref||'').replace(/\D/g,''),10), e = n ? evByKey(EVREFS[n-1]) : null;
    if(n && !e) return;
    if(e){
      if(e.editable===false) return;
      if(x.remove===true || x.remove==='true'){ if(!out.some(o=>o.key===evKey(e))) out.push({op:'remove', key:evKey(e)}); return; }
      const ch = {};
      if(x.title && String(x.title).trim() && String(x.title).trim()!==e.title) ch.title = String(x.title).trim();
      if(validDate(x.date) && x.date!==evDay(e)) ch.date = x.date;
      if(!e.allDay && hm(x.start) && hm(x.start)!==String(e.start).slice(11,16)) ch.start = hm(x.start);
      if(!e.allDay && hm(x.end) && hm(x.end)!==String(e.end).slice(11,16)) ch.end = hm(x.end);
      if(typeof x.place==='string' && x.place.trim() && x.place.trim()!==(e.location||'')) ch.location = x.place.trim();
      if(ch.start && !ch.end){ const len = evMin(e.end)-evMin(e.start); if(len>0){ const m = toMin(ch.start)+len; if(m < 24*60) ch.end = toHM(m); } }
      if(Object.keys(ch).length) out.push({op:'change', key:evKey(e), changes:ch});
      return;
    }
    const title = String(x.title||'').trim(); if(!title || !validDate(x.date) || x.date < TODAY) return;
    const st = hm(x.start); let en = hm(x.end); if(st && (!en || en<=st)) en = toHM(Math.min(23*60+59, toMin(st)+60));
    out.push({op:'add', title, date:x.date, start:st, end:st?en:'', location:String(x.place||'').trim()});
  });
  return out;
}
const evChangeCount = p => (p.events||[]).length;
/* Claude Haiku checks suggested tasks against the plan. Only task titles go out, redacted. Skipped when the Mac is offline. */
function haikuAllowed(){ return !offline(); }
async function dropRepeats(p){
  if(!p.tasks.length || !haikuAllowed()) return p;
  const from = addDays(TODAY,-21);
  const ex = allTasks().filter(({t})=>t.status!=='done' || !t.due || t.due>=from);
  if(!ex.length) return p;
  const prompt = `New tasks were suggested for a student's planner. Find the ones that repeat a task the student already has: the same work, even if worded differently or in another language. A different part of a split task, or clearly different work for the same deliverable, is not a repeat.

Tasks the student has:
${ex.map(({c,t},i)=>'E'+(i+1)+' ['+c.short+'] '+t.title+(t.status==='done'?' (done)':'')).join('\n')}

Suggested tasks:
${p.tasks.map((t,i)=>'N'+(i+1)+' ['+((cById(t.course)||{}).short||'?')+'] '+t.title).join('\n')}

Reply with JSON only: {"repeats":[{"new":"N1","has":"E4"}]}. Use an empty list when nothing repeats.`;
  const red = redact(prompt).text;
  try{
    const r = await APP.call('llm', {prompt: red, remotePrompt: red, order:['claude']});
    if(!r.text) return p;
    const num = v => parseInt(String(v||'').replace(/\D/g,''),10) - 1, drop = new Map();
    /* the model's answer counts only when code agrees the two are close: same course and overlapping title words */
    arr(extractJSON(r.text).repeats).forEach(x=>{ const ni = num(x.new), ei = num(x.has); const n = p.tasks[ni], e = ex[ei]; if(n && e && n.course===e.c.id && partNo(n.title)===partNo(e.t.title) && pairScore(n.title, e.t.title) >= 0.3) drop.set(ni, e.t.title); });
    if(drop.size){ p.dropped = (p.dropped||[]).concat([...drop].map(([i,of])=>({title:p.tasks[i].title, of}))); p.tasks = p.tasks.filter((_,i)=>!drop.has(i)); }
    p.checked = 'claude';
  }catch(e){}
  return p;
}
const hasChanges = p => (p.prios||[]).length || (p.unbusy||[]).length || (p.sessions||[]).length || (p.info ? 1 : 0) || p.tasks.length || p.updates.length || p.deliverables.length || p.dupdates.length || p.removes.length || (p.busy||[]).length || (p.classWork||[]).length || (p.skips||[]).length || evChangeCount(p);
/* Duplicates are checked only when tasks are added (the user's choice, 3 Nov 2026): the planning prompt says never to repeat a task,
   dropRepeats() checks new tasks against the plan (the model's answer counts only when code also finds the titles close),
   and the preview warns "Looks like a task you have" (similarTask, code). There is no background check. */
const lsGet = k => { try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } };
const lsSet = (k,v) => { try{ localStorage.setItem(k,v); }catch(e){} };
const partNo = s => (String(s).match(/part (\d+)/i)||[])[1] || '';
function pairScore(a, b){ const x = titleWords(a), y = titleWords(b); if(!x.size || !y.size) return 0; let n = 0; x.forEach(w=>{ if(y.has(w)) n++; }); return n/Math.min(x.size, y.size); }
/* the model line follows the network: offline switches to Local until the Mac is back online */
window.addEventListener('online', ()=>render()); window.addEventListener('offline', ()=>render());
