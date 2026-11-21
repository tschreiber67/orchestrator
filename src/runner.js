// Deterministic DAG runner on a virtual clock with a fixed worker pool.
//
// Scheduling: list scheduling. Whenever a worker is free, the ready task with the
// largest bottom level (longest remaining chain) starts first; ties go to task id.
// Executors are pluggable so a real one can replace the simulated one.
import { MinHeap, cmpStr } from './heap.js';

export const SUCCESS = 'success';
export const FAILED = 'failed';
export const SKIPPED = 'skipped';

/** Takes exactly task.duration of virtual time; fails iff task.fails. */
export class SimulatedExecutor {
  run(task) {
    return [task.duration, task.fails ? FAILED : SUCCESS];
  }
}

export function runWorkflow(wf, workers = 2, executor = new SimulatedExecutor()) {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError('workers must be an integer >= 1');
  }
  wf.validate();
  const bl = wf.bottomLevels();
  const depsOf = wf.dependents();
  const state = new Map([...wf.tasks.keys()].map((id) => [id, null])); // null until finished/skipped
  const remaining = new Map([...wf.tasks].map(([id, t]) => [id, t.deps.length]));
  const ready = new MinHeap((a, b) => a[0] - b[0] || cmpStr(a[1], b[1]));
  for (const [id, n] of remaining) if (n === 0) ready.push([-bl.get(id), id]);
  const free = new MinHeap((a, b) => a - b);
  for (let i = 0; i < workers; i++) free.push(i);
  const running = new MinHeap((a, b) => a[0] - b[0] || cmpStr(a[1], b[1]) || a[2] - b[2]);
  const events = [];
  const spans = new Map();
  let now = 0;

  const skipDownstream = (root, t) => {
    const stack = [...depsOf.get(root)];
    while (stack.length) {
      const c = stack.pop();
      if (state.get(c) === null) {
        state.set(c, SKIPPED);
        events.push({ t, kind: 'skip', task: c, worker: null, status: SKIPPED });
        spans.set(c, { task: c, status: SKIPPED, start: null, end: null, worker: null });
        stack.push(...depsOf.get(c));
      }
    }
  };

  while (ready.size || running.size) {
    while (ready.size && free.size) {
      const [, id] = ready.pop();
      if (state.get(id) !== null) continue; // skipped while queued
      const w = free.pop();
      const [dur, status] = executor.run(wf.tasks.get(id));
      running.push([now + dur, id, w, status]);
      events.push({ t: now, kind: 'start', task: id, worker: w, status: null });
      spans.set(id, { task: id, status: 'running', start: now, end: null, worker: w });
    }
    if (!running.size) break;
    const [t, id, w, status] = running.pop();
    now = t;
    free.push(w);
    state.set(id, status);
    Object.assign(spans.get(id), { status, end: now });
    events.push({ t: now, kind: 'finish', task: id, worker: w, status });
    if (status === SUCCESS) {
      for (const c of depsOf.get(id)) {
        remaining.set(c, remaining.get(c) - 1);
        if (remaining.get(c) === 0 && state.get(c) === null) ready.push([-bl.get(c), c]);
      }
    } else {
      skipDownstream(id, now);
    }
  }

  const all = [...spans.values()];
  const finished = all.filter((s) => s.end !== null);
  const makespan = finished.reduce((m, s) => Math.max(m, s.end), 0);
  const busy = finished.reduce((a, s) => a + (s.end - s.start), 0);
  const cp = wf.criticalPath();
  const count = (s) => [...state.values()].filter((v) => v === s).length;
  return {
    workflow: wf.name,
    workers,
    makespan,
    critical_path: cp,
    utilization: makespan ? Math.round((busy / (makespan * workers)) * 1e4) / 1e4 : 0,
    counts: { [SUCCESS]: count(SUCCESS), [FAILED]: count(FAILED), [SKIPPED]: count(SKIPPED) },
    timeline: all.sort((a, b) =>
      (a.start === null) - (b.start === null) || (a.start ?? 0) - (b.start ?? 0) || cmpStr(a.task, b.task)),
    events,
  };
}

const g = (x) => String(Number(x.toPrecision(6))); // like Python's {:g} for typical values

/** ASCII Gantt chart, one row per worker. '#' fills success, '!' fills failure. */
export function renderText(result, width = 60) {
  const span = result.makespan || 1;
  const lines = [
    `workflow=${result.workflow} workers=${result.workers} makespan=${g(result.makespan)} ` +
    `critical_path=${g(result.critical_path.length)} utilization=${Math.round(result.utilization * 100)}%`,
  ];
  for (let w = 0; w < result.workers; w++) {
    const row = new Array(width).fill(' ');
    for (const s of result.timeline) {
      if (s.worker !== w || s.end === null) continue;
      const a = Math.trunc((s.start / span) * width);
      const b = Math.max(a + 1, Math.trunc((s.end / span) * width));
      const fill = s.status === SUCCESS ? '#' : '!';
      const label = (s.task + fill.repeat(width)).slice(0, b - a).split('');
      row.splice(a, b - a, ...label);
    }
    lines.push(`w${w} |${row.slice(0, width).join('')}|`);
  }
  for (const s of result.timeline) if (s.status === SKIPPED) lines.push(`   skipped: ${s.task}`);
  lines.push('critical path: ' + result.critical_path.tasks.join(' -> '));
  return lines.join('\n');
}
