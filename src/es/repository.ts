import type { Client } from '@elastic/elasticsearch';
import type { FastifyBaseLogger } from 'fastify';
import { appEnvAllowed, type AuthPrincipal } from '../auth/authorize.js';
import type { AppConfig } from '../config/schema.js';
import type { BoundaryRequest } from '../schema/boundary.js';
import type { ContextRequest } from '../schema/context.js';
import type { MetaAppsQuery } from '../schema/meta.js';
import type { SearchRequest } from '../schema/search.js';
import { AppError, wrapElasticsearchError } from '../http/errors.js';
import { ensureContentTermTotal, normalizeContentTerms, normalizeValues } from '../utils/content.js';
import { clampTimeRange, ensureRangeHours, resolveOptionalTimeRange } from '../utils/time.js';
import { buildQueryHash, decodeCursor } from './cursor.js';
import { resolveRunIndexPatterns } from './indexing.js';
import { mapBoundaryRecord, mapContextLog, mapContextLogs, mapSearchResponse, type GatewayWarning } from './mappers.js';
import { buildBoundaryQuery, buildSearchQuery } from './queryBuilders.js';

const SEARCH_COLUMNS = ['index', 'id', 'timestamp', 'app', 'env', 'level', 'traceId', 'host', 'logger', 'method', 'contentPreview', 'contentTruncated'];

export interface RepositoryRequestContext {
  requestId?: string;
}

type RepositoryLogger = Pick<FastifyBaseLogger, 'warn' | 'debug'>;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

export class PlumelogRepository {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly logger?: RepositoryLogger,
  ) {}

  async close(): Promise<void> {
    await this.client.close();
  }

  async ping(timeoutMs: number): Promise<void> {
    try {
      await this.client.ping({}, { requestTimeout: timeoutMs });
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  private async timedEsCall<T>(
    operation: string,
    context: RepositoryRequestContext | undefined,
    details: Record<string, unknown>,
    action: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await action();
      const durationMs = Date.now() - startedAt;
      if (durationMs >= this.config.observability.slowQueryMs) {
        this.logger?.warn({
          requestId: context?.requestId,
          operation,
          durationMs,
          slowQueryMs: this.config.observability.slowQueryMs,
          ...details,
        }, 'slow elasticsearch query');
      } else {
        this.logger?.debug({
          requestId: context?.requestId,
          operation,
          durationMs,
          ...details,
        }, 'elasticsearch query');
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger?.warn({
        requestId: context?.requestId,
        operation,
        durationMs,
        ...details,
      }, 'elasticsearch query failed');
      throw error;
    }
  }

  private validateLimit(limit: number): void {
    if (limit < 1 || limit > this.config.limits.maxLimit) {
      throw new AppError('LIMIT_OUT_OF_RANGE', 400, { maxLimit: this.config.limits.maxLimit }, 'limit is out of range');
    }
  }

  private validateSearchRange(from: string, to: string): void {
    ensureRangeHours(from, to, this.config.limits.maxTimeRangeHours);
  }

  private validateBoundaryRange(from: string, to: string): void {
    ensureRangeHours(from, to, 31 * 24);
  }

  private normalizeFilters(filters: SearchRequest['filters']): SearchRequest['filters'] {
    const contentAll = normalizeContentTerms(filters.content?.all, this.config.limits.maxContentTermLength);
    const contentAny = normalizeContentTerms(filters.content?.any, this.config.limits.maxContentTermLength);
    const contentNot = normalizeContentTerms(filters.content?.not, this.config.limits.maxContentTermLength);
    ensureContentTermTotal([contentAll, contentAny, contentNot], this.config.limits.maxContentTerms);

    return {
      apps: normalizeValues(filters.apps),
      envs: normalizeValues(filters.envs),
      levels: normalizeValues(filters.levels),
      traceIds: normalizeValues(filters.traceIds),
      hosts: normalizeValues(filters.hosts),
      loggers: normalizeValues(filters.loggers),
      methods: normalizeValues(filters.methods),
      content: filters.content
        ? {
            all: contentAll,
            any: contentAny,
            not: contentNot,
          }
        : undefined,
    };
  }

  private async resolveExistingRunIndices(
    from: string,
    to: string,
    context?: RepositoryRequestContext,
  ): Promise<{ indices: string[]; warnings: GatewayWarning[] }> {
    const patterns = resolveRunIndexPatterns(this.config, from, to);
    const indices: string[] = [];
    const warnings: GatewayWarning[] = [];

    const resolved = await mapWithConcurrency(patterns, this.config.elasticsearch.indexResolveConcurrency, async (pattern) => {
      try {
        const exists = await this.timedEsCall(
          'indices.exists',
          context,
          { indexPattern: pattern },
          () => this.client.indices.exists({ index: pattern }),
        );
        const body = typeof exists === 'boolean' ? exists : Boolean((exists as any).body);
        return { pattern, exists: body };
      } catch (error) {
        throw wrapElasticsearchError(error);
      }
    });

    for (const result of resolved) {
      if (result.exists) {
        indices.push(result.pattern);
      } else {
        warnings.push({
          code: 'INDEX_NOT_FOUND',
          message: 'index pattern does not exist',
          details: { indexPattern: result.pattern },
        });
      }
    }

    return { indices, warnings };
  }

  private principalFilters(principal?: AuthPrincipal) {
    const filters = [];
    if (principal?.allowedApps.length) {
      filters.push({ terms: { [this.config.plumelog.fields.app]: principal.allowedApps } });
    }
    if (principal?.allowedEnvs.length) {
      filters.push({ terms: { [this.config.plumelog.fields.env]: principal.allowedEnvs } });
    }
    return filters;
  }

  async listApps(query: MetaAppsQuery, principal?: AuthPrincipal, context?: RepositoryRequestContext) {
    const timeRange = resolveOptionalTimeRange(query.from, query.to, this.config.meta.defaultTimeRangeHours);
    this.validateSearchRange(timeRange.from, timeRange.to);
    const { indices, warnings } = await this.resolveExistingRunIndices(timeRange.from, timeRange.to, context);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.apps.v1',
        timeRange,
        apps: [],
        warnings,
      };
    }

    try {
      const response = await this.timedEsCall('search.meta.apps', context, { indicesCount: indices.length }, () => this.client.search({
        index: indices,
        size: 0,
        track_total_hits: false,
        body: {
          query: {
            bool: {
              filter: [
                {
                  range: {
                    [this.config.plumelog.fields.time]: {
                      gte: timeRange.from,
                      lt: timeRange.to,
                    },
                  },
                },
                ...this.principalFilters(principal),
              ],
            },
          },
          aggs: {
            apps: {
              terms: {
                field: this.config.plumelog.fields.app,
                size: this.config.meta.appAggSize,
              },
              aggs: {
                envs: {
                  terms: {
                    field: this.config.plumelog.fields.env,
                    size: this.config.meta.envAggSize,
                  },
                },
              },
            },
          },
        },
      }));
      const appsAgg = (response as any).body.aggregations?.apps;
      const resultWarnings = [...warnings];
      if (Number(appsAgg?.sum_other_doc_count ?? 0) > 0) {
        resultWarnings.push({
          code: 'APP_AGG_TRUNCATED',
          message: 'app aggregation may be truncated',
          details: {
            size: this.config.meta.appAggSize,
            sumOtherDocCount: Number(appsAgg.sum_other_doc_count),
          },
        });
      }
      const apps = (appsAgg?.buckets ?? [])
        .filter((bucket: any) => principal?.allowedApps.length ? principal.allowedApps.includes(String(bucket.key)) : true)
        .map((bucket: any) => {
        const envAgg = bucket.envs;
        if (Number(envAgg?.sum_other_doc_count ?? 0) > 0) {
          resultWarnings.push({
            code: 'ENV_AGG_TRUNCATED',
            message: 'env aggregation may be truncated for app',
            details: {
              app: String(bucket.key),
              size: this.config.meta.envAggSize,
              sumOtherDocCount: Number(envAgg.sum_other_doc_count),
            },
          });
        }
        const envBuckets = (envAgg?.buckets ?? [])
          .filter((env: any) => principal?.allowedEnvs.length ? principal.allowedEnvs.includes(String(env.key)) : true);
        return {
          app: bucket.key,
          envs: envBuckets.map((env: any) => env.key),
        };
      });
      return {
        schema: 'plumelog.apps.v1',
        timeRange,
        apps,
        warnings: resultWarnings,
      };
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  private mapOptions(principal?: AuthPrincipal) {
    return { redactContent: !(principal?.allowRawContent ?? false) };
  }

  async searchLogs(request: SearchRequest, principal?: AuthPrincipal, context?: RepositoryRequestContext) {
    const normalizedRequest: SearchRequest = {
      ...request,
      filters: this.normalizeFilters(request.filters),
    };
    this.validateLimit(normalizedRequest.limit);
    this.validateSearchRange(normalizedRequest.timeRange.from, normalizedRequest.timeRange.to);

    const legacyQueryHash = buildQueryHash({
      timeRange: normalizedRequest.timeRange,
      filters: normalizedRequest.filters,
      limit: normalizedRequest.limit,
    });

    let cursor = null;
    let legacyUnsignedCursor = false;
    if (normalizedRequest.cursor) {
      try {
        const decoded = decodeCursor(this.config, normalizedRequest.cursor);
        cursor = decoded.cursor;
        legacyUnsignedCursor = decoded.legacyUnsigned;
      } catch {
        throw new AppError('CURSOR_INVALID', 400, {}, 'cursor is invalid');
      }
      if (legacyUnsignedCursor && this.config.search.tieBreakerField) {
        throw new AppError('CURSOR_INVALID', 400, {}, 'legacy cursor cannot be used after tie-breaker sort changes');
      }
    }
    const effectiveSortMode = cursor?.sortMode ?? 'time_seq';
    const queryHash = buildQueryHash({
      timeRange: normalizedRequest.timeRange,
      filters: normalizedRequest.filters,
      limit: normalizedRequest.limit,
      sortMode: effectiveSortMode,
      tieBreakerField: effectiveSortMode === 'time_seq' ? this.config.search.tieBreakerField : null,
    });
    if (cursor) {
      const expectedQueryHash = legacyUnsignedCursor ? legacyQueryHash : queryHash;
      if (cursor.queryHash !== expectedQueryHash) {
        throw new AppError('CURSOR_INVALID', 400, {}, 'cursor does not match current query');
      }
    }

    const { indices, warnings } = await this.resolveExistingRunIndices(normalizedRequest.timeRange.from, normalizedRequest.timeRange.to, context);
    const searchWarnings = legacyUnsignedCursor
      ? [
          ...warnings,
          {
            code: 'CURSOR_LEGACY_UNSIGNED',
            message: 'legacy unsigned cursor was accepted for compatibility; use the returned signed cursor for subsequent pages',
            details: {},
          },
        ]
      : warnings;
    if (indices.length === 0) {
      return {
        schema: 'plumelog.search.v1',
        summary: {
          total: 0,
          totalRelation: 'eq',
          totalKnown: true,
          hasMore: false,
          nextCursor: null,
        },
        columns: SEARCH_COLUMNS,
        rows: [],
        warnings: searchWarnings,
      };
    }

    const primaryCursor = cursor;
    try {
      const response = await this.timedEsCall('search.logs', context, {
        indicesCount: indices.length,
        limit: normalizedRequest.limit,
      }, () => this.client.search({
        index: indices,
        body: buildSearchQuery(this.config, normalizedRequest, primaryCursor),
      }));
      return mapSearchResponse(
        this.config,
        (response as any).body,
        primaryCursor?.sortMode ?? 'time_seq',
        queryHash,
        normalizedRequest.limit,
        searchWarnings,
        this.mapOptions(principal),
      );
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  async findBoundary(request: BoundaryRequest, principal?: AuthPrincipal, context?: RepositoryRequestContext) {
    this.validateBoundaryRange(request.timeRange.from, request.timeRange.to);

    const normalizedRequest: BoundaryRequest = {
      ...request,
      filters: this.normalizeFilters(request.filters),
    };

    const { indices, warnings } = await this.resolveExistingRunIndices(normalizedRequest.timeRange.from, normalizedRequest.timeRange.to, context);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.boundary.v1',
        record: null,
        warnings,
      };
    }

    try {
      const response = await this.timedEsCall('search.boundary', context, {
        indicesCount: indices.length,
        direction: normalizedRequest.direction,
      }, () => this.client.search({
        index: indices,
        body: buildBoundaryQuery(this.config, normalizedRequest, normalizedRequest.direction, 'time_seq'),
      }));
      const hit = (response as any).body?.hits?.hits?.[0] ?? null;
      return {
        schema: 'plumelog.boundary.v1',
        record: hit ? mapBoundaryRecord(this.config, hit, this.mapOptions(principal)) : null,
        warnings,
      };
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

  private async getCenterLog(index: string, id: string, context?: RepositoryRequestContext) {
    try {
      const response = await this.timedEsCall('get.context.center', context, { index }, () => this.client.get({ index, id }));
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

  private async getLogsByTraceId(
    indices: string[],
    traceId: string,
    from: string,
    to: string,
    limit: number,
    principal?: AuthPrincipal,
    context?: RepositoryRequestContext,
  ) {
    try {
      return await this.timedEsCall('search.context.trace', context, { indicesCount: indices.length, limit }, () => this.client.search({
        index: indices,
        size: limit,
        body: {
          query: {
            bool: {
              filter: [
                { term: { [this.config.plumelog.fields.traceId]: traceId } },
                { range: { [this.config.plumelog.fields.time]: { gte: from, lt: to } } },
                ...this.principalFilters(principal),
              ],
            },
          },
          sort: [{ [this.config.plumelog.fields.time]: { order: 'asc' } }],
        },
      }));
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  private async getNearbyLogs(
    indices: string[],
    app: string,
    host: string,
    from: string,
    to: string,
    limit: number,
    principal?: AuthPrincipal,
    context?: RepositoryRequestContext,
  ) {
    try {
      return await this.timedEsCall('search.context.nearby', context, { indicesCount: indices.length, limit }, () => this.client.search({
        index: indices,
        size: limit,
        body: {
          query: {
            bool: {
              filter: [
                { term: { [this.config.plumelog.fields.app]: app } },
                { term: { [this.config.plumelog.fields.host]: host } },
                { range: { [this.config.plumelog.fields.time]: { gte: from, lt: to } } },
                ...this.principalFilters(principal),
              ],
            },
          },
          sort: [{ [this.config.plumelog.fields.time]: { order: 'asc' } }],
        },
      }));
    } catch (error) {
      throw wrapElasticsearchError(error);
    }
  }

  async getContext(request: ContextRequest, principal?: AuthPrincipal, context?: RepositoryRequestContext) {
    this.validateLimit(request.limit);
    this.validateSearchRange(request.timeRange.from, request.timeRange.to);
    if ((request.context?.timeWindowSeconds ?? this.config.limits.contextDefaultWindowSeconds) > this.config.limits.contextMaxWindowSeconds) {
      throw new AppError('INVALID_REQUEST', 400, { maxWindowSeconds: this.config.limits.contextMaxWindowSeconds }, 'context window exceeds allowed maximum');
    }

    let center: any = null;
    if (request.center) {
      this.validateCenterIndex(request.center.index, request.timeRange.from, request.timeRange.to);
      center = await this.getCenterLog(request.center.index, request.center.id, context);
      if (!appEnvAllowed(
        principal,
        center._source?.[this.config.plumelog.fields.app],
        center._source?.[this.config.plumelog.fields.env],
      )) {
        throw new AppError('FORBIDDEN', 403, {}, 'center log exceeds API key limit');
      }
    }

    const traceId = request.traceId ?? center?._source?.[this.config.plumelog.fields.traceId] ?? null;
    const { indices, warnings } = await this.resolveExistingRunIndices(request.timeRange.from, request.timeRange.to, context);
    if (indices.length === 0) {
      return {
        schema: 'plumelog.context.v1',
        center: center ? mapContextLog(this.config, center, this.mapOptions(principal)) : null,
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
      const traceLogsResponse = await this.getLogsByTraceId(
        indices,
        traceId,
        request.timeRange.from,
        request.timeRange.to,
        request.limit,
        principal,
        context,
      );
      return {
        schema: 'plumelog.context.v1',
        center: center ? mapContextLog(this.config, center, this.mapOptions(principal)) : null,
        traceLogs: mapContextLogs(this.config, (traceLogsResponse as any).body, this.mapOptions(principal)),
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
      principal,
      context,
    );

    return {
      schema: 'plumelog.context.v1',
      center: mapContextLog(this.config, center, this.mapOptions(principal)),
      traceLogs: [],
      nearbyLogs: mapContextLogs(this.config, (nearbyLogsResponse as any).body, this.mapOptions(principal)),
      resolution: {
        mode: 'timeWindow',
        reason: 'traceId missing, fell back to app + host window',
      },
      warnings,
    };
  }
}
