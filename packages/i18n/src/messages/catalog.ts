import type { en } from './en.js';

/** The shape every catalog must have: English's keys, each a string of its own. */
type Leaves<T> = { readonly [K in keyof T]: T[K] extends string ? string : Leaves<T[K]> };
export type Catalog = Leaves<typeof en>;
