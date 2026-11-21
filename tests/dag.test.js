import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow, WorkflowError } from '../src/dag.js';
import { ETL, layered } from '../src/samples.js';

const wf = (tasks) => Workflow.fromObject({ name: 't', tasks });

test('topo order respects dependencies', () => {
  const w = Workflow.fromObject(ETL);
  const pos = new Map(w.topoOrder().map((t, i) => [t, i]));
  assert.equal(pos.size, 11);
  for (const t of w.tasks.values()) for (const d of t.deps) assert.ok(pos.get(d) < pos.get(t.id));
});

test('cycle rejected', () => {
  assert.throws(
    () => wf([{ id: 'a', duration: 1, deps: ['b'] }, { id: 'b', duration: 1, deps: ['a'] }]),
    { name: 'WorkflowError', message: /cycle/ });
});

test('unknown dependency rejected', () => {
  assert.throws(() => wf([{ id: 'a', duration: 1, deps: ['zz'] }]), /unknown/);
});

test('self dependency and duplicate id rejected', () => {
  assert.throws(() => wf([{ id: 'a', duration: 1, deps: ['a'] }]), WorkflowError);
  assert.throws(() => wf([{ id: 'a', duration: 1 }, { id: 'a', duration: 1 }]), /duplicate/);
});

test('bad durations rejected', () => {
  for (const bad of [0, -1, '3', null, true, NaN, Infinity]) {
    assert.throws(() => wf([{ id: 'a', duration: bad }]), WorkflowError, `duration ${String(bad)}`);
  }
});

test('critical path of etl is 26 via the train chain', () => {
  const { length, tasks } = Workflow.fromObject(ETL).criticalPath();
  // extract_orders 4 + clean 2 + join 5 + features 6 + train 8 + publish 1
  assert.equal(length, 26);
  assert.deepEqual(tasks, ['extract_orders', 'clean_orders', 'join', 'features', 'train', 'publish']);
});

test('critical path of a diamond', () => {
  const w = wf([{ id: 'a', duration: 1 }, { id: 'b', duration: 5, deps: ['a'] },
    { id: 'c', duration: 2, deps: ['a'] }, { id: 'd', duration: 1, deps: ['b', 'c'] }]);
  assert.deepEqual(w.criticalPath(), { length: 7, tasks: ['a', 'b', 'd'] });
});

test('layered generator is deterministic and acyclic', () => {
  assert.deepEqual(layered(3), layered(3));
  assert.notDeepEqual(layered(3), layered(4));
  for (let seed = 0; seed < 20; seed++) Workflow.fromObject(layered(seed));
});

test('toObject / fromObject round trip', () => {
  const w = Workflow.fromObject(ETL);
  assert.deepEqual(Workflow.fromObject(w.toObject()).tasks, w.tasks);
});
