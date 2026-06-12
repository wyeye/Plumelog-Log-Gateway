import { z } from 'zod';
import { isoDateTimeSchema, warningSchema } from './common.js';

export const contextRequestSchema = z.object({
  timeRange: z.object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  }),
  limit: z.number().int().min(1).max(500),
  center: z.object({
    index: z.string().min(1),
    id: z.string().min(1),
  }).nullable().optional(),
  traceId: z.string().min(1).nullable().optional(),
  context: z.object({
    timeWindowSeconds: z.number().int().positive().max(3600).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.center && !value.traceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['center'],
      message: 'center or traceId is required',
    });
  }
});

export type ContextRequest = z.infer<typeof contextRequestSchema>;

export const contextResponseSchema = z.object({
  schema: z.literal('plumelog.context.v1'),
  center: z.record(z.unknown()).nullable(),
  traceLogs: z.array(z.record(z.unknown())),
  nearbyLogs: z.array(z.record(z.unknown())),
  resolution: z.object({
    mode: z.enum(['traceId', 'timeWindow', 'traceIdAndTimeWindow']),
    reason: z.string().min(1),
  }),
  warnings: z.array(warningSchema),
});
