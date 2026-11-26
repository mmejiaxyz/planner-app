/* The profile: who uses the planner, where, which term, their own rules, course colours and their timetable.
   It is data, not code: the `profile/me` document of the plan (a top-level `profile` list in plan.json), read on load
   before the first render (main.js) and applied here. Code never names a person, a school or a course; it reads these.
   A plan without a profile runs on the defaults below and on RULES_CFG.

   Shape (every field optional):
   { id:"me", v:1,
     name:"first name for sign-offs", institution:"school or employer", country:"", tz:"Area/City", langs:["en"],
     term:{start:"YYYY-MM-DD", end:"YYYY-MM-DD"},
     places:[{id, name, short, commute:true, words:["campus", …]}],   // places[0]: the main place, a commute away
     rules:{…RULES_CFG keys to override…},
     hues:{courseId:"#hex"},
     timetable:[{d, s, e, c, t, r, o?}] }                              // classes and fixed events, local time
*/
const PROFILE_V = 1;
const RULES_DEFAULTS = JSON.parse(JSON.stringify(typeof RULES_CFG!=='undefined' ? RULES_CFG : require('./rules.js')));
let PROFILE = {};
const CLASSES = [];                 // the timetable, filled from PROFILE.timetable (shared array: views keep their reference)
let TERM_START = '', TERM_END = '';
const PROFILE_HOOKS = [];           // later scripts register what they derive from the profile (onProfile)
const onProfile = f => { PROFILE_HOOKS.push(f); try{ f(); }catch(e){} };

/* pure: the rules a profile gives (defaults, then its overrides of known keys only) */
function rulesFor(p){
  const out = JSON.parse(JSON.stringify(RULES_DEFAULTS)), r = (p && p.rules) || {};
  Object.keys(r).forEach(k=>{ if(k in out && typeof r[k]===typeof out[k] && Array.isArray(r[k])===Array.isArray(out[k])) out[k] = r[k]; });
  return out;
}
const profileDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/* No term in the profile: the half year around today (winter Oct–Mar, summer Apr–Sep). */
function termGuess(today){
  const y = +today.slice(0,4), m = +today.slice(5,7);
  if(m >= 4 && m <= 9) return {start:y+'-04-01', end:y+'-09-30'};
  const s = m >= 10 ? y : y-1; return {start:s+'-10-01', end:(s+1)+'-03-31'};
}

function applyProfile(p, today){
  PROFILE = (p && typeof p==='object') ? JSON.parse(JSON.stringify(p)) : {};
  const r = rulesFor(PROFILE); Object.keys(RULES_CFG).forEach(k=>{ delete RULES_CFG[k]; }); Object.assign(RULES_CFG, r);
  CLASSES.length = 0;
  (Array.isArray(PROFILE.timetable) ? PROFILE.timetable : []).forEach(e=>{ if(e && profileDate(e.d) && e.s && e.c) CLASSES.push(e); });
  const t = PROFILE.term || {}, g = termGuess(today || new Date().toISOString().slice(0,10));
  TERM_START = profileDate(t.start) ? t.start : g.start;
  TERM_END = profileDate(t.end) && t.end > TERM_START ? t.end : g.end;
  PROFILE_HOOKS.forEach(f=>{ try{ f(); }catch(e){ console.warn('profile hook', e); } });
}

/* ---------- what the rest of the page reads ---------- */
const mainPlace = () => (Array.isArray(PROFILE.places) && PROFILE.places[0]) || {id:'main', name:'Campus', short:'campus', commute:true, words:[]};
const placeShort = () => mainPlace().short || mainPlace().name;
const profileTZ = () => PROFILE.tz || (typeof Intl!=='undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
const profileName = () => PROFILE.name || '';
const profileInstitution = () => [PROFILE.institution, PROFILE.country].filter(Boolean).join(', ');
const profileHue = id => (PROFILE.hues || {})[id] || '';
/* a place text that names the main place (its name, short name or words): getting home from there takes the commute */
const atMainPlace = text => { const p = mainPlace(), w = [p.name, p.short].concat(p.words||[]).filter(x=>x && String(x).length>=3);
  const t = String(text||'').toLowerCase(); return w.some(x=>new RegExp('(^|[^a-z0-9äöüß])'+String(x).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9äöüß])').test(t)); };

if(typeof module!=='undefined' && module.exports) module.exports = {rulesFor, termGuess, PROFILE_V};
