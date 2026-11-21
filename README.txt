Distributed Workflow Orchestrator (S1 baseline)

Facts
- Node 22+, ES modules, zero npm dependencies (node:http, node:test, node:assert). No install step.
- Runs a DAG of tasks with dependencies on a virtual clock and a fixed worker pool.
- Scheduler: list scheduling; ready task with the longest remaining chain starts first, ties by id.
- Validation: duplicate ids, unknown deps, self deps, cycles (Kahn), non-positive durations.
- Failure: a task with fails=true ends failed; all transitive dependents are skipped.
- Output: execution timeline (start, end, worker, status), makespan, critical path, utilization, event log.
- Synthetic deterministic data in src/samples.js: etl, etl-with-failure, layered (seeded PRNG).
- Executor is an interface (run(task) -> [duration, status]); only SimulatedExecutor exists.
- Commands are identical in Windows PowerShell and the macOS terminal. Run them from the repo root.

Run
- npm start                                          (UI at http://127.0.0.1:8102)
- node src/cli.js run etl --workers 3                (ASCII Gantt)
- node src/cli.js run etl --json
- node src/cli.js run path/to/workflow.json
- node src/cli.js serve --port 8102

Workflow JSON
- {"name": "x", "tasks": [{"id": "a", "duration": 2, "deps": [], "fails": false}]}

API
- GET /api/workflows
- GET /api/run?workflow=etl&workers=3
- POST /api/run  {"workflow": {...}, "workers": 2}   (422 on invalid input)

Test
- npm test

Layout
- src/dag.js (model, validation, topo order, critical path), src/runner.js (scheduler, ASCII render),
  src/samples.js, src/server.js, src/cli.js, src/heap.js, public/index.html
- tests/dag.test.js, tests/runner.test.js, tests/server.test.js

Limitations
- Simulated time only; no real task execution, no locks, no retries, no cancellation, no timeouts.
- No persistence; a crash loses all state.
- Single process, no auth, binds 127.0.0.1, local use only.
