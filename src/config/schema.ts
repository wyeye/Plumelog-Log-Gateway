import { z } from 'zod';

export const READ_SCOPES = ['meta:read', 'logs:search', 'logs:context', 'logs:boundary'] as const;
const scopeSchema = z.enum(READ_SCOPES);
const tieBreakerTypeSchema = z.enum(['keyword', 'long', 'date']);

const apiKeySchema = z.object({
  name: z.string().min(1),
  token: z.string().min(1),
  scopes: z.array(scopeSchema).default([...READ_SCOPES]),
  allowedApps: z.array(z.string().min(1)).default([]),
  allowedEnvs: z.array(z.string().min(1)).default([]),
  maxTimeRangeHours: z.number().positive().optional(),
  maxLimit: z.number().int().min(1).max(500).optional(),
  allowRawContent: z.boolean().default(false),
});

const nullableNonEmptyStringSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().min(1).nullable(),
);

export const configSchema = z.object({
  runtime: z.object({
    production: z.boolean().default(false),
  }).default({}),
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
    tieBreakerType: tieBreakerTypeSchema.default('keyword'),
  }).default({}),
  cursor: z.object({
    signingSecret: nullableNonEmptyStringSchema.default(null),
    ttlSeconds: z.number().int().positive().default(3600),
    allowUnsignedV1: z.boolean().default(false),
  }).default({}),
  redaction: z.object({
    enabled: z.boolean().default(true),
    replacement: z.string().min(1).default('[REDACTED]'),
    maxInputChars: z.number().int().positive().default(200_000),
  }).default({}),
  observability: z.object({
    slowQueryMs: z.number().int().positive().default(1000),
    readyTimeoutMs: z.number().int().positive().default(1000),
  }).default({}),
});

export type AppConfig = z.infer<typeof configSchema>;
