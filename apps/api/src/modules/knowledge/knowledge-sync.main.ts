import { runKnowledgeSync } from './knowledge-sync.cli';

// The command's entry point and nothing else; everything it does is in knowledge-sync.cli.ts.
void runKnowledgeSync({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});
