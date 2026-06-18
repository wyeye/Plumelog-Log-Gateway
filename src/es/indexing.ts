import type { AppConfig } from '../config/schema.js';
import { formatIndexSuffix } from '../utils/time.js';

function resolveIndexPatterns(
  prefix: string,
  timeZone: string,
  mode: 'day' | 'hour',
  from: string,
  to: string,
): string[] {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return [];
  }

  const cursor = new Date(start);
  const patterns = new Set<string>();
  const step = mode === 'day'
    ? () => cursor.setUTCDate(cursor.getUTCDate() + 1)
    : () => cursor.setUTCHours(cursor.getUTCHours() + 1);

  while (cursor < end) {
    patterns.add(`${prefix}${formatIndexSuffix(cursor, timeZone, mode)}*`);
    step();
  }
  patterns.add(`${prefix}${formatIndexSuffix(new Date(end.getTime() - 1), timeZone, mode)}*`);

  return [...patterns];
}

export function resolveRunIndexPatterns(config: AppConfig, from: string, to: string): string[] {
  return resolveIndexPatterns(
    config.plumelog.runIndexPrefix,
    config.plumelog.timezone,
    config.plumelog.indexMode,
    from,
    to,
  );
}
