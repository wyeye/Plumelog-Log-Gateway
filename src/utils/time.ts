import { AppError } from '../http/errors.js';

export interface ResolvedTimeRange {
  from: string;
  to: string;
}

function zonedParts(date: Date, timeZone: string): { year: string; month: string; day: string; hour: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: byType.get('year') ?? '0000',
    month: byType.get('month') ?? '00',
    day: byType.get('day') ?? '00',
    hour: byType.get('hour') ?? '00',
  };
}

export function toIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INVALID_TIME_RANGE', 400, { value }, 'timeRange is invalid');
  }
  return date.toISOString();
}

export function ensureRangeHours(from: string, to: string, maxHours: number): void {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const rangeHours = (end - start) / 3_600_000;
  if (rangeHours <= 0) {
    throw new AppError('INVALID_TIME_RANGE', 400, {}, 'timeRange.to must be greater than timeRange.from');
  }
  if (rangeHours > maxHours) {
    throw new AppError('TIME_RANGE_TOO_LARGE', 400, { maxHours }, 'time range exceeds allowed maximum');
  }
}

export function resolveDefaultTimeRange(now: Date, defaultHours: number): ResolvedTimeRange {
  const to = new Date(now);
  const from = new Date(now.getTime() - defaultHours * 3_600_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function resolveOptionalTimeRange(
  from: string | undefined,
  to: string | undefined,
  defaultHours: number,
): ResolvedTimeRange {
  if (!from && !to) {
    return resolveDefaultTimeRange(new Date(), defaultHours);
  }
  if (!from || !to) {
    throw new AppError('INVALID_TIME_RANGE', 400, {}, 'from and to must be provided together');
  }
  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
  };
}

export function formatIndexSuffix(date: Date, timeZone: string, mode: 'day' | 'hour'): string {
  const parts = zonedParts(date, timeZone);
  return mode === 'hour'
    ? `${parts.year}${parts.month}${parts.day}${parts.hour}`
    : `${parts.year}${parts.month}${parts.day}`;
}

export function clampTimeRange(
  from: string,
  to: string,
  centerIso: string,
  timeWindowSeconds: number,
): ResolvedTimeRange {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const center = new Date(centerIso).getTime();
  const windowMillis = timeWindowSeconds * 1_000;
  return {
    from: new Date(Math.max(start, center - windowMillis)).toISOString(),
    to: new Date(Math.min(end, center + windowMillis)).toISOString(),
  };
}
