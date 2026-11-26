/* A Node stand-in for the page's day rules (js/rules.js + a profile's rules and timetable), without the calendar.
   makeEnv(today, nowMin, {busy:{'YYYY-MM-DD':[[fromMin,toMin]]}, commute:['YYYY-MM-DD'], free:{'YYYY-MM-DD':hours},
   classes:[…], profile:{…}}). The default profile is PLANNER_PROFILE, else none (the tests give their own classes). */
const fs = require('fs'), path = require('path');
const {rulesFor} = require('../page/js/profile.js');
const PROFILE_FILE = process.env.PLANNER_PROFILE || '';
const loadProfile = f => { if(!f) return {}; try{ return JSON.parse(fs.readFileSync(f, 'utf8')); }catch(e){ return {}; } };
const DEFAULT_PROFILE = loadProfile(PROFILE_FILE);
const toMin = hm => { const [h,m] = hm.split(':').map(Number); return h*60+m; };
function makeEnv(today, nowMin, o = {}){
  const P = o.profile || DEFAULT_PROFILE, R = rulesFor(P), CLASSES = Array.isArray(P.timetable) ? P.timetable : [];
  const classesOn = d => o.classes ? o.classes.filter(e=>e.d===d) : CLASSES.filter(e=>e.d===d);
  const dayTimes = d => {
    const cl = classesOn(d); if(!cl.length) return null;
    const first = Math.min(...cl.map(e=>toMin(e.s))), end = Math.max(...cl.map(e=>toMin(e.e||e.s)+(e.e?0:60)));
    return {leave:first-R.leaveBefore, home:end+R.homeAfterCommute};
  };
  const freeAtHome = (d, from) => {
    if(o.free && o.free[d]!=null && !from) return o.free[d];
    let free = [[Math.max(R.dayStart, from||0), R.dayEnd]].filter(([x,y])=>y>x);
    const cut = (a, b) => { free = free.flatMap(([x,y])=> b<=x || a>=y ? [[x,y]] : [[x,Math.min(a,y)],[Math.max(b,x),y]].filter(([p,q])=>q>p)); };
    const tm = dayTimes(d); if(tm) cut(tm.leave, tm.home);
    ((o.busy||{})[d]||[]).forEach(([a,b])=>cut(a,b));
    return free.reduce((s,[x,y])=>s+(y-x),0)/60;
  };
  return {today, nowMin: nowMin ?? R.dayStart, freeAtHome, isCommute: d => classesOn(d).length>0 || (o.commute||[]).includes(d),
    homeMin: d => (dayTimes(d)||{}).home ?? null, heavy:R.heavy, commuteCap:R.commuteCap, aheadDays:R.aheadDays, dayEnd:R.dayEnd,
    maxEarly:R.maxEarly, levelTol:R.levelTol, fixedCourses:R.waitsForWeek};
}
module.exports = {makeEnv, toMin, loadProfile, DEFAULT_PROFILE};
