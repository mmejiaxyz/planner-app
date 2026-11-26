/* Deadline risk tests (deadlineRisks). Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../page/js/organize.js');
const {makeEnv} = require('./env.js');
const NOCLASS = {classes: []};
const MON = '2026-12-28', TUE = '2026-12-29', WED = '2026-12-30', THU = '2026-12-31';
const course = (id, deliverables, tasks) => ({id, deliverables, tasks});
const task = (id, did, due, est, more = {}) => Object.assign({id, did, title: id, due, est, status: 'todo', where: 'desk'}, more);

test('enough time: no risk', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:TUE}], [task('a','d1',MON,4), task('b','d1',TUE,4)])];
  assert.deepEqual(O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS)), []);
});

test('more work than time before the deadline: short by the difference', () => {
  /* Mon and Tue from 09:00: 7 h each = 14 h; 18 h of work */
  const cs = [course('ct', [{id:'d1', title:'Concept', date:TUE}], [task('a','d1',MON,9), task('b','d1',TUE,9)])];
  const r = O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(r.length, 1); assert.equal(r[0].did, 'd1'); assert.equal(r[0].short, 4); assert.equal(r[0].inherited, false);
});

test('today counts only the time left now and work already done today', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:MON}], [task('a','d1',MON,3), task('x','d1',MON,5,{status:'done', doneOn:MON})])];
  /* 20:00: 2 h left in the day, but 5 h already done of the 7 h day: 2 h room, 3 h open */
  const r = O.deadlineRisks(cs, makeEnv(MON, 20*60, NOCLASS));
  assert.equal(r.length, 0, 'a 1 h shortfall is within tolerance');
  const r2 = O.deadlineRisks(cs, makeEnv(MON, 20*60, NOCLASS), 0.5);
  assert.equal(r2[0].short, 1);
});

test('a later deadline short only because of an earlier one is marked inherited', () => {
  const cs = [course('ct', [{id:'d1', title:'A', date:MON}, {id:'d2', title:'B', date:TUE}], [task('a','d1',MON,10), task('b','d2',TUE,7)])];
  const r = O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(r.length, 2); assert.equal(r[0].short, 3); assert.equal(r[1].short, 3); assert.equal(r[1].inherited, true);
});

test('commute time only helps train and metro work', () => {
  const env = makeEnv(MON, 9*60, Object.assign({commute:[MON, TUE]}, NOCLASS));
  const desk = [course('ct', [{id:'d1', title:'A', date:TUE}], [task('a','d1',MON,16)])];
  assert.equal(O.deadlineRisks(desk, env)[0].short, 2, 'desk work cannot use the train');
  const train = [course('ct', [{id:'d1', title:'A', date:TUE}], [task('a','d1',MON,14), task('b','d1',MON,2,{where:'train'})])];
  assert.deepEqual(O.deadlineRisks(train, env), []);
});

test('session work is due the day before; passed deadlines, done work and class work are left out', () => {
  const cs = [course('ghost', [{id:'s', title:'Session 3', date:WED}, {id:'old', title:'Old', date:'2026-12-20'}], [
    task('a','s',MON,10), task('b','s',TUE,5), task('c','old',MON,30), task('d','s',MON,9,{status:'done'}), task('e','s',TUE,9,{where:'class', pin:TUE})])];
  const r = O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(r.length, 0, 'by Tue: 14 h of time, 15 h of work is 1 h short, within tolerance');
  assert.equal(O.deadlineRisks(cs, makeEnv(MON, 9*60, NOCLASS), 0.5)[0].short, 1);
});

test('work done ahead today does not make today look full (14 Nov 2026)', () => {
  /* 12.75 h done today, 14:45, a 1.25 h reading for tomorrow's session: there is time today */
  const cs = [course('ghost', [{id:'s3', title:'Session 3', date:TUE}], [task('r','s3',MON,1.25,{where:'phone'}), task('x','s3',MON,12.75,{status:'done', doneOn:MON})])];
  assert.deepEqual(O.deadlineRisks(cs, makeEnv(MON, 14*60+45, NOCLASS)), []);
});

test('session work pinned on the session day is pulled back to its last day, and the safety checks pass', () => {
  const real = [course('ghost', [{id:'s3', title:'Session 3', date:TUE}], [task('r','s3',TUE,1.25,{pin:TUE})])];
  const copy = JSON.parse(JSON.stringify(real));
  const env = makeEnv(MON, 14*60+45, NOCLASS);
  const {moves} = O.organizePlan(copy, env);
  assert.equal(copy[0].tasks[0].due, MON); assert.equal(copy[0].tasks[0].pin, undefined);
  assert.deepEqual(O.organizeProblems(real, copy, moves, MON), []);
  assert.equal(O.lastDayOf(real[0], real[0].tasks[0]), MON);
});

test('a pin before the last day still holds', () => {
  const real = [course('ghost', [{id:'s3', title:'Session 3', date:THU}], [task('r','s3',WED,1.25,{pin:WED})])];
  const copy = JSON.parse(JSON.stringify(real));
  O.organizePlan(copy, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(copy[0].tasks[0].due, WED);
});

/* 24 Nov 2026: an online class at 20:00 left the whole class day out of the room for its reading */
test('session work for an evening class may be done on the class day', () => {
  const ses = [{d:WED, s:'20:00', e:'22:30', o:'online'}], morning = [{d:WED, s:'10:00', e:'12:00', o:'online'}];
  const mk = sessions => [Object.assign(course('tnc', [{id:'s1', title:'Session 30 Dec · Topic', date:WED}], [task('r1','s1',MON,6), task('r2','s1',TUE,6), task('r3','s1',TUE,6)]), {sessions})];
  assert.equal(O.sessionLast(mk(ses)[0], mk(ses)[0].deliverables[0]), WED);
  assert.equal(O.sessionLast(mk(morning)[0], mk(morning)[0].deliverables[0]), TUE);
  assert.equal(O.lastDayOf(mk(ses)[0], mk(ses)[0].tasks[0]), WED);
  /* Mon + Tue = 14 h for 18 h: short with a morning class, not with an evening one (Wed adds 7 h) */
  assert.equal(O.deadlineRisks(mk(morning), makeEnv(MON, 9*60, NOCLASS)).length, 1);
  assert.equal(O.deadlineRisks(mk(ses), makeEnv(MON, 9*60, NOCLASS)).length, 0);
});
