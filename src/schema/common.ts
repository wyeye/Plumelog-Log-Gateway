import { z } from 'zod';

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()),
});
export const timeRangeSchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
