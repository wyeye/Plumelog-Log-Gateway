import { z } from 'zod';

const apiKeySchema = z.object({
  name: z.string().min(1),
  token: z.string().min(1),
});

const nullableNonEmptyStringSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().min(1).nullable(),
);

export const configSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535),
  }),
  auth: z.object({
    apiKeys: z.array(apiKeySchema).min(1),
  }),
  elasticsearch: z.object({
    node: z.string().url(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    indexResolveConcurrency: z.number().int().min(1).max(64).default(8),
    tls: z.object({
      rejectUnauthorized: z.boolean(),
    }),
  }),
  plumelog: z.object({
    indexMode: z.enum(['day', 'hour']),
    timezone: z.string().min(1),
    runIndexPrefix: z.string().min(1),
    traceIndexPrefix: z.string().min(1),
    fields: z.object({
      time: z.string().min(1),
      app: z.string().min(1),
      env: z.string().min(1),
      level: z.string().min(1),
      message: z.string().min(1),
      host: z.string().min(1),
      traceId: z.string().min(1),
      logger: z.string().min(1),
      method: z.string().min(1),
      thread: z.string().min(1),
      seq: z.string().min(1),
    }),
  }),
  limits: z.object({
    maxTimeRangeHours: z.number().positive(),
    maxLimit: z.number().int().min(1).max(500),
    contentPreviewChars: z.number().int().positive(),
    maxContentTermLength: z.number().int().positive(),
    maxContentTerms: z.number().int().positive(),
    contextDefaultWindowSeconds: z.number().int().positive(),
    contextMaxWindowSeconds: z.number().int().positive(),
  }),
  meta: z.object({
    defaultTimeRangeHours: z.number().positive(),
    appAggSize: z.number().int().min(1).default(200),
    envAggSize: z.number().int().min(1).default(50),
  }),
  search: z.object({
    trackTotalHits: z.union([z.boolean(), z.number().int().nonnegative()]).default(false),
    sourceFiltering: z.boolean().default(true),
    tieBreakerField: nullableNonEmptyStringSchema.default(null),
  }).default({}),
  cursor: z.object({
    signingSecret: nullableNonEmptyStringSchema.default(null),
  }).default({}),
});

export type AppConfig = z.infer<typeof configSchema>;
