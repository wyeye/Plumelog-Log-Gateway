import { z } from 'zod';

export const stringArraySchema = z.array(z.string().min(1)).optional();

export const contentFilterSchema = z.object({
  all: stringArraySchema,
  any: stringArraySchema,
  not: stringArraySchema,
}).partial();

export const logFiltersSchema = z.object({
  apps: stringArraySchema,
  envs: stringArraySchema,
  levels: stringArraySchema,
  traceIds: stringArraySchema,
  hosts: stringArraySchema,
  loggers: stringArraySchema,
  methods: stringArraySchema,
  content: contentFilterSchema.optional(),
}).default({});

export type LogFilters = z.infer<typeof logFiltersSchema>;
