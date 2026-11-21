// node:http server: static UI plus JSON API. No auth, bound to 127.0.0.1, local use.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, WorkflowError } from './dag.js';
import { runWorkflow } from './runner.js';
import { allSamples } from './samples.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, '..', 'public', 'index.html');
const MAX_BODY = 1_000_000;

/** Parse a base-10 integer strictly; "x", "1.5" and "" are rejected. */
function parseIntStrict(s) {
  if (!/^[+-]?\d+$/.test(s)) throw new RangeError(`not an integer: ${s}`);
  return Number(s);
}

/** Pure routing function: returns [status, payload]. `query` is a URLSearchParams. */
export function handle(method, pathname, query, body) {
  const samples = allSamples();
  try {
    if (method === 'GET' && pathname === '/api/workflows') {
      return [200, { workflows: Object.keys(samples).sort() }];
    }
    if (method === 'GET' && pathname === '/api/run') {
      const name = query.get('workflow') ?? 'etl';
      if (!Object.hasOwn(samples, name)) return [404, { error: `unknown workflow ${name}` }];
      const workers = parseIntStrict(query.get('workers') ?? '2');
      return [200, runWorkflow(Workflow.fromObject(samples[name]), workers)];
    }
    if (method === 'POST' && pathname === '/api/run') {
      const req = JSON.parse(body && body.length ? body : '{}');
      if (req === null || typeof req !== 'object' || Array.isArray(req)) {
        throw new WorkflowError('request body must be a JSON object');
      }
      return [200, runWorkflow(Workflow.fromObject(req.workflow), req.workers ?? 2)];
    }
  } catch (e) {
    if (e instanceof WorkflowError || e instanceof RangeError || e instanceof SyntaxError ||
        e instanceof TypeError) {
      return [422, { error: e.message }];
    }
    throw e;
  }
  return [404, { error: 'not found' }];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new RangeError('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const send = (code, data, type = 'application/json') => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length });
      res.end(buf);
    };
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
        return send(200, await readFile(INDEX), 'text/html; charset=utf-8');
      }
      const body = req.method === 'POST' ? await readBody(req) : '';
      const [code, payload] = handle(req.method, u.pathname, u.searchParams, body);
      return send(code, payload);
    } catch (e) {
      return send(e instanceof RangeError ? 413 : 500, { error: String(e.message) });
    }
  });
}

export function serve(port = 8102) {
  const srv = createServer();
  srv.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
  return srv;
}
