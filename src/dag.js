// Workflow model and graph algorithms: validation, topological order, critical path.
import { cmpStr } from './heap.js';

export class WorkflowError extends Error {
  constructor(msg) { super(msg); this.name = 'WorkflowError'; }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class Workflow {
  constructor(name = 'unnamed') {
    this.name = name;
    this.tasks = new Map(); // id -> {id, duration, deps, fails, resource}; insertion order kept
  }

  static fromObject(d) {
    if (!isPlainObject(d) || !Array.isArray(d.tasks)) {
      throw new WorkflowError("workflow needs a 'tasks' list");
    }
    const wf = new Workflow(String(d.name ?? 'unnamed'));
    for (const t of d.tasks) {
      if (!isPlainObject(t)) throw new WorkflowError('each task must be an object');
      const id = t.id;
      if (typeof id !== 'string' || !id) {
        throw new WorkflowError('every task needs a non-empty string id');
      }
      if (wf.tasks.has(id)) throw new WorkflowError(`duplicate task id: ${id}`);
      const dur = t.duration;
      if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0) {
        throw new WorkflowError(`task ${id}: duration must be a positive number`);
      }
      const deps = t.deps ?? [];
      if (!Array.isArray(deps)) throw new WorkflowError(`task ${id}: deps must be a list`);
      wf.tasks.set(id, {
        id,
        duration: dur,
        deps: Object.freeze([...deps]),
        fails: Boolean(t.fails),
        resource: String(t.resource ?? 'cpu'), // label only in S1
      });
    }
    wf.validate();
    return wf;
  }

  toObject() {
    return {
      name: this.name,
      tasks: [...this.tasks.values()].map((t) => ({
        id: t.id, duration: t.duration, deps: [...t.deps], fails: t.fails, resource: t.resource,
      })),
    };
  }

  validate() {
    for (const t of this.tasks.values()) {
      if (t.deps.includes(t.id)) throw new WorkflowError(`task ${t.id} depends on itself`);
      if (new Set(t.deps).size !== t.deps.length) {
        throw new WorkflowError(`task ${t.id} lists a dependency twice`);
      }
      for (const d of t.deps) {
        if (!this.tasks.has(d)) throw new WorkflowError(`task ${t.id} depends on unknown task ${d}`);
      }
    }
    this.topoOrder(); // throws on cycle
  }

  dependents() {
    const out = new Map([...this.tasks.keys()].map((id) => [id, []]));
    for (const t of this.tasks.values()) for (const d of t.deps) out.get(d).push(t.id);
    return out;
  }

  /** Kahn's algorithm; ties broken by task id so output is deterministic. */
  topoOrder() {
    const indeg = new Map([...this.tasks].map(([id, t]) => [id, t.deps.length]));
    const depsOf = this.dependents();
    const ready = [...indeg].filter(([, n]) => n === 0).map(([id]) => id).sort(cmpStr);
    const order = [];
    for (let i = 0; i < ready.length; i++) { // ready doubles as a FIFO queue
      const id = ready[i];
      order.push(id);
      const newly = [];
      for (const c of depsOf.get(id)) {
        indeg.set(c, indeg.get(c) - 1);
        if (indeg.get(c) === 0) newly.push(c);
      }
      ready.push(...newly.sort(cmpStr));
    }
    if (order.length !== this.tasks.size) {
      const seen = new Set(order);
      const stuck = [...this.tasks.keys()].filter((id) => !seen.has(id)).sort(cmpStr);
      throw new WorkflowError('dependency cycle involving: ' + stuck.join(', '));
    }
    return order;
  }

  /** Longest duration path from each task to any sink, including itself. */
  bottomLevels() {
    const depsOf = this.dependents();
    const bl = new Map();
    for (const id of this.topoOrder().reverse()) {
      let tail = 0;
      for (const c of depsOf.get(id)) tail = Math.max(tail, bl.get(c));
      bl.set(id, this.tasks.get(id).duration + tail);
    }
    return bl;
  }

  /** {length, tasks} of the longest dependency chain by duration. */
  criticalPath() {
    const bl = this.bottomLevels();
    const depsOf = this.dependents();
    const best = (ids) => [...ids].sort((x, y) => bl.get(y) - bl.get(x) || cmpStr(x, y))[0];
    const roots = [...this.tasks.values()].filter((t) => t.deps.length === 0).map((t) => t.id);
    if (!roots.length) return { length: 0, tasks: [] };
    let cur = best(roots);
    const length = bl.get(cur);
    const path = [cur];
    while (depsOf.get(cur).length) {
      cur = best(depsOf.get(cur));
      path.push(cur);
    }
    return { length, tasks: path };
  }
}
