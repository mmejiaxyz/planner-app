/* Dry-run the organizer on a copy of plan.json and print the moves. Nothing is written.
   Usage: node tools/dryrun.js [plan.json] [YYYY-MM-DD] [HH:MM]
   Defaults: ~/Library/Application Support/Planner/plan.json, today, now.
   Calendar events are not known here (they come from Calendar.app in the app), so days with events may get a little more. */
const fs = require('fs'), os = require('os'), path = require('path');
const O = require('../page/js/organize.js');
const {makeEnv, toMin, DEFAULT_PROFILE} = require('../test/env.js');
const file = process.argv[2] || path.join(os.homedir(), 'Library/Application Support/Planner/plan.json');
const now = new Date(), pad = n => String(n).padStart(2,'0');
const today = process.argv[3] || now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
const at = process.argv[4] ? toMin(process.argv[4]) : (process.argv[3] ? 9*60 : Math.ceil((now.getHours()*60+now.getMinutes())/15)*15);
/* a malformed day ("2026-11-26 10:00" as one argument) made the organizer loop forever */
if(!/^\d{4}-\d{2}-\d{2}$/.test(today) || (process.argv[4] && !/^\d{1,2}:\d{2}$/.test(process.argv[4]))){ console.error('Usage: node tools/dryrun.js [plan.json] [YYYY-MM-DD] [HH:MM]'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const busy = {}; (plan.days||[]).forEach(d=>(d.busy||[]).forEach(b=>{ (busy[d.id] = busy[d.id]||[]).push([b.from, b.to]); }));
O.orderParts(plan.courses);     /* as the app does before each run */
O.setPlanDates(plan.courses);
const real = plan.courses, copy = JSON.parse(JSON.stringify(real));
/* classes he will not attend (days/<day>.skip) take no time, as in the app */
const skip = {}; (plan.days||[]).forEach(d=>(d.skip||[]).forEach(x=>{ if(x.c) (skip[d.id] = skip[d.id]||[]).push(x.c+'|'+x.s); }));
/* the plan's own profile (timetable, rules), else the default one (test/env.js) */
const profile = (Array.isArray(plan.profile) ? plan.profile.find(x=>x.id==='me') : plan.profile) || DEFAULT_PROFILE;
/* course sessions (set up in the app): at the main place they are classes; online and nearby ones take their hours (+1 h each way nearby) */
const own = plan.courses.flatMap(c=>(c.sessions||[]).map(e=>Object.assign({c:c.id}, e)));
own.filter(e=>e.o).forEach(e=>{ const a = toMin(e.s), b = e.e ? toMin(e.e) : a + 90, w = e.o==='near' ? 60 : 0; (busy[e.d] = busy[e.d]||[]).push([a - w, b + w]); });
const classes = (profile.timetable||[]).concat(own.filter(e=>!e.o)).filter(e=>!(skip[e.d]||[]).includes(e.c+'|'+e.s));
const env = makeEnv(today, at, {busy, classes, profile});
const {moves} = O.organizePlan(copy, env);
const problems = O.organizeProblems(real, copy, moves, today);
const wd = s => new Date(s+'T12:00').toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
console.log('Dry run for '+wd(today)+' at '+pad(Math.floor(at/60))+':'+pad(at%60)+' on '+file);
console.log(moves.length ? moves.length+' move(s):' : 'No moves.');
moves.slice().sort((a,b)=>a.to.localeCompare(b.to)).forEach(m=>console.log('  '+wd(m.from)+' -> '+wd(m.to)+'  ['+m.c.id+'] '+m.t.title+' ('+m.t.est+' h'+(m.t.where!=='desk'?', '+m.t.where:'')+')'+(m.today?'  today top-up':m.carried?'  carried over':'')));
console.log(problems.length ? 'SAFETY CHECK FAILED, would not apply:\n  '+problems.join('\n  ') : 'Safety checks: passed.');
const risks = O.deadlineRisks(real, env);
console.log(risks.length ? 'Deadlines short of time:' : 'Every deadline has enough time.');
risks.forEach(r=>console.log('  '+wd(r.date)+'  ['+r.course+'] '+r.title+': '+r.short+' h short ('+r.work+' h of work due by then, '+r.room+' h of time)'+(r.inherited?'  (from earlier deadlines)':'')));
