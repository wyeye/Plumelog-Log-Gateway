import type { Client } from '@elastic/elasticsearch';
import type { AppConfig } from '../config/schema.js';
import type { ContextRequest } from '../schema/context.js';
import type { MetaAppsQuery } from '../schema/meta.js';
import type { SearchRequest } from '../schema/search.js';
import { AppError, wrapElasticsearchError } from '../http/errors.js';
import { ensureContentTermTotal, normalizeContentTerms, normalizeValues } from '../utils/content.js';
import { clampTimeRange, ensureRangeHours, resolveOptionalTimeRange } from '../utils/time.js';
import { buildQueryHash, decodeCursor } from './cursor.js';
import { resolveRunIndexPatterns } from './indexing.js';
import { mapContextLog, mapContextLogs, mapSearchResponse, type GatewayWarning } from './mappers.js';
import { buildSearchQuery } from './queryBuilders.js';

const SEARCH_COLUMNS = ['index', 'id', 'timestamp', 'app', 'env', 'level', 'traceId', 'host', 'logger', 'method', 'contentPreview', 'contentTruncated'];

export class PlumelogRepository {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
  ) {}

  async close(): Promise<void> {
    await this.client.close();
  }

  private validateLimit(limit: number): void {
    if (limit < 1 || limit > this.config.limits.maxLimit) {
      throw new AppError('LIMIT_OUT_OF_RANGE', 400, { maxLimit: this.config.limits.maxLimit }, 'limit is out of range');
    }
  }

  private validateSearchRange(from: string, to: string): void {
    ensureRangeHours(from, to, this.config.limits.maxTimeRangeHours);
  }

  private async resolveExistingRunIndices(from: string, to: string): Promise<{ indices: string[]; warnings: GatewayWarning[] }> {
    const patterns = resolveRunIndexPatterns(this.config, from, to);
    const indices: string[] = [];
    const warnings: GatewayWarning[] = [];

    for (const pattern of patterns) {
      try {
        const exists = await this.client.indices.exists({ index: pattern });
        const body = typeof exists === 'boolean' ? exists : Boolean((exists as any).body);
        if (body) {
          indices.push(pattern);
        } else {
          warnings.push({
            code: 'INDEX_NOT_FOUND',
            message: 'index pattern does not exist',
            details: { indexPattern: pattern },
          });
        }
      } catch (error) {
        throw wrapElasticsearchError(error);
      }
    }

    return { indices, warnings };
  }

  async listApps(query: MetaAppsQuery) {
    const timeRange = resolveOptionalTimeRange(query.from, query.to, this.config.meta.defaultTimeRangeHours);
    this.validateSearchRange(timeRange.from, timeRange.to);
    const { indices, warnings } = await this.resolveExistingRunIndices(timeRange.from, timeRange.to);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.apps.v1',
        timeRange,
        apps: [],
        warnings,
      };
    }

    try {
      const response = await this.client.search({
        index: indices,
        size: 0,
        track_total_hits: false,
        body: {
          query: {
            range: {
              [this.config.plumelog.fields.time]: {
                gte: timeRange.from,
                lt: timeRange.to,
              },
            },
          },
          aggs: {
            apps: {
              terms: {
                field: this.config.plumelog.fields.app,
                size: 200,
              },
              aggs: {
                envs: {
                  terms: {
                    field: this.config.plumelog.fields.env,
                    size: 50,
                  },
                },
              },
            },
          },
        },
      });
      return {
        schema: 'plumelog.apps.v1',
        timeRange,
        apps: ((response as any).body.aggregations?.apps?.buckets ?? []).map((bucket: any) => ({
          app: bucket.key,
          envs: (bucket.envs?.buckets ?? []).map((env: any) => env.key),
        })),
        warnings,
      };
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  async searchLogs(request: SearchRequest) {
    const contentAll = normalizeContentTerms(request.filters.content?.all, this.config.limits.maxContentTermLength);
    const contentAny = normalizeContentTerms(request.filters.content?.any, this.config.limits.maxContentTermLength);
    const contentNot = normalizeContentTerms(request.filters.content?.not, this.config.limits.maxContentTermLength);
    ensureContentTermTotal([contentAll, contentAny, contentNot], this.config.limits.maxContentTerms);

    const normalizedRequest: SearchRequest = {
      ...request,
      filters: {
        ...request.filters,
        apps: normalizeValues(request.filters.apps),
        envs: normalizeValues(request.filters.envs),
        levels: normalizeValues(request.filters.levels),
        traceIds: normalizeValues(request.filters.traceIds),
        hosts: normalizeValues(request.filters.hosts),
        loggers: normalizeValues(request.filters.loggers),
        methods: normalizeValues(request.filters.methods),
        content: request.filters.content
          ? {
              all: contentAll,
              any: contentAny,
              not: contentNot,
            }
          : undefined,
      },
    };
    this.validateLimit(normalizedRequest.limit);
    this.validateSearchRange(normalizedRequest.timeRange.from, normalizedRequest.timeRange.to);

    const queryHash = buildQueryHash({
      timeRange: normalizedRequest.timeRange,
      filters: normalizedRequest.filters,
      limit: normalizedRequest.limit,
    });

    let cursor = null;
    if (normalizedRequest.cursor) {
      try {
        cursor = decodeCursor(normalizedRequest.cursor);
      } catch {
        throw new AppError('CURSOR_INVALID', 400, {}, 'cursor is invalid');
      }
      if (cursor.queryHash !== queryHash) {
        throw new AppError('CURSOR_INVALID', 400, {}, 'cursor does not match current query');
      }
    }

    const { indices, warnings } = await this.resolveExistingRunIndices(normalizedRequest.timeRange.from, normalizedRequest.timeRange.to);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.search.v1',
        summary: {
          total: 0,
          totalRelation: 'eq',
          hasMore: false,
          nextCursor: null,
        },
        columns: SEARCH_COLUMNS,
        rows: [],
        warnings,
      };
    }

    const primaryCursor = cursor;
    try {
      const response = await this.client.search({
        index: indices,
        body: buildSearchQuery(this.config, normalizedRequest, primaryCursor),
      });
      return mapSearchResponse(
        this.config,
        (response as any).body,
        primaryCursor?.sortMode ?? 'time_seq',
        queryHash,
        normalizedRequest.limit,
        warnings,
      );
    } catch (error) {
      if (!String(error).includes(this.config.plumelog.fields.seq)) {
        throw wrapElasticsearchError(error);
      }
    }

    try {
      const fallbackCursor = primaryCursor ? { ...primaryCursor, sortMode: 'time_only' as const } : null;
      const response = await this.client.search({
        index: indices,
        body: buildSearchQuery(this.config, normalizedRequest, fallbackCursor),
      });
      return mapSearchResponse(this.config, (response as any).body, 'time_only', queryHash, normalizedRequest.limit, [
        ...warnings,
        {
          code: 'SEQ_SORT_UNAVAILABLE',
          message: 'seq field is unavailable; falling back to dtTime-only sort',
          details: {},
        },
      ]);
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  private validateCenterIndex(index: string, from: string, to: string): void {
    if (!index.startsWith(this.config.plumelog.runIndexPrefix)) {
      throw new AppError('INVALID_REQUEST', 400, { index }, 'center.index is invalid');
    }
    const allowedPrefixes = resolveRunIndexPatterns(this.config, from, to).map((pattern) => pattern.slice(0, -1));
    if (!allowedPrefixes.some((prefix) => index.startsWith(prefix))) {
      throw new AppError('INVALID_REQUEST', 400, { index }, 'center.index is outside requested time range');
    }
  }

  private async getCenterLog(index: string, id: string) {
    try {
      const response = await this.client.get({ index, id });
      return {
        _index: (response as any).body._index,
        _id: (response as any).body._id,
        _source: (response as any).body._source,
        sort: [],
      };
    } catch (error: any) {
      const statusCode = error?.meta?.statusCode;
      if (statusCode === 404) {
        throw new AppError('CENTER_LOG_NOT_FOUND', 404, { index, id }, 'center log not found');
      }
      throw wrapElasticsearchError(error);
    }
  }

  private async getLogsByTraceId(indices: string[], traceId: string, from: string, to: string, limit: number) {
    try {
      return await this.client.search({
        index: indices,
        size: limit,
        body: {
          query: {
            bool: {
              filter: [
                { term: { [this.config.plumelog.fields.traceId]: traceId } },
                { range: { [this.config.plumelog.fields.time]: { gte: from, lt: to } } },
              ],
            },
          },
          sort: [{ [this.config.plumelog.fields.time]: { order: 'asc' } }],
        },
      });
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  private async getNearbyLogs(indices: string[], app: string, host: string, from: string, to: string, limit: number) {
    try {
      return await this.client.search({
        index: indices,
        size: limit,
        body: {
          query: {
            bool: {
              filter: [
                { term: { [this.config.plumelog.fields.app]: app } },
                { term: { [this.config.plumelog.fields.host]: host } },
                { range: { [this.config.plumelog.fields.time]: { gte: from, lt: to } } },
              ],
            },
          },
          sort: [{ [this.config.plumelog.fields.time]: { order: 'asc' } }],
        },
      });
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  async getContext(request: ContextRequest) {
    this.validateLimit(request.limit);
    this.validateSearchRange(request.timeRange.from, request.timeRange.to);
    if ((request.context?.timeWindowSeconds ?? this.config.limits.contextDefaultWindowSeconds) > this.config.limits.contextMaxWindowSeconds) {
      throw new AppError('INVALID_REQUEST', 400, { maxWindowSeconds: this.config.limits.contextMaxWindowSeconds }, 'context window exceeds allowed maximum');
    }

    let center: any = null;
    if (request.center) {
      this.validateCenterIndex(request.center.index, request.timeRange.from, request.timeRange.to);
      center = await this.getCenterLog(request.center.index, request.center.id);
    }

    const traceId = request.traceId ?? center?._source?.[this.config.plumelog.fields.traceId] ?? null;
    const { indices, warnings } = await this.resolveExistingRunIndices(request.timeRange.from, request.timeRange.to);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.context.v1',
        center: center ? mapContextLog(this.config, center) : null,
        traceLogs: [],
        nearbyLogs: [],
        resolution: {
          mode: traceId ? 'traceId' : 'timeWindow',
          reason: 'no run indices found for requested time range',
        },
        warnings,
      };
    }

    if (traceId) {
      const traceLogsResponse = await this.getLogsByTraceId(indices, traceId, request.timeRange.from, request.timeRange.to, request.limit);
      return {
        schema: 'plumelog.context.v1',
        center: center ? mapContextLog(this.config, center) : null,
        traceLogs: mapContextLogs(this.config, (traceLogsResponse as any).body),
        nearbyLogs: [],
        resolution: {
          mode: 'traceId',
          reason: 'traceId provided or found on center log',
        },
        warnings,
      };
    }

    if (!center?._source) {
      throw new AppError('CENTER_LOG_NOT_FOUND', 404, {}, 'center log not found');
    }

    const centerTime = String(center._source[this.config.plumelog.fields.time] ?? request.timeRange.from);
    const nearbyRange = clampTimeRange(
      request.timeRange.from,
      request.timeRange.to,
      centerTime,
      request.context?.timeWindowSeconds ?? this.config.limits.contextDefaultWindowSeconds,
    );
    const nearbyLogsResponse = await this.getNearbyLogs(
      indices,
      String(center._source[this.config.plumelog.fields.app] ?? ''),
      String(center._source[this.config.plumelog.fields.host] ?? ''),
      nearbyRange.from,
      nearbyRange.to,
      request.limit,
    );

    return {
      schema: 'plumelog.context.v1',
      center: mapContextLog(this.config, center),
      traceLogs: [],
      nearbyLogs: mapContextLogs(this.config, (nearbyLogsResponse as any).body),
      resolution: {
        mode: 'timeWindow',
        reason: 'traceId missing, fell back to app + host window',
      },
      warnings,
    };
  }
}
