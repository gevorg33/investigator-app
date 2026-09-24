import { z } from 'zod';
import { TAXONOMY_LOCALES } from '../../../../database/schema';
import { MAX_FILTER_VALUES, MAX_SEARCH_RADIUS_KM } from '../../../search/search.policy';

/**
 * The shapes the discovery tools take and give (T-018). Typed and closed: every input field is a
 * filter with a type, bounded like the HTTP search it calls (`search.dto.ts`), and nothing
 * free-form reaches a query. The one free-text field, `relevanceHint`, only reorders.
 */

/** Most results the assistant shows for one request. The full list is the HTTP search. */
export const MAX_TOOL_RESULTS = 10;
export const DEFAULT_TOOL_RESULTS = 5;

export const localeSchema = z.enum(TAXONOMY_LOCALES);

/** Where the investigator works: matched against their declared service areas. */
export const placeSchema = z.strictObject({
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  region: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(80).optional(),
});

/** A weekly window, in the shape investigators declare availability. 0 = Monday. */
export const windowSchema = z
  .strictObject({
    dayOfWeek: z.int().min(0).max(6),
    startMinute: z.int().min(0).max(1439),
    endMinute: z.int().min(1).max(1440),
  })
  .refine((w) => w.endMinute > w.startMinute, { message: 'window ends before it starts' });

export const languagesSchema = z.array(z.string().regex(/^[a-z]{2}$/)).max(MAX_FILTER_VALUES);

export const searchInvestigatorsInput = z.strictObject({
  place: placeSchema.optional(),
  /**
   * Real coordinates, from the person's device or a map — never from the model, which has no way
   * to know them. "Nearest" without these is a question, not a guess (`investigator-discovery`).
   */
  near: z
    .strictObject({
      lon: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      radiusKm: z.int().min(0).max(MAX_SEARCH_RADIUS_KM),
    })
    .optional(),
  taxonomyNodeIds: z.array(z.uuid()).max(MAX_FILTER_VALUES).optional(),
  languages: languagesSchema.optional(),
  availableDuring: windowSchema.optional(),
  /** Free text. Reorders an already-eligible result; never filters, never adds. */
  relevanceHint: z.string().trim().min(1).max(200).optional(),
  /** The language labels are given in. */
  locale: localeSchema.optional(),
  limit: z.int().min(1).max(MAX_TOOL_RESULTS).optional(),
});
export type SearchInvestigatorsInput = z.infer<typeof searchInvestigatorsInput>;

const labelSchema = z.object({ id: z.string(), label: z.string().nullable() });
export type NodeLabel = z.infer<typeof labelSchema>;

const windowOutSchema = z.object({
  dayOfWeek: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
});

/**
 * Why this investigator is here: only what was asked for, and only what their declared profile
 * data satisfied. The explanation is rendered from this and nothing else.
 */
export const matchedOnSchema = z.object({
  taxonomy: z.array(labelSchema),
  languages: z.array(z.string()),
  place: z
    .object({
      countryCode: z.string().optional(),
      region: z.string().optional(),
      city: z.string().optional(),
    })
    .nullable(),
  /** The window asked for, which their declared weekly hours overlap. */
  availability: windowOutSchema.nullable(),
});
export type MatchedOnView = z.infer<typeof matchedOnSchema>;

export const notMatchedSchema = z.object({ taxonomy: z.array(labelSchema) });
export type NotMatchedView = z.infer<typeof notMatchedSchema>;

/**
 * One investigator, as the assistant may see and say it: the public projection, cut down.
 *
 * Deliberately absent — so no rendering and no model can repeat them:
 * - **price**: a price is a quote, not a figure the assistant states (`ai-assistant` article);
 * - **bio**: prose is where capabilities get inferred ("their bio mentions fraud"), and
 *   capabilities are declared specialties only;
 * - **contact details, user id, coordinates, service-area geometry**: never public.
 */
export const investigatorMatchSchema = z.object({
  investigatorId: z.string(),
  displayName: z.string().nullable(),
  headline: z.string().nullable(),
  yearsExperience: z.number().nullable(),
  verificationStatus: z.literal('VERIFIED'),
  languages: z.array(z.object({ code: z.string(), proficiency: z.string() })),
  specialties: z.array(labelSchema),
  /** Declared weekly hours, as the investigator published them. Not a booking calendar. */
  availability: z.array(windowOutSchema),
  /** Rounded up to whole kilometres; null when no location was given. */
  distanceKm: z.number().nullable(),
  matchedOn: matchedOnSchema,
  notMatched: notMatchedSchema,
});
export type InvestigatorMatch = z.infer<typeof investigatorMatchSchema>;

export const searchInvestigatorsOutput = z.object({
  results: z.array(investigatorMatchSchema),
  hasMore: z.boolean(),
  orderedBy: z.enum(['distance', 'relevance', 'experience']),
});
export type SearchInvestigatorsOutput = z.infer<typeof searchInvestigatorsOutput>;

export const listTaxonomyInput = z.strictObject({ locale: localeSchema.optional() });
export type ListTaxonomyInput = z.infer<typeof listTaxonomyInput>;

export const listTaxonomyOutput = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      parentId: z.string().nullable(),
      label: z.string().nullable(),
      description: z.string().nullable(),
    }),
  ),
});
export type ListTaxonomyOutput = z.infer<typeof listTaxonomyOutput>;
