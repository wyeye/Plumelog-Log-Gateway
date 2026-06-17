import { createHash } from 'node:crypto';

export interface SearchCursor {
  version: 1;
  sortMode: 'time_seq' | 'time_only';
  values: Array<string | number>;
  queryHash: string;
}

export function buildQueryHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
}

export function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): SearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SearchCursor;
    if (parsed.version !== 1 || !Array.isArray(parsed.values)) {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw new Error('invalid cursor');
  }
}
