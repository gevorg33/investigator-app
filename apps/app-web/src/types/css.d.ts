// TypeScript 6 checks side-effect imports, and Next 15 declares no module for a plain stylesheet.
// The only such import is the root layout's `./globals.css`.
declare module '*.css';
