// Regenerates tokens.css from src/tokens.ts. Run after changing a token; the drift test in
// src/css.spec.ts fails until you do.
import { writeFileSync } from 'node:fs';
import { toCss } from '../src/css';

writeFileSync(new URL('../tokens.css', import.meta.url), toCss());
console.log('tokens.css written');
