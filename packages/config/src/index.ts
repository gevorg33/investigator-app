// Shared configuration. The domain map is the one place a public hostname is derived (ADR-0002).
// CommonJS, unlike the other packages: the API is CommonJS and needs it synchronously — at boot,
// to validate the environment — and an ESM package can reach it there only by dynamic import.
export * from './cookies.js';
export * from './csp.js';
export * from './domains.js';
