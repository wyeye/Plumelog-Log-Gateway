import { z } from 'zod';
import { timeRangeSchema, warningSchema } from './common.js';
import { logFiltersSchema } from './logFilters.js';

export const searchRequestSchema = z.object({
  timeRange: timeRangeSchema,
  limit: z.number().int().min(1).max(500),
  filters: logFiltersSchema,
  cursor: z.string().nullable().optional(),
  contentMode: z.enum(['preview', 'full']).default('preview'),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const searchResponseSchema = z.object({
  schema: z.literal('plumelog.search.v1'),
  summary: z.object({
    total: z.number().int().nonnegative().nullable(),
    totalRelation: z.enum(['eq', 'gte']),
    totalKnown: z.boolean(),
    returnedCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  columns: z.array(z.string().min(1)),
  rows: z.array(z.array(z.unknown())),
  warnings: z.array(warningSchema),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
