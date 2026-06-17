import { z } from 'zod';
import { timeRangeSchema, warningSchema } from './common.js';
import { logFiltersSchema } from './logFilters.js';

export const boundaryRequestSchema = z.object({
  timeRange: timeRangeSchema,
  filters: logFiltersSchema,
  direction: z.enum(['earliest', 'latest']),
});

export const boundaryRecordSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  app: z.string().min(1).nullable(),
  env: z.string().min(1).nullable(),
  index: z.string().min(1),
  id: z.string().min(1),
  contentPreview: z.string(),
});

export const boundaryResponseSchema = z.object({
  schema: z.literal('plumelog.boundary.v1'),
  record: boundaryRecordSchema.nullable(),
  warnings: z.array(warningSchema),
});

export type BoundaryRequest = z.infer<typeof boundaryRequestSchema>;
export type BoundaryResponse = z.infer<typeof boundaryResponseSchema>;
