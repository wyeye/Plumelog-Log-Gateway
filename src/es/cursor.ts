import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/schema.js';

type CursorValue = string | number | boolean | null;
export type CursorSortMode = 'time_seq' | 'time_only';
export type CursorTieBreakerType = 'keyword' | 'long' | 'date';

export interface SearchCursorV1 {
  version: 1;
  sortMode: CursorSortMode;
  values: CursorValue[];
  queryHash: string;
}

export interface SearchCursorV2 {
  version: 2;
  sortMode: CursorSortMode;
  tieBreakerType?: CursorTieBreakerType;
  values: CursorValue[];
  queryHash: string;
  expiresAt: string;
}

export type SearchCursor = SearchCursorV1 | SearchCursorV2;

export interface DecodedCursor {
  cursor: SearchCursor;
  legacyUnsigned: boolean;
}

export function buildQueryHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('base64url');
}

function getCursorSigningSecret(config: AppConfig): string {
  if (config.cursor.signingSecret) {
    return config.cursor.signingSecret;
  }

  return createHash('sha256')
    .update(`plumelog-log-gateway:cursor:${config.auth.apiKeys[0]?.token ?? ''}`)
    .digest('base64url');
}

function parseCursorPayload(value: unknown): SearchCursor {
  const parsed = value as Partial<SearchCursor>;
  if (
    (parsed.version !== 1 && parsed.version !== 2)
    || (parsed.sortMode !== 'time_seq' && parsed.sortMode !== 'time_only')
    || !Array.isArray(parsed.values)
    || parsed.values.some((item) => item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')
    || typeof parsed.queryHash !== 'string'
  ) {
    throw new Error('invalid cursor');
  }

  if (parsed.version === 2) {
    if (typeof parsed.expiresAt !== 'string' || Number.isNaN(Date.parse(parsed.expiresAt))) {
      throw new Error('invalid cursor');
    }
    if (parsed.tieBreakerType !== undefined && parsed.tieBreakerType !== 'keyword' && parsed.tieBreakerType !== 'long' && parsed.tieBreakerType !== 'date') {
      throw new Error('invalid cursor');
    }
  }

  return parsed as SearchCursor;
}

function signPayloadJson(payloadJson: string, config: AppConfig): string {
  return createHmac('sha256', getCursorSigningSecret(config)).update(payloadJson).digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function encodeCursor(
  config: AppConfig,
  cursor: Omit<SearchCursorV2, 'version' | 'expiresAt'> & { version?: 2; expiresAt?: string },
): string {
  const expiresAt = cursor.expiresAt ?? new Date(Date.now() + config.cursor.ttlSeconds * 1000).toISOString();
  const payloadJson = JSON.stringify({ ...cursor, expiresAt, version: 2 });
  const payload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  return `${payload}.${signPayloadJson(payloadJson, config)}`;
}

export function decodeCursor(config: AppConfig, raw: string): DecodedCursor {
  try {
    const [payload, signature, ...extra] = raw.split('.');
    if (!payload || extra.length > 0) {
      throw new Error('invalid cursor');
    }

    if (!signature) {
      if (!config.cursor.allowUnsignedV1) {
        throw new Error('invalid cursor');
      }
      const legacy = parseCursorPayload(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      if (legacy.version !== 1) {
        throw new Error('invalid cursor');
      }
      return { cursor: legacy, legacyUnsigned: true };
    }

    const payloadJson = Buffer.from(payload, 'base64url').toString('utf8');
    const expectedSignature = signPayloadJson(payloadJson, config);
    if (!signaturesMatch(signature, expectedSignature)) {
      throw new Error('invalid cursor');
    }

    const cursor = parseCursorPayload(JSON.parse(payloadJson));
    if (cursor.version !== 2) {
      throw new Error('invalid cursor');
    }
    if (cursor.expiresAt && Date.parse(cursor.expiresAt) <= Date.now()) {
      throw new Error('invalid cursor');
    }

    return { cursor, legacyUnsigned: false };
  } catch {
    throw new Error('invalid cursor');
  }
}
