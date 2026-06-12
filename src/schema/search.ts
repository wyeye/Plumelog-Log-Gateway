import { z } from 'zod';
import { timeRangeSchema, warningSchema } from './common.js';

const stringArraySchema = z.array(z.string().min(1)).optional();

const contentFilterSchema = z.object({
  all: stringArraySchema,
  any: stringArraySchema,
  not: stringArraySchema,
}).partial();

export const searchRequestSchema = z.object({
  timeRange: timeRangeSchema,
  limit: z.number().int().min(1).max(500),
  filters: z.object({
    apps: stringArraySchema,
    envs: stringArraySchema,
    levels: stringArraySchema,
    traceIds: stringArraySchema,
    hosts: stringArraySchema,
    loggers: stringArraySchema,
    methods: stringArraySchema,
    content: contentFilterSchema.optional(),
  }).default({}),
  cursor: z.string().nullable().optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const searchResponseSchema = z.object({
  schema: z.literal('plumelog.search.v1'),
  summary: z.object({
    total: z.number().int().nonnegative(),
    totalRelation: z.enum(['eq', 'gte']),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  columns: z.array(z.string().min(1)),
  rows: z.array(z.array(z.unknown())),
  warnings: z.array(warningSchema),
});
