/* The planner chat as a floating window (24 Nov 2026, the user's request: "I want more a floating window with a chat, actions are
   asked the way you ask here questions, with a little interface where I can tick options or actions, text of course also
   available"). Part of page/index_v2.html; classic script, loaded after actions.js.
   - The window (#pchat, class "compose" so the old hooks still find it) sits over every tab, bottom right; "–" folds it into
     the Planner button, ⌘K opens and folds it. It opens by itself when something new happens in the chat (a question, a
     preview, Set up, "Get help · Change the plan", an inbox note). Open or folded is kept (localStorage chatOpen).
   - The state is still `compose` (input.js, organizer-run.js, onboard.js): this file only draws it.
   - Questions are cards: a label, the question, options to pick (and "Other" to type), several questions in one card.
     Options come from code (where a course meets, which course dropped files are for, how long a task takes) or from the
     model, which may end a question with options in brackets: "Which course? [Design | Lab]" (`qOptions`).
   - Changes are the checklist card from proposalBlock(); Apply writes the ticked rows.
   - Typing is always there: any card can be answered in his own words. */
let PCHAT = {open: (typeof lsGet==='function' ? lsGet('chatOpen') : '')!=='0', sig:null, at:null};
const chatActive = () => !!(compose.busy || compose.proposal || compose.thread.length || compose.focus || compose.done || compose.error);
const chatSig = () => [compose.thread.length, !!compose.proposal, !!compose.busy, compose.focus && compose.focus.id, compose.done, compose.error, (compose.questions||[]).join('|'), compose.setup && compose.setup.cid].join('§');
function chatOpen(on){ PCHAT.open = on; lsSet('chatOpen', on ? '1' : '0'); chatRender(); if(on) setTimeout(()=>{ const t = document.getElementById('cmp-text'); if(t && !document.querySelector('#pchat .pc-qcard input:focus')) t.focus(); }, 30); }

/* "Which course? [Design | Lab]" -> {q:'Which course?', opts:['Design','Lab']} */
function qOptions(q){ const m = String(q||'').match(/^(.*?)\s*\[([^\]]+\|[^\]]+)\]\s*$/); return m ? {q:m[1].trim(), opts:m[2].split('|').map(x=>x.trim()).filter(Boolean).slice(0,6)} : {q:String(q||''), opts:[]}; }
const SIZE_OPTS = [['30 min','30 min'],['1 h','1 h'],['2 h','2 h'],['3 h','3 h'],['A full day','1 day', '7 h, split over days with room']];
/* the open question as a card: [{q, opts:[{label, d, val, chip}], other}] and how to send it */
function chatCard(){
  const c = compose; if(!c.questions || !c.questions.length || c.busy || c.proposal) return null;
  if(c.chips && c.chips.length){   /* code's own options (where it meets, which course) */
    const desc = k => ((typeof ONB_MODES!=='undefined' ? ONB_MODES : []).find(m=>m[0]===k)||[])[2] || '';
    return {label: c.setup && !c.setup.mode ? 'Where it meets' : c.dropped ? 'Course' : 'Question', kind:'chips',
      qs:[{q:c.questions[0], opts:c.chips.map((x,i)=>({label:x.label, d:x.act==='mode' ? desc(x.val) : x.act==='file' ? 'Moved into the folder you pick, nothing else' : x.pri && c.dropped ? 'Guessed from the file names' : '', val:i, pri:x.pri})), other:true}]};
  }
  if(c.pendingSize){   /* how long: one question per task */
    const ps = c.pendingSize, list = ps.ask.map(i=>ps.raw.tasks[i]).filter(Boolean);
    return {label:'How long', kind:'size', qs:list.map(t=>({q:'How long will “'+String(t.title||'').slice(0,80)+'” take?', opts:SIZE_OPTS.map(([l,v,d])=>({label:l, val:v, d:d||''})).concat([{label:'You decide', val:'guess:'+(Number(t.minutes)||60), d:'Claude’s estimate: '+fmtH((Number(t.minutes)||60)/60)}]), other:true}))};
  }
  return {label: c.questions.length > 1 ? c.questions.length+' questions' : 'Question', kind:'text', qs:c.questions.map(q=>{ const o = qOptions(q); return {q:o.q, opts:o.opts.map(x=>({label:x, val:x})), other:true}; })};
}
const fmtH = h => h >= 1 ? (Math.round(h*4)/4)+' h' : Math.round(h*60)+' min';
function cardHTML(card){
  const multi = card.qs.length > 1;
  let h = '<div class="pc-qcard pc-card"><div class="pc-ch"><span class="pc-chip">'+esc(card.label)+'</span></div>';
  card.qs.forEach((x,qi)=>{
    if(multi) h += '<div class="pc-qn">'+(qi+1)+' / '+card.qs.length+'</div>';
    h += '<div class="pc-q">'+esc(x.q)+'</div><div class="pc-opts" role="radiogroup">';
    x.opts.forEach((o,oi)=>{ h += '<label class="pc-opt pc-radio"><input type="radio" name="pcq'+qi+'" value="'+oi+'"'+(o.pri?' checked':'')+'><span class="pc-l">'+esc(o.label)+'</span>'+(o.d?'<span class="pc-meta">'+esc(o.d)+'</span>':'')+'</label>'; });
    if(x.other) h += '<label class="pc-opt pc-radio"><input type="radio" name="pcq'+qi+'" value="other"'+(x.opts.length?'':' checked')+'><span class="pc-l">'+(x.opts.length?'Other':'Your answer')+'</span><input class="pc-other" data-qo="'+qi+'" placeholder="Type your answer"></label>';
    h += '</div>';
  });
  return h + '<div class="pc-foot"><button class="btn pri" data-qsend="1">'+(card.qs.length>1?'Send answers':'Continue')+'</button><span class="pc-src">or answer below in your own words</span></div></div>';
}
/* the picks of the open card -> a chip action, or text for the usual reader (runCompose / setupAnswer / sizesFrom) */
function cardSend(){
  const card = chatCard(); if(!card) return;
  const box = document.querySelector('#pchat .pc-qcard'); if(!box) return;
  const ans = card.qs.map((x,qi)=>{ const r = box.querySelector('input[name="pcq'+qi+'"]:checked'), other = (box.querySelector('[data-qo="'+qi+'"]')||{}).value || '';
    if(!r) return other.trim() ? {text:other.trim()} : null;
    if(r.value==='other') return other.trim() ? {text:other.trim()} : null;
    return {opt:x.opts[+r.value]}; });
  if(ans.some(a=>!a)){ compose.error = card.qs.length > 1 ? 'Answer each question, or write it below.' : 'Pick an answer, or write it below.'; return render(); }
  compose.error = '';
  if(card.kind==='chips' && ans[0].opt){ const ch = compose.chips[ans[0].opt.val]; if(ch){ if(ch.act==='course') compose.thread.push({role:'user', text:ch.label}); return chipAct(ch); } }
  let text;
  if(card.kind==='size') text = ans.map(a=>a.text || (String(a.opt.val).startsWith('guess:') ? (+String(a.opt.val).slice(6))+' min' : a.opt.val)).join(', ');
  else if(ans.length===1) text = ans[0].text || ans[0].opt.label;
  else text = ans.map((a,i)=>(i+1)+') '+(a.text || a.opt.label)).join(' ');
  compose.draft = text; runCompose();
}

function chatMsgs(){
  const c = compose; let h = '';
  const card = chatCard();
  if(!c.thread.length && !c.proposal && !c.busy){
    h += '<div class="pc-ai pc-note">Tell me what is coming up or what changed, or ask about your plan. Drop a syllabus or readings here to set up a course.</div>';
    if(todayOver() > 0) h += '<div class="pc-acts"><button class="btn sm" data-cmp="busy">Today is '+todayOver()+' h over the time left: move what can wait</button></div>';
  }
  const lastQ = card ? c.thread.map(m=>m.role==='assistant' && m.kind!=='note').lastIndexOf(true) : -1;
  c.thread.forEach((m,i)=>{ if(i===lastQ) return;
    h += m.role==='user' ? '<div class="pc-me">'+esc(m.text)+'</div>' : '<div class="pc-ai'+(m.kind==='note'?' pc-note':'')+'">'+esc(m.text)+'</div>'; });
  if(c.busy) h += '<div id="cmp-prog" class="cprog pc-prog" role="status" aria-live="polite">'+planProgress()+'</div>';
  if(card) h += cardHTML(card);
  else if(c.chips && c.chips.length && !c.busy && !c.proposal) h += '<div class="pc-acts">'+c.chips.map((x,i)=>'<button class="btn sm'+(x.pri?' pri':'')+'" data-chip="'+i+'">'+esc(x.label)+'</button>').join('')+'</div>';
  if(c.proposal) h += c.whatIf && typeof whatIfBlock==='function' ? whatIfBlock(c.proposal) : proposalBlock(c.proposal, 'compose');
  if(c.error) h += '<div class="pc-warn">'+esc(c.error)+'</div>';
  if(c.done) h += '<div class="pc-done"><span>'+esc(c.done)+'</span>'+(c.undo && typeof UNDO!=='undefined' && UNDO ? '<button class="lnk" data-cmp="undo">Undo</button>' : '')+'</div>';
  return h;
}
function chatRender(){
  let host = document.getElementById('pchat-host');
  if(typeof IN_APP==='undefined' || !IN_APP || typeof PHONE!=='undefined' && PHONE){ if(host) host.remove(); return; }
  if(!host){ host = document.createElement('div'); host.id = 'pchat-host'; document.body.appendChild(host); }
  /* something new in the chat opens the window (not the first paint) */
  const sig = chatSig(); if(PCHAT.sig!==null && sig!==PCHAT.sig && chatActive() && !PCHAT.open){ PCHAT.open = true; lsSet('chatOpen','1'); }
  const fresh = sig!==PCHAT.sig; PCHAT.sig = sig;
  const hx = chatHelp();
  if(!PCHAT.open){   /* folded: the Planner logo as a square; a dot when the chat has something waiting (27 Nov 2026) */
    const what = hx ? 'Get help · '+hx.t.title.slice(0,60) : chatActive() ? 'Planner chat: something is waiting' : 'Tell the planner something, add a task or a note';
    host.innerHTML = '<button class="pc-launch pc-logo" data-chatwin="open" title="'+esc(what)+' (⌘K)" aria-label="'+esc(what)+'">'+PLANNER_LOGO+(chatActive()||hx?'<span class="pc-dot"></span>':'')+'</button>'; return; }
  const prev = host.querySelector('.pc-msgs'), atEnd = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 60, keep = prev ? prev.scrollTop : 0;
  const ae = document.activeElement, fid = ae && host.contains(ae) && ae.id ? ae.id : '', fsel = fid && 'selectionStart' in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const wasHelp = !!host.querySelector('.pc-hctx');
  const ft = focusTask();
  const head = '<div class="pc-head"><div><h2>Planner</h2><div class="pc-sub">'+'Claude · names, links and numbers hidden'+'</div></div><div class="pc-ctl">'
    + (!hx && c_any() ? '<button data-cmp="reset" title="Start over">⟲</button>' : '')+'<button data-chatwin="close" title="Make small (⌘K)">–</button></div></div>';
  if(hx){   /* a task attached: its Get help session (help.js) */
    host.innerHTML = '<section class="compose pchat pc-help" id="pchat" aria-label="Get help with a task">'+head+helpView()+'</section>';
    const m = host.querySelector('.pc-msgs'); if(m) m.scrollTop = !wasHelp || atEnd ? m.scrollHeight : keep;
    chatRefocus(host, fid, fsel); return;
  }
  host.innerHTML = '<section class="compose pchat" id="pchat" aria-label="Planner chat">'+head
    + (ft ? '<div class="pc-ctx"><span>About <b>'+esc(ft.t.title)+'</b> <span class="muted">· '+esc(ft.c.short)+' · '+(ft.t.due?esc(fmtShort(ft.t.due)):'no day')+'</span></span><button class="lnk" data-cmp="unfocus">Clear</button></div>' : '')
    + '<div class="pc-msgs">'+chatMsgs()+'</div>'
    + '<div class="pc-inp">'+chatAtList()+'<textarea id="cmp-text" rows="2" placeholder="'+(compose.questions?'Or answer in your own words':compose.setup?'Answer, or paste the Moodle page, an email, the schedule':ft?'What changed? e.g. the prof said only chapter 1, or: drop it':'Message the planner · @ to ask about a task')+'"'+(compose.busy?' disabled':'')+'>'+esc(compose.draft)+'</textarea>'
    + '<div class="pc-row"><button class="lnk" data-chatwin="files">Add files…</button>'+modelPicker()+'<button class="lnk" data-chatwin="priv">Privacy</button><span class="mono faint">⌘↩</span><button class="btn pri" data-cmp="go"'+(compose.busy?' disabled':'')+'>'+(compose.busy?'Thinking…':'Send')+'</button></div>'
    + (PCHAT.priv ? '<div class="priv pc-priv"><label>Also hide these words, comma separated<input id="pref-private" value="'+esc((PREFS&&PREFS.privateWords)||'')+'" placeholder="Paula, Jonas, Café Kranz"></label><div class="faint">Hidden automatically: '+esc(privacyTerms().join(', ')||'none')+'</div></div>' : '')
    + '</div></section>';
  const m = host.querySelector('.pc-msgs');
  const cards = m.querySelectorAll('.pc-card'), card = cards[cards.length-1];
  m.scrollTop = fresh && card ? Math.max(0, card.offsetTop - 12) : atEnd && !wasHelp ? m.scrollHeight : wasHelp ? m.scrollHeight : keep;
  chatRefocus(host, fid, fsel);
}
/* the window is drawn again on every change: the field being typed in keeps its focus and caret */
function chatRefocus(host, fid, fsel){
  if(!fid) return; const el = document.getElementById(fid);
  if(el && host.contains(el) && el!==document.activeElement && !el.disabled){ el.focus(); if(fsel && el.setSelectionRange) try{ el.setSelectionRange(fsel[0], fsel[1]); }catch(e){} }
}
/* the Get help session shown in the window, if a task is attached (help.js) */
const chatHelp = () => (typeof HELP!=='undefined' && HELP && typeof helpTask==='function') ? helpTask() : null;

/* @ in the planner box attaches a task: "@essay" lists matching open tasks, a pick opens its Get help session here */
function chatAtQuery(){ const m = String(compose.draft||'').match(/(?:^|\s)@([^\n@]{0,40})$/); return m ? m[1].trim() : null; }
function chatAtTasks(q){
  const words = String(q||'').toLowerCase().split(/\s+/).filter(Boolean);
  return allTasks().filter(({t})=>t.status!=='done').filter(({c,t})=>{ const s = (t.title+' '+c.short).toLowerCase(); return words.every(w=>s.includes(w)); })
    .sort((a,b)=>(a.t.due||'9999').localeCompare(b.t.due||'9999')).slice(0,6);
}
function chatAtList(){
  const q = chatAtQuery(); if(q===null || compose.busy) return '';
  const ts = chatAtTasks(q);
  return '<div class="pc-at" role="listbox" aria-label="Ask about a task">'+(ts.length ? ts.map(({c,t},i)=>'<button class="'+(i===0?'on':'')+'" data-atask="'+esc(c.id+'|'+t.id)+'"><span>'+esc(t.title)+'</span><span class="mono">'+esc(c.short)+(t.due?' · '+esc(fmtShort(t.due)):'')+'</span></button>').join('') : '<div class="pc-hsrc">No open task matches.</div>')+'</div>';
}
function chatAtPick(key){
  const [cid, tid] = String(key).split('|');
  compose.draft = String(compose.draft||'').replace(/(?:^|\s)@[^\n@]{0,40}$/, '').trimEnd();
  if(typeof openHelp==='function') openHelp(cid, tid);
}
const c_any = () => compose.thread.length || compose.proposal || compose.focus || compose.done;

document.addEventListener('click', async e=>{
  const w = e.target.closest('[data-chatwin]'); if(w){ e.preventDefault(); const k = w.dataset.chatwin;
    if(k==='open') return chatOpen(true);
    if(k==='close') return chatOpen(false);
    if(k==='priv'){ PCHAT.priv = !PCHAT.priv; return chatRender(); }
    if(k==='files'){   /* files picked here go where dropped files go */
      try{ const r = await APP.call('pickFiles', {}); const paths = (r && r.paths) || []; if(paths.length) chatDrop(paths); }
      catch(err){ if(compose.setup){ chipAct({act:'add'}); } else { compose.error = /not found|unknown|unsupported/i.test(err.message||'') ? 'Adding files here needs the app rebuilt. Drop them on this window instead.' : err.message; render(); } }
      return; }
  }
  if(e.target.closest('[data-qsend]')){ e.preventDefault(); return cardSend(); }
  const at = e.target.closest('[data-atask]'); if(at){ e.preventDefault(); return chatAtPick(at.dataset.atask); }
});
/* typing @ redraws the list of tasks to attach */
document.addEventListener('input', e=>{ if(e.target.id!=='cmp-text') return; compose.draft = e.target.value; const q = chatAtQuery(); if(q!==null || PCHAT.at!==null){ PCHAT.at = q; chatRender(); } });
/* typing in "Other" picks it */
document.addEventListener('input', e=>{ const o = e.target.closest && e.target.closest('.pc-other'); if(o){ const r = o.closest('.pc-opt').querySelector('input[type=radio]'); if(r) r.checked = true; } });
document.addEventListener('keydown', e=>{
  if((e.metaKey||e.ctrlKey) && (e.key==='k' || e.key==='K') && typeof IN_APP!=='undefined' && IN_APP){ e.preventDefault(); return chatOpen(!PCHAT.open); }
  if(e.key==='Enter' && e.target.closest && e.target.closest('.pc-other')){ e.preventDefault(); cardSend(); }
  if(e.target.id==='cmp-text' && chatAtQuery()!==null){   /* the @ list: Enter takes the first task, Escape closes it */
    if(e.key==='Enter' && !e.metaKey && !e.ctrlKey){ const f = document.querySelector('#pchat .pc-at [data-atask]'); if(f){ e.preventDefault(); chatAtPick(f.dataset.atask); } }
    else if(e.key==='Escape'){ e.preventDefault(); compose.draft = compose.draft.replace(/@([^\n@]{0,40})$/, '$1'); PCHAT.at = null; chatRender(); }
  }
});
