/* Organizer tests. Run: node --test test/   (no packages needed) */
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../page/js/organize.js');
const {makeEnv} = require('./env.js');

/* A quiet stretch without classes (winter break), so free time is simple: 09:00 to 22:00, at most 7 h. */
const NOCLASS = {classes: []};
const MON = '2026-12-28', TUE = '2026-12-29', WED = '2026-12-30', THU = '2026-12-31', FRI = '2027-01-01';
const course = (id, deliverables, tasks) => ({id, deliverables, tasks});
const task = (id, did, due, est, more = {}) => Object.assign({id, did, title: id, due, est, status: 'todo', where: 'desk'}, more);
const run = (cs, env) => { const before = JSON.parse(JSON.stringify(cs)); const r = O.organizePlan(cs, env); return {moves: r.moves, problems: O.organizeProblems(before, cs, r.moves, env.today)}; };
const find = (cs, id) => { for(const c of cs) for(const t of c.tasks) if(t.id===id) return t; };

test('a task pulled into today and not done lands on the next today, not further away', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('a', 'd1', TUE, 2)])];
  let r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'a').due, MON, 'pulled into Monday');
  /* Tuesday: not done, so it is carried over and goes onto Tuesday (today) */
  r = run(cs, makeEnv(TUE, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'a').due, TUE);
});

test('train and metro work keeps its place when it is pulled into today', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('a', 'd1', TUE, 1.5, {where:'train'})])];
  const env = makeEnv(MON, 9*60, Object.assign({commute:[TUE]}, NOCLASS));
  const r = run(cs, env);
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'a').due, MON);
  assert.equal(find(cs, 'a').where, 'train');
  assert.equal(find(cs, 'a').back, undefined);
  assert.equal(find(cs, 'a').wasWhere, undefined);
});

test('blocked work is never pulled earlier or put on today', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('b', 'd1', THU, 1, {status:'blocked'})])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'b').due, THU);
  /* carried over and blocked: not onto today */
  find(cs, 'b').due = '2026-12-27';
  const r2 = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r2.problems, []);
  assert.notEqual(find(cs, 'b').due, MON);
});

test('a task he placed himself stays', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('p', 'd1', THU, 1, {pin:THU})])];
  run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.equal(find(cs, 'p').due, THU);
});

test('never past the deadline, and class session work by the day before', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:WED}], [task('x1', 'd1', WED, 5), task('x2', 'd1', WED, 5)]),
    course('ghost', [{id:'s1', title:'Session 4', date:THU}], [task('s', 's1', WED, 1)])];
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));   /* late in the day: nothing goes onto today */
  assert.deepEqual(r.problems, []);
  for(const id of ['x1','x2']) assert.ok(find(cs, id).due <= WED);
  assert.ok(find(cs, 's').due < THU);
});

test('tasks of one deliverable keep their order, parts in part order', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [
    task('p1', 'd1', THU, 2, {title:'Draft (part 1 of 2)'}), task('p2', 'd1', WED, 2, {title:'Draft (part 2 of 2)'})])];
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'p1').due <= find(cs, 'p2').due);
});

test('a second run changes nothing', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:'2027-01-08'}], [
    task('a', 'd1', '2027-01-07', 3), task('b', 'd1', '2027-01-07', 3), task('c', 'd1', '2027-01-08', 3)])];
  run(cs, makeEnv(MON, 9*60, NOCLASS));
  const again = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(again.moves, []);
});

test('an overloaded day hands work to a day with room', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('a', 'd1', THU, 3), task('b', 'd1', THU, 3), task('c', 'd1', THU, 3)])];
  const r = run(cs, makeEnv(MON, 21*60, Object.assign({free:{[THU]:4}}, NOCLASS)));
  assert.deepEqual(r.problems, []);
  const thu = ['a','b','c'].filter(id=>find(cs, id).due===THU).length;
  assert.ok(thu <= 1);
});

test('busy time is respected: work leaves a busy day', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('a', 'd1', WED, 2)])];
  const r = run(cs, makeEnv(MON, 21*60, Object.assign({busy:{[WED]:[[9*60, 22*60]]}}, NOCLASS)));
  assert.deepEqual(r.problems, []);
  assert.notEqual(find(cs, 'a').due, WED);
});

test('a course is planned like any other unless it is fixed', () => {
  const cs = [course('dig', [{id:'p', title:'Poster', date:FRI}], [task('d', 'p', THU, 1)])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'd').due < THU, 'pulled earlier like other work');
});

test('a course listed in fixedCourses is still never moved', () => {
  const cs = [course('x', [{id:'p', title:'Poster', date:FRI}], [task('d', 'p', THU, 1)])];
  run(cs, Object.assign(makeEnv(MON, 9*60, NOCLASS), {fixedCourses:['x']}));
  assert.equal(find(cs, 'd').due, THU);
});

test('carried-over work without room or deadline stays carried over', () => {
  const cs = [course('ct', [], [task('n', '', '2026-12-27', 3)])];
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));   /* no time left today */
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'n').due, '2026-12-27');
});

test('safety checks catch a changed place, a move past the deadline and an unlisted move', () => {
  const real = [course('ct', [{id:'d1', title:'Concept', date:WED}], [task('a', 'd1', TUE, 1)])];
  const bad = JSON.parse(JSON.stringify(real));
  bad[0].tasks[0].where = 'train'; bad[0].tasks[0].due = THU;
  const p = O.organizeProblems(real, bad, [], MON);
  assert.ok(p.some(x=>x.startsWith('changed more than the day')));
  assert.ok(p.some(x=>x.startsWith('past its deadline')));
  assert.ok(p.some(x=>x.startsWith('moved without being listed')));
});

test('undo puts back only tasks still where the organizer left them', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('a', 'd1', MON, 1), task('b', 'd1', MON, 1, {status:'done'}), task('c', 'd1', TUE, 1)])];
  const log = [{course:'ct', id:'a', from:WED, to:MON}, {course:'ct', id:'b', from:WED, to:MON}, {course:'ct', id:'c', from:WED, to:MON}];
  O.undoMoves(cs, log);
  assert.equal(find(cs, 'a').due, WED, 'still there: goes back');
  assert.equal(find(cs, 'b').due, MON, 'done since: left alone');
  assert.equal(find(cs, 'b').status, 'done');
  assert.equal(find(cs, 'c').due, TUE, 'moved by hand since: left alone');
});

test('work placed in a class stays there and does not use time at home', () => {
  /* Tuesday: 4 h in class on top of a full 7 h day at home. Nothing moves off Tuesday, and today still gets topped up. */
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [
    task('c1', 'd1', TUE, 4, {where:'class', pin:TUE}),
    task('h1', 'd1', TUE, 7),
  ])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'c1').due, TUE, 'class work is never moved');
  assert.equal(O.placeOf(find(cs, 'c1'), MON), 'class');
  assert.ok(!r.moves.some(m=>m.t.id==='c1'));
});

test('class work not done that day is carried over like desk work', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('c1', 'd1', MON, 2, {where:'class', pin:MON})])];
  assert.equal(O.placeOf(find(cs, 'c1'), TUE), 'desk', 'past its class it counts as desk work');
  const r = run(cs, makeEnv(TUE, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'c1').due, TUE, 'carried onto today');
});

test('carried-over work never goes past the next task of its deliverable', () => {
  /* 4 Nov 2026: a carried-over task went to the delivery day, after "Package and send". Here every day is full,
     so it has no room before the next step and stays carried over. */
  const SAT = '2027-01-02';
  const cs = [course('void', [{id:'e', title:'Delivery', date:SAT}], [
    task('late', 'e', '2026-12-27', 2), task('next', 'e', WED, 7), task('pack', 'e', FRI, 1)]),
    course('ct', [{id:'d1', title:'Concept', date:SAT}], [task('f1', 'd1', TUE, 7, {pin:TUE}), task('f0', 'd1', MON, 7, {pin:MON})])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'late').due <= WED, 'by the next step, got ' + find(cs, 'late').due);
});

test('carried-over work he started (doing) stays on today, even when today is full', () => {
  const cs = [course('void', [{id:'e', title:'Delivery', date:FRI}], [task('started', 'e', '2026-12-27', 2, {status:'doing'}), task('later', 'e', THU, 1)]),
    course('ct', [{id:'d1', title:'Concept', date:FRI}], [task('full', 'd1', MON, 7, {pin:MON})])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'started').due, MON);
  /* the same task as todo has no room today and moves to a gap by the next step */
  const cs2 = JSON.parse(JSON.stringify(cs)); find(cs2, 'started').status = 'todo'; find(cs2, 'started').due = '2026-12-27';
  const r2 = run(cs2, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r2.problems, []);
  assert.ok(find(cs2, 'started').due > MON && find(cs2, 'started').due <= THU);
});

test('a task planned after a deadline that is still ahead is pulled back before it', () => {
  const cs = [course('dig', [{id:'p', title:'Poster', date:WED}], [task('fix', 'p', MON, 1, {status:'done'}), task('hand', 'p', FRI, 0.5)]),
              course('ct', [{id:'d1', title:'Concept', date:THU}], [task('a', 'd1', FRI, 1)])];
  const r = run(cs, makeEnv(MON, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'hand').due <= WED, 'poster hand-in by Wednesday');
  assert.ok(find(cs, 'a').due <= THU, 'concept work by Thursday');
});

test('a late task whose deadline is today goes onto today', () => {
  const cs = [course('dig', [{id:'p', title:'Poster', date:MON}], [task('hand', 'p', FRI, 0.5)])];
  const r = run(cs, makeEnv(MON, 14*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'hand').due, MON);
});

test('work planned after a deadline already past goes onto today and stays there as carried over; work he placed stays', () => {
  const cs = [course('inf', [{id:'m', title:'Mock exam', date:MON}], [task('late', 'm', THU, 2), task('mine', 'm', FRI, 1, {pin:FRI}), task('stuck', 'm', THU, 1, {status:'blocked'})])];
  let r = run(cs, makeEnv(TUE, 9*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'late').due, TUE);
  assert.equal(find(cs, 'mine').due, FRI);
  assert.equal(find(cs, 'stuck').due, THU, 'blocked work is never put on today');
  /* not done Tuesday: Wednesday it is carried over onto today again, never to a later day */
  r = run(cs, makeEnv(WED, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.equal(find(cs, 'late').due, TUE, 'stays as carried over');
});

test('train or metro work on a day without a commute counts as time at home and can be moved off a full day', () => {
  const cs = [course('mt', [{id:'d1', title:'Review', date:'2027-01-15'}], [task('home', 'd1', THU, 5, {pin:THU}), task('read', 'd1', THU, 3, {where:'phone'})]),];
  cs[0].tasks.reverse();   /* reading after the pinned desk work in the list does not matter: the day is over 7 h either way */
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.notEqual(find(cs, 'read').due, THU, 'the 3 h reading left the 8 h day');
  assert.equal(find(cs, 'read').where, 'phone', 'where never changes');
});

test('a day well over the even share hands work to a lighter later day when it cannot go earlier', () => {
  const cs = [course('ct', [{id:'d1', title:'Concept', date:'2027-01-08'}], [task('p', 'd1', THU, 0.5, {pin:THU}), task('a', 'd1', THU, 3), task('b', 'd1', THU, 3)])];
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok([find(cs, 'a').due, find(cs, 'b').due].some(d=>d > THU), 'one of them moved after Thursday (6.5 h was under 7 h, so nothing moved before)');
  const r2 = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.equal(r2.moves.length, 0, 'stable on a second run');
});

test('a big deliverable may start more than 14 days before its deadline', () => {
  const DL = '2027-01-17';   /* 20 days after Monday */
  const big = Array.from({length:20}, (_, i)=>task('big'+i, 'd1', DL, 2));
  const cs = [course('laga', [{id:'d1', title:'Report', date:DL}], big),
    course('war', [{id:'e1', title:'Essay', date:'2027-01-12'}], [task('small', 'e1', '2027-01-12', 2)])];
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'big0').due < O.addDays(DL, -14), 'first step of the 40 h report starts more than 14 days early: '+find(cs, 'big0').due);
  assert.ok(find(cs, 'small').due <= '2027-01-12', 'the essay still makes its deadline');
  for(let i = 1; i < 20; i++) assert.ok(find(cs, 'big'+(i-1)).due <= find(cs, 'big'+i).due, 'order kept');
});

test('work without a date plans to its planning date: spread like dated work, never past it, and the date does not creep', () => {
  const SAT = '2027-01-02', NEXT = '2027-01-09';
  const cs = [course('inf', [{id:'x', title:'Exam', date:null, state:'tbd'}], [task('r1', 'x', SAT, 3), task('p', 'x', SAT, 4, {pin:SAT}), task('r2', 'x', NEXT, 3)])];
  assert.deepEqual(O.setPlanDates(cs).map(c=>c.id), ['inf']);
  assert.equal(cs[0].deliverables[0].planBy, NEXT, 'planning date: the last day its work is planned on');
  const r = run(cs, makeEnv(MON, 21*60, NOCLASS));
  assert.deepEqual(r.problems, []);
  assert.ok(find(cs, 'r1').due < SAT, 'the 7 h Saturday hands work to an earlier day');
  assert.ok(find(cs, 'r2').due <= NEXT, 'never past the planning date');
  /* the last task was pulled earlier: the planning date stays */
  find(cs, 'r2').due = '2027-01-05';
  assert.deepEqual(O.setPlanDates(cs), []);
  assert.equal(cs[0].deliverables[0].planBy, NEXT);
  /* planned later (he drags it): it grows */
  find(cs, 'r2').due = '2027-01-12'; find(cs, 'r2').pin = '2027-01-12';
  O.setPlanDates(cs); assert.equal(cs[0].deliverables[0].planBy, '2027-01-12');
  /* a real date wins */
  cs[0].deliverables[0].date = '2027-01-20'; assert.equal(O.deadlineOf(cs[0], find(cs, 'r1')), '2027-01-20');
});

test('parts of one task get their days back in part order, pinned parts too', () => {
  const T = (id, n, due, more) => task(id, 'd1', due, 1, Object.assign({title:'Read Adorno (part '+n+' of 3)'}, more||{}));
  const cs = [course('war', [{id:'d1', title:'Talk', date:FRI}], [T('p2', 2, MON, {pin:MON, where:'phone'}), T('p3', 3, WED), T('p1', 1, TUE, {pin:TUE})])];
  assert.equal(O.orderParts(cs).length, 1);
  assert.deepEqual(['p1','p2','p3'].map(id=>find(cs, id).due), [MON, TUE, WED]);
  assert.equal(find(cs, 'p1').pin, MON); assert.equal(find(cs, 'p1').where, 'phone');
  assert.equal(find(cs, 'p2').pin, TUE); assert.equal(find(cs, 'p2').where, 'desk');
  assert.equal(find(cs, 'p3').pin, undefined);
  assert.equal(O.orderParts(cs).length, 0, 'nothing to do the second time');
});

/* New work (18 Nov 2026): spread over the free days before the deadline, not left on the deadline day. */
const item = (est, more = {}) => Object.assign({course:'ct', did:'d1', est, where:'desk', last:FRI}, more);

test('new work spreads evenly in order before the deadline', () => {
  const r = O.fillDays([course('ct', [], [])], [item(2), item(2), item(2), item(2)], makeEnv('2026-12-27', 9*60, NOCLASS));
  assert.equal(r.fit, true);
  assert.deepEqual(r.days, [MON, TUE, WED, THU]);
});

test('a full-day block only goes on a day with room for all of it', () => {
  const cs = [course('ct', [], [task('a', 'd1', MON, 1)])];
  const r = O.fillDays(cs, [item(7)], makeEnv('2026-12-27', 9*60, NOCLASS));
  assert.deepEqual(r, {days:[TUE], fit:true});
});

test('parts never go before the part ahead of them', () => {
  const cs = [course('ct', [], [task('a', 'd1', MON, 7)])];
  const r = O.fillDays(cs, [item(7, {last:WED}), item(1, {last:WED})], makeEnv('2026-12-27', 9*60, NOCLASS));
  assert.deepEqual(r.days, [TUE, WED]);
});

test('work that cannot fit is reported and stays on its last day', () => {
  const r = O.fillDays([course('ct', [], [])], [item(7, {last:MON}), item(7, {last:MON})], makeEnv('2026-12-27', 9*60, NOCLASS));
  assert.equal(r.fit, false);
  assert.deepEqual(r.days, [MON, MON]);
});

test('train work only goes on commute days, within the commute limit', () => {
  const env = makeEnv('2026-12-27', 9*60, {classes:[], commute:[TUE]});
  const r = O.fillDays([course('ct', [], [])], [item(2, {where:'train'})], env);
  assert.deepEqual(r, {days:[TUE], fit:true});
});

test('commute work already on a day counts toward its limit', () => {
  const cs = [course('ct', [], [task('a', 'd1', MON, 2, {where:'train'})])];
  const r = O.fillDays(cs, [item(7)], makeEnv('2026-12-27', 9*60, {classes:[], commute:[MON]}));
  assert.deepEqual(r, {days:[TUE], fit:true});
});

/* 19 Nov 2026 stress test: train work on a day without a commute counted as desk work, was moved by desk room onto a commute
   day and put 4.75 h of laptop work on a 2 h train ride. Room is checked for where the work counts on the day it goes to. */
test('train work moved onto a commute day stays within the train limit', () => {
  const cs = [course('mg', [{id:'p', title:'Report', date:FRI}], [task('mg', 'p', WED, 1, {where:'train'})]),
    course('war', [{id:'e', title:'Essay', date:FRI}], [task('a', 'e', TUE, 1.25, {where:'train'}), task('b', 'e', TUE, 2.5, {where:'train'})])];
  const env = makeEnv(MON, 9*60, Object.assign({commute:[WED], busy:{[TUE]:[[0, 24*60]]}}, NOCLASS));
  const r = run(cs, env);
  assert.deepEqual(r.problems, []);
  const onWed = cs.flatMap(c=>c.tasks).filter(t=>t.due===WED && t.where==='train').reduce((s,t)=>s+t.est, 0);
  assert.ok(onWed <= 2 + 1e-6, 'train on Wednesday: '+onWed+' h');
  assert.notEqual(find(cs, 'a').due, TUE); assert.notEqual(find(cs, 'b').due, TUE);
});

test('filling gaps keeps commute work on commute days', () => {
  const cs = [course('ct', [{id:'d', title:'Slides', date:FRI}], [task('s', 'd', THU, 1.5, {where:'train'})])];
  const env = makeEnv(MON, 9*60, Object.assign({commute:[THU]}, NOCLASS));
  run(cs, env);
  assert.ok(env.isCommute(find(cs, 's').due) || find(cs, 's').due===MON, 'on '+find(cs, 's').due);
});
