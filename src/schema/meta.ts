import { z } from 'zod';
import { isoDateTimeSchema, warningSchema } from './common.js';

export const metaAppsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export type MetaAppsQuery = z.infer<typeof metaAppsQuerySchema>;

export const metaAppsResponseSchema = z.object({
  schema: z.literal('plumelog.apps.v1'),
  timeRange: z.object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  }),
  apps: z.array(z.object({
    app: z.string().min(1),
    envs: z.array(z.string().min(1)),
  })),
  warnings: z.array(warningSchema),
});

export type MetaAppsResponse = z.infer<typeof metaAppsResponseSchema>;
