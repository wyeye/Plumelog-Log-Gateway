import type { AppConfig } from '../config/schema.js';
import { buildContentPreview } from '../utils/content.js';
import { encodeCursor, type SearchCursor } from './cursor.js';

export interface GatewayWarning {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

const SEARCH_COLUMNS = [
  'index',
  'id',
  'timestamp',
  'app',
  'env',
  'level',
  'traceId',
  'host',
  'logger',
  'method',
  'contentPreview',
  'contentTruncated',
] as const;

function safeIso(value: unknown): string {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function safeEpoch(value: unknown): number {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function mapSearchResponse(
  config: AppConfig,
  response: any,
  sortMode: SearchCursor['sortMode'],
  queryHash: string,
  limit: number,
  warnings: GatewayWarning[] = [],
) {
  const hits = response.hits?.hits ?? [];
  const hasMore = hits.length > limit;
  const pageHits = hits.slice(0, limit);
  const rows = pageHits.map((hit: any) => {
    const source = hit._source ?? {};
    const preview = buildContentPreview(
      String(source[config.plumelog.fields.message] ?? ''),
      config.limits.contentPreviewChars,
    );
    return [
      String(hit._index ?? ''),
      String(hit._id ?? ''),
      safeIso(source[config.plumelog.fields.time]),
      source[config.plumelog.fields.app] ?? null,
      source[config.plumelog.fields.env] ?? null,
      source[config.plumelog.fields.level] ?? null,
      source[config.plumelog.fields.traceId] ?? null,
      source[config.plumelog.fields.host] ?? null,
      source[config.plumelog.fields.logger] ?? null,
      source[config.plumelog.fields.method] ?? null,
      preview.contentPreview,
      preview.contentTruncated,
    ];
  });
  const lastSort = hasMore && pageHits.length > 0 ? pageHits[pageHits.length - 1].sort : null;
  const total = response.hits?.total;
  const totalValue = typeof total === 'number' ? total : total?.value ?? 0;
  const totalRelation = config.search.trackTotalHits === false
    ? 'gte'
    : typeof total === 'number' ? 'eq' : total?.relation ?? 'eq';
  const totalKnown = config.search.trackTotalHits !== false && totalRelation === 'eq';

  return {
    schema: 'plumelog.search.v1',
    summary: {
      total: totalValue,
      totalRelation,
      totalKnown,
      hasMore,
      nextCursor: lastSort
        ? encodeCursor(config, { sortMode, values: lastSort, queryHash })
        : null,
    },
    columns: [...SEARCH_COLUMNS],
    rows,
    warnings,
  };
}

export function mapBoundaryRecord(config: AppConfig, hit: any) {
  if (!hit) {
    return null;
  }

  const source = hit._source ?? {};
  const preview = buildContentPreview(
    String(source[config.plumelog.fields.message] ?? ''),
    config.limits.contentPreviewChars,
  );

  return {
    timestamp: safeIso(source[config.plumelog.fields.time]),
    app: source[config.plumelog.fields.app] ?? null,
    env: source[config.plumelog.fields.env] ?? null,
    index: String(hit._index ?? ''),
    id: String(hit._id ?? ''),
    contentPreview: preview.contentPreview,
  };
}

export function mapContextLog(config: AppConfig, hit: any) {
  const source = hit._source ?? {};
  return {
    source: {
      index: String(hit._index ?? ''),
    },
    id: String(hit._id ?? ''),
    timestamp: safeIso(source[config.plumelog.fields.time]),
    epochMillis: safeEpoch(source[config.plumelog.fields.time]),
    app: source[config.plumelog.fields.app] ?? null,
    env: source[config.plumelog.fields.env] ?? null,
    level: source[config.plumelog.fields.level] ?? null,
    traceId: source[config.plumelog.fields.traceId] ?? null,
    host: source[config.plumelog.fields.host] ?? null,
    thread: source[config.plumelog.fields.thread] ?? null,
    logger: source[config.plumelog.fields.logger] ?? null,
    method: source[config.plumelog.fields.method] ?? null,
    content: String(source[config.plumelog.fields.message] ?? ''),
    truncated: false,
    sort: hit.sort ?? [],
  };
}

export function mapContextLogs(config: AppConfig, response: any) {
  return (response.hits?.hits ?? response.body?.hits?.hits ?? []).map((hit: any) => mapContextLog(config, hit));
}
