import { z } from 'zod';
import { searchRequestSchema } from './search.js';

const positiveIntSchema = z.number().int().positive();

export const searchLogsAllPagesRequestSchema = searchRequestSchema.extend({
  maxPages: positiveIntSchema.max(1000).optional(),
  maxRows: positiveIntSchema.max(100_000).optional(),
  allowPartial: z.boolean().default(true),
});

export type SearchLogsAllPagesRequest = z.infer<typeof searchLogsAllPagesRequestSchema>;

const searchLogsAutoRequestObjectSchema = searchRequestSchema.extend({
  maxPages: positiveIntSchema.max(1000).optional(),
  maxRows: positiveIntSchema.max(100_000).optional(),
  allowPartial: z.boolean().default(true),
  sliceMinutes: positiveIntSchema.max(24 * 60).optional(),
  minSliceMinutes: positiveIntSchema.max(24 * 60).default(2),
});

export const searchLogsAutoRequestSchema = searchLogsAutoRequestObjectSchema.superRefine((value, ctx) => {
  if (value.cursor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'cursor is not supported for search_logs_auto',
    });
  }
  if (value.sliceMinutes !== undefined && value.sliceMinutes < value.minSliceMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sliceMinutes'],
      message: 'sliceMinutes must be greater than or equal to minSliceMinutes',
    });
  }
});

export type SearchLogsAutoRequest = z.infer<typeof searchLogsAutoRequestSchema>;

export const exportLogsCsvRequestSchema = searchLogsAutoRequestObjectSchema.extend({
  outputPath: z.string().min(1).optional(),
  inlineCsv: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.cursor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'cursor is not supported for export_logs_csv',
    });
  }
  if (value.sliceMinutes !== undefined && value.sliceMinutes < value.minSliceMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sliceMinutes'],
      message: 'sliceMinutes must be greater than or equal to minSliceMinutes',
    });
  }
});

export type ExportLogsCsvRequest = z.infer<typeof exportLogsCsvRequestSchema>;
