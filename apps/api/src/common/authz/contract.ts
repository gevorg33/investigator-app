/**
 * The single crossing point between this CommonJS app and the ESM `@investigator/auth`
 * package.
 *
 * TypeScript requires `resolution-mode` when a CommonJS file takes a type-only import
 * from an ESM package. Confining it here means the attribute appears once instead of on
 * every import site, and the module boundary is documented in one place rather than
 * implied by a repeated incantation.
 *
 * These are types only. They erase at compile time, so no `require` of an ESM package
 * reaches the runtime — verified in the emitted output.
 */
export type { AccountStatus, Actor, Role, StaffScope } from '@investigator/auth' with {
  'resolution-mode': 'import',
};
