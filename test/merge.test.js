// Phone changes merged into a plan the Mac may have changed since. Run: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { merge3, applyOps } = require('../page/js/merge.js');

const course = () => ({ id: 'dig', name: 'Course D', v: 2,
  deliverables: [{ id: 'd1', title: 'Poster', date: '2026-11-12', state: 'set' }],
  tasks: [
    { id: 't1', did: 'd1', title: 'Sketch', due: '2026-11-09', est: 1, status: 'todo', where: 'desk' },
    { id: 't2', did: 'd1', title: 'Layout', due: '2026-11-10', est: 2, status: 'todo', where: 'train' },
  ] });

test('a tick on the phone survives organizer moves on the Mac', () => {
  const base = course();
  const mine = course(); Object.assign(mine.tasks[0], { status: 'done', doneOn: '2026-11-08', spent: 1.5 });
  const theirs = course(); theirs.tasks[1].due = '2026-11-11';            // the Mac moved another task
  const out = merge3(base, mine, theirs);
  assert.equal(out.tasks[0].status, 'done');
  assert.equal(out.tasks[0].spent, 1.5);
  assert.equal(out.tasks[0].doneOn, '2026-11-08');
  assert.equal(out.tasks[1].due, '2026-11-11');
});

test('new tasks on the Mac are kept, a task the phone removed goes', () => {
  const base = course();
  const mine = course(); mine.tasks = mine.tasks.filter(t => t.id !== 't2');
  const theirs = course(); theirs.tasks.push({ id: 't3', did: 'd1', title: 'Print', due: '2026-11-11', est: 1, status: 'todo', where: 'desk' });
  const out = merge3(base, mine, theirs);
  assert.deepEqual(out.tasks.map(t => t.id), ['t1', 't3']);
});

test('a field the phone removed is removed (unticking clears spent)', () => {
  const base = course(); Object.assign(base.tasks[0], { status: 'done', spent: 2, doneOn: '2026-11-08' });
  const mine = course();                                                   // unticked: no spent, no doneOn
  const theirs = course(); Object.assign(theirs.tasks[0], { status: 'done', spent: 2, doneOn: '2026-11-08' }); theirs.note = 'mac note';
  const out = merge3(base, mine, theirs);
  assert.equal(out.tasks[0].status, 'todo');
  assert.ok(!('spent' in out.tasks[0]));
  assert.equal(out.note, 'mac note');
});

test('a task the Mac removed stays removed even if the phone edited it', () => {
  const base = course();
  const mine = course(); mine.tasks[1].status = 'done';
  const theirs = course(); theirs.tasks = theirs.tasks.slice(0, 1);
  assert.deepEqual(merge3(base, mine, theirs).tasks.map(t => t.id), ['t1']);
});

test('same field changed on both sides: the phone wins', () => {
  const base = course();
  const mine = course(); mine.tasks[0].status = 'done';
  const theirs = course(); theirs.tasks[0].status = 'doing';
  assert.equal(merge3(base, mine, theirs).tasks[0].status, 'done');
});

test('no change on the phone returns the Mac version untouched', () => {
  const theirs = course(); theirs.tasks[0].due = '2026-11-20';
  assert.deepEqual(merge3(course(), course(), theirs), theirs);
});

test('applyOps shows pending phone changes on top of a newer snapshot, in order', () => {
  const plan = { courses: [course()], flags: [] };
  plan.courses[0].tasks[1].due = '2026-11-11';
  const b0 = course();
  const m1 = course(); m1.tasks[0].status = 'done';
  const m2 = course(); m2.tasks[0].status = 'done'; m2.tasks[1].status = 'doing';
  const out = applyOps(plan, [
    { kind: 'set', path: 'courses/dig', base: b0, data: m1 },
    { kind: 'note', text: 'ignored here' },
    { kind: 'set', path: 'courses/dig', base: m1, data: m2 },
    { kind: 'set', path: 'days/2026-11-09', base: null, data: { id: '2026-11-09', busy: [] } },
  ]);
  const t = out.courses[0].tasks;
  assert.equal(t[0].status, 'done');
  assert.equal(t[1].status, 'doing');
  assert.equal(t[1].due, '2026-11-11');
  assert.equal(out.days[0].id, '2026-11-09');
  assert.equal(plan.courses[0].tasks[0].status, 'todo', 'input is not changed');
});
