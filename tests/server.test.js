import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, createServer } from '../src/server.js';
import { main } from '../src/cli.js';

const q = (o = {}) => new URLSearchParams(o);
const quiet = () => {
  const out = [], err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
};

test('GET /api/workflows lists samples', () => {
  const [c, p] = handle('GET', '/api/workflows', q(), '');
  assert.equal(c, 200);
  assert.ok(p.workflows.includes('etl'));
});

test('GET /api/run returns a result', () => {
  const [c, p] = handle('GET', '/api/run', q({ workflow: 'etl', workers: '3' }), '');
  assert.deepEqual([c, p.workers, p.makespan], [200, 3, 26]);
});

test('unknown workflow is 404, bad workers is 422', () => {
  assert.equal(handle('GET', '/api/run', q({ workflow: 'nope' }), '')[0], 404);
  assert.equal(handle('GET', '/api/run', q({ workers: '0' }), '')[0], 422);
  assert.equal(handle('GET', '/api/run', q({ workers: 'x' }), '')[0], 422);
  assert.equal(handle('GET', '/api/nothing', q(), '')[0], 404);
});

test('POST custom workflow, cycle, empty and malformed bodies', () => {
  const ok = { workflow: { name: 'x', tasks: [{ id: 'a', duration: 2 }] }, workers: 1 };
  const [c, p] = handle('POST', '/api/run', q(), JSON.stringify(ok));
  assert.deepEqual([c, p.makespan], [200, 2]);
  const bad = { workflow: { tasks: [{ id: 'a', duration: 1, deps: ['a'] }] } };
  assert.equal(handle('POST', '/api/run', q(), JSON.stringify(bad))[0], 422);
  assert.equal(handle('POST', '/api/run', q(), '{}')[0], 422);
  assert.equal(handle('POST', '/api/run', q(), '{not json')[0], 422);
});

test('CLI exit codes and output', async () => {
  const a = quiet();
  assert.equal(await main(['run', 'etl', '--workers', '2'], a.io), 0);
  assert.match(a.out[0], /makespan=29/);
  const b = quiet();
  assert.equal(await main(['run', 'etl', '--workers', '3', '--json'], b.io), 0);
  assert.equal(JSON.parse(b.out[0]).makespan, 26);
  const c = quiet();
  assert.equal(await main(['run', 'missing.json'], c.io), 2);
  assert.match(c.err[0], /^error:/);
  assert.equal(await main([], quiet().io), 2);
});

test('real HTTP server serves the page and the API', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Workflow timeline/);
    const run = await fetch(base + '/api/run?workflow=etl-with-failure&workers=2');
    assert.equal(run.status, 200);
    assert.deepEqual((await run.json()).counts, { success: 7, failed: 1, skipped: 3 });
    const post = await fetch(base + '/api/run', { method: 'POST', body: '{"workflow":1}' });
    assert.equal(post.status, 422);
  } finally {
    srv.close();
    srv.closeAllConnections();
  }
});
