import { runWorker } from './common/jobs/worker';

// The worker's entry point and nothing else; everything it does is in common/jobs/worker.ts.
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());
void runWorker({
  env: process.env,
  signal: stop.signal,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});
