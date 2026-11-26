/* Priority deadlines (26 Nov 2026, the user's rule: "I work from highers prio down, so if things are missed or delayed the lower
   impacting are missed"). Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../page/js/organize.js');
const {makeEnv} = require('./env.js');
const NOCLASS = {classes: []};
const MON = '2026-12-28', TUE = '2026-12-29', WED = '2026-12-30', THU = '2026-12-31', FRI = '2027-01-01';
const course = (id, deliverables, tasks) => ({id, deliverables, tasks});
const task = (id, did, due, est, more = {}) => Object.assign({id, did, title: id, due, est, status: 'todo', where: 'desk'}, more);

test('a shortage lands on the lower-priority deadline, not the priority one', () => {
  /* Mon to Wed from 09:00: 21 h. Normal deadline Tue (7 h), priority deadline Wed (18 h): 25 h of work */
  const cs = [course('a', [{id:'low', title:'Low', date:TUE}], [task('l1','low',TUE,7)]),
              course('b', [{id:'top', title:'Top', date:WED, prio:1}], [task('t1','top',WED,9), task('t2','top',WED,9)])];
  const r = O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(r.length, 1); assert.equal(r[0].did, 'low'); assert.equal(r[0].byPrio, true);
  /* without the priority the earlier deadline fits and the later one is short */
  delete cs[1].deliverables[0].prio;
  const r2 = O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(r2.length, 1); assert.equal(r2[0].did, 'top');
});

test('priority work takes the earlier day; lower work makes way, never past its deadline', () => {
  /* Tue is full with low-priority work (deadline Fri); priority work sits on Thu (deadline Thu) */
  const cs = [course('a', [{id:'low', title:'Low', date:FRI}], [task('l1','low',TUE,7)]),
              course('b', [{id:'top', title:'Top', date:THU, prio:1}], [task('t1','top',THU,7)])];
  const env = makeEnv(MON, 23*60, NOCLASS);
  const {moves} = O.organizePlan(cs, env);
  const t1 = cs[1].tasks[0], l1 = cs[0].tasks[0];
  assert.ok(t1.due < THU, 'priority work moved earlier: '+t1.due);
  assert.ok(l1.due <= FRI, 'low work stays by its deadline: '+l1.due);
  /* a second run leaves it */
  assert.equal(O.organizePlan(cs, env).moves.length, 0);
});

test('lower work never goes past its own deadline to make room', () => {
  /* low work due Tue on Tue; priority work due Wed on Wed: low cannot move later, so priority stays */
  const cs = [course('a', [{id:'low', title:'Low', date:TUE}], [task('l1','low',TUE,7)]),
              course('b', [{id:'top', title:'Top', date:WED, prio:1}], [task('t1','top',WED,7)])];
  O.organizePlan(cs, makeEnv(MON, 23*60, NOCLASS));
  assert.ok(cs[0].tasks[0].due <= TUE);
});
