import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../src/dag.js';
import { runWorkflow, renderText } from '../src/runner.js';
import { ETL, ETL_FAILURE, layered } from '../src/samples.js';

const spans = (res) => new Map(res.timeline.map((s) => [s.task, s]));
const sumDur = (w) => [...w.tasks.values()].reduce((a, t) => a + t.duration, 0);

test('dependencies respected for 1, 2, 3 and 8 workers', () => {
  for (const wk of [1, 2, 3, 8]) {
    const w = Workflow.fromObject(ETL);
    const sp = spans(runWorkflow(w, wk));
    for (const t of w.tasks.values()) {
      for (const d of t.deps) assert.ok(sp.get(t.id).start >= sp.get(d).end, `${d} -> ${t.id}`);
    }
  }
});

test('no overlap on one worker', () => {
  for (let seed = 0; seed < 10; seed++) {
    const res = runWorkflow(Workflow.fromObject(layered(seed)), 3);
    const by = new Map();
    for (const s of res.timeline) {
      if (!by.has(s.worker)) by.set(s.worker, []);
      by.get(s.worker).push([s.start, s.end]);
    }
    for (const iv of by.values()) {
      iv.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < iv.length; i++) assert.ok(iv[i - 1][1] <= iv[i][0]);
    }
  }
});

test('one worker makespan equals the sum of durations (44 for etl)', () => {
  const w = Workflow.fromObject(ETL);
  assert.equal(runWorkflow(w, 1).makespan, sumDur(w));
  assert.equal(sumDur(w), 44);
});

test('many workers reach the critical path (26 for etl)', () => {
  assert.equal(runWorkflow(Workflow.fromObject(ETL), 20).makespan, 26);
});

test('makespan respects both lower bounds', () => {
  for (let seed = 0; seed < 10; seed++) {
    const w = Workflow.fromObject(layered(seed));
    for (const wk of [1, 2, 4]) {
      const r = runWorkflow(w, wk);
      assert.ok(r.makespan >= w.criticalPath().length);
      assert.ok(r.makespan + 1e-9 >= sumDur(w) / wk);
    }
  }
});

test('runs are deterministic', () => {
  const w = Workflow.fromObject(layered(5));
  assert.deepEqual(runWorkflow(w, 3), runWorkflow(w, 3));
});

test('failure skips downstream tasks only', () => {
  const r = runWorkflow(Workflow.fromObject(ETL_FAILURE), 2);
  const sp = spans(r);
  assert.equal(sp.get('sessionize').status, 'failed');
  for (const t of ['features', 'train', 'publish']) {
    assert.equal(sp.get(t).status, 'skipped');
    assert.equal(sp.get(t).start, null);
  }
  for (const t of ['join', 'report', 'clean_orders']) assert.equal(sp.get(t).status, 'success');
  assert.deepEqual(r.counts, { success: 7, failed: 1, skipped: 3 });
});

test('invalid worker counts rejected', () => {
  for (const bad of [0, -1, 1.5, '2', true, null]) {
    assert.throws(() => runWorkflow(Workflow.fromObject(ETL), bad), RangeError, String(bad));
  }
});

test('utilization and event log', () => {
  const r = runWorkflow(Workflow.fromObject(ETL), 2);
  assert.ok(r.utilization > 0 && r.utilization <= 1);
  assert.equal(r.events.filter((e) => e.kind === 'start').length, 11);
});

test('ASCII render shows header, worker rows and skipped tasks', () => {
  const out = renderText(runWorkflow(Workflow.fromObject(ETL_FAILURE), 2));
  assert.match(out, /makespan=/);
  assert.match(out, /skipped: train/);
  const rows = out.split('\n').filter((l) => /^w\d \|/.test(l));
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.length, 'w0 |'.length + 60 + 1);
});
