/* Brain: recording, transcription status, meetings, summaries, ask your notes, planner updates from meetings. Part of page/index_v2.html; classic script, loaded in order. */
/* ---------- processing status: what runs, how far, how long, what failed ---------- */
let JOBS = {}, jobTick = null, jobPoll = null;
const JOB_STAGE = {separating:'Separating your voice from the meeting', mixing:'Mixing the audio', converting:'Converting the file', recovering:'Recovering', transcribing:'Transcribing', summarizing:'Summarizing', planning:'Finding planner changes', done:'Done', failed:'Failed'};
const ACTIVE = j => j && !['done','failed'].includes(j.stage);
function minLabel(ms){ const m = Math.round(ms/60000); return m < 1 ? 'under a minute' : m === 1 ? '1 min' : m < 60 ? m+' min' : Math.floor(m/60)+' h '+(m%60)+' min'; }
function jobLine(j){
  const now = Date.now(), el = now - (j.stageStarted||j.started||now), pct = Math.max(0, Math.min(100, j.pct||0));
  if(j.stage==='failed') return 'Failed: '+esc(j.error||'unknown error');
  if(j.stage==='done') return 'Done';
  let t = esc(JOB_STAGE[j.stage]||j.stage);
  if(j.stage==='transcribing'){
    if(j.part) t = 'Transcribing '+esc(j.part);
    t += ' · '+pct+'% · '+minLabel(el)+' so far';
    if(pct >= 3 && pct < 100) t += ' · about '+minLabel(el*(100-pct)/pct)+' left';
    else if(j.audioSeconds) t += ' · '+minLabel(j.audioSeconds*1000)+' of audio';
    if(now - (j.updated||now) > 180000) t += ' · <b>no progress for '+minLabel(now-j.updated)+'</b>';
  } else t += ' · '+minLabel(el)+' so far';
  return t;
}
function statusPanel(){
  const list = Object.values(JOBS).sort((a,b)=>(b.started||0)-(a.started||0));
  if(!list.length) return '';
  return '<section class="jobs" aria-label="Processing"><h2>Processing</h2>'+list.map(j=>'<div class="job '+esc(j.stage)+'" data-job="'+esc(j.id)+'"><div class="jt"><b>'+esc(j.title||'Recording')+'</b><span class="jl">'+jobLine(j)+'</span></div>'
    + (ACTIVE(j)?'<div class="jbar"><i style="width:'+(j.stage==='transcribing'?Math.max(2,j.pct||0):100)+'%"'+(j.stage==='transcribing'?'':' class="ind"')+'></i></div>':'')
    + (j.stage==='failed'?'<div class="crow"><button class="btn pri" data-job-retry="'+esc(j.id)+'">Retry</button><button class="lnk" data-job-close="'+esc(j.id)+'">Dismiss</button></div>':'')
    + (j.stage==='done'?'<div class="crow"><button class="lnk" data-brain="open" data-id="'+esc(j.id)+'">Open</button><button class="lnk" data-job-close="'+esc(j.id)+'">Dismiss</button></div>':'')
    + '</div>').join('')+'</section>';
}
function jobsChanged(){
  const active = Object.values(JOBS).filter(ACTIVE), tabA = document.querySelector('nav.tabs a[data-tab="brain"]');
  if(tabA) tabA.textContent = active.length ? 'Brain · '+(active[0].stage==='transcribing'?(active[0].pct||0)+'%':'…') : 'Brain';
  document.querySelectorAll('[data-job]').forEach(el=>{ const j = JOBS[el.dataset.job]; const l = el.querySelector('.jl'); if(j && l) l.innerHTML = jobLine(j); const b = el.querySelector('.jbar i'); if(j && b && j.stage==='transcribing') b.style.width = Math.max(2,j.pct||0)+'%'; });
  if(active.length && !jobTick) jobTick = setInterval(jobsChanged, 1000);
  if(!active.length && jobTick){ clearInterval(jobTick); jobTick = null; }
}
async function pollJobs(){ try{ const l = await APP.call('jobs'); const before = JSON.stringify(Object.keys(JOBS).sort()); l.forEach(j=>{ JOBS[j.id] = Object.assign(JOBS[j.id]||{}, j); }); if(JSON.stringify(Object.keys(JOBS).sort())!==before && tab==='brain' && !BRAIN_OPEN) render(); jobsChanged(); }catch(e){} }
function setLocalJob(id, title, stage, extra){ JOBS[id] = Object.assign(JOBS[id]||{id, started:Date.now()}, {title, stage, stageStarted:Date.now(), updated:Date.now()}, extra||{}); jobsChanged(); if(tab==='brain' && !BRAIN_OPEN) render(); }

/* A5: recording as a strip of bars hanging from a line */
const STRIP_N = 180;
let LEVELS = [], SYS_LEVELS = [];
function stripBars(vals, n, cls, played){
  let h = '';
  for(let i=0;i<n;i++){ const v = vals && vals.length ? vals[Math.floor(i*vals.length/n)] || 0 : 0; h += '<i'+(played!=null && i < played*n ? ' class="p"' : '')+' style="height:'+Math.max(2, Math.round(v*100))+'%"></i>'; }
  return '<div class="strip '+(cls||'')+'">'+h+'</div>';
}
function paintStrip(id, levels){
  const el = document.getElementById(id); if(!el) return;
  const bars = el.children, off = STRIP_N - levels.length;
  for(let i=0;i<bars.length;i++){ const v = i < off ? 0 : levels[i-off]; bars[i].style.height = Math.max(2, Math.round(v*100))+'%'; }
}
function onLevel(rms){
  LEVELS.push(Math.min(1, Math.pow(rms*9, 0.7))); if(LEVELS.length > STRIP_N) LEVELS.shift();
  paintStrip('rec-strip', LEVELS);
}
function onSysLevel(rms){
  SYS_LEVELS.push(Math.min(1, Math.pow(rms*9, 0.7))); if(SYS_LEVELS.length > STRIP_N) SYS_LEVELS.shift();
  paintStrip('rec-sys-strip', SYS_LEVELS);
}
function recordBlock(){
  const t = REC.tools || {}, last = BRAIN.find(m=>m.peaks && m.peaks.length);
  let h = '<section class="rec5'+(REC.recording?' on':'')+'" aria-label="Record a meeting"><div class="rec5-ctl">';
  if(RECSTAGE) h += '<div class="recstage"><b>'+esc(RECSTAGE)+'</b><div class="muted">Runs on this Mac. A one-hour meeting takes a few minutes.</div></div>';
  else if(REC.recording) h += '<input id="rec-title" class="rtitle" value="'+esc(REC.title)+'" placeholder="Title (optional)" aria-label="Recording title"><button class="recbtn on" data-rec="stop">Stop</button><div class="rectime mono" id="rec-time">'+clockLabel(REC.seconds)+'</div><div class="muted">'+(!REC.withSystem?'In person · microphone only':REC.micPolicy==='zoom'?'Online call · two tracks, transcribed separately. Your mic follows Zoom: <b id="mic-state">'+(REC.micOpen?'unmuted, recording you':'muted, not recording you')+'</b>':(REC.micPolicy==='on'?'Online call · two tracks: your voice and the meeting, transcribed separately':'Online call · the meeting is recorded, your mic is off')+(/zoom/i.test((REC.tools||{}).callApp||'')&&!(REC.tools||{}).zoomAccess?'. To follow Zoom mute, allow Planner in System Settings › Privacy & Security › Accessibility.':''))+'</div><button class="lnk" data-rec="cancel">Discard this recording</button>';
  else h += '<input id="rec-title" class="rtitle" value="'+esc(REC.title)+'" placeholder="Title (optional)" aria-label="Recording title"><button class="recbtn" data-rec="start">Record</button>'+(()=>{ const why = detectOnline(), online = REC.sysPref===null ? !!why : REC.sysPref; return '<div class="mode"><b>'+(online?'Online call':'In person')+'</b><span class="muted">'+(online?(/zoom/i.test((REC.tools||{}).callApp||'')?'Two tracks, transcribed separately. Your mic follows Zoom':'Two tracks: your voice and the meeting, transcribed separately'):'Microphone only')+(why&&REC.sysPref===null?' · detected: '+esc(why):'')+'</span><button class="lnk" data-rec="mode" data-v="'+(online?'0':'1')+'">'+(online?'Switch to in person':'Switch to online call')+'</button></div>'; })()+'<label class="ck">Course <select id="rec-course">'+courseOptions(REC.course)+'</select></label>'
    + (t.whisper===false?'<div class="tag warn">'+ICON.warn+'Whisper is missing: brew install whisper-cpp</div>':'')
    + (t.vad===false?'<div class="tag warn">'+ICON.warn+'The speech detector is missing from the app. Rebuild to get clean transcripts.</div>':'')
    + (t.model===''?'<div class="tag warn">'+ICON.warn+'No Whisper model in the app folder.</div>':'');
  h += '</div><div class="rec5-strip">';
  if(REC.recording){
    h += '<div class="strip live" id="rec-strip">'+'<i></i>'.repeat(STRIP_N)+'</div><div class="strip-cap muted">'+(REC.withSystem?'Your voice':'Microphone')+'</div>';
    if(REC.withSystem) h += '<div class="strip sys live" id="rec-sys-strip">'+'<i></i>'.repeat(STRIP_N)+'</div><div class="strip-cap muted">Meeting audio</div>';
    h += '<div class="strip-cap muted">Listening. Audio stays on this Mac.</div>';
  }
  else if(last) h += stripBars(last.peaks, STRIP_N, 'ghost')+'<div class="strip-cap muted">Last recording · '+esc(last.title||'Untitled')+' · '+esc(fmtShort(String(last.created).slice(0,10)))+'</div>';
  else h += stripBars([], STRIP_N, 'ghost')+'<div class="strip-cap muted">Press Record. Audio stays on this Mac.</div>';
  h += '</div>';
  if(REC.error) h += '<div class="cerr"><span class="tag warn">'+ICON.warn+esc(REC.error)+'</span></div>';
  if(REC.recording) h += '<div class="livebox"><div><h2>Notes</h2><textarea id="rec-notes" rows="6" placeholder="Write while you listen. Saved with the recording.">'+esc(REC.notes)+'</textarea></div></div>';
  else if(!RECSTAGE) h += '<div class="recimport"><button class="lnk" data-rec="import">Import audio or video…</button> <span class="muted">Transcribed on this Mac like a recording.</span></div>';
  h += newCourseForm('rec');
  return h + '</section>';
}
function topicNames(){ const names = new Set(TOPICS.topics.map(t=>t.name)); BRAIN.forEach(m=>(m.topics||[]).forEach(t=>names.add(t))); return [...names]; }
const inTopic = (m, topic) => topic==='All' || (m.topics||[]).includes(topic);
/* C2: answers as reading text on a dark panel */
function chatBlock(){
  const thread = CHATS[CHAT.topic] || [];
  let h = '<section class="chat2" aria-label="Chat with your notes"><div class="c2head"><span class="chip2">'+esc(CHAT.topic==='All'?'All notes':CHAT.topic)+'</span><span class="muted2">Claude, names hidden · summaries and transcripts</span>'+(thread.length?'<button class="lnk2" data-chat="clear">Clear</button>':'')+'</div><div class="thread2" id="thread2">';
  if(!thread.length) h += '<div class="empty2">Ask about '+(CHAT.topic==='All'?'anything in your meetings and plan':'“'+esc(CHAT.topic)+'”')+'. For example: what did we decide about the script structure?</div>';
  thread.forEach(m=>{
    if(m.role==='user') h += '<div class="q2">'+esc(m.text)+'</div>';
    else h += '<div class="a2"><span class="chip2 small">'+(m.ms?'Answered in '+Math.max(1,Math.round(m.ms/1000))+' s':'Answer')+(m.cites&&m.cites.length?' · from '+m.cites.length+' meeting'+(m.cites.length===1?'':'s'):'')+'</span><div class="a2body">'+md(m.text)+'</div>'+(m.cites&&m.cites.length?'<div class="cites2">'+m.cites.map(c=>'<button class="lnk2" data-brain="open" data-id="'+esc(c.id)+'">'+esc(c.title)+'</button>').join('')+'</div>':'')+'</div>';
  });
  if(CHAT.busy) h += '<span class="chip2 small">Thinking '+modelWhere()+'… <span class="lt"></span></span>';
  h += '</div><div class="c2input"><input id="chat-q" value="'+esc(CHAT.draft)+'" placeholder="Ask your notes" aria-label="Ask your notes"><button class="btn2" data-chat="go"'+(CHAT.busy?' disabled':'')+'>Send</button></div>';
  if(CHAT.error) h += '<div class="cerr2">'+esc(CHAT.error)+'</div>';
  return h + '</section>';
}
async function saveTopics(){ await APP.call('brainFile', {name:'topics', data:TOPICS}); }
async function saveChats(){ await APP.call('brainFile', {name:'chats', data:CHATS}); }
async function clusterTopics(){
  if(CHAT.clustering || !BRAIN.length) return; CHAT.clustering = true; CHAT.error = ''; render();
  try{
    const lines = [];
    for(const meta of BRAIN){ const m = await APP.call('brainGet',{id:meta.id}); const gist = m.summary || String(m.summaryMarkdown||'').replace(/[#*]/g,'').slice(0,400) || (m.segments||[]).slice(0,25).map(s=>s.text).join(' ').slice(0,500); lines.push(m.id+' | '+(m.title||'')+' | '+String(m.created||'').slice(0,10)+' | course '+(m.course||'-')+' | '+gist.replace(/\s+/g,' ')); }
    const o = extractJSON(await brainLLM(`Group these meetings by topic for a student's second brain. Make 2 to 8 topics with short names (2 to 4 words). A meeting can be in one or two topics. Reuse these existing names when they fit: ${topicNames().join(', ')||'none'}.
Return JSON only: {"topics":[{"name":"...","description":"one sentence","ids":["meeting ids"]}]}

Meetings (id | title | date | course | gist):
${lines.join('\n')}`));
    const ids = new Set(BRAIN.map(m=>m.id));
    TOPICS = {topics:(o.topics||[]).map(t=>({name:String(t.name||'').trim(), description:String(t.description||''), ids:(t.ids||[]).filter(i=>ids.has(i))})).filter(t=>t.name && t.ids.length)};
    for(const meta of BRAIN){ const m = await APP.call('brainGet',{id:meta.id}); const tp = TOPICS.topics.filter(t=>t.ids.includes(m.id)).map(t=>t.name); if(tp.length){ m.topics = tp; delete m.segments; await APP.call('brainSave',{meeting:m}); } }
    await saveTopics(); BRAIN = await APP.call('brainList');
  }catch(e){ CHAT.error = e.message; }
  CHAT.clustering = false; render();
}
/* Search across meetings for the Brain chat (26 Nov 2026, the user's question: "all notes doesnt read transcripts?"). It did, by
   literal word stems, so "discord" matched "discourse" all over another meeting, "last week" matched the word "week", and
   summaries rarely made the cut. Code decides what the model reads:
   - scope first: a meeting named by its title or course, or a time ("last week", "yesterday", "on Tuesday", "15 Nov",
     "last session") narrows the meetings; nothing found there falls back to all of them;
   - words match at the start of a word (plural endings dropped), rarer words weigh more, a word repeated in one chunk counts
     less, and chunks with more of the words rank higher;
   - every meeting with a hit brings its summary, transcript chunks carry their time and speaker;
   - a named meeting with no other words (what did we talk about in Studio 3) gives its summary and chunks spread through it.
   Pure: meetings in, chunks out (o.today, o.extra search words, o.names = meeting id -> course name). */
const BR_STOP = new Set(('the and about with for was were when which that this from have has how why who what whats did does do '
  +'you your our we they them their there here into onto than then just also more most some any all can could would should will '
  +'say said tell told talk talked talking discuss discussed mention mentioned meeting meetings session sessions class notes note '
  +'last week weeks yesterday today day days ago time remember again please give list explain summary summarize '
  +'que los las del por una uno para con como pero sobre dijo dije hablamos habló esta este esto eso fue son sus nos '
  +'und der die das den dem des ein eine mit von für über was wie wer wir ihr sie ist sind war').split(/\s+/));
const brWords = q => [...new Set((String(q).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(w=>!BR_STOP.has(w)))];
const brStem = w => w.length > 4 ? w.replace(/(?:ies|es|s)$/,'') : w;
const brRe = w => new RegExp('(?<![\\p{L}\\p{N}])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'giu');
function brSpan(q, today){
  const low = ' '+String(q||'').toLowerCase()+' ', d0 = today, add = (d,n)=>{ const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
  const mon = d => { const x = new Date(d+'T12:00:00'); return add(d, -((x.getDay()+6)%7)); };
  if(/\b(last|latest|most recent|previous)\s+(session|meeting|class|recording|call|time)\b|\bla última (sesión|clase|reunión)\b|\bletzte[nrs]? (sitzung|termin|treffen)\b/.test(low)) return {latest:1};
  if(/\byesterday\b|\bayer\b|\bgestern\b/.test(low)) return {from:add(d0,-1), to:add(d0,-1)};
  if(/\btoday\b|\bhoy\b|\bheute\b/.test(low)) return {from:d0, to:d0};
  if(/\blast week\b|\bsemana pasada\b|\bletzte[nr]? woche\b|\bvorige[nr]? woche\b/.test(low)){ const m = mon(d0); return {from:add(m,-7), to:add(m,-1)}; }
  if(/\bthis week\b|\besta semana\b|\bdiese[nr]? woche\b/.test(low)) return {from:mon(d0), to:d0};
  const ago = low.match(/\b(\d+)\s+(day|week)s?\s+ago\b/); if(ago){ const n = +ago[1]*(ago[2]==='week'?7:1); return {from:add(d0,-n-3), to:add(d0,-n+3)}; }
  const days = {sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,domingo:0,lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5,'sábado':6,sabado:6,sonntag:0,montag:1,dienstag:2,mittwoch:3,donnerstag:4,freitag:5,samstag:6};
  for(const [w,n] of Object.entries(days)) if(new RegExp('(?<![\\p{L}])'+w+'(?![\\p{L}])','u').test(low)){ for(let i=0;i<7;i++){ const d = add(d0,-i); if(new Date(d+'T12:00:00').getDay()===n) return {from:d, to:d}; } }
  const MO = {jan:1,ene:1,feb:2,mar:3,'mär':3,apr:4,abr:4,may:5,mai:5,jun:6,jul:7,aug:8,ago:8,sep:9,set:9,oct:10,okt:10,nov:11,dec:12,dez:12,dic:12};
  const m = low.match(/(?<![\d])(\d{1,2})(?:st|nd|rd|th)?\.?\s*(?:de\s+|of\s+)?(\p{L}{3})\p{L}*/u) || low.match(/(?<![\p{L}])(\p{L}{3})\p{L}*\.?\s+(\d{1,2})(?![\d:])/u);
  if(m){ const [dd, mm] = /\d/.test(m[1]) ? [+m[1], MO[m[2]]] : [+m[2], MO[m[1]]];
    if(mm && dd>=1 && dd<=31){ let y = +d0.slice(0,4); let iso = y+'-'+String(mm).padStart(2,'0')+'-'+String(dd).padStart(2,'0'); if(iso > d0) iso = (y-1)+iso.slice(4); return {from:iso, to:iso}; } }
  return null;
}
function brChunks(m){
  const out = [], segs = m.segments||[], who = sp => sp==='you' ? 'You' : sp==='them' ? 'Meeting' : '';
  const sum = m.summary ? m.summary+(m.decisions&&m.decisions.length?' Decisions: '+m.decisions.join('; '):'')+(m.actions&&m.actions.length?' Action items: '+m.actions.map(a=>a.text).join('; '):'')+(m.points&&m.points.length?' Key points: '+m.points.join('; '):'') : String(m.summaryMarkdown||'').slice(0,4000);
  if(sum) out.push({kind:'summary', text:sum});
  if(m.notes) out.push({kind:'notes', text:'His notes: '+m.notes});
  for(let i=0;i<segs.length;i+=12){ const g = segs.slice(i,i+12); out.push({kind:'transcript', t:g[0].t||0, text:g.map(s=>(who(s.sp)?who(s.sp)+': ':'')+s.text).join(' ')}); }
  return out;
}
function brainFind(ms, q, o){
  o = o || {}; const today = o.today, names = o.names || {};
  const low = String(q||'').toLowerCase();
  /* meetings named by title (a word of 4+ letters that is not common) or course */
  const qDig = low.match(/\d+/g) || [];
  const titleHit = m => { const tw = brWords(m.title||'').filter(w=>w.length>=4); const n = tw.filter(w=>brRe(w).test(low)).length;
    const td = String(m.title||'').match(/\d+/g) || [];   /* "Studio 3" is not "Studio #1" */
    if(td.length && qDig.length && !td.some(d=>qDig.includes(d))) return false;
    return tw.length && (n >= Math.min(2, tw.length)); };
  const courseHit = m => { const c = String(names[m.id]||'').toLowerCase(); return c.length >= 4 && low.includes(c); };
  let pool = ms.filter(m=>titleHit(m)), scope = pool.length ? 'named' : '';
  if(!pool.length){ pool = ms.filter(courseHit); if(pool.length) scope = 'course'; }
  const span = brSpan(q, today);
  if(span){ const by = (pool.length ? pool : ms).slice().sort((a,b)=>String(b.created).localeCompare(String(a.created)));
    const inSpan = span.latest ? by.slice(0, span.latest) : by.filter(m=>{ const d = String(m.created||'').slice(0,10); return d >= span.from && d <= span.to; });
    if(inSpan.length){ pool = inSpan; scope = scope || 'time'; } }
  if(!pool.length){ pool = ms; scope = ''; }
  /* the search words: the question's own, minus the words that only named the meeting, plus words from the model */
  const nameWords = new Set(pool.length < ms.length ? pool.flatMap(m=>brWords((m.title||'')+' '+(names[m.id]||''))) : []);
  const terms = [...new Set(brWords(q).filter(w=>!nameWords.has(w)).concat((o.extra||[]).map(w=>String(w).toLowerCase()).filter(w=>w.length>=3)).map(brStem))];
  const all = []; pool.forEach(m=>brChunks(m).forEach(c=>all.push(Object.assign(c, {m}))));
  const res = terms.map(brRe), N = all.length || 1;
  const df = res.map(r=>all.filter(c=>{ r.lastIndex = 0; return r.test(c.text); }).length);
  all.forEach(c=>{ let s = 0, k = 0; res.forEach((r,i)=>{ const n = (c.text.match(r)||[]).length; if(n){ k++; s += Math.log(1 + N/(1+df[i])) * (1 + Math.log(n)); } }); c.score = s * (1 + 0.5*Math.max(0,k-1)); });
  const tx = all.filter(c=>c.kind!=='summary' && c.score>0).sort((a,b)=>b.score-a.score);
  const perM = {}, pick = [];
  for(const c of tx){ const id = c.m.id; if((perM[id]||0) >= (pool.length===1 ? 12 : 5)) continue; perM[id] = (perM[id]||0)+1; pick.push(c); if(pick.length >= 12) break; }
  let generic = false;
  if(!pick.length && scope){   /* a named meeting or time with nothing else to search for: its summary and chunks spread through it */
    generic = !terms.length;
    pool.slice(0,3).forEach(m=>{ const t = all.filter(c=>c.m===m && c.kind==='transcript'), n = Math.min(t.length, pool.length===1 ? 8 : 3); for(let i=0;i<n;i++) pick.push(t[Math.floor(i*t.length/n)]); });
  }
  const best = pick.length ? pick[0].score : 0;   /* summaries only from meetings with a strong hit, not one stray word */
  const hitIds = [...new Set(pick.filter(c=>!best || c.score >= best*0.4).map(c=>c.m.id).concat(scope ? pool.slice(0,4).map(m=>m.id) : []))].slice(0,5);
  const sums = all.filter(c=>c.kind==='summary' && (hitIds.includes(c.m.id) || (!pick.length && c.score>0)));
  return {chunks: sums.concat(pick), hits: tx.length, scope, generic, pool: pool.length};
}
async function chatAsk(){
  const q = CHAT.draft.trim(); if(!q || CHAT.busy) return;
  const topic = CHAT.topic, thread = CHATS[topic] = CHATS[topic] || [];
  thread.push({role:'user', text:q, at:new Date().toISOString()}); CHAT.draft = ''; CHAT.busy = true; CHAT.error = ''; render();
  const t0 = Date.now();
  try{
    const ms = [], names = {};
    for(const meta of BRAIN.filter(m=>inTopic(m, topic))){ const m = await APP.call('brainGet', {id:meta.id}); if(!m) continue; ms.push(m); if(m.course) names[m.id] = cnm(m.course); }
    let r = brainFind(ms, q, {today:TODAY, names});
    /* few transcript hits: the words may differ from what was said (another language, other words). The model reads the
       question and gives search words; code searches again (AI reads, code decides). */
    if(r.hits < 3 && !r.generic && ms.length){
      try{ const o = extractJSON(await brainLLM('A student searches transcripts of class meetings (speech-to-text, English, Spanish or German). Give up to 12 single search words that would appear in the transcript where this question is answered: key nouns and names, in English, Spanish and German, singular. Question: '+q+'\nReturn JSON only: {"terms":["..."]}'));
        const extra = (o.terms||[]).map(String).filter(w=>/^[\p{L}\p{N}-]{3,30}$/u.test(w)).slice(0,16);
        if(extra.length){ const r2 = brainFind(ms, q, {today:TODAY, names, extra}); if(r2.hits >= r.hits) r = r2; } }catch(e){}
    }
    const hits = r.chunks.map(c=>({id:c.m.id, title:c.m.title||'Meeting', date:String(c.m.created||'').slice(0,10), kind:c.kind, at:c.t, text:c.text}));
    if(topic==='All'){ const words = brWords(q).map(brStem).map(brRe); allTasks().forEach(({c,t})=>{ const txt = c.short+': '+t.title+' (day '+t.due+', '+t.status+') '+(t.note||''); const s = words.filter(w=>{ w.lastIndex = 0; return w.test(txt); }).length; if(s >= 2 || (s && words.length===1)) hits.push({id:'', title:'Planner', date:t.due, kind:'plan', text:txt}); }); }
    const top = hits.slice(0, 22);
    const history = thread.slice(-7,-1).map(m=>(m.role==='user'?'Student: ':'You: ')+m.text.slice(0,600)).join('\n');
    let answer = 'Nothing in '+(topic==='All'?'your notes':'this topic')+' mentions that.', cites = [];
    if(top.length){
      const lab = c => c.kind==='summary' ? 'summary' : c.kind==='transcript' ? 'transcript at '+clockLabel(c.at||0) : c.kind==='notes' ? 'the student\'s notes' : 'planner';
      const o = extractJSON(await brainLLM(`You are the student's second brain and study partner. Answer from the notes below${topic==='All'?'':' from the topic "'+topic+'"'} first and say which meeting a fact comes from (and the transcript time when it helps). Transcript parts are speech-to-text: words can be misheard; "You:" is the student, "Meeting:" the others. If the question asks to explain a concept, you may add general knowledge, and say which part is not from the notes. If the notes do not answer it, say so plainly. Keep it short.
${history?'\nConversation so far:\n'+history+'\n':''}
Question: ${q}

Notes:
${top.map((c,i)=>'['+(i+1)+'] '+c.title+' ('+c.date+', '+lab(c)+'): '+c.text.slice(0, c.kind==='summary' ? 2500 : 1400)).join('\n\n')}

Return JSON: {"answer":"...","sources":[note numbers you used]}`));
      answer = String(o.answer||'').replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g,'');
      const used = (o.sources||[]).map(n=>top[n-1]).filter(Boolean); const seen = new Set();
      cites = (used.length?used:top).filter(c=>c.id && !seen.has(c.id) && seen.add(c.id)).slice(0,4).map(c=>({id:c.id, title:c.title}));
    }
    thread.push({role:'assistant', text:answer, cites, ms:Date.now()-t0, at:new Date().toISOString()});
    await saveChats();
  }catch(e){ CHAT.error = 'Claude did not answer: '+e.message; thread.pop(); CHAT.draft = q; }
  CHAT.busy = false; render();
}
/* D6 + D1: topics as nested rectangles, meetings as points placed by date */
const hash01 = s => { let x = 7; for(const c of String(s)) x = (x*31 + c.charCodeAt(0)) >>> 0; return (x % 1000) / 1000; };
const tms = m => Date.parse(m.created) || 0;
function topicGroups(){
  const groups = topicNames().map(n=>({name:n, items:BRAIN.filter(m=>(m.topics||[]).includes(n))})).filter(g=>g.items.length);
  const loose = BRAIN.filter(m=>!(m.topics||[]).length); if(loose.length) groups.push({name:'No topic yet', items:loose, loose:true});
  return groups.sort((a,b)=>b.items.length-a.items.length);
}
function splitRects(groups, x, y, w, h){
  if(!groups.length) return [];
  if(groups.length===1) return [{g:groups[0], x, y, w, h}];
  const tot = groups.reduce((s,g)=>s+g.items.length,0), f = groups[0].items.length/tot;
  if(w >= h){ const w1 = w*f; return [{g:groups[0], x, y, w:w1, h}].concat(splitRects(groups.slice(1), x+w1, y, w-w1, h)); }
  const h1 = h*f; return [{g:groups[0], x, y, w, h:h1}].concat(splitRects(groups.slice(1), x, y+h1, w, h-h1));
}
function mapBlock(){
  const groups = topicGroups(); if(!groups.length) return '';
  const W = 240, H = 100, rects = splitRects(groups, 0, 0, W, H);
  const ts = BRAIN.map(tms).filter(Boolean), d0 = Math.min(...ts), d1 = Math.max(...ts);
  let h = '<section class="map" aria-label="Topics"><div class="maphead"><h2>Topics <span class="muted">· '+groups.length+'</span></h2><button class="lnk" data-chat="cluster"'+(CHAT.clustering?' disabled':'')+'>'+(CHAT.clustering?'Grouping '+modelWhere()+'…':'Regroup by topic')+'</button></div><div class="mapbox">';
  rects.forEach(r=>{
    const name = r.g.loose ? 'All' : r.g.name, on = !r.g.loose && CHAT.topic===r.g.name;
    const pts = r.g.items.slice().sort((a,b)=>tms(a)-tms(b)).map(m=>({m, px: 10 + (d1>d0 ? (tms(m)-d0)/(d1-d0) : .5)*80, py: 34 + hash01(m.id)*54}));
    h += '<div class="trect'+(on?' on':'')+'" style="left:'+(r.x/W*100)+'%;top:'+(r.y/H*100)+'%;width:'+(r.w/W*100)+'%;height:'+(r.h/H*100)+'%">'
      + '<button class="tlabel" data-topic="'+esc(name)+'">'+esc(r.g.name)+' <span class="mono">'+r.g.items.length+'</span></button>'
      + (pts.length>1?'<svg class="tlines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="'+pts.map(p=>p.px.toFixed(1)+','+p.py.toFixed(1)).join(' ')+'"/></svg>':'')
      + pts.map(p=>'<button class="dot'+(p.m.status==='summarized'?'':' hollow')+'" style="left:'+p.px.toFixed(1)+'%;top:'+p.py.toFixed(1)+'%;--s:'+Math.round(7+Math.min(7,(p.m.duration||0)/900))+'px" data-brain="open" data-id="'+esc(p.m.id)+'" title="'+esc((p.m.title||'Meeting')+' · '+String(p.m.created||'').slice(0,10))+'" aria-label="'+esc(p.m.title||'Meeting')+'"></button>').join('')
      + '</div>';
  });
  h += '</div><div class="mapaxis mono muted"><span>'+(d0?esc(fmtShort(iso(new Date(d0)))):'')+'</span><span>Filled point: summarized · hollow: not yet</span><span>'+(d1?esc(fmtShort(iso(new Date(d1)))):'')+'</span></div></section>';
  return h;
}
/* D7: the chosen topic's meetings seated around a circle */
function circleBlock(topic){
  const items = BRAIN.filter(m=>inTopic(m, topic)).sort((a,b)=>tms(a)-tms(b)).slice(-16);
  const T = TOPICS.topics.find(x=>x.name===topic), n = items.length, C = 320, R = 150;
  let svg = '<svg viewBox="-60 0 760 440" class="table7" role="img" aria-label="Meetings in '+esc(topic==='All'?'all topics':topic)+'"><circle cx="320" cy="220" r="'+R+'"/>';
  items.forEach((m,i)=>{
    const a = -Math.PI/2 + i*2*Math.PI/Math.max(n,1), x = C+R*Math.cos(a), y = 220+R*Math.sin(a);
    const lx = C+(R+16)*Math.cos(a), ly = 220+(R+16)*Math.sin(a), anchor = Math.cos(a) > .25 ? 'start' : Math.cos(a) < -.25 ? 'end' : 'middle';
    const tt = String(m.title||'Untitled'); const label = tt.length > 24 ? tt.slice(0,23)+'…' : tt;
    svg += '<g class="seat" data-brain="open" data-id="'+esc(m.id)+'" tabindex="0"><title>'+esc(tt)+'</title><rect x="'+(x-4)+'" y="'+(y-4)+'" width="8" height="8"/><text x="'+lx.toFixed(1)+'" y="'+(ly+(Math.sin(a)>.5?12:Math.sin(a)<-.5?-4:5)).toFixed(1)+'" text-anchor="'+anchor+'"><tspan class="n">'+esc(fmt(String(m.created).slice(0,10),{day:'2-digit',month:'short'}))+'</tspan> '+esc(label)+'</text></g>';
  });
  svg += '</svg>';
  return '<div class="seatwrap">'+svg+'<div class="seatcenter"><div class="sname">'+esc(topic==='All'?'All notes':topic)+'</div>'+(T&&T.description?'<p>'+esc(T.description)+'</p>':'')+'<div class="mono muted">'+n+' meeting'+(n===1?'':'s')+'</div>'+(topic!=='All'?'<button class="lnk" data-topic="All">Show all</button>':'')+'</div></div>';
}
function viewBrain(){
  if(!IN_APP) return '<div class="empty">The second brain lives in the Mac app.</div>';
  if(BRAIN_OPEN) return meetingView(BRAIN_OPEN);
  let h = statusPanel() + recordBlock() + mapBlock();
  h += '<div class="brain2"><div>'+(BRAIN.length?circleBlock(CHAT.topic):'<div class="empty">No meetings yet. Record one above.</div>')+'</div><div>'+chatBlock()+'</div></div>';
  const shown = BRAIN.filter(m=>inTopic(m, CHAT.topic));
  if(shown.length) h += '<section aria-label="Archive"><h2>Archive <span class="muted">· '+(CHAT.topic==='All'?shown.length:shown.length+' in '+esc(CHAT.topic))+'</span></h2><ol class="arch">'+shown.map(m=>'<li><button data-brain="open" data-id="'+esc(m.id)+'"><span class="mono muted">'+esc(fmtShort(String(m.created||TODAY).slice(0,10)))+'</span><span class="at">'+esc(m.title||'Untitled meeting')+'</span><span class="muted">'+[m.course?esc(cnm(m.course)):'', (m.topics||[]).map(esc).join(', '), durLabel(m.duration), m.status==='summarized'?'summarized':(JOBS[m.id]&&ACTIVE(JOBS[m.id]))?esc(JOB_STAGE[JOBS[m.id].stage]||'')+(JOBS[m.id].stage==='transcribing'?' '+(JOBS[m.id].pct||0)+'%':''):m.status==='transcribing'?'transcription unfinished':'not summarized', m.audio?'':'no audio'].filter(Boolean).join(' · ')+'</span></button></li>').join('')+'</ol></section>';
  h += '<div class="note">Recordings and transcripts stay on this Mac; only a small copy of the audio is kept. Questions and summaries go to Claude with names, links and numbers hidden, unless the model is set to Local or the Mac is offline. <button class="lnk" data-brain="reveal">Show files</button>'+(BRAIN_MSG?' · '+esc(BRAIN_MSG):'')+'</div>';
  return h;
}
/* B1 + A5: a meeting as a film stage with a subtitle line and a waveform scrub bar */
const AUD = new Audio(); AUD.preload = 'auto';
let STAGE = {id:'', idx:0, t:0, q:'', hits:[], hi:-1, userScroll:0};
function densityPeaks(segs, dur){ const n = 180, b = new Array(n).fill(0), D = dur || ((segs[segs.length-1]||{}).t || 1); segs.forEach(s=>{ const i = Math.min(n-1, Math.floor((s.t||0)/D*n)); b[i] += String(s.text).length; }); const mx = Math.max(1, ...b); return b.map(v=>v/mx); }
const meetDur = m => (AUD.src && isFinite(AUD.duration) && AUD.duration) || m.duration || (((m.segments||[]).slice(-1)[0]||{}).t || 0);
function segAt(m, t){ const s = m.segments||[]; let i = 0; for(let k=0;k<s.length;k++){ if((s[k].t||0) <= t + .05) i = k; else break; } return i; }
function openStage(m){
  if(STAGE.id === m.id) return;
  AUD.pause(); STAGE = {id:m.id, idx:0, t:0, q:'', hits:[], hi:-1, userScroll:0};
  if(m.audio){ AUD.src = 'wtt-audio://'+encodeURIComponent(m.audio); try{ AUD.load(); }catch(e){} } else { AUD.removeAttribute('src'); }
  if(m.audio && !(m.peaks && m.peaks.length)) APP.call('brainPeaks', {id:m.id}).then(r=>{ if(BRAIN_OPEN && BRAIN_OPEN.id===m.id){ BRAIN_OPEN.peaks = r.peaks; render(); } }).catch(()=>{});
}
/* the stage is the transcript: current line bright, scroll to read, select a line to jump, search */
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function stageLine(sg, i){
  let txt = esc(sg.text);
  if(STAGE.q.length > 1) txt = txt.replace(new RegExp(reEsc(esc(STAGE.q)),'gi'), x=>'<mark'+(STAGE.hits[STAGE.hi]===i?' class="on"':'')+'>'+x+'</mark>');
  const sp = sg.sp ? '<span class="spk '+esc(sg.sp)+'">'+esc(spkName(sg.sp))+'</span>' : '';
  return '<p data-seek="'+(sg.t||0)+'" data-i="'+i+'"'+(i===STAGE.idx?' class="cur"':'')+'><span class="tt">'+clockLabel(sg.t)+'</span>'+sp+txt+'</p>';
}
function stageLines(m){ const segs = m.segments||[]; return segs.length ? segs.map(stageLine).join('') : '<p class="none">No transcript.</p>'; }
function centerLine(el, smooth){ const stx = document.getElementById('stx'); if(!stx || !el) return; stx.scrollTo({top: el.offsetTop - stx.clientHeight/2 + el.offsetHeight/2, behavior: smooth ? 'smooth' : 'auto'}); }
const countText = () => STAGE.q.length < 2 ? '' : STAGE.hits.length ? (STAGE.hi+1)+' of '+STAGE.hits.length : 'No match';
function stageCount(){ const c = document.getElementById('ss-count'); if(c) c.textContent = countText(); }
function stageSearch(q){
  const m = BRAIN_OPEN; if(!m) return; const segs = m.segments||[];
  STAGE.q = q; const low = q.toLowerCase();
  STAGE.hits = q.length < 2 ? [] : segs.map((sg,i)=>String(sg.text).toLowerCase().includes(low) ? i : -1).filter(i=>i>=0);
  STAGE.hi = STAGE.hits.length ? Math.max(0, STAGE.hits.findIndex(i=>i>=STAGE.idx)) : -1; STAGE.fresh = true;
  const stx = document.getElementById('stx'); if(stx) stx.innerHTML = stageLines(m);
  stageCount(); hitBars(m);
  if(STAGE.hi>=0){ STAGE.userScroll = Date.now(); centerLine(document.querySelector('#stx p[data-i="'+STAGE.hits[STAGE.hi]+'"]'), false); }
  else updateStage(true);
}
function stageStep(dir){
  const m = BRAIN_OPEN; if(!m || !STAGE.hits.length) return;
  if(STAGE.fresh) dir = 0; STAGE.fresh = false;
  STAGE.hi = (STAGE.hi + dir + STAGE.hits.length) % STAGE.hits.length;
  document.querySelectorAll('#stx mark.on').forEach(x=>x.classList.remove('on'));
  const p = document.querySelector('#stx p[data-i="'+STAGE.hits[STAGE.hi]+'"]'); if(p) p.querySelectorAll('mark').forEach(x=>x.classList.add('on'));
  stageCount(); seekTo((m.segments[STAGE.hits[STAGE.hi]]||{}).t||0);
}
function hitBars(m){ const bars = document.querySelectorAll('#seek i'), D = meetDur(m)||1, on = new Set(STAGE.hits.map(i=>Math.min(bars.length-1, Math.floor(((m.segments[i]||{}).t||0)/D*bars.length)))); bars.forEach((b,i)=>b.classList.toggle('hit', on.has(i))); }
function updateStage(force){
  const m = BRAIN_OPEN; if(!m) return;
  const t = m.audio && AUD.src ? AUD.currentTime : STAGE.t, idx = segAt(m, t), moved = idx !== STAGE.idx; STAGE.idx = idx;
  const stx = document.getElementById('stx');
  if(stx){
    const prev = stx.querySelector('p.cur'); if(prev && prev.dataset.i !== String(idx)) prev.classList.remove('cur');
    const cur = stx.querySelector('p[data-i="'+idx+'"]'); if(cur) cur.classList.add('cur');
    const fresh = stx.dataset.fresh; delete stx.dataset.fresh;
    if(cur && (fresh || force || (moved && !AUD.paused && Date.now() - STAGE.userScroll > 5000))) centerLine(cur, !fresh && !force);
    if(fresh && STAGE.hits.length) hitBars(m);
  }
  const tm = document.getElementById('stage-time'); if(tm) tm.textContent = clockLabel(t)+' / '+clockLabel(meetDur(m));
  const bars = document.querySelectorAll('#seek i'), f = meetDur(m) ? t/meetDur(m) : 0;
  bars.forEach((b,i)=>b.classList.toggle('p', i < f*bars.length));
  const pb = document.getElementById('playbtn'); if(pb) pb.textContent = AUD.paused ? 'Play' : 'Pause';
}
function seekTo(t){ const m = BRAIN_OPEN; if(!m) return; t = Math.max(0, Math.min(t, meetDur(m)||t)); STAGE.t = t; STAGE.userScroll = 0; if(m.audio && AUD.src){ try{ AUD.currentTime = t; }catch(e){} } updateStage(true); }
['timeupdate','play','pause','loadedmetadata','ended'].forEach(ev=>AUD.addEventListener(ev, updateStage));
/* M6 (Mac redesign, Figma 26 Nov 2026): the summary and the talk fill the screen; the transcript and audio are one line at the
   bottom (Play, waveform, Transcript › opens it as a panel over the talk, with search). Action items say whether they are in
   the plan; a missing one has Add to plan. Course, Summarize again, Transcribe again, Remove audio, notes and Delete sit in ⋯.
   Decisions are not shown (the user's comment: "dont need to see decisions"; they still go to the planner). */
let MV = {id:'', menu:false, tx:false, more:false, notes:false};
const actInPlan = (m, a) => typeof similarTask==='function' ? similarTask(m.course && cById(m.course) ? m.course : null, a.text) : null;
function meetingView(m){
  openStage(m);
  if(MV.id!==m.id) MV = {id:m.id, menu:false, tx:false, more:false, notes:!!m.notes};
  const segs = m.segments||[], dur = meetDur(m), peaks = (m.peaks && m.peaks.length) ? m.peaks : densityPeaks(segs, dur);
  const meta = [fmtShort(String(m.created||TODAY).slice(0,10)), dur?durLabel(dur):'', m.course?cnm(m.course):'', (m.topics||[]).length?'topic: '+m.topics.join(', '):'', m.audio?'':'transcript only', m.separated?'your voice and the meeting transcribed apart':'', m.status==='transcribing'?'transcript on its way':''].filter(Boolean).map(esc).join(' · ');
  const menu = MV.menu ? '<div class="mx-menu" role="menu">'
    + '<label>Course <select id="m-course">'+courseOptions(m.course)+'</select></label>'
    + '<button data-brain="summarize"'+(m._busy?' disabled':'')+'>'+(m.summary||m.summaryMarkdown?'Summarize again':'Summarize')+'</button>'
    + '<div class="mx-mrow faint">Summaries by Gemini 4 Hydrogen, names, links and numbers hidden</div>'
    + (m.audio?'<button data-brain="retranscribe">Transcribe again</button>':'')
    + '<button data-mv="notes">'+(MV.notes?'Hide your notes':'Your notes')+'</button>'
    + ((m.topics||[]).length?'<div class="mx-mrow">Topic '+m.topics.map(t=>'<button class="lnk" data-topic="'+esc(t)+'" data-brain="back">'+esc(t)+'</button>').join(', ')+'</div>':'')
    + (m.audio?'<button data-brain="dropaudio">'+(m._armAudio?'Remove the audio for good?':'Remove audio, keep transcript')+'</button>':'')
    + '<button class="warn" data-brain="delete">'+(m._armed?'Delete for good?':'Delete')+'</button></div>' : '';
  let h = '<div class="mx-bh"><div class="mx-bt"><button class="lbl lnk" data-brain="back">‹ Brain</button>'
    + '<input class="mx-mtitle" id="m-title" value="'+esc(m.title||'')+'" placeholder="Meeting title" aria-label="Meeting title">'
    + '<div class="m mono">'+meta+'</div></div>'
    + '<div class="r"><button class="btn" data-mv="menu" aria-expanded="'+MV.menu+'" aria-label="More: course, summarize again, transcribe again, notes, delete">⋯</button>'
    + '<button class="btn pri" data-brain="plan"'+(m._busy?' disabled':'')+'>Update the planner</button>'+menu+'</div></div>';
  h += newCourseForm('meeting');
  if(JOBS[m.id] && JOBS[m.id].stage!=='done') h += '<div class="job '+esc(JOBS[m.id].stage)+'" data-job="'+esc(m.id)+'"><div class="jt"><span class="jl">'+jobLine(JOBS[m.id])+'</span></div>'+(JOBS[m.id].stage==='failed'?'<div class="crow"><button class="btn pri" data-job-retry="'+esc(m.id)+'">Retry</button></div>':'')+'</div>';
  if(m._busy) h += '<div class="recstage"><b>'+esc(m._busy)+'</b> <span class="mono muted lt"></span></div>';
  if(m._error) h += '<div class="cerr"><span class="tag warn">'+ICON.warn+esc(m._error)+'</span></div>';
  if(m._moved) h += '<div class="cdone">'+esc(m._moved)+'</div>';
  if(m._note) h += '<div class="cdone">'+esc(m._note)+'</div>';
  if(m._proposal) h += '<section><h2>Planner changes from this meeting</h2>'+proposalBlock(m._proposal,'meeting')+'</section>';
  /* left: summary, action items, key points (5, then + N more), notes */
  let L = '';
  if(m.summary){
    const acts = m.actions||[], found = acts.map(a=>actInPlan(m, a)), inPlan = found.filter(Boolean).length;
    L += '<span class="lbl">Summary</span><p>'+esc(m.summary)+'</p>';
    if(acts.length) L += '<h3>Action items<span class="mono">'+inPlan+' in the plan</span></h3><ul>'+acts.map((a,i)=>{ const f = found[i];
      return '<li><i class="mono">'+(i+1)+'</i><span>'+esc(a.text)+(a.owner&&!/^me$/i.test(a.owner)?' <span class="faint">· '+esc(a.owner)+'</span>':'')+'</span>'
        + (f ? '<span class="ok mono">'+(f.t.status==='done'?'done':'in plan'+(f.t.due?' · '+esc(fmt(f.t.due,{weekday:'short',day:'numeric'})):''))+'</span>' : '<button class="mx-chip" data-mvadd="'+i+'">Add to plan</button>')+'</li>'; }).join('')+'</ul>';
    const pts = m.points||[], shown = MV.more ? pts : pts.slice(0,5);
    if(pts.length) L += '<h3>Key points'+(pts.length>5?'<button class="lnk mono" data-mv="more">'+(MV.more?'show fewer':'+ '+(pts.length-5)+' more')+'</button>':'')+'</h3><ul>'+shown.map((x,i)=>'<li><i class="mono">'+(i+1)+'</i><span>'+esc(x)+'</span></li>').join('')+'</ul>';
  } else if(m.summaryMarkdown) L += '<span class="lbl">Summary · from Meetily</span><div class="md">'+md(m.summaryMarkdown)+'</div>';
  else L += '<div class="empty">No summary yet. Open ⋯ and select Summarize.</div>';
  if(MV.notes) L += '<h3>Your notes</h3><textarea id="m-notes" rows="5" placeholder="Anything to remember">'+esc(m.notes||'')+'</textarea>';
  /* right: the talk, or the transcript over it */
  const R = MV.tx
    ? '<div class="mx-cv mx-txp"><div class="hd"><b>Transcript</b><span class="mono">'+segs.length+' lines</span><button class="lnk" data-mv="tx">Close</button></div>'
      + (segs.length?'<span class="ssearch"><span class="mono" id="ss-count">'+countText()+'</span><input id="ss" value="'+esc(STAGE.q)+'" placeholder="Search the transcript" aria-label="Search the transcript"><button data-ss="prev" title="Previous match (Shift Return)" aria-label="Previous match">↑</button><button data-ss="next" title="Next match (Return)" aria-label="Next match">↓</button></span>':'')
      + '<div class="stx" id="stx" data-fresh="1" aria-label="Transcript. Select a line to jump there.">'+stageLines(m)+'</div></div>'
    : sessionChat(m);
  h += '<div class="mx-bs"><div class="mx-sm">'+L+'</div>'+R+'</div>';
  h += '<div class="mx-tb"><button class="mx-pl" id="playbtn" data-play'+(m.audio?'':' disabled title="No audio kept for this meeting"')+'>Play</button>'
    + '<div id="seek" class="seekwrap" data-seekbar title="Jump to a moment">'+stripBars(peaks, STRIP_N, 'seek')+'</div>'
    + '<span class="mono tm" id="stage-time">0:00 / '+clockLabel(dur)+'</span>'
    + '<button class="mx-tx" data-mv="tx" aria-pressed="'+MV.tx+'">'+(MV.tx?'Talk ›':'Transcript ›')+'</button></div>';
  return '<div class="mx-brain">'+h+'</div>';
}
/* times in answers (0:42:10) jump the audio */
const seekLinks = html => html.replace(/\b(\d):([0-5]\d):([0-5]\d)\b/g, (x,h,mm,ss)=>'<button class="lnk mono" data-seekt="'+(+h*3600 + +mm*60 + +ss)+'">'+x+'</button>');
document.addEventListener('click', e=>{
  if(typeof tab==='undefined' || tab!=='brain' || !BRAIN_OPEN) return;
  const mv = e.target.closest('[data-mv]');
  if(mv){ const k = mv.dataset.mv; MV[k] = !MV[k]; if(k!=='menu') MV.menu = false; render(); if(k==='tx' && MV.tx) updateStage(true); return; }
  const st = e.target.closest('[data-seekt]'); if(st){ seekTo(+st.dataset.seekt); return; }
  const sg = e.target.closest('[data-mvsug]'); if(sg){ BRAIN_OPEN._ask = sg.dataset.mvsug; sessionAsk(BRAIN_OPEN); return; }
  const ad = e.target.closest('[data-mvadd]');
  if(ad){ const a = (BRAIN_OPEN.actions||[])[+ad.dataset.mvadd]; if(!a) return;
    compose = freshCompose(); compose.draft = a.text+(a.due?' (by '+a.due+')':'')+(BRAIN_OPEN.course?' · '+cnm(BRAIN_OPEN.course):''); chatOpen(true); render(); return; }
  if(MV.menu && !e.target.closest('.mx-menu,[data-mv]')){ MV.menu = false; render(); }
});
/* talk about one session: understand a concept, or organise the work it created. Claude (redacted) unless the model is Local or the Mac is offline. */
const ORG_RE = /\b(plan|planner|task|tasks|organi[sz]e|schedul|deadline|due|move|prepare|to-?do|this week|next week|tomorrow|busy|hours|when should|reschedul|add it|remind)/i;
let STREAM = null;
function sessionChat(m){
  const th = m.chat||[];
  const sug = ['What did we decide?','Quiz me on this session','What should I bring next time?'].concat(m.separated?['Where did I talk?']:[]);
  let h = '<section class="mx-cv chat" aria-label="Talk about this session"><div class="hd"><b>Talk about this session</b><span class="mono">Claude</span>'+(th.length?'<button class="lnk" data-brain="askclear">'+(m._armChat?'Clear the chat for good?':'Clear')+'</button>':'')+'</div>';
  h += '<div class="thread" id="m-thread">'+(th.length ? th.map(c=>c.role==='user' ? '<div class="mx-q">'+esc(c.text)+'</div>' : '<div class="mx-a">'+seekLinks(md(c.text))+'</div>').join('') : '<div class="empty">Ask anything about it: what a concept means here, or what to do before the next session.</div>')+'</div>';
  if(m._asking) h += m._stream!=null ? '<div class="mx-a" id="m-stream">'+(m._stream?md(m._stream):'<span class="muted">Reading the session… <span class="lt mono"></span></span>')+'</div>' : '<div class="muted">Working out planner changes '+modelWhere()+'… <span class="lt mono"></span></div>';
  if(!m._asking) h += '<div class="mx-sug">'+sug.map(q=>'<button data-mvsug="'+esc(q)+'">'+esc(q)+'</button>').join('')+'</div>';
  h += '<div class="mx-inp"><input id="m-ask" value="'+esc(m._ask||'')+'" placeholder="Ask about this session" aria-label="Ask about this session"><button class="btn pri" data-brain="ask"'+(m._asking?' disabled':'')+'>Send</button></div>';
  return h + '</section>';
}
function sessionContext(m, q, budget){
  const segs = m.segments||[], chunks = [];
  for(let i=0;i<segs.length;i+=14) chunks.push({i, t:segs[i].t||0, text:segs.slice(i,i+14).map(s=>(s.sp?'['+spkName(s.sp)+'] ':'')+s.text).join(' ')});
  const words = (String(q).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).map(w=>w.length>5 ? w.slice(0,w.length-2) : w);
  const score = t => { const low = t.toLowerCase(); return words.reduce((s,w)=>s+(low.split(w).length-1),0); };
  budget = budget || 6000; const picked = [];
  chunks.map(c=>({c, s:score(c.text)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).forEach(({c})=>{ if(budget - c.text.length > 0){ picked.push(c); budget -= c.text.length; } });
  if(!picked.length && chunks.length){ const step = Math.max(1, Math.floor(chunks.length/6)); for(let k=0;k<chunks.length && budget>0;k+=step){ picked.push(chunks[k]); budget -= chunks[k].text.length; } }
  picked.sort((a,b)=>a.i-b.i);
  return picked.map(c=>'['+clockLabel(c.t)+'] '+c.text).join('\n');
}
async function sessionAsk(m){
  const q = String(m._ask||'').trim(); if(!q || m._asking) return;
  m.chat = m.chat||[]; m.chat.push({role:'user', text:q, at:new Date().toISOString()}); m._ask = ''; m._asking = true; m._error = ''; render();
  try{
    const c = cById(m.course);
    const sum = m.summary ? m.summary+'\nDecisions: '+(m.decisions||[]).join('; ')+'\nAction items: '+(m.actions||[]).map(a=>a.text+(a.due?' (by '+a.due+')':'')).join('; ')+'\nKey points: '+(m.points||[]).join('; ') : String(m.summaryMarkdown||'').slice(0,4000);
    const history = m.chat.slice(-9,-1).map(x=>(x.role==='user'?'Student: ':'You: ')+String(x.text).slice(0,700)).join('\n');
    const org = m._org || ORG_RE.test(q);
    if(!org){
      m._stream = ''; render(); localTimer(true);
      const sid = m.id+':'+Date.now(); let raw = '', red = null;
      STREAM = {sid, on: piece => { raw += piece; m._stream = red ? restore(raw, red.map) : raw; const el = document.getElementById('m-stream'); if(el){ el.innerHTML = md(m._stream); const th = document.getElementById('m-thread'); if(th) th.scrollTop = th.scrollHeight; } }};
      const prompt = `You are a study partner. The student asks about one of their sessions (a class or meeting).
Session: ${m.title||'Untitled'} on ${String(m.created||'').slice(0,10)}${c?', course '+c.short:''}
Summary:
${sum||'none yet'}
${m.notes?'Student notes: '+m.notes:''}

Transcript excerpts (time in the recording):
${sessionContext(m, q+' '+history.slice(-300), 4500)||'no transcript'}
${history?'\nConversation so far:\n'+history+'\n':''}
Question: ${q}

Answer in the language of the question. Use what was said in the session first and give its time like [12:30]. If general knowledge helps explain a concept, add it and say it is not from the session. Clear and concrete, short paragraphs or a short list, Markdown.`;
      let r = null;
      red = redact(prompt);
      r = await APP.call('llm', {prompt, remotePrompt: red.text, order:['claude'], sid});
      if(!r.text) throw new Error((r.errors||[]).join(' · ') || 'Claude did not answer.');
      r.text = restore(r.text, red.map);
      STREAM = null; localTimer(false);
      m.chat.push({role:'assistant', text:String(r.text||'').trim()||'No answer.', at:new Date().toISOString()});
      m._stream = null; await saveMeeting(m);
      m._asking = false; render(); const th = document.getElementById('m-thread'); if(th) th.scrollTop = th.scrollHeight;
      return;
    }
    m._stream = null; m._org = false; render();
    const raw = extractJSON(await brainLLM(`You are a study partner. The student is asking about one of their sessions (a class or meeting).
Today is ${TODAY} (${fmt(TODAY,{weekday:'long'})}).

Session: ${m.title||'Untitled'} on ${String(m.created||'').slice(0,10)}${c?', course '+c.id+' ('+c.short+')':''}
Summary:
${sum||'none yet'}
${m.notes?'Student notes: '+m.notes:''}

Transcript excerpts (time in the recording):
${sessionContext(m, q+' '+history.slice(-300), 4000)||'no transcript'}

${c ? 'Deliverables of this course:\n'+(c.deliverables||[]).map(d=>'    deliverable '+d.id+': '+d.title+' ['+(d.date||d.state)+']').join('\n')+'\nOpen tasks of this course:\n'+(openTasksContext([c.id])||'    none') : ''}

Load per day for the next 2 weeks (limit about ${HEAVY} h a day):
${loadContext()}
Commute days in the next 6 weeks: ${commuteList()}
${history?'\nConversation so far:\n'+history+'\n':''}
Question: ${q}

How to answer:
- To explain a concept, use what was said in the session first, with its time like [12:30]. Then add general knowledge if it helps, and say that part is not from the session. Keep it clear and concrete, as for a student.
- To organise work, look at the open tasks and the load per day. If the student wants changes or clearly would benefit, put them in "plan" using the shape below; otherwise leave "plan" out. Never add a task that repeats an open or done one.
- Short paragraphs or a short list. Plain words. Markdown is fine.

${rulesText()}

Reply with JSON only: {"answer":"...","plan":${SHAPE.split('\n')[0]}}
"plan" is optional.`));
    m.chat.push({role:'assistant', text:String(raw.answer||'').trim()||'No answer.', at:new Date().toISOString()});
    if(raw.plan && typeof raw.plan==='object'){ EVREFS = []; const p = await dropRepeats(normalize(raw.plan, 'claude', q)); if(hasChanges(p) || p.dropped.length) m._proposal = PENDING[m.id] = p; }
    await saveMeeting(m);
  }catch(e){ STREAM = null; localTimer(false); m._stream = null; m._error = e.message; m.chat.pop(); m._ask = q; }
  m._asking = false; render();
  const th = document.getElementById('m-thread'); if(th) th.scrollTop = th.scrollHeight;
}
async function saveMeeting(m){ const copy = {}; Object.keys(m).forEach(k=>{ if(k[0]!=='_') copy[k] = m[k]; }); await APP.call('brainSave', {meeting:copy}); BRAIN = await APP.call('brainList'); }
let LOCAL_T0 = 0, localTick = null;
function localTimer(on){ clearInterval(localTick); if(!on) return; LOCAL_T0 = Date.now(); localTick = setInterval(()=>{ document.querySelectorAll('.lt').forEach(el=>el.textContent = Math.round((Date.now()-LOCAL_T0)/1000)+' s'); }, 1000); }
/* Brain questions, topics and planner changes from a meeting: Claude Haiku, redacted. */
const modelWhere = () => 'with Claude';
async function brainLLM(prompt, schema){
  localTimer(true);
  try{
    const red = redact(prompt), a = {prompt: red.text, remotePrompt: red.text, order:['claude']};
    if(schema) a.schema = schema;
    const r = await APP.call('llm', a);
    if(!r.text) throw new Error((r.errors||[]).join(' · ') || (offline() ? 'The Mac is offline.' : 'Claude did not answer.'));
    return restore(r.text, red.map);
  } finally { localTimer(false); }
}
const haikuLLM = prompt => brainLLM(prompt);
const PENDING = {};
/* Summaries (26 Nov 2026, the user's request: "for summarizing texts use the best model possible"): Gemini 4 Hydrogen at
   its highest effort through the Antigravity CLI (his Google AI plan), redacted like Claude. Claude Sonnet answers when
   Gemini does not. Only when he asks (Summarize). */
async function summaryLLM(prompt){
  const red = redact(prompt), r = await APP.call('llm', {prompt: red.text, remotePrompt: red.text, order:['gemini','claude'], model:'sonnet'});
  if(!r.text) throw new Error((r.errors||[]).join(' · ') || (offline() ? 'The Mac is offline.' : 'Neither Gemini nor Claude answered.'));
  return restore(r.text, red.map);
}
/* Transcripts are only ever English or Spanish; the summary is written in the transcript's language. Decided here by counting common words, not by the model. */
const ES_WORDS = new Set('que de la el en y los las por para con una un es no lo se del al como pero más esto eso está están porque también muy todo hay tiene ser ya sí cuando entonces bueno vamos'.split(' '));
const EN_WORDS = new Set('the and to of a in is that it you for this on with was are be have we not but so what they at do can if just like there about will one your'.split(' '));
function transcriptLang(text){
  let es = 0, en = 0;
  for(const w of String(text||'').toLowerCase().match(/[a-záéíóúñü]+/g)||[]){ if(ES_WORDS.has(w)) es++; else if(EN_WORDS.has(w)) en++; }
  return es > en ? 'es' : 'en';
}
async function summarizeMeeting(m, opts){
  let ok = false;
  const full = (m.segments||[]).map(s=>'['+clockLabel(s.t)+']'+(s.sp?'['+spkName(s.sp)+'] ':' ')+s.text).join('\n');
  if(!full.trim()){ m._error = 'There is no transcript to summarize.'; render(); return; }
  m._busy = 'Summarizing with Gemini… this can take a few minutes'; m._error = ''; m._note = ''; m._moved = ''; setLocalJob(m.id, m.title||'Meeting', 'summarizing', {pct:0}); render();
  try{
    const lang = transcriptLang(full.replace(/\[(?:You|Meeting)\]/g,''));
    const o = extractJSON(await summaryLLM(`You summarize a meeting for a design and media student. The transcript is in ${lang==='es'?'Spanish':'English'}. Write the title, summary, decisions, actions and points in ${lang==='es'?'Spanish':'English'}. Keep the JSON keys in English.
Courses the meeting may belong to (pick by what the work is, not by one shared word):
${courses.map(c=>'- '+c.id+' = '+c.short+' ('+c.name+')'+(c.note?': '+c.note:'')).join('\n')}
Today is ${TODAY}. "actions" are things someone agreed to do; owner is "me" for the student. Lines marked [You] are the student and [Meeting] is everyone else on the call: use that to attribute decisions and actions.
Return JSON only:
{"title":"short title","course":"course id or empty","topic":"one of: ${topicNames().join(', ')||'none yet'}, or a new 2 to 4 word topic","summary":"4 to 6 plain sentences","decisions":["..."],"actions":[{"text":"what has to be done","owner":"me or a name","due":"YYYY-MM-DD or null"}],"points":["at most 8 key points"]}

Transcript:
${full}`));
    if(!m.title || /^Meeting \d|^m-\d/.test(m.title) || m.titleAuto) { m.title = String(o.title||m.title||''); delete m.titleAuto; }
    if(cById(o.course) && o.course!==m.course && !m.courseSet){ if(m.course) m._moved = 'Filed under '+cnm(o.course)+' (was '+cnm(m.course)+'). Change the course above if that is wrong.'; m.course = o.course; }
    m.summaryLang = lang; m.summary = String(o.summary||''); m.decisions = (o.decisions||[]).map(String); m.points = (o.points||[]).map(String);
    m.actions = (o.actions||[]).map(a=>typeof a==='string'?{text:a,owner:'',due:null}:{text:String(a.text||''), owner:String(a.owner||''), due:validDate(a.due)?a.due:null}).filter(a=>a.text);
    const tp = String(o.topic||'').trim(); if(tp && !/^none/i.test(tp)){ m.topics = Array.from(new Set((m.topics||[]).concat(tp))); let T = TOPICS.topics.find(x=>x.name===tp); if(!T){ T = {name:tp, description:'', ids:[]}; TOPICS.topics.push(T); } if(!T.ids.includes(m.id)) T.ids.push(m.id); saveTopics(); }
    m.status = 'summarized';
    await saveMeeting(m);
    setLocalJob(m.id, m.title||'Meeting', 'done', {pct:100}); ok = true;
  }catch(e){ m._error = e.message; setLocalJob(m.id, m.title||'Meeting', 'failed', {error:'Summary: '+e.message}); }
  m._busy = ''; render();
  if(ok && !(opts && opts.noPlan)) await planFromMeeting(m);
}
async function planFromMeeting(m){
  if(!m.summary && !m.summaryMarkdown){ await summarizeMeeting(m, {noPlan:true}); if(m._error) return; }
  m._busy = 'Working out planner changes with Haiku…'; m._error = ''; m._note = ''; m._proposal = null; render();
  try{
    const ids = m.course ? [m.course] : null;   /* readings and time history: the meeting's course only */
    const raw = extractJSON(await brainLLM(`You update a student's study planner from a meeting.
Today is ${TODAY} (${fmt(TODAY,{weekday:'long'})}).

Courses and deliverables:
${plannerContext()}

Open tasks in all courses (id, course, title, day, hours, where, status):
${openTasksContext(null)||'    none'}

Done in the last 3 weeks:
${doneTasksContext(null)}

Planned vs actual time on finished tasks:
${timeHistory(ids)}
${readingsContext(ids) ? '\nReadings in the course folders:\n'+readingsContext(ids)+'\n' : ''}

Meeting: ${m.title||''}${m.course?' (course '+m.course+')':''}
Summary: ${m.summary||''}
Decisions: ${(m.decisions||[]).join('; ')}
Action items: ${(m.actions||[]).map(a=>a.text+(a.owner?' ('+a.owner+')':'')+(a.due?' by '+a.due:'')).join('; ')}
${m.summaryMarkdown?'Summary notes:\n'+m.summaryMarkdown.slice(0,6000):''}
${m.notes?'Student notes: '+m.notes:''}

${rulesText()}
6. Only plan what the student (me) has to do. Skip what other people will do.
7. When feedback changes an existing task (new day, more time, done, blocked), put it in "updates" with the task id. When a deadline moves, use "deadlineUpdates". Add new tasks only for new work.
8. Never add a task that repeats an open or done task listed above, even in other words. If nothing new came up, return empty arrays.
9. "events": only a new meeting the student agreed to attend, with a day and a time. No calendar events are listed here, so never use "ref".
10. The meeting is filed under ${m.course?m.course+' ('+cnm(m.course)+')':'no course'}. Put each task under the course and deliverable the work is for; check that course's open tasks and deadline first.
11. Write task titles and notes in English, like the existing tasks, even when the meeting was in Spanish. One concrete step per task, as the action items say it; do not merge or blur them.

Reply with JSON only:
${SHAPE}`, PLAN_SCHEMA));
    EVREFS = [];
    const p = normalize(raw, 'claude', [m.notes||'', (m.actions||[]).map(a=>a.text+(a.due?' by '+a.due:'')).join('; ')].join(' '));
    if(p.tasks.length && haikuAllowed()){ m._busy = 'Checking for tasks you already have…'; render(); }
    await dropRepeats(p);
    m.plannerChecked = new Date().toISOString(); await saveMeeting(m);
    if(!hasChanges(p)) m._note = p.dropped.length ? 'No planner changes: the '+p.dropped.length+' task'+(p.dropped.length===1?' it found is':'s it found are')+' already in your plan.' : 'No planner changes found in this meeting.';
    else { m._proposal = PENDING[m.id] = p; if(BRAIN_OPEN && BRAIN_OPEN.id===m.id && BRAIN_OPEN!==m) BRAIN_OPEN._proposal = p; }
  }catch(e){ m._error = e.message; }
  m._busy = ''; render();
}

if(IN_APP){
  window.__appEvent = ev => { if(ev.type==='level'){ onLevel(ev.v); return; } if(ev.type==='sysLevel'){ onSysLevel(ev.v); return; } if(ev.type==='mic'){ REC.micOpen = ev.open; const el = document.getElementById('mic-state'); if(el) el.textContent = ev.open ? 'unmuted, recording you' : 'muted, not recording you'; return; } if(ev.type==='job'){ const j = ev.job; const isNew = !JOBS[j.id]; JOBS[j.id] = Object.assign(JOBS[j.id]||{}, j); jobsChanged(); if((isNew || ['done','failed'].includes(j.stage)) && tab==='brain'){ if(j.stage==='done') APP.call('brainList').then(l=>{ BRAIN = l; render(); }); else render(); } return; }
    if(ev.type==='helpChunk'){ if(String(ev.sid||'')[0]==='r') readerEvent(ev); else helpChunk(ev); return; }
    if(/^reader/.test(ev.type)){ readerEvent(ev); return; }
    if(ev.type==='filesDropped'){ filesDropped(ev); return; }
    if(ev.type==='helpOcr'){ helpOcr(ev); return; }
    if(ev.type==='llmChunk'){ if(STREAM && STREAM.sid===ev.sid) STREAM.on(ev.text||''); return; }
    if(ev.type==='meeting'){ RECSTAGE = ev.stage==='recovering' ? 'Recovering an unfinished recording…' : ev.stage==='converting' ? 'Converting the file…' : ev.stage==='separating' ? 'Separating your voice from the meeting…' : ev.stage==='mixing' ? 'Mixing the audio…' : ev.stage==='transcribing' ? 'Transcribing with Whisper on this Mac…' : RECSTAGE; render(); } };
document.addEventListener('input', e=>{
    const el = e.target;
    if(el.id==='cmp-text') compose.draft = el.value;
    if(el.id==='chat-q') CHAT.draft = el.value;
    if(el.id==='m-ask' && BRAIN_OPEN){ BRAIN_OPEN._ask = el.value; }
    if(el.id==='ss' && BRAIN_OPEN){ stageSearch(el.value); }
    if(el.id==='rec-title'){ REC.title = el.value; if(REC.recording) saveDraft(); }
    if(el.id==='rec-notes'){ REC.notes = el.value; saveDraft(); }
    if(el.id==='nc-name') NEWC.name = el.value;
    if(el.id==='nc-note') NEWC.note = el.value;
    if(el.id==='nc-gname') NEWC.gname = el.value;
    if(el.id==='m-notes' && BRAIN_OPEN){ BRAIN_OPEN.notes = el.value; clearTimeout(window.__nt); window.__nt = setTimeout(()=>saveMeeting(BRAIN_OPEN), 800); }
  });
  const flushNotes = ()=>{ if(REC.recording) saveDraft(true); if(BRAIN_OPEN && window.__nt){ clearTimeout(window.__nt); saveMeeting(BRAIN_OPEN); } };
  window.addEventListener('pagehide', flushNotes); document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushNotes(); }); window.addEventListener('blur', flushNotes);
  ['wheel','touchmove'].forEach(ev=>document.addEventListener(ev, e=>{ if(e.target.closest && e.target.closest('#stx')) STAGE.userScroll = Date.now(); }, {passive:true}));
  document.addEventListener('keydown', e=>{
    if(EVEDIT && e.key==='Escape'){ closeEvEdit(); return; }
    if(EVEDIT && e.key==='Enter' && (e.metaKey || (e.target.tagName==='INPUT' && e.target.type!=='checkbox' && e.target.closest('.evedit')))){ e.preventDefault(); evAct('save'); return; }
    if((e.metaKey||e.ctrlKey) && e.key==='Enter' && e.target.id==='cmp-text'){ e.preventDefault(); runCompose(); }
    if(e.key==='Enter' && e.target.id==='chat-q'){ e.preventDefault(); chatAsk(); }
    if(e.key==='Enter' && e.target.id==='m-ask' && BRAIN_OPEN){ e.preventDefault(); sessionAsk(BRAIN_OPEN); }
    if(e.target.id==='ss' && BRAIN_OPEN){ if(e.key==='Enter'){ e.preventDefault(); stageStep(e.shiftKey ? -1 : 1); } if(e.key==='Escape'){ e.preventDefault(); e.target.value = ''; stageSearch(''); } }
    if(e.key==='Enter' && (e.target.id==='nc-name' || e.target.id==='nc-note')){ e.preventDefault(); document.querySelector('[data-nc=add]').click(); }
  });
  const propOf = el => { const box = el.closest('.prop'); if(!box) return null; return box.dataset.ctx==='meeting' ? (BRAIN_OPEN && BRAIN_OPEN._proposal) : compose.proposal; };
  document.addEventListener('change', e=>{
    const el = e.target;
    if(el.id==='pref-private'){ APP.call('prefs', {privateWords: el.value}).then(p=>{ PREFS = p; render(); }); return; }
    if(el.dataset && el.dataset.pe !== undefined){ const p = propOf(el); const x = p && p.events && p.events[+el.dataset.pe]; if(x) x[el.dataset.pf] = el.value; return; }
    if(el.dataset && el.dataset.pi !== undefined){ const p = propOf(el); if(!p) return; const t = p.tasks[+el.dataset.pi], f = el.dataset.pf; t[f] = f==='est' ? Math.min(100, Math.max(0.25, Number(el.value)||t.est)) : el.value;   /* hours: 0.25 to 100 (19 Nov 2026 user test: 1e9 h was saved) */ if(f==='due') t.pinned = true; if(f==='est') t.estNote = ''; if(f==='course' && deskOnly(cById(t.course))) t.where = 'desk'; render(); return; }
    if(el.id==='m-title' && BRAIN_OPEN){ BRAIN_OPEN.title = el.value; saveMeeting(BRAIN_OPEN); }
    if(el.id==='m-course' && BRAIN_OPEN){ if(el.value==='__new'){ NEWC.where = 'meeting'; NEWC.error = ''; return render(); } BRAIN_OPEN.course = el.value; BRAIN_OPEN.courseSet = true; BRAIN_OPEN._moved = ''; delete BRAIN_OPEN.plannerChecked; saveMeeting(BRAIN_OPEN); if(BRAIN_OPEN.summary && !BRAIN_OPEN.plannerUpdated) planFromMeeting(BRAIN_OPEN); }
    if(el.id==='rec-sys') REC.sysPref = el.checked;
    if(el.id==='rec-course'){ if(el.value==='__new'){ NEWC.where = 'rec'; NEWC.error = ''; return render(); } REC.course = el.value; if(REC.recording) saveDraft(true); }
    if(el.id==='nc-kind') NEWC.kind = el.value;
    if(el.id==='nc-group'){ NEWC.group = el.value; return render(); }
  });
  document.addEventListener('click', async e=>{
    const sb = e.target.closest('[data-seekbar]');
    if(sb && BRAIN_OPEN){ const r = sb.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width * meetDur(BRAIN_OPEN)); return; }
    const ss = e.target.closest('[data-ss]'); if(ss){ stageStep(ss.dataset.ss==='prev' ? -1 : 1); return; }
    const ln = e.target.closest('#stx p[data-seek]');
    if(ln && BRAIN_OPEN){ seekTo(Number(ln.dataset.seek)); return; }
    if(e.target.closest('[data-play]') && BRAIN_OPEN && BRAIN_OPEN.audio){ if(AUD.paused) AUD.play().catch(err=>{ BRAIN_OPEN._error = 'Could not play the audio: '+err.message; render(); }); else AUD.pause(); return; }
    const b = e.target.closest('[data-cmp],[data-prop],[data-rec],[data-brain],[data-chat],[data-topic],[data-inbox],[data-join],[data-file],[data-nc],[data-job-retry],[data-job-close]'); if(!b) return;
    const d = b.dataset;
    if(b.dataset.jobRetry){ const id = b.dataset.jobRetry, j = JOBS[id]||{}; if(/^Summary/.test(j.error||'')){ const m = await APP.call('brainGet',{id}); BRAIN_OPEN = BRAIN_OPEN && BRAIN_OPEN.id===id ? BRAIN_OPEN : m; return summarizeMeeting(BRAIN_OPEN); } try{ const m = await APP.call('retry', {id}); if(BRAIN_OPEN && BRAIN_OPEN.id===id){ BRAIN_OPEN = m; render(); } }catch(err){} return; }
    if(b.dataset.jobClose){ delete JOBS[b.dataset.jobClose]; jobsChanged(); return render(); }
    if(d.nc==='open'){ NEWC = {where:d.where, name:'', kind:'project', note:'', error:''}; render(); const el = document.getElementById('nc-name'); if(el) el.focus(); return; }
    if(d.nc==='cancel'){ NEWC.where = ''; return render(); }
    if(d.nc==='add'){ const where = NEWC.where, c = addCourse(); if(c && where==='courses' && typeof chatSetup==='function'){ chatSetup(c.id); return; } if(c){ if(where==='rec') REC.course = c.id; if(where==='meeting' && BRAIN_OPEN){ BRAIN_OPEN.course = c.id; BRAIN_OPEN.courseSet = true; saveMeeting(BRAIN_OPEN); } } return render(); }
    if(d.join){ e.preventDefault(); try{ await APP.call('openURL', {url:d.join}); }catch(err){} return; }
    if(d.file && !d.reveal && /\.pdf$/i.test(d.file)){ e.preventDefault(); const [cid,tid] = String(d.ctx||'').split('|'); openReader(d.file, {cid, tid}); return; }
    if(d.file){ e.preventDefault(); try{ await APP.call('openFile', {path:d.file, reveal: d.reveal==='1'}); }catch(err){} return; }
    if(d.topic!==undefined){ CHAT.topic = d.topic; if(d.brain==='back'){ AUD.pause(); BRAIN_OPEN = null; } return render(); }
    if(d.chat==='go') return chatAsk();
    if(d.chat==='cluster') return clusterTopics();
    if(d.chat==='clear'){ delete CHATS[CHAT.topic]; await saveChats(); return render(); }
    if(d.cmp==='go') return runCompose();
    if(d.cmp==='undo'){ const msg = await undoApply(); compose = freshCompose(); compose.done = msg; return render(); }
    if(d.cmp==='reset' || d.cmp==='unfocus'){ compose = freshCompose(); return render(); }
    if(d.cmp==='busy'){ compose = freshCompose(); const up = relieveToday().map(u=>Object.assign(u, {pin:false}));
      if(!up.length){ compose.done = 'Nothing on today can move: what is left has to happen today.'; return render(); }
      compose.proposal = Object.assign(emptyProposal('Today is packed: '+up.length+' task'+(up.length===1?'':'s')+' that can wait move to tomorrow, and the planner spreads them before their deadlines.'), {updates:up}); return render(); }
    if(d.prop){
      const box = b.closest('.prop'), ctx = box && box.dataset.ctx, p = propOf(b); if(!p) return; const i = +d.i;
      /* a double click on Remove takes one row, not the next one too (19 Nov 2026 user test) */
      if(/^del/.test(d.prop)){ const now = Date.now(); if(now - (p._lastDel||0) < 450) return; p._lastDel = now; }
      if(d.prop==='deltask') p.tasks.splice(i,1);
      if(d.prop==='delup') p.updates.splice(i,1);
      if(d.prop==='deldl') p.deliverables.splice(i,1);
      if(d.prop==='deldu') p.dupdates.splice(i,1);
      if(d.prop==='delrm') p.removes.splice(i,1);
      if(d.prop==='delev') p.events.splice(i,1);
      if(d.prop==='delbusy') p.busy.splice(i,1);
      if(d.prop==='delskip') p.skips.splice(i,1);
      if(d.prop==='delsess'){ const g = sessGroups(p.sessions)[i]; if(g){ const drop = new Set(g.items); p.sessions = p.sessions.filter(x=>!drop.has(x)); } }
      if(d.prop==='delinfo') p.info = null;
      if(d.prop==='delunbusy') p.unbusy.splice(i,1);
      if(d.prop==='delcw'){ const w = p.classWork.splice(i,1)[0]; p.updates = p.updates.filter(u=>!(u.course===w.course && u.changes.where==='class')); }
      if(d.prop==='cancel'){ if(ctx==='meeting'){ BRAIN_OPEN._proposal = null; delete PENDING[BRAIN_OPEN.id]; } else compose = freshCompose(); }
      if(d.prop==='apply'){
        /* once only (19 Nov 2026 user test: a double click applied everything twice, tasks and calendar events) */
        if(p._applying) return; p._applying = true; b.disabled = true;
        /* risky rows he did not tick stay out; what is applied is kept for Undo (actions.js) */
        const q = applyable(p), rec = undoBefore(q);
        const evErr = await applyEvents(q);
        const n = applyProposal(q);
        undoAfter(rec, q);
        if(ctx==='meeting'){ BRAIN_OPEN._proposal = null; delete PENDING[BRAIN_OPEN.id]; BRAIN_OPEN._note = 'Planner updated: '+n+' change'+(n===1?'':'s')+'.'; BRAIN_OPEN.plannerUpdated = new Date().toISOString(); saveMeeting(BRAIN_OPEN); }
        else { const inb = compose.inboxId; compose = freshCompose(); compose.done = 'Added to the plan: '+n+' change'+(n===1?'':'s')+'.'; compose.undo = true; if(evErr) compose.error = evErr; if(inb){ try{ await APP.call('inboxDone',{id:inb}); }catch(err){} refreshExternal(); } }
      }
      return render();
    }
    if(d.inbox){
      const it = INBOX.find(x=>x.id===d.id); if(!it) return;
      if(d.inbox==='dismiss'){ try{ await APP.call('inboxDone',{id:it.id}); }catch(err){} return refreshExternal(); }
      if(d.inbox==='use'){ compose = freshCompose(); compose.draft = it.title+(it.notes?'\n'+it.notes:''); compose.inboxId = it.id; return runCompose(); }
    }
    if(d.rec==='start'){
      REC.error = '';
      try{ const online = REC.sysPref===null ? !!detectOnline() : REC.sysPref; const r = await APP.call('recStart', {system: online, title: REC.title.trim(), course: REC.course||''}); REC.notes = REC.notes||''; REC.recording = true; REC.withSystem = r.withSystem; REC.micPolicy = r.micPolicy; REC.micOpen = r.micOpen; REC.started = Date.now(); REC.seconds = 0; LEVELS = []; SYS_LEVELS = []; startRecTimer(); }
      catch(err){ REC.error = err.message; }
      return render();
    }
    if(d.rec==='import'){
      REC.error = ''; RECSTAGE = 'Choose a file…'; render();
      try{ const m = await APP.call('importMedia', {course: REC.course||''}); RECSTAGE = ''; if(m && m.id){ BRAIN = await APP.call('brainList'); BRAIN_OPEN = m; render(); } else render(); }
      catch(err){ RECSTAGE = ''; REC.error = err.message; render(); }
      return;
    }
    if(d.rec==='mode'){ REC.sysPref = d.v==='1'; return render(); }
    if(d.rec==='cancel'){ clearInterval(recTimer); REC.recording = false; try{ await APP.call('recCancel'); }catch(err){} return render(); }
    if(d.rec==='stop'){
      clearInterval(recTimer); REC.recording = false; RECSTAGE = 'Mixing the audio…'; render();
      try{ const m = await APP.call('recStop', {course: REC.course||'', title: REC.title.trim(), notes: REC.notes}); REC.title = ''; REC.notes = ''; RECSTAGE = ''; BRAIN = await APP.call('brainList'); BRAIN_OPEN = m; render(); }
      catch(err){ RECSTAGE = ''; REC.error = err.message; render(); }
      return;
    }
    if(d.brain==='open'){ if(!BRAIN_OPEN || BRAIN_OPEN.id!==d.id) AUD.pause(); BRAIN_OPEN = await APP.call('brainGet', {id:d.id}); if(PENDING[d.id]) BRAIN_OPEN._proposal = PENDING[d.id]; else if(BRAIN_OPEN.summary && !BRAIN_OPEN.plannerChecked && !BRAIN_OPEN.plannerUpdated && String(BRAIN_OPEN.created||'')>=addDays(TODAY,-7)) planFromMeeting(BRAIN_OPEN); if(tab!=='brain') location.hash = 'brain'; render(); window.scrollTo(0,0); return; }
    if(d.brain==='back'){ AUD.pause(); BRAIN_OPEN = null; return render(); }
    if(d.brain==='summarize') return summarizeMeeting(BRAIN_OPEN);
    if(d.brain==='retranscribe'){
      if(!BRAIN_OPEN || !BRAIN_OPEN.audio) return;
      const id = BRAIN_OPEN.id;
      BRAIN_OPEN._busy = 'Transcribing again with the speech detector…'; BRAIN_OPEN._error = ''; render();
      try{ const r = await APP.call('retry', {id}); if(BRAIN_OPEN && BRAIN_OPEN.id===id){ BRAIN_OPEN = r; BRAIN_OPEN._busy = ''; } }
      catch(e){ if(BRAIN_OPEN && BRAIN_OPEN.id===id){ BRAIN_OPEN._busy = ''; BRAIN_OPEN._error = e.message; } }
      return render();
    }
    if(d.brain==='plan') return planFromMeeting(BRAIN_OPEN);
    if(d.brain==='ask') return sessionAsk(BRAIN_OPEN);
    if(d.brain==='askclear'){ if(!BRAIN_OPEN._armChat){ BRAIN_OPEN._armChat = true; return render(); } BRAIN_OPEN.chat = []; BRAIN_OPEN._armChat = false; await saveMeeting(BRAIN_OPEN); return render(); }
    if(d.brain==='delete'){ if(!BRAIN_OPEN._armed){ BRAIN_OPEN._armed = true; return render(); } await APP.call('brainDelete', {id:BRAIN_OPEN.id}); BRAIN_OPEN = null; BRAIN = await APP.call('brainList'); return render(); }
    if(d.brain==='reveal') return APP.call('revealBrain');
    if(d.brain==='dropaudio'){ if(!BRAIN_OPEN._armAudio){ BRAIN_OPEN._armAudio = true; return render(); } AUD.pause(); AUD.removeAttribute('src'); STAGE.id = ''; await APP.call('brainDropAudio',{id:BRAIN_OPEN.id}); delete BRAIN_OPEN.audio; delete BRAIN_OPEN.peaks; BRAIN_OPEN._armAudio = false; BRAIN = await APP.call('brainList'); return render(); }
  });
}
