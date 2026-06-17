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
  const cursor = new Date(start);
  const patterns = new Set<string>();

  while (cursor < end) {
    patterns.add(`${prefix}${formatIndexSuffix(cursor, timeZone, mode)}*`);
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }

  if (patterns.size === 0) {
    patterns.add(`${prefix}${formatIndexSuffix(start, timeZone, mode)}*`);
  }

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
