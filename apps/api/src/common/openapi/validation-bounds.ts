import type { OpenAPIObject } from '@nestjs/swagger';
import { getMetadataStorage } from 'class-validator';

/** A class, for `instanceof`: what class-validator's storage keys its metadata by. */
type Constructor = abstract new (...args: never[]) => unknown;

type Schema = Record<string, unknown> & { items?: Schema; properties?: Record<string, Schema> };

interface Constraint {
  propertyName: string;
  name?: string;
  constraints?: unknown[];
  each?: boolean;
}

/**
 * The bounds each DTO property is validated against, written into its schema (T-136).
 *
 * The swagger plugin (`metadata.generator.ts`) reads a decorator's arguments only when they are
 * literals, so `@Max(MAX_SEARCH_RADIUS_KM)` — a bound shared with the service — reached the
 * document as no bound at all. class-validator's own storage holds every bound as the value the
 * running API validates against, so the document is filled from there: what it says is what the
 * API enforces. A bound the plugin already wrote is overwritten with the same value.
 */
const KEYWORDS: Record<string, (c: unknown[]) => Schema> = {
  min: ([n]) => ({ minimum: n }),
  max: ([n]) => ({ maximum: n }),
  isLength: ([min, max]) => ({ minLength: min, ...(max === undefined ? {} : { maxLength: max }) }),
  minLength: ([n]) => ({ minLength: n }),
  maxLength: ([n]) => ({ maxLength: n }),
  matches: ([pattern]) => ({ pattern: (pattern as RegExp).source }),
  isIn: ([values]) => ({ enum: values }),
  isEmail: () => ({ format: 'email' }),
  isUuid: () => ({ format: 'uuid' }),
  isInt: () => ({ type: 'integer' }),
};

/** The array itself, not each item: these describe the list. */
const ARRAY_KEYWORDS: Record<string, (c: unknown[]) => Schema> = {
  arrayMinSize: ([n]) => ({ minItems: n }),
  arrayMaxSize: ([n]) => ({ maxItems: n }),
};

export function addValidationBounds(document: OpenAPIObject): OpenAPIObject {
  const storage = getMetadataStorage() as unknown as {
    validationMetadatas: Map<{ name: string; prototype: object }, Constraint[]>;
  };
  const schemas = (document.components?.schemas ?? {}) as Record<string, Schema>;
  const all = [...storage.validationMetadatas];
  for (const [target] of all) {
    const properties = schemas[target.name]?.properties;
    if (properties === undefined) continue;
    // A class's own constraints and every parent's: an inherited field is validated too.
    const constraints = all
      .filter(
        ([other]) =>
          other === target || target.prototype instanceof (other as unknown as Constructor),
      )
      .flatMap(([, list]) => list);
    for (const c of constraints) {
      const property = properties[c.propertyName];
      if (property === undefined || c.name === undefined) continue;
      const args = c.constraints ?? [];
      const array = ARRAY_KEYWORDS[c.name];
      if (array !== undefined) {
        Object.assign(property, array(args));
        continue;
      }
      const keyword = KEYWORDS[c.name];
      if (keyword === undefined) continue;
      // `each: true` validates every item of an array, so the bound belongs to `items`.
      const into = c.each === true ? (property.items ?? property) : property;
      Object.assign(into, keyword(args));
    }
  }
  return document;
}
