// Deterministic synthetic workflows (no external data).

export const ETL = {
  name: 'etl',
  tasks: [
    { id: 'extract_orders', duration: 4, deps: [] },
    { id: 'extract_users', duration: 3, deps: [] },
    { id: 'extract_events', duration: 6, deps: [] },
    { id: 'clean_orders', duration: 2, deps: ['extract_orders'] },
    { id: 'clean_users', duration: 2, deps: ['extract_users'] },
    { id: 'join', duration: 5, deps: ['clean_orders', 'clean_users'] },
    { id: 'sessionize', duration: 4, deps: ['extract_events'] },
    { id: 'features', duration: 6, deps: ['join', 'sessionize'] },
    { id: 'train', duration: 8, deps: ['features'] },
    { id: 'report', duration: 3, deps: ['join'] },
    { id: 'publish', duration: 1, deps: ['train', 'report'] },
  ],
};

export const ETL_FAILURE = {
  name: 'etl-with-failure',
  tasks: ETL.tasks.map((t) => ({ ...t, fails: t.id === 'sessionize' })),
};

// mulberry32: small seeded PRNG, identical on every platform.
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  const sample = (arr, k) => {
    const pool = [...arr];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(next() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  };
  return { int, sample };
}

/** Random layered DAG; every edge points to an earlier layer, so it is acyclic. */
export function layered(seed = 7, layers = 5, width = 4) {
  const r = rng(seed);
  const tasks = [];
  let prev = [];
  for (let li = 0; li < layers; li++) {
    const cur = [];
    const n = r.int(2, width);
    for (let i = 0; i < n; i++) {
      const id = `L${li}_${i}`;
      const deps = prev.length
        ? r.sample(prev, r.int(1, Math.min(3, prev.length))).sort()
        : [];
      tasks.push({ id, duration: r.int(1, 9), deps });
      cur.push(id);
    }
    prev = cur;
  }
  return { name: `layered-seed${seed}`, tasks };
}

export function allSamples() {
  return { etl: ETL, 'etl-with-failure': ETL_FAILURE, layered: layered() };
}
