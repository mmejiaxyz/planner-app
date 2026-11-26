/* Background organizer. Pure: everything it needs about the day comes in through `env`, so the same plan and the same
   env always give the same moves, and tests can run it in Node with any date and time.

   env = {
     today:'YYYY-MM-DD', nowMin: minutes since midnight now (DAY_START when the page date is not the clock date),
     freeAtHome(day, fromMin) -> hours free at home that day (away time and calendar events taken out),
     isCommute(day) -> bool, homeMin(day) -> minute he is home on a class day (or null),
     heavy: 7, commuteCap: 2, aheadDays: 7, dayEnd: 22*60, maxEarly: 14, levelTol: 1, fixedCourses: []
   }

   It starts from the plan as it is and only makes moves that help:
   0. Carried over (planned before today, not done): onto today if today still has room, else the first gap before its deadline.
   Ranking: least slack first, the last day a task can start with all other work counted (`latest`), then deadline.
   1. A day over its limit hands work to the nearest day in range with room, earlier first. 1b. A day more than 1 h over the even
      share hands a task to the nearest day in range that ends up more than 1 h lighter than it was.
   2. Least slack first, work is pulled into the earliest day in range that is still under its even daily target.
   P. Priority first: priority work takes the earliest day in range with room; lower-priority work on that day makes way (later, else its last day).
   3. Today is topped up to the same even share from work planned in the next few days (near work only).
   Deliverables without a date plan to their planning date (`planBy`, see setPlanDates) as a soft deadline.
   Never moved: done, courses in fixedCourses (none since 4 Nov 2026), tasks without a deadline or planning date (except carried over onto today),
   tasks he placed himself (pin === due), and today's tasks. Blocked tasks are never pulled earlier (2, 3) and never put on today.
   A task never goes past its deadline (class session work: by the day before), never more than 14 days before its last possible start unless it was
   already planned earlier, and never across another task of the same deliverable, so sequences and part order hold.
   `where` is never changed: a train or metro task done at home today simply counts as desk time today.
   Work in class (where "class", placed by him on a class he uses as work time, pinned to that day) is its own lane: it never
   counts against time at home and is never moved. Not done that day, it is carried over like desk work. */
(function(root){
  const pad = n => String(n).padStart(2,'0');
  const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
  const diff = (a,b) => Math.round((parse(a)-parse(b))/864e5);
  const PART_RE = /\s*\(part (\d+) of (\d+)\)\s*$/i;
  const partInfo = t => { const m = String(t.title||'').match(PART_RE); return m ? {n:+m[1], of:+m[2], base:String(t.title).replace(PART_RE,'')} : null; };
  const delivOf = (c,t) => (c.deliverables||[]).find(d=>d.id===t.did);
  const deadlineOf = (c,t) => { const d = delivOf(c,t); return d && d.date || ''; };
  /* priority (26 Nov 2026, the user's words: "I told claude that 3 deadline were top priority … I work from highers prio down, so if
     things are missed or delayed the lower impacting are missed"): a deliverable's `prio` (1 = most important); none = 99.
     Priority work picks days first (steps 0, 2, 3), lower priority leaves a full day first (1, 1b), and deadlineRisks counts
     priority work first, so a shortage lands on the lower deadlines. Deadlines, pins, part order and the rest still hold. */
  const prioOf = (c,t) => { const d = delivOf(c,t); return d && d.prio > 0 ? +d.prio : 99; };
  const isSession = (c,d) => d ? /^Session\b/i.test(d.title||'') : c.id==='ghost';
  /* the last day a task can be done: its real deadline, session work the day before ('' without a deadline). One rule for the
     organizer, the safety checks, drag and "Move to next day" (14 Nov 2026: a session reading was moved onto the session day). */
  /* the last day for session work: the day before the class, or the class day itself when the class starts at 17:00 or later
     (24 Nov 2026, the user's report: "Short of time" for the Saturday 20:00 online Seminar class while the whole Saturday before it
     was free). Class times from the course's own sessions. */
  const EVENING = '17:00';
  const sessionLast = (c, d) => { if(!d || !d.date) return ''; const s = (c.sessions||[]).find(x=>x.d===d.date);
    return s && String(s.s||'') >= EVENING ? d.date : addDays(d.date,-1); };
  const lastDayOf = (c,t) => { const dl = deadlineOf(c,t); return dl && isSession(c, delivOf(c,t)) ? sessionLast(c, delivOf(c,t)) : dl; };
  /* the same for a deadline day dl the organizer works with (the real date, or a planning date) */
  const lastFrom = (c,t,dl) => !dl || !isSession(c, delivOf(c,t)) ? dl : dl===deadlineOf(c,t) ? sessionLast(c, delivOf(c,t)) : addDays(dl,-1);
  /* his pin holds, except past the last day of a deadline still ahead (that was never a valid place for the work). Past a
     deadline already gone, his pin is the user's answer (a late hand-in he arranged). `today` is optional (safety checks pass it). */
  const pinHolds = (c,t,today) => { if(!t.pin || t.pin!==t.due) return false; const ld = lastDayOf(c,t); return !(ld && t.due > ld && (!today || ld >= today)); };
  const workable = t => t.status!=='done' && t.status!=='blocked';
  const est = t => Number(t.est)||0;
  /* Done work counts on the day it was done; done without doneOn (older data) counts on its day only if that day is past. */
  /* the lane a task's hours count in: train, phone, class (only on the class day it was placed on) or desk */
  const placeOf = (t, today) => t.where==='train' || t.where==='phone' ? t.where : t.where==='class' && t.pin && t.pin===t.due && t.due >= today ? 'class' : 'desk';
  const countsOn = (t, day, today) => t.status!=='done' ? t.due===day : t.doneOn ? t.doneOn===day : t.due===day && day < today;

  function organizePlan(cs, env){
    const TOL = env.levelTol ?? 1, EPS = 1e-6, TODAY = env.today, TOM = addDays(TODAY,1), CAP = env.commuteCap, EARLY = env.maxEarly || 14;
    const fixed = new Set(env.fixedCourses || []);
    /* deadline for planning: the real one, else the planning date of a deliverable without a date (`planBy`, set by setPlanDates),
       while it is still ahead. Late work (step L) and the safety checks use only the real deadline. */
    const dlOf = (c,t) => { const d = delivOf(c,t); return d && d.date || (d && d.planBy && d.planBy > TODAY ? d.planBy : ''); };
    const all = []; cs.forEach(c=>(c.tasks||[]).forEach(t=>all.push({c,t})));
    const open = all.filter(({t})=>t.status!=='done' && t.due);
    /* train or metro work on a later day without a commute is done at home, so it counts as desk time on that day (7 Nov 2026:
       58 h of commute work sat on break days in a lane with no room, out of the day totals and never moved). `where` stays. */
    const place = t => { const p = placeOf(t, TODAY); return (p==='train' || p==='phone') && t.due > TODAY && !env.isCommute(t.due) ? 'desk' : p; };
    const deskCap = d => Math.min(env.heavy, env.freeAtHome(d));
    const isFree = ({c,t}) => t.due > TODAY && place(t)!=='class' && t.pin!==t.due && !fixed.has(c.id) && dlOf(c,t) && t.due <= dlOf(c,t) && !(place(t)!=='desk' && est(t) > CAP + EPS);
    const mv = open.filter(isFree), orig = new Map(open.map(x=>[x.t, x.t.due]));
    /* parts of one task out of order (part 2 before part 1): hand their days back out in part order (same place only) */
    const pg = {}; mv.forEach(x=>{ const p = partInfo(x.t); if(p) (pg[x.c.id+'|'+p.base] = pg[x.c.id+'|'+p.base]||[]).push(x); });
    Object.values(pg).forEach(ps=>{ if(ps.length < 2 || new Set(ps.map(x=>place(x.t))).size > 1) return; const days = ps.map(x=>x.t.due).sort(); ps.sort((a,b)=>partInfo(a.t).n-partInfo(b.t).n).forEach((x,i)=>{ x.t.due = days[i]; }); });
    /* loads */
    const L = {desk:{}, train:{}, phone:{}, class:{}};
    const add = (t, d, sign) => { const m = place(t); L[m][d] = (L[m][d]||0) + sign*est(t); };
    /* where a task counts on day d: train or metro work is desk work on a day without a commute, and commute work again on a
       commute day. Room is always checked for the day it goes to (19 Nov 2026 stress test: train work on a sick Friday counted as
       desk work, was moved by desk room onto Monday and put 4.75 h of laptop work on a 2 h train ride). */
    const mAt = (t, d) => place(Object.assign({}, t, {due:d}));
    const fits = (t, d, e, lim) => { const m = mAt(t, d); return (L[m][d]||0) + e <= lim(m, d) + EPS; };
    open.forEach(({t})=>add(t, t.due, 1));
    const cap = (m, d) => m==='desk' ? Math.max(0, deskCap(d)) : m==='class' ? 0 : (env.isCommute(d) ? CAP : 0);
    /* daily target for desk work: free time times how full the next 4 weeks are (from things that do not move, so it is stable) */
    let need = 0, room = 0; const H = addDays(TODAY, 28);
    open.forEach(x=>{ if(place(x.t)!=='desk') return; if(mv.includes(x) ? dlOf(x.c,x.t) <= H : (x.t.due > TODAY && x.t.due <= H)) need += est(x.t); });
    for(let d = TOM; d <= H; d = addDays(d,1)) room += Math.max(0, deskCap(d));
    const U = Math.min(1, Math.max(0.35, room ? need/room*1.1 : 1));
    const target = (m, d) => m==='desk' ? cap(m,d) * U : cap(m,d);
    /* sequence inside each course: current order, the parts of one task in part order */
    const seq = new Map();
    cs.forEach(c=>{
      const list = open.filter(x=>x.c===c).sort((a,b)=>a.t.due.localeCompare(b.t.due) || (c.tasks.indexOf(a.t)-c.tasks.indexOf(b.t)));
      const groups = {}; list.forEach((x,i)=>{ const p = partInfo(x.t); if(p) (groups[p.base] = groups[p.base]||[]).push(i); });
      const ordered = list.slice();
      Object.values(groups).forEach(idx=>{ const ps = idx.map(i=>list[i]).sort((a,b)=>partInfo(a.t).n-partInfo(b.t).n); idx.forEach((i,k)=>ordered[i] = ps[k]); });
      ordered.forEach((x,i)=>seq.set(x.t, i));
    });
    const before = (y, x) => y!==x && y.c===x.c && y.t.did===x.t.did && seq.get(y.t) < seq.get(x.t);
    /* ranking: the last day each task can start and still be done in time, with all other work counted. Planned backwards from
       the deadlines over the even daily share (plus the commute on commute days), latest deadline first, each task before the next
       step of its deliverable. A big deliverable or a crowded week starts earlier than its deadline alone says. Work that does not
       move (placed by him, class work, today's, no deadline) takes its time first. Depends only on deadlines, sizes and free
       time, not on the days the organizer gives, so a second run ranks the same. */
    const lastDay = (c,t) => lastFrom(c, t, dlOf(c,t));
    const latest = new Map();
    {
      const cand = open.filter(({c,t})=>dlOf(c,t) && t.due!==TODAY && place(t)!=='class' && !(t.pin && t.pin===t.due && t.due >= TODAY) && !fixed.has(c.id));
      const inC = new Set(cand.map(x=>x.t)), busyH = {}, free = {};
      open.forEach(({t})=>{ if(!inC.has(t) && t.due > TODAY && place(t)!=='class') busyH[t.due] = (busyH[t.due]||0) + est(t); });
      const room = d => free[d] ?? (free[d] = Math.max(0, target('desk',d) + (env.isCommute(d) ? 2*CAP : 0) - (busyH[d]||0)));
      cand.slice().sort((a,b)=>lastDay(b.c,b.t).localeCompare(lastDay(a.c,a.t)) || seq.get(b.t)-seq.get(a.t)).forEach(x=>{
        let d = lastDay(x.c,x.t);
        open.forEach(y=>{ if(!before(x, y)) return; const k = inC.has(y.t) ? latest.get(y.t) : y.t.due > TODAY ? y.t.due : null; if(k && k < d) d = k; });
        let rem = est(x.t);
        while(rem > EPS && d >= TOM){ const take = Math.min(rem, room(d)); free[d] -= take; rem -= take; if(rem > EPS) d = addDays(d,-1); }
        latest.set(x.t, d < TOM ? TODAY : d);
      });
    }
    const rank = x => latest.get(x.t) || dlOf(x.c,x.t) || '9999';
    /* where a task may go: after the task before it for the same deliverable, before the one after it, not past its deadline,
       not more than 14 days before the deadline (unless it was planned earlier), not today or before */
    const range = x => {
      const dlx = dlOf(x.c,x.t), ses = isSession(x.c, delivOf(x.c,x.t));
      const s = seq.get(x.t); let lo = TOM, hi = ses && x.t.due < dlx ? lastFrom(x.c, x.t, dlx) : dlx;
      open.forEach(y=>{ if(y.c!==x.c || y.t.did!==x.t.did || y===x) return; const k = seq.get(y.t); if(k < s && y.t.due > lo) lo = y.t.due; if(k > s && y.t.due < hi) hi = y.t.due; });
      /* not more than 14 days before the last day it can start (a big or crowded deliverable may start earlier) */
      const early = [addDays(rank(x) < dlx ? rank(x) : dlx, -EARLY), orig.get(x.t)].sort()[0];
      if(early > lo) lo = early;
      return [lo, hi];
    };
    const move = (x, d) => { add(x.t, x.t.due, -1); x.t.due = d; add(x.t, d, 1); };

    /* room on today: the even daily share minus work done today and still open today, never more than the free time left now
       (to dayEnd, minus away time and calendar) and never past `heavy` for the whole day. Train or metro work still open today
       counts against time at home once the commute is over (or on a day without one). */
    const nowMin = env.nowMin, todayOpen = nowMin < env.dayEnd - 30;
    let left = 0;
    if(todayOpen){
      const doneT = all.filter(({t})=>t.status==='done' && t.where!=='class' && countsOn(t, TODAY, TODAY)).reduce((s,{t})=>s+est(t),0);
      const openT = open.filter(({t})=>t.due===TODAY && place(t)!=='class'), openH = openT.reduce((s,{t})=>s+est(t),0);
      const home = env.homeMin(TODAY);
      const homeOpen = openT.filter(({t})=>place(t)==='desk' || !env.isCommute(TODAY) || home==null || nowMin >= home).reduce((s,{t})=>s+est(t),0);
      left = Math.min(deskCap(TODAY)*U - doneT - openH, env.freeAtHome(TODAY, nowMin) - homeOpen, env.heavy - doneT - openH);
    }

    /* L. late: planned after its real deadline (the deliverable date, the submission). Two deadlines (the user's words, 4 Nov 2026):
       the real one never moves; the task's day is the app's deadline, which moves to fit the plan but never past the real one.
       The real deadline wins over everything else here (4 Nov 2026: "Hand in the poster" sat on
       Friday, its deadline was Wednesday, and nothing pulled it back because every step skipped work already past it).
       Still ahead: the first day with room from tomorrow (after the earlier tasks of its deliverable) to the deadline (session
       work: the day before), else the last day even if full; deadline today: onto today.
       Already passed: onto today, where it stays as carried over (step 0 keeps it there) until he ticks it, moves it himself
       or removes it. Not moved: work he placed (his pin is the user's answer), class work, blocked work that would land on today. */
    const lateMoves = [];
    open.filter(({c,t})=>{ const ld = lastDayOf(c,t); return ld && t.due > ld && t.due > TODAY && !pinHolds(c,t,TODAY) && place(t)!=='class'; })
      .sort((a,b)=>deadlineOf(a.c,a.t).localeCompare(deadlineOf(b.c,b.t)) || seq.get(a.t)-seq.get(b.t)).forEach(x=>{
        const t = x.t, from = t.due, m = place(t), e = est(t), dl = deadlineOf(x.c,t);
        let hi = lastDayOf(x.c,t); if(hi < TOM) hi = TODAY;
        if(hi===TODAY){ if(!workable(t)) return; add(t, from, -1); t.due = TODAY; L.desk[TODAY] = (L.desk[TODAY]||0) + e; left -= e; delete t.pin; lateMoves.push({c:x.c, t, from, to:TODAY, late:true}); return; }
        let lo = TOM; open.forEach(y=>{ if(before(y, x) && y.t.due > lo && y.t.due <= hi) lo = y.t.due; });
        let to = hi;
        for(let d = lo; d <= hi; d = addDays(d,1)) if(fits(t, d, e, target)){ to = d; break; }
        move(x, to); delete t.pin;
        if(fixed.has(x.c.id) || !isFree(x)) lateMoves.push({c:x.c, t, from, to, late:true}); else mv.push(x);
      });

    /* 0. carried over (planned before today, not done). Work he started (doing) always onto today. Otherwise today first while it has room (only work that can be done now),
       then the first gap from tomorrow to its deadline (session work by the day before), after the earlier tasks of its
       deliverable and by the next one. No room by then, or no deadline: it stays on Today as carried over. */
    const carriedMoves = [];
    open.filter(({c,t})=>t.due < TODAY && !fixed.has(c.id)).sort((a,b)=>prioOf(a.c,a.t)-prioOf(b.c,b.t) || rank(a).localeCompare(rank(b)) || (dlOf(a.c,a.t)||'9999').localeCompare(dlOf(b.c,b.t)||'9999') || a.t.due.localeCompare(b.t.due) || seq.get(a.t)-seq.get(b.t)).forEach(x=>{
      const t = x.t, from = t.due, m = place(t), e = est(t), dl = dlOf(x.c,t);
      /* work he has started (doing) stays on today even when today is full (the user's choice, 4 Nov 2026); "Today is packed" warns */
      if(t.status==='doing' || todayOpen && workable(t) && e > 0 && e <= left + EPS){ left -= e; add(t, from, -1); t.due = TODAY; L.desk[TODAY] = (L.desk[TODAY]||0) + e; delete t.pin; carriedMoves.push({c:x.c, t, from, to:TODAY, carried:true}); return; }
      if(!dl) return;
      /* never past the next task of its deliverable planned from tomorrow on (4 Nov 2026: a carried-over Project X task went to
         the delivery day, after "Package and send the delivery files").
         19 Nov 2026 user test (overdue work piled up on Today, 15 to 72 h, while the next days stayed empty):
         room is checked for where the task counts on each day (train or metro work bigger than one leg is desk work on a day at
         home, so it is no longer stuck), first the even share, then the day's full free time, earliest day first (three steps
         no longer all land on the deadline day); and if nothing fits before the next step, it may go later, up to its last day,
         when the later steps can move along to that day so the order holds. Still no room: it stays carried over. */
      const last = lastFrom(x.c, t, dl);
      let hi = last;
      open.forEach(y=>{ if(before(x, y) && y.t.due >= TOM && y.t.due < hi) hi = y.t.due; });
      let lo = TOM; open.forEach(y=>{ if(before(y, x) && y.t.due > lo) lo = y.t.due; });
      const go = d => { move(x, d); delete t.pin; carriedMoves.push({c:x.c, t, from, to:d}); };
      for(const lim of [target, cap]) for(let d = lo; d <= hi; d = addDays(d,1)) if(fits(t, d, e, lim)){ go(d); return; }
      for(let d = addDays(hi > lo ? hi : lo, 1); d <= last; d = addDays(d,1)){
        if(!fits(t, d, e, cap)) continue;
        const later = open.filter(y=>before(x, y) && y.t.due >= TOM && y.t.due < d);
        if(!later.every(y=>mv.includes(y))) break;
        /* the whole group must fit on that day, lane by lane (else it would only move the overload) */
        const need = {}; [x].concat(later).forEach(y=>{ const ln = mAt(y.t, d); need[ln] = (need[ln]||0) + est(y.t); });
        if(!Object.entries(need).every(([ln, h])=>(L[ln][d]||0) + h <= cap(ln, d) + EPS)) continue;
        go(d); later.forEach(y=>move(y, d)); return;
      }
    });

    const byDeadline = mv.slice().sort((a,b)=>prioOf(a.c,a.t)-prioOf(b.c,b.t) || rank(a).localeCompare(rank(b)) || dlOf(a.c,a.t).localeCompare(dlOf(b.c,b.t)) || seq.get(a.t)-seq.get(b.t) || a.c.id.localeCompare(b.c.id));
    /* a full day hands off its lowest-priority work first */
    const byRelief = byDeadline.slice().sort((a,b)=>prioOf(b.c,b.t)-prioOf(a.c,a.t) || byDeadline.indexOf(a)-byDeadline.indexOf(b));
    for(let pass = 0; pass < 60; pass++){
      let changed = false;
      /* 1. overloaded days: move work to the nearest day in range with room, earlier first */
      for(const x of byRelief){
        const m = place(x.t), d0 = x.t.due, e = est(x.t);
        if((L[m][d0]||0) <= cap(m,d0) + EPS) continue;
        const [lo, hi] = range(x); let best = '', dist = 1e9;
        for(let d = lo; d <= hi; d = addDays(d,1)){
          if(d===d0 || !fits(x.t, d, e, cap)) continue;
          if(d < d0 && !workable(x.t)) continue;   /* blocked work is only ever moved later */
          const k = Math.abs(diff(d, d0)) + (d > d0 ? 0.5 : 0);
          if(k < dist){ dist = k; best = d; }
        }
        if(best){ move(x, best); changed = true; }
      }
      /* 1b. peaks: a day more than levelTol (1 h) over its even target hands a task to the nearest day in range that stays within
         its free time and ends up more than levelTol lighter than this day was, so 7 h days do not sit next to empty ones
         (7 Nov 2026). Every such move makes the days more even, so it cannot go back and forth. Blocked work only later. */
      for(const x of byRelief){
        const m = place(x.t), d0 = x.t.due, e = est(x.t);
        if(m!=='desk' || (L.desk[d0]||0) <= target('desk',d0) + TOL + EPS) continue;
        const [lo, hi] = range(x); let best = '', dist = 1e9;
        for(let d = lo; d <= hi; d = addDays(d,1)){
          if(d===d0 || place(Object.assign({}, x.t, {due:d}))!=='desk' || (L.desk[d]||0) + e > cap('desk',d) + EPS || (L.desk[d]||0) + e + TOL > (L.desk[d0]||0) - EPS) continue;
          if(d < d0 && !workable(x.t)) continue;
          const k = Math.abs(diff(d, d0)) + (d > d0 ? 0.5 : 0);
          if(k < dist){ dist = k; best = d; }
        }
        if(best){ move(x, best); changed = true; }
      }
      /* 2. gaps: least slack first (rank), pull work into the earliest day in range that is still under its target */
      for(const x of byDeadline){
        if(!workable(x.t)) continue;
        const m = place(x.t), d0 = x.t.due, e = est(x.t);
        const [lo] = range(x);
        for(let d = lo; d < d0; d = addDays(d,1)){
          /* gaps keep commute work on commute days: pulling it to a day at home would waste the train or metro time */
          if(mAt(x.t, d)===m && fits(x.t, d, e, target)){ move(x, d); changed = true; break; }
        }
      }
      if(!changed) break;
    }

    /* P. priority first (26 Nov 2026, the user's rule: "I work from highers prio down, so if things are missed or delayed the lower
       impacting are missed"). Highest priority first, each priority task takes the earliest day in its range (deadline, part
       and step order, 14-day window) that has room in its lane, making room when needed: lower-priority work on that day moves
       to the nearest later day in its own range with room, else onto its last day even when that day is full (that is the
       work that slips, and Short of time names it). Blocked work is never pulled earlier; work he placed is never moved. */
    for(let pass = 0; pass < 30; pass++){
      let changed = false;
      for(const x of byDeadline){
        const px = prioOf(x.c,x.t); if(px >= 99 || !workable(x.t)) continue;
        const [lo] = range(x), dx = x.t.due, ex = est(x.t), m = place(x.t);
        for(let d = lo; d < dx && !changed; d = addDays(d,1)){
          if(mAt(x.t, d)!==m) continue;
          if(fits(x.t, d, ex, cap)){ move(x, d); changed = true; break; }
          /* make room: lower-priority work on d, lowest priority and latest deadline first */
          const low = byDeadline.filter(y=>y.t.due===d && prioOf(y.c,y.t) > px && place(y.t)===m)
            .sort((p,q)=>prioOf(q.c,q.t)-prioOf(p.c,p.t) || (dlOf(q.c,q.t)||'9999').localeCompare(dlOf(p.c,p.t)||'9999'));
          const plan = []; let free = cap(m, d) - (L[m][d]||0);
          for(const y of low){
            if(free + EPS >= ex) break;
            const [, hiY] = range(y); if(hiY <= d) continue;
            let to = '';
            for(let k = addDays(d,1); k <= hiY; k = addDays(k,1)) if(mAt(y.t, k)===m && (L[m][k]||0) + est(y.t) + plan.filter(z=>z.to===k).reduce((s,z)=>s+est(z.y.t),0) <= cap(m, k) + EPS){ to = k; break; }
            if(!to) to = hiY;   /* nowhere with room: its last day, where it may be missed */
            plan.push({y, to}); free += est(y.t);
          }
          if(free + EPS < ex) continue;
          plan.forEach(({y, to})=>move(y, to)); move(x, d); changed = true;
        }
      }
      if(!changed) break;
    }

    /* 3. today: top it up to the same even share as other days, so he stays ahead. Near work only: tasks planned in the next
       aheadDays days, the nearest day first (then nearest deadline), in deliverable order; not blocked, in a fixed course or
       user-placed, and not more than 14 days before its deadline. Not done today, it is carried over tomorrow (step 0). */
    const todayMoves = [];
    if(todayOpen){
      const cands = open.filter(({c,t})=>t.due > TODAY && place(t)!=='class' && workable(t) && !fixed.has(c.id) && t.pin!==t.due && t.due <= addDays(TODAY, env.aheadDays) && (!dlOf(c,t) || t.due <= dlOf(c,t) && addDays(rank({c,t}) < dlOf(c,t) ? rank({c,t}) : dlOf(c,t),-EARLY) <= TODAY))
        .sort((a,b)=>prioOf(a.c,a.t)-prioOf(b.c,b.t) || a.t.due.localeCompare(b.t.due) || (dlOf(a.c,a.t)||'9999').localeCompare(dlOf(b.c,b.t)||'9999') || seq.get(a.t)-seq.get(b.t) || a.c.id.localeCompare(b.c.id));
      const chosen = new Set();
      const waits = x => open.some(y=>before(y, x) && y.t.due > TODAY && !chosen.has(y.t));
      for(const x of cands){
        const e = est(x.t); if(left < 0.25 - EPS) break;
        if(e <= 0 || e > left + EPS || waits(x)) continue;
        chosen.add(x.t); left -= e;
        const from = x.t.due;
        add(x.t, from, -1); x.t.due = TODAY; L.desk[TODAY] = (L.desk[TODAY]||0) + e; delete x.t.pin;
        todayMoves.push({c:x.c, t:x.t, from, to:TODAY, today:true});
      }
    }
    /* keep each course's list in its sequence, so tasks on the same day keep their order next time */
    cs.forEach(c=>{ const idx = [], items = []; (c.tasks||[]).forEach((t,i)=>{ if(seq.has(t)){ idx.push(i); items.push(t); } }); items.sort((a,b)=>a.due.localeCompare(b.due) || seq.get(a)-seq.get(b)); idx.forEach((i,k)=>c.tasks[i] = items[k]); });
    const listed = new Set(carriedMoves.concat(todayMoves, lateMoves).map(m=>m.t));
    const moves = mv.filter(x=>x.t.due!==orig.get(x.t) && !listed.has(x.t)).map(x=>({c:x.c, t:x.t, from:orig.get(x.t), to:x.t.due}))
      .concat(lateMoves.filter(m=>!carriedMoves.concat(todayMoves).some(k=>k.t===m.t)), carriedMoves, todayMoves.map(m=>Object.assign({}, m, {from:orig.get(m.t)||m.from})));
    return {moves};
  }

  /* Planning dates (7 Nov 2026, the user's choice): a deliverable without a date (tbd) gets `planBy`, the last day its open work is planned
     on. The organizer treats it as a soft deadline, so that work is ranked, spread and moved off heavy days like dated work, but
     never later than planBy. It is stored, so it does not creep earlier when the last task is pulled into a gap; it only grows when
     work is planned later (a new task, a task he drags). A real date always wins. Returns the courses it changed. */
  /* Parts of one task in part order (10 Nov 2026, the user's report: "some tasks are showing stage two before stage 1"). The
     organizer only reorders parts it may move, so parts pinned by a drag, a free-time or short-slot fill or a day named in a
     note stayed out of order (Adorno part 2 on 12 Nov, part 1 on 13 Nov). Here the open parts of each task (same course, same
     title without "(part k of n)") get their slots back in part order: a slot is the day with its pin and place, since the
     place belongs to the day (metro on a commute day). The days used and the load per day stay the same. Run before each
     organize; returns the courses changed. */
  function orderParts(cs){
    const touched = new Set();
    cs.forEach(c=>{
      const groups = {};
      (c.tasks||[]).forEach(t=>{ const p = t.status!=='done' && t.due && partInfo(t); if(p) (groups[p.base] = groups[p.base]||[]).push(t); });
      Object.values(groups).forEach(ps=>{
        if(ps.length < 2) return;
        ps.sort((a,b)=>partInfo(a).n-partInfo(b).n);
        if(ps.every((t,i)=>!i || ps[i-1].due <= t.due)) return;
        const slots = ps.map(t=>({due:t.due, pin:t.pin, where:t.where})).sort((a,b)=>a.due.localeCompare(b.due));
        ps.forEach((t,i)=>{ const s = slots[i]; t.due = s.due; if(s.pin) t.pin = s.due; else delete t.pin; t.where = s.where; });
        touched.add(c);
      });
    });
    return [...touched];
  }

  function setPlanDates(cs){
    const touched = new Set();
    cs.forEach(c=>(c.deliverables||[]).forEach(d=>{
      if(d.date) return;
      const last = (c.tasks||[]).filter(t=>t.did===d.id && t.status!=='done' && t.due).map(t=>t.due).sort().pop();
      if(last && !(d.planBy >= last)){ d.planBy = last; touched.add(c); }
    }));
    return [...touched];
  }

  /* Days for new work (18 Nov 2026, the user's report: a note for 70 h of Lab work left 33 h on the deadline day with 200 h free before it).
     items, in order: {course, did, est, where, last}. Each goes on the first day from tomorrow to `last` with room, after the item
     before it for the same deliverable. Days fill evenly: the lowest daily level that fits everything is used. A block larger than
     the level needs a day with room for all of it. Train and metro work only on commute days. Returns {days, fit}; without room an
     item gets its last day and fit is false. */
  function fillDays(cs, items, env){
    const TOM = addDays(env.today,1), EPS = 1e-6, base = {desk:{}, train:{}, phone:{}};
    const lane = (where, d) => (where==='train' || where==='phone') && env.isCommute(d) ? where : 'desk';
    cs.forEach(c=>(c.tasks||[]).forEach(t=>{ if(t.status==='done' || !t.due || t.due<=env.today || placeOf(t, env.today)==='class') return; const m = lane(t.where, t.due); base[m][t.due] = (base[m][t.due]||0) + est(t); }));
    const cap = d => Math.max(0, Math.min(env.heavy, env.freeAtHome(d)));
    const attempt = level => {
      const L = {desk:{...base.desk}, train:{...base.train}, phone:{...base.phone}}, after = {}, days = []; let fit = true;
      items.forEach(x=>{
        const go = x.where==='train' || x.where==='phone', key = x.course+'|'+x.did; let day = '';
        for(let d = after[key] && after[key] > TOM ? after[key] : TOM; d <= x.last; d = addDays(d,1)){
          const total = (L.desk[d]||0) + (L.train[d]||0) + (L.phone[d]||0) + x.est;   /* commute work counts toward the day's limit too */
          if(total > Math.min(env.heavy, Math.max(level, x.est)) + EPS) continue;
          if(go ? env.isCommute(d) && (L[x.where][d]||0) + x.est <= env.commuteCap + EPS : (L.desk[d]||0) + x.est <= cap(d) + EPS){ day = d; break; }
        }
        if(!day){ fit = false; day = x.last; }
        const m = lane(x.where, day); L[m][day] = (L[m][day]||0) + x.est; after[key] = day; days.push(day);
      });
      return {days, fit};
    };
    let r = {days:[], fit:true};
    for(let level = 1; level <= env.heavy; level += 0.5){ r = attempt(level); if(r.fit) break; }
    return r;
  }

  /* Deadlines that cannot be met (9 Nov 2026, the user's request). Real deadlines only, in date order: all open work due by a deadline
     (session work by the day before) against all the time there is until then. Time is desk time at home (free time, at most
     `heavy` a day; today the free time left now, at most `heavy`) plus the commute on commute days (2 x commuteCap),
     which only train and metro work can use; desk work needs desk time on its own. Work pinned to a class is its own lane and
     not counted. Work done in the right order is the best any plan can do, so a deadline short here is short in every plan.
     Returns [{course, did, title, date, short, work, room, inherited}] for deadlines short by more than `tol` hours; `inherited`
     when the shortfall is no bigger than one already reported for an earlier deadline (that work is the cause). */
  function deadlineRisks(cs, env, tol){
    tol = tol ?? 1;
    const TODAY = env.today, CAP = env.commuteCap || 0, all = [];
    cs.forEach(c=>(c.tasks||[]).forEach(t=>all.push({c,t})));
    /* today: the free time left now. Work already done today does not shrink it (14 Nov 2026: 12.75 h done, 7 h free left,
       and a 1.25 h reading was called short). */
    const deskRoom = d => d===TODAY ? Math.max(0, Math.min(env.heavy, env.freeAtHome(TODAY, env.nowMin))) : Math.max(0, Math.min(env.heavy, env.freeAtHome(d)));
    const commuteRoom = d => env.isCommute(d) && (d > TODAY || env.homeMin == null || env.homeMin(TODAY) == null || env.nowMin < env.homeMin(TODAY)) ? 2*CAP : 0;
    const items = [];
    cs.forEach(c=>(c.deliverables||[]).forEach(d=>{
      if(!d.date || d.date < TODAY) return;
      const by = isSession(c, d) ? sessionLast(c, d) : d.date; if(by < TODAY) return;
      const ts = (c.tasks||[]).filter(t=>t.did===d.id && t.status!=='done' && placeOf(t, TODAY)!=='class');
      if(ts.length) items.push({c, d, by, prio: d.prio > 0 ? +d.prio : 0, desk: ts.filter(t=>t.where!=='train' && t.where!=='phone').reduce((s,t)=>s+est(t),0), go: ts.filter(t=>t.where==='train' || t.where==='phone').reduce((s,t)=>s+est(t),0)});
    }));
    items.sort((a,b)=>a.by.localeCompare(b.by));
    /* priority work is done first (the user's rule, 26 Nov 2026), so it is checked on its own, and every other deadline gets the time
       that is left after all of it; a shortage then lands on the lower deadlines */
    const pri = items.filter(x=>x.prio), rest = items.filter(x=>!x.prio);
    const pDesk = pri.reduce((s,x)=>s+x.desk,0), pGo = pri.reduce((s,x)=>s+x.go,0);
    const out = []; let worst = 0;
    const run = (list, takeDesk, takeGo) => { let deskNeed = takeDesk, goNeed = takeGo, deskHave = 0, goHave = 0, day = TODAY;
      list.forEach(x=>{
        for(; day <= x.by; day = addDays(day,1)){ deskHave += deskRoom(day); goHave += commuteRoom(day); }
        deskNeed += x.desk; goNeed += x.go;
        /* train and metro work can also be done at a desk; desk work cannot be done on the train */
        const short = Math.max(deskNeed - deskHave, deskNeed + goNeed - deskHave - goHave);
        if(short > tol) out.push({course:x.c.id, did:x.d.id, title:x.d.title, date:x.d.date, short:Math.round(short*4)/4, work:Math.round((deskNeed+goNeed)*4)/4, room:Math.round((deskHave+goHave)*4)/4, inherited: short <= worst + tol, prio:x.prio||0, byPrio: !x.prio && takeDesk + takeGo > 0});
        if(short > worst) worst = short;
      }); };
    run(pri, 0, 0); worst = 0;
    run(rest, pDesk, pGo);
    return out.sort((a,b)=>a.date.localeCompare(b.date));
  }

  /* Safety checks on the organizer's result (list of problems; empty = safe): no task removed, added or left without a
     date; nothing but the day (and a stale pin) changed; nothing moved before today; to today only as a listed carried-over
     move or today top-up; nothing moved past its deadline (class session: on or after it); nothing moved without being listed. */
  function organizeProblems(real, copy, moves, today){
    const out = [], key = (c,t) => c.id+'|'+t.id, valid = s => /^\d{4}-\d\d-\d\d$/.test(String(s||''));
    const a = new Map(), b = new Map();
    real.forEach(c=>(c.tasks||[]).forEach(t=>a.set(key(c,t), {c,t})));
    copy.forEach(c=>(c.tasks||[]).forEach(t=>b.set(key(c,t), {c,t})));
    if(a.size !== b.size) out.push('task count changed');
    a.forEach((x,k)=>{
      const y = b.get(k); if(!y){ out.push('missing '+k); return; }
      const strip = t => { const o = Object.assign({}, t, {due:null, pin:null}); return JSON.stringify(o, Object.keys(o).sort()); };
      if(strip(x.t) !== strip(y.t)) out.push('changed more than the day: '+k);
      if(pinHolds(x.c, x.t, today) && x.t.due >= today && y.t.due!==x.t.due) out.push('moved a task he placed: '+k);
      if(x.t.due && !valid(y.t.due)) out.push('lost its date: '+k);
      if(x.t.due !== y.t.due){
        const m = moves.find(m=>m.c.id===y.c.id && m.t.id===y.t.id);
        const dl = deadlineOf(y.c, y.t), ses = isSession(y.c, delivOf(y.c, y.t));
        if(y.t.due < today) out.push('moved before today: '+k);
        if(y.t.due===today && !(m && (m.today && x.t.due > today || m.carried && x.t.due < today || m.late && x.t.due > today))) out.push('moved to today without being a today move: '+k);
        if(y.t.due===today && y.t.status==='blocked') out.push('blocked task put on today: '+k);
        /* a passed deadline: today is the only allowed day, and only as carried-over or late work */
        const overdue = dl && dl < today && y.t.due===today && m && (m.late || m.carried);
        if(dl && !overdue && (y.t.due > dl || (ses && y.t.due > lastDayOf(y.c, y.t) && x.t.due < dl))) out.push('past its deadline: '+k);
        if(!m) out.push('moved without being listed: '+k);
      }
    });
    b.forEach((y,k)=>{ if(!a.has(k)) out.push('added '+k); });
    return out;
  }

  /* Undo a list of moves, newest first: a task goes back to its old day only if it is still open and still on the day it was
     moved to, so anything changed since (ticked, edited, moved by hand) is left alone. Returns the courses it changed. */
  function undoMoves(cs, list){
    const touched = new Set();
    list.forEach(m=>{ const c = cs.find(x=>x.id===m.course), t = c && (c.tasks||[]).find(x=>x.id===m.id); if(!t || t.status==='done' || t.due!==m.to) return; t.due = m.from; touched.add(c); });
    return [...touched];
  }

  const api = {organizePlan, fillDays, setPlanDates, orderParts, deadlineRisks, organizeProblems, lastDayOf, sessionLast, pinHolds, undoMoves, placeOf, partInfo, PART_RE, deadlineOf, delivOf, isSession, workable, countsOn, addDays};
  if(typeof module!=='undefined' && module.exports) module.exports = api; else root.Organizer = api;
})(typeof window!=='undefined' ? window : globalThis);
