/* Three-way merge for phone changes. Part of page/index_v2.html; classic script, also loaded by node tests.
   A phone change carries the document as the phone saw it (base) and as the phone left it (mine). The Mac may have changed
   the same document since (theirs: organizer moves, new tasks, ticks on the Mac). Only what the phone changed is carried
   over: field by field, and lists of items with an id (tasks, deliverables, decisions) item by item. When both sides
   changed the same field, the phone wins: it is the later, deliberate action (a tick, a time). Items the phone removed
   go; items the Mac removed stay gone. */
(function(root){
  const isObj = x => !!x && typeof x==='object' && !Array.isArray(x);
  const clone = x => x===undefined ? undefined : JSON.parse(JSON.stringify(x));
  function deq(a, b){
    if(a===b) return true;
    if(!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b)) return false;
    if(Array.isArray(a)) return a.length===b.length && a.every((x,i)=>deq(x,b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length===kb.length && ka.every(k=>Object.prototype.hasOwnProperty.call(b,k) && deq(a[k], b[k]));
  }
  const idList = a => Array.isArray(a) && a.every(x=>isObj(x) && typeof x.id==='string');
  function merge3(base, mine, theirs){
    if(deq(base, mine)) return clone(theirs);
    if(theirs===undefined || base===undefined || base===null) return clone(mine);
    if(isObj(base) && isObj(mine) && isObj(theirs)){
      const out = clone(theirs);
      new Set(Object.keys(base).concat(Object.keys(mine))).forEach(k=>{
        if(deq(base[k], mine[k])) return;
        if(!(k in mine)){ delete out[k]; return; }
        out[k] = (k in theirs && k in base) ? merge3(base[k], mine[k], theirs[k]) : clone(mine[k]);
      });
      return out;
    }
    if(idList(base) && idList(mine) && idList(theirs) && (base.length || mine.length || theirs.length)){
      const B = new Map(base.map(x=>[x.id,x])), M = new Map(mine.map(x=>[x.id,x])), T = new Set(theirs.map(x=>x.id));
      const out = [];
      theirs.forEach(t=>{
        if(B.has(t.id) && !M.has(t.id)) return;                              /* the phone removed it */
        out.push(B.has(t.id) && M.has(t.id) ? merge3(B.get(t.id), M.get(t.id), t) : clone(t));
      });
      mine.forEach(m=>{ if(!B.has(m.id) && !T.has(m.id)) out.push(clone(m)); });   /* new on the phone */
      return out;
    }
    return clone(mine);
  }
  /* Apply a list of "set" changes to a plan {courses, flags, days}, in order. Used by the phone to show its own changes
     on top of the last snapshot until the Mac has applied them. */
  function applyOps(plan, ops){
    const out = clone(plan) || {};
    (ops||[]).forEach(op=>{
      if(!op || op.kind!=='set') return;
      const [col, id] = String(op.path||'').split('/'); if(!col || !id) return;
      const list = out[col] = Array.isArray(out[col]) ? out[col] : [];
      const i = list.findIndex(x=>x && x.id===id);
      const m = merge3(op.base, op.data, i<0 ? undefined : list[i]);
      if(!isObj(m)) return;
      m.id = id;
      if(i<0) list.push(m); else list[i] = m;
    });
    return out;
  }
  const api = {merge3, applyOps, deq, clone};
  if(typeof module!=='undefined' && module.exports) module.exports = api;
  root.PlanMerge = api;
})(typeof window!=='undefined' ? window : globalThis);
