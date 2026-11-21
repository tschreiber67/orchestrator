// CLI: node src/cli.js run <sample|file.json> [--workers N] [--json]
//      node src/cli.js serve [--port N]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Workflow, WorkflowError } from './dag.js';
import { runWorkflow, renderText } from './runner.js';
import { allSamples } from './samples.js';

const USAGE = 'usage: orchestrator run <sample|file.json> [--workers N] [--json]\n' +
              '       orchestrator serve [--port N]';

function intFlag(args, name, dflt) {
  const i = args.indexOf(name);
  if (i === -1) return dflt;
  const v = args[i + 1];
  if (v === undefined || !/^[+-]?\d+$/.test(v)) throw new RangeError(`${name} needs an integer`);
  args.splice(i, 2);
  return Number(v);
}

/** Returns an exit code. `io` lets tests capture output. */
export async function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'serve') {
      const port = intFlag(rest, '--port', 8102);
      const { serve } = await import('./server.js');
      serve(port);
      return 0;
    }
    if (cmd === 'run') {
      const asJson = rest.includes('--json');
      if (asJson) rest.splice(rest.indexOf('--json'), 1);
      const workers = intFlag(rest, '--workers', 2);
      const target = rest[0];
      if (!target) throw new RangeError('run needs a workflow name or JSON file');
      const samples = allSamples();
      const data = Object.hasOwn(samples, target)
        ? samples[target]
        : JSON.parse(readFileSync(target, 'utf8'));
      const res = runWorkflow(Workflow.fromObject(data), workers);
      io.out(asJson ? JSON.stringify(res, null, 2) : renderText(res));
      return 0;
    }
    io.err(USAGE);
    return 2;
  } catch (e) {
    if (e instanceof WorkflowError || e instanceof RangeError || e instanceof SyntaxError ||
        e.code === 'ENOENT' || e.code === 'EISDIR') {
      io.err(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await main(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
