import type { AppConfig } from '../config/schema.js';
import { buildContentPreview } from '../utils/content.js';
import { encodeCursor, type SearchCursor } from './cursor.js';

export interface GatewayWarning {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface MapLogOptions {
  contentMode?: 'preview' | 'full';
}

const BASE_SEARCH_COLUMNS = [
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
] as const;

export function searchColumnsForMode(contentMode: MapLogOptions['contentMode']): string[] {
  return contentMode === 'full'
    ? [...BASE_SEARCH_COLUMNS, 'content']
    : [...BASE_SEARCH_COLUMNS, 'contentPreview', 'contentTruncated'];
}

function safeIso(value: unknown): string {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function safeEpoch(value: unknown): number {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function logContent(config: AppConfig, source: Record<string, unknown>, options: MapLogOptions = {}): string {
  return String(source[config.plumelog.fields.message] ?? '');
}

export function mapSearchResponse(
  config: AppConfig,
  response: any,
  sortMode: SearchCursor['sortMode'],
  queryHash: string,
  limit: number,
  warnings: GatewayWarning[] = [],
  options: MapLogOptions = {},
) {
  const hits = response.hits?.hits ?? [];
  const hasMore = hits.length > limit;
  const pageHits = hits.slice(0, limit);
  const contentMode = options.contentMode ?? 'preview';
  const rows = pageHits.map((hit: any) => {
    const source = hit._source ?? {};
    const content = logContent(config, source, options);
    const preview = buildContentPreview(content, config.limits.contentPreviewChars);
    const baseRow = [
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
    ];

    return contentMode === 'full'
      ? [...baseRow, content]
      : [...baseRow, preview.contentPreview, preview.contentTruncated];
  });
  const lastSort = hasMore && pageHits.length > 0 ? pageHits[pageHits.length - 1].sort : null;
  const total = response.hits?.total;
  const totalValue = config.search.trackTotalHits === false
    ? null
    : typeof total === 'number' ? total : total?.value ?? 0;
  const totalRelation = config.search.trackTotalHits === false
    ? 'gte'
    : typeof total === 'number' ? 'eq' : total?.relation ?? 'eq';
  const totalKnown = config.search.trackTotalHits !== false && totalRelation === 'eq';
  const returnedCount = rows.length;

  return {
    schema: 'plumelog.search.v1',
    summary: {
      total: totalValue,
      totalRelation,
      totalKnown,
      returnedCount,
      hasMore,
      nextCursor: lastSort
        ? encodeCursor(config, {
            sortMode,
            tieBreakerType: config.search.tieBreakerField ? config.search.tieBreakerType : undefined,
            values: lastSort,
            queryHash,
          })
        : null,
    },
    columns: searchColumnsForMode(contentMode),
    rows,
    warnings,
  };
}

export function mapBoundaryRecord(config: AppConfig, hit: any, options: MapLogOptions = {}) {
  if (!hit) {
    return null;
  }

  const source = hit._source ?? {};
  const preview = buildContentPreview(
    logContent(config, source, options),
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

export function mapContextLog(config: AppConfig, hit: any, options: MapLogOptions = {}) {
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
    content: logContent(config, source, options),
    truncated: false,
    sort: hit.sort ?? [],
  };
}

export function mapContextLogs(config: AppConfig, response: any, options: MapLogOptions = {}) {
  return (response.hits?.hits ?? response.body?.hits?.hits ?? []).map((hit: any) => mapContextLog(config, hit, options));
}
