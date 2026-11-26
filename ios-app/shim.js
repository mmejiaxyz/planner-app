/* Planner for iPhone: the bridge between page/index_v2.html and the app (PhoneApp.swift). Injected before the page loads.
   APP.call(op, args) talks to Swift, as on the Mac (APP.phone tells the page it runs on the phone).
   The page's database is the last snapshot from the Mac with the phone's own changes not yet applied laid on top
   (PlanMerge.applyOps, page/js/merge.js). Saving a document does not overwrite anything: it sends one change
   {base, data} that the Mac merges into its plan. */
(function(){
  let n = 0; const pend = {};
  window.__appReply = (id, res) => { const p = pend[id]; if(!p) return; delete pend[id]; (res && res.error) ? p.rej(new Error(res.error)) : p.res(res); };
  window.APP = { phone: true, call: (op, args) => new Promise((res, rej) => { const id = ++n; pend[id] = {res, rej}; window.webkit.messageHandlers.app.postMessage({id, op, args: args || {}}); }) };

  const copy = x => JSON.parse(JSON.stringify(x));
  let VIEW = null, loading = null;
  const subs = {};
  async function load(){
    const s = await APP.call('load');
    VIEW = window.PlanMerge.applyOps(s.plan || {courses: [], flags: [], days: []}, s.pending || []);
  }
  const snap = list => ({ docs: copy(list || []).map(x => ({ id: x.id, data: () => x })) });
  const deliver = () => Object.keys(subs).forEach(name => subs[name].forEach(cb => { try{ cb(snap(VIEW[name])); }catch(e){ console.error(e); } }));
  const db = {
    collection: name => ({ onSnapshot: (cb, err) => {
      (subs[name] = subs[name] || []).push(cb);
      (loading = loading || load()).then(() => cb(snap(VIEW[name]))).catch(e => err && err(e));
    } }),
    doc: path => ({ set: async data => {
      if(!VIEW) await (loading = loading || load());
      const [col, id] = path.split('/');
      const list = VIEW[col] = VIEW[col] || [];
      const i = list.findIndex(x => x.id === id);
      const base = i < 0 ? null : copy(list[i]);
      const doc = copy(data); doc.id = id;
      if(window.PlanMerge.deq(base, doc)) return;
      if(i < 0) list.push(doc); else list[i] = doc;
      await APP.call('pushOp', { op: { kind: 'set', path, base, data: doc } });
    } })
  };
  window.claude = { use: async n => n === 'db' ? db : null };

  /* A new snapshot arrived (or changes were applied): show it, unless something is being typed; then try again shortly. */
  window.__planChanged = async function again(){
    const a = document.activeElement;
    if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){ clearTimeout(again.t); again.t = setTimeout(again, 3000); return; }
    try{ await load(); deliver(); }catch(e){ console.error(e); }
    if(window.__syncChanged) window.__syncChanged();
  };
})();
