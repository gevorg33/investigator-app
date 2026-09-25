import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePluginMetadata } from './metadata.generator';

// The command's entry point and nothing else: writes a fresh `src/metadata.ts` (T-136).
// Run from the package directory — `pnpm --filter api openapi:metadata` does.
const root = process.cwd();
writeFileSync(
  join(root, 'src/metadata.ts'),
  generatePluginMetadata(join(root, 'tsconfig.json'), join(root, 'src')),
);
process.stdout.write('Wrote src/metadata.ts\n');
