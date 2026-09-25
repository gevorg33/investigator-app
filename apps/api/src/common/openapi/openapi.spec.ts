import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getMetadataStorage } from 'class-validator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../../../test/db';
import { closeApp, listenOnce } from '../../../test/http';
import { generatePluginMetadata } from './metadata.generator';

/** A class, for `instanceof`: what class-validator's storage keys its metadata by. */
type Constructor = abstract new (...args: never[]) => unknown;

/**
 * The published contract says what every request takes (T-136): each DTO's properties, their
 * types, and the bounds the API validates them against — read from the real document of the real
 * module graph, against class-validator's own record of every validated property.
 */
type Schema = Record<string, unknown> & { items?: Schema; properties?: Record<string, Schema> };
interface Validation {
  target: { name: string; prototype: object };
  propertyName: string;
  name?: string;
  constraints?: unknown[];
  each?: boolean;
}
interface Parameter {
  name: string;
  in: string;
  schema?: Schema;
}

const ROOT = join(__dirname, '../../..');
const QUERY = RouteParamtypes.QUERY;

/** What each class-validator constraint must look like in the document. */
const EXPECTED: Record<string, (c: unknown[]) => Record<string, unknown>> = {
  min: ([n]) => ({ minimum: n }),
  max: ([n]) => ({ maximum: n }),
  isLength: ([min, max]) => ({ minLength: min, ...(max === undefined ? {} : { maxLength: max }) }),
  minLength: ([n]) => ({ minLength: n }),
  maxLength: ([n]) => ({ maxLength: n }),
  matches: ([pattern]) => ({ pattern: (pattern as RegExp).source }),
  isIn: ([values]) => ({ enum: values }),
  arrayMinSize: ([n]) => ({ minItems: n }),
  arrayMaxSize: ([n]) => ({ maxItems: n }),
};
const OF_THE_LIST = new Set(['arrayMinSize', 'arrayMaxSize']);

describe('the OpenAPI document', () => {
  const saved = { ...process.env };
  let app: INestApplication;
  let schemas: Record<string, Schema>;
  let queries: Map<string, Parameter[]>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] ??= TEST_DATABASE_URL;
    process.env['REDIS_URL'] ??= 'redis://localhost:6380';
    process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
    process.env['NODE_ENV'] = 'development';
    // Imported after the environment is set: ConfigModule validates it on import.
    const { AppModule } = await import('../../app.module');
    const { configureApp } = await import('../../bootstrap');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ logger: false });
    await configureApp(app);
    await listenOnce(app);
    const doc = (await request(app.getHttpServer()).get('/api/docs-json').expect(200)).body as {
      components: { schemas: Record<string, Schema> };
      paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
    };
    schemas = doc.components.schemas;
    queries = new Map(
      Object.entries(doc.paths).flatMap(([path, ops]) =>
        Object.entries(ops).map(
          ([verb, op]) =>
            [`${verb} ${path}`, (op.parameters ?? []).filter((p) => p.in === 'query')] as const,
        ),
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await closeApp(app);
    process.env = saved;
  });

  const validations = (): Validation[] =>
    [
      ...(
        getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Validation[]> }
      ).validationMetadatas.values(),
    ].flat();
  const classes = () => [...new Set(validations().map((v) => v.target))];
  /** A class another validated class extends: its properties are checked on the subclasses. */
  const isBase = (c: Validation['target']) =>
    classes().some(
      (other) => other !== c && other.prototype instanceof (c as unknown as Constructor),
    );
  /** Every validated property of a class, its parents' included. */
  const propertiesOf = (c: Validation['target']) =>
    validations().filter(
      (v) => v.target === c || c.prototype instanceof (v.target as unknown as Constructor),
    );

  it('is generated from the current source — `pnpm --filter api openapi:metadata` if not', () => {
    const committed = readFileSync(join(ROOT, 'src/metadata.ts'), 'utf8');
    const fresh = generatePluginMetadata(join(ROOT, 'tsconfig.json'), join(ROOT, 'src'));
    expect(
      fresh === committed,
      'src/metadata.ts is stale: run pnpm --filter api openapi:metadata',
    ).toBe(true);
  }, 60_000);

  it('describes every property of every request body', () => {
    const missing: string[] = [];
    for (const c of classes().filter((x) => !isBase(x) && schemas[x.name] !== undefined)) {
      const properties = schemas[c.name]!.properties ?? {};
      for (const v of propertiesOf(c)) {
        if (!(v.propertyName in properties)) missing.push(`${c.name}.${v.propertyName}`);
      }
    }
    expect(missing).toEqual([]);
    // Not an empty pass: the search body is there, with its fields.
    expect(Object.keys(schemas['SearchInvestigatorsDto']!.properties!)).toEqual(
      expect.arrayContaining(['countryCode', 'near', 'radiusKm', 'languages', 'cursor']),
    );
  });

  it('describes every query a route takes as that route’s parameters, with their bounds', () => {
    // Each controller method's @Query() class, from Nest's own route metadata, and the operation
    // it becomes in the document — so a query is checked on its route, not on any route that
    // happens to share a parameter name.
    const routes: Array<{ operation: string; query: Validation['target'] }> = [];
    for (const module of app.get(ModulesContainer).values()) {
      for (const { metatype } of module.controllers.values()) {
        const controller = metatype as unknown as { prototype: Record<string, unknown> };
        const base = [Reflect.getMetadata(PATH_METADATA, controller) as string].flat()[0]!;
        for (const method of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[method];
          const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
            Record<string, { index: number; data?: unknown }> | undefined;
          const query = Object.entries(args ?? {}).find(
            ([key, arg]) => key.startsWith(`${QUERY}:`) && arg.data === undefined,
          );
          if (query === undefined) continue;
          const types = Reflect.getMetadata(
            'design:paramtypes',
            controller.prototype,
            method,
          ) as Validation['target'][];
          const path = [Reflect.getMetadata(PATH_METADATA, handler as object) as string].flat()[0]!;
          const verb =
            RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler as object) as number]!;
          const url = `/api/v1/${base}/${path}`
            .replace(/\/+/g, '/')
            .replace(/\/$/, '')
            .replace(/:(\w+)/g, '{$1}');
          routes.push({ operation: `${verb.toLowerCase()} ${url}`, query: types[query[1].index]! });
        }
      }
    }
    // Every validated class that is not a body and not a parent is some route's query.
    const query = classes().filter((c) => !isBase(c) && schemas[c.name] === undefined);
    expect(query.map((c) => c.name).filter((n) => !routes.some((r) => r.query.name === n))).toEqual(
      [],
    );

    const wrong: string[] = [];
    for (const { operation, query: c } of routes) {
      const params = queries.get(operation);
      for (const v of propertiesOf(c)) {
        const param = params?.find((p) => p.name === v.propertyName);
        if (param === undefined) {
          wrong.push(`${operation} lacks ${v.propertyName}`);
          continue;
        }
        const expected = v.name === undefined ? undefined : EXPECTED[v.name];
        if (expected === undefined) continue;
        const want = expected(v.constraints ?? []);
        if (!Object.entries(want).every(([k, x]) => equal(param.schema?.[k], x))) {
          wrong.push(`${operation} ${v.propertyName} ${v.name}`);
        }
      }
    }
    expect(routes.length).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it('states every bound the API validates a body against, as the API enforces it', () => {
    const wrong: string[] = [];
    for (const c of classes().filter((x) => !isBase(x) && schemas[x.name] !== undefined)) {
      for (const v of propertiesOf(c)) {
        const expected = v.name === undefined ? undefined : EXPECTED[v.name];
        if (expected === undefined) continue;
        const property = schemas[c.name]!.properties![v.propertyName]!;
        const where = v.each === true && !OF_THE_LIST.has(v.name!) ? property.items : property;
        const want = expected(v.constraints ?? []);
        if (where === undefined || !Object.entries(want).every(([k, x]) => equal(where[k], x))) {
          wrong.push(`${c.name}.${v.propertyName} ${v.name}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // Including a bound written as a constant, which the compiler plugin cannot read.
    expect(schemas['SearchInvestigatorsDto']!.properties!['radiusKm']).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: 100,
    });
    expect(schemas['SearchInvestigatorsDto']!.properties!['languages']).toMatchObject({
      maxItems: 20,
      items: { pattern: '^[a-z]{2}$' },
    });
  });
});

/** Equal as JSON; an enum's values in any order, since only membership is validated. */
const equal = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    : JSON.stringify(a) === JSON.stringify(b);
