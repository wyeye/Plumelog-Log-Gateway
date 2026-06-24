import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { SearchRequest, SearchResponse } from '../schema/search.js';
import type { ExportLogsCsvRequest, SearchLogsAllPagesRequest, SearchLogsAutoRequest } from '../schema/mcp.js';
import { buildQueryHash } from '../es/cursor.js';
import { GatewayClient, GatewayClientError, type GatewayResponseMeta } from './gatewayClient.js';

interface ToolWarning {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface ToolFailure {
  code: string;
  message: string;
  status: number;
  requestId: string;
  details?: Record<string, unknown>;
}

interface CollectedPage {
  columns: string[];
  rows: unknown[][];
  hasMore: boolean;
  nextCursor: string | null;
  warnings: ToolWarning[];
  meta: GatewayResponseMeta;
}

interface CollectSummary {
  pagesFetched: number;
  rowsCollected: number;
  reachedMaxRows: boolean;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

interface PartialCollectionState {
  columns: string[];
  rows: unknown[][];
  warnings: ToolWarning[];
  summary: CollectSummary;
  diagnostics: { pageDurationsMs: number[]; requestIds: string[] };
}

interface SearchAggregateResult {
  schema: 'plumelog.search.aggregated.v1';
  mode: 'all_pages' | 'auto_slice';
  queryDigest: string;
  partialResult: boolean;
  columns: string[];
  rows: unknown[][];
  warnings: ToolWarning[];
  failures: ToolFailure[];
  summary: {
    totalRows: number;
    pagesFetched: number;
    slicesProcessed: number;
    slicesSucceeded: number;
    slicesFailed: number;
    reachedMaxRows: boolean;
    reachedMaxPages: boolean;
    hasMore: boolean;
  };
  diagnostics: {
    totalDurationMs: number;
    pageDurationsMs: number[];
    requestIds: string[];
    sliceRanges: Array<{ from: string; to: string; status: 'success' | 'partial' | 'failed' }>;
  };
}

interface ExportCsvResult {
  schema: 'plumelog.export.csv.v1';
  filePath: string;
  bytes: number;
  rowCount: number;
  partialResult: boolean;
  warnings: ToolWarning[];
  failures: ToolFailure[];
  queryDigest: string;
  diagnostics: SearchAggregateResult['diagnostics'];
  inlineCsv?: string;
}

interface SliceRange {
  from: string;
  to: string;
}

class PageCollectionError extends Error {
  constructor(
    public readonly cause: GatewayClientError,
    public readonly partial: PartialCollectionState,
  ) {
    super(cause.message);
  }
}

function createQueryDigest(request: Pick<SearchRequest, 'timeRange' | 'filters' | 'limit' | 'contentMode'>): string {
  return buildQueryHash({
    timeRange: request.timeRange,
    filters: request.filters,
    limit: request.limit,
    contentMode: request.contentMode,
  });
}

function cloneRequest(request: SearchRequest, overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    ...request,
    ...overrides,
    filters: overrides.filters ?? request.filters,
    timeRange: overrides.timeRange ?? request.timeRange,
  };
}

function mergeWarnings(target: ToolWarning[], incoming: ToolWarning[]): ToolWarning[] {
  const seen = new Set(target.map((item) => `${item.code}:${JSON.stringify(item.details)}`));
  for (const warning of incoming) {
    const key = `${warning.code}:${JSON.stringify(warning.details)}`;
    if (!seen.has(key)) {
      target.push(warning);
      seen.add(key);
    }
  }
  return target;
}

function pushWarning(target: ToolWarning[], warning: ToolWarning): void {
  mergeWarnings(target, [warning]);
}

function summaryHitMaxRows(summary: CollectSummary, maxRows: number | undefined): boolean {
  return maxRows !== undefined && summary.reachedMaxRows && summary.hasMore;
}

function toToolFailure(error: GatewayClientError, extra: Record<string, unknown> = {}): ToolFailure {
  return {
    code: error.payload.code,
    message: error.payload.message,
    status: error.payload.status,
    requestId: error.payload.requestId,
    details: {
      ...error.payload.details,
      ...extra,
    },
  };
}

function isSliceableError(error: GatewayClientError): boolean {
  return error.payload.code === 'GATEWAY_TIMEOUT'
    || error.payload.code === 'ES_TIMEOUT'
    || error.payload.code === 'INDEX_RESOLVE_TIMEOUT';
}

function splitRange(from: string, to: string): [SliceRange, SliceRange] | null {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 60_000) {
    return null;
  }
  const midpoint = start + Math.floor((end - start) / 2);
  if (midpoint <= start || midpoint >= end) {
    return null;
  }
  const midpointIso = new Date(midpoint).toISOString();
  return [
    { from: midpointIso, to },
    { from, to: midpointIso },
  ];
}

function buildFixedSlices(range: SliceRange, sliceMinutes: number): SliceRange[] {
  const start = new Date(range.from).getTime();
  const end = new Date(range.to).getTime();
  const step = sliceMinutes * 60_000;
  const slices: SliceRange[] = [];
  for (let cursor = end; cursor > start; cursor -= step) {
    const sliceStart = Math.max(start, cursor - step);
    slices.push({
      from: new Date(sliceStart).toISOString(),
      to: new Date(cursor).toISOString(),
    });
  }
  return slices;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function defaultExportPath(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return resolve(tmpdir(), `plumelog-export-${stamp}.csv`);
}

async function fetchPage(client: GatewayClient, request: SearchRequest): Promise<CollectedPage> {
  const response = await client.searchLogsDetailed(request);
  const data = response.data;
  return {
    columns: data.columns,
    rows: data.rows,
    hasMore: data.summary.hasMore,
    nextCursor: data.summary.nextCursor,
    warnings: data.warnings,
    meta: response.meta,
  };
}

async function collectAllPages(
  client: GatewayClient,
  request: SearchRequest,
  options: { maxPages?: number; maxRows?: number; allowPartial: boolean; captureProgressOnError?: boolean },
): Promise<{
  columns: string[];
  rows: unknown[][];
  warnings: ToolWarning[];
  failures: ToolFailure[];
  summary: CollectSummary;
  diagnostics: { pageDurationsMs: number[]; requestIds: string[] };
}> {
  const rows: unknown[][] = [];
  const warnings: ToolWarning[] = [];
  const failures: ToolFailure[] = [];
  const pageDurationsMs: number[] = [];
  const requestIds: string[] = [];
  let columns: string[] = [];
  let cursor = request.cursor ?? null;
  let hasMore = false;
  let pagesFetched = 0;
  let reachedMaxRows = false;
  let reachedMaxPages = false;

  while (true) {
    if (options.maxPages !== undefined && pagesFetched >= options.maxPages) {
      reachedMaxPages = true;
      hasMore = true;
      break;
    }

    const remainingRows = options.maxRows === undefined ? undefined : options.maxRows - rows.length;
    if (remainingRows !== undefined && remainingRows <= 0) {
      reachedMaxRows = true;
      hasMore = true;
      break;
    }

    const pageLimit = remainingRows !== undefined ? Math.min(request.limit, remainingRows) : request.limit;
    const pageRequest = cloneRequest(request, { cursor, limit: pageLimit });

    try {
      const page = await fetchPage(client, pageRequest);
      pagesFetched += 1;
      pageDurationsMs.push(page.meta.durationMs);
      requestIds.push(page.meta.requestId);

      if (columns.length === 0) {
        columns = page.columns;
      }

      rows.push(...page.rows);
      mergeWarnings(warnings, page.warnings);
      hasMore = page.hasMore;
      cursor = page.nextCursor;

      if (remainingRows !== undefined && rows.length >= options.maxRows!) {
        reachedMaxRows = true;
        break;
      }

      if (!hasMore || !cursor) {
        break;
      }
    } catch (error) {
      if (error instanceof GatewayClientError && options.captureProgressOnError) {
        throw new PageCollectionError(error, {
          columns,
          rows: [...rows],
          warnings: [...warnings],
          summary: {
            pagesFetched,
            rowsCollected: rows.length,
            reachedMaxRows,
            reachedMaxPages,
            hasMore: true,
          },
          diagnostics: {
            pageDurationsMs: [...pageDurationsMs],
            requestIds: [...requestIds],
          },
        });
      }
      if (error instanceof GatewayClientError && options.allowPartial) {
        failures.push(toToolFailure(error, {
          pagingPosition: pagesFetched === 0 ? 'first_page' : 'after_previous_page',
          queryDigest: createQueryDigest(request),
        }));
        hasMore = true;
        break;
      }
      throw error;
    }
  }

  return {
    columns,
    rows,
    warnings,
    failures,
    summary: {
      pagesFetched,
      rowsCollected: rows.length,
      reachedMaxRows,
      reachedMaxPages,
      hasMore,
    },
    diagnostics: {
      pageDurationsMs,
      requestIds,
    },
  };
}

export async function searchLogsAllPages(client: GatewayClient, request: SearchLogsAllPagesRequest): Promise<SearchAggregateResult> {
  const startedAt = Date.now();
  const queryDigest = createQueryDigest(request);
  const collected = await collectAllPages(client, request, {
    maxPages: request.maxPages,
    maxRows: request.maxRows,
    allowPartial: request.allowPartial,
  });

  if (collected.summary.reachedMaxPages) {
    pushWarning(collected.warnings, {
      code: 'MAX_PAGES_REACHED',
      message: 'stopped before consuming all pages',
      details: { maxPages: request.maxPages },
    });
  }
  const hitMaxRows = summaryHitMaxRows(collected.summary, request.maxRows);

  if (hitMaxRows) {
    pushWarning(collected.warnings, {
      code: 'MAX_ROWS_REACHED',
      message: 'stopped before collecting all rows',
      details: { maxRows: request.maxRows },
    });
  }

  return {
    schema: 'plumelog.search.aggregated.v1',
    mode: 'all_pages',
    queryDigest,
    partialResult: collected.failures.length > 0 || collected.summary.reachedMaxPages || hitMaxRows,
    columns: collected.columns,
    rows: collected.rows,
    warnings: collected.warnings,
    failures: collected.failures,
    summary: {
      totalRows: collected.rows.length,
      pagesFetched: collected.summary.pagesFetched,
      slicesProcessed: 1,
      slicesSucceeded: collected.failures.length > 0 ? 0 : 1,
      slicesFailed: collected.failures.length > 0 ? 1 : 0,
      reachedMaxRows: hitMaxRows,
      reachedMaxPages: collected.summary.reachedMaxPages,
      hasMore: collected.summary.hasMore,
    },
    diagnostics: {
      totalDurationMs: Date.now() - startedAt,
      pageDurationsMs: collected.diagnostics.pageDurationsMs,
      requestIds: collected.diagnostics.requestIds,
      sliceRanges: [{
        from: request.timeRange.from,
        to: request.timeRange.to,
        status: collected.failures.length > 0 ? 'partial' : 'success',
      }],
    },
  };
}

export async function searchLogsAuto(client: GatewayClient, request: SearchLogsAutoRequest): Promise<SearchAggregateResult> {
  const startedAt = Date.now();
  const queryDigest = createQueryDigest(request);
  const rows: unknown[][] = [];
  const warnings: ToolWarning[] = [];
  const failures: ToolFailure[] = [];
  const requestIds: string[] = [];
  const pageDurationsMs: number[] = [];
  const sliceRanges: SearchAggregateResult['diagnostics']['sliceRanges'] = [];
  const queue = request.sliceMinutes
    ? buildFixedSlices(request.timeRange, request.sliceMinutes)
    : [{ from: request.timeRange.from, to: request.timeRange.to }];
  let columns: string[] = [];
  let pagesFetched = 0;
  let slicesProcessed = 0;
  let slicesSucceeded = 0;
  let reachedMaxPages = false;
  let reachedMaxRows = false;
  let hasMore = false;

  while (queue.length > 0) {
    if (request.maxRows !== undefined && rows.length >= request.maxRows) {
      reachedMaxRows = true;
      hasMore = true;
      break;
    }
    if (request.maxPages !== undefined && pagesFetched >= request.maxPages) {
      reachedMaxPages = true;
      hasMore = true;
      break;
    }

    const slice = queue.shift()!;
    const sliceRequest = cloneRequest(request, {
      timeRange: { from: slice.from, to: slice.to },
      cursor: null,
    });

    try {
      const collected = await collectAllPages(client, sliceRequest, {
        allowPartial: false,
        captureProgressOnError: true,
        maxPages: request.maxPages === undefined ? undefined : request.maxPages - pagesFetched,
        maxRows: request.maxRows === undefined ? undefined : request.maxRows - rows.length,
      });
      pagesFetched += collected.summary.pagesFetched;
      slicesProcessed += 1;
      slicesSucceeded += collected.failures.length > 0 ? 0 : 1;
      if (columns.length === 0) {
        columns = collected.columns;
      }
      rows.push(...collected.rows);
      mergeWarnings(warnings, collected.warnings);
      failures.push(...collected.failures);
      requestIds.push(...collected.diagnostics.requestIds);
      pageDurationsMs.push(...collected.diagnostics.pageDurationsMs);
      hasMore = hasMore || collected.summary.hasMore;
      if (collected.summary.reachedMaxPages) {
        reachedMaxPages = true;
      }
      if (summaryHitMaxRows(collected.summary, request.maxRows)) {
        reachedMaxRows = true;
      }
      sliceRanges.push({
        from: slice.from,
        to: slice.to,
        status: collected.failures.length > 0 ? 'partial' : 'success',
      });
      if (reachedMaxPages || reachedMaxRows) {
        break;
      }
    } catch (error) {
      const gatewayError = error instanceof PageCollectionError ? error.cause : error;
      const partial = error instanceof PageCollectionError ? error.partial : null;

      if (!(gatewayError instanceof GatewayClientError)) {
        throw error;
      }

      const split = splitRange(slice.from, slice.to);
      if (split && isSliceableError(gatewayError)) {
        pushWarning(warnings, {
          code: 'AUTO_SLICE_RETRY',
          message: 'slice timed out and was split into smaller ranges',
          details: { from: slice.from, to: slice.to },
        });
        queue.unshift(split[0], split[1]);
        continue;
      }

      slicesProcessed += 1;
      if (partial) {
        pagesFetched += partial.summary.pagesFetched;
        if (columns.length === 0) {
          columns = partial.columns;
        }
        rows.push(...partial.rows);
        mergeWarnings(warnings, partial.warnings);
        requestIds.push(...partial.diagnostics.requestIds);
        pageDurationsMs.push(...partial.diagnostics.pageDurationsMs);
        hasMore = true;
      }
      failures.push(toToolFailure(gatewayError, {
        queryDigest,
        slice,
        rowsCollectedBeforeFailure: partial?.summary.rowsCollected ?? 0,
      }));
      sliceRanges.push({ from: slice.from, to: slice.to, status: partial ? 'partial' : 'failed' });

      if (!request.allowPartial) {
        throw gatewayError;
      }
    }
  }

  if (reachedMaxPages) {
    pushWarning(warnings, {
      code: 'MAX_PAGES_REACHED',
      message: 'stopped before consuming all pages',
      details: { maxPages: request.maxPages },
    });
  }
  const partialDueToMaxRows = request.maxRows !== undefined && reachedMaxRows;

  if (partialDueToMaxRows) {
    pushWarning(warnings, {
      code: 'MAX_ROWS_REACHED',
      message: 'stopped before collecting all rows',
      details: { maxRows: request.maxRows },
    });
  }
  if (failures.length > 0) {
    pushWarning(warnings, {
      code: 'PARTIAL_RESULT',
      message: 'one or more slices failed; returned rows are partial',
      details: { failures: failures.length },
    });
  }

  return {
    schema: 'plumelog.search.aggregated.v1',
    mode: 'auto_slice',
    queryDigest,
    partialResult: failures.length > 0 || reachedMaxPages || partialDueToMaxRows,
    columns,
    rows,
    warnings,
    failures,
    summary: {
      totalRows: rows.length,
      pagesFetched,
      slicesProcessed,
      slicesSucceeded,
      slicesFailed: failures.length,
      reachedMaxRows: partialDueToMaxRows,
      reachedMaxPages,
      hasMore,
    },
    diagnostics: {
      totalDurationMs: Date.now() - startedAt,
      pageDurationsMs,
      requestIds,
      sliceRanges,
    },
  };
}

export async function exportLogsCsv(client: GatewayClient, request: ExportLogsCsvRequest): Promise<ExportCsvResult> {
  const result = await searchLogsAuto(client, request);
  const filePath = request.outputPath ? resolve(request.outputPath) : defaultExportPath();
  const csv = toCsv(result.columns, result.rows);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, csv, 'utf8');

  return {
    schema: 'plumelog.export.csv.v1',
    filePath,
    bytes: Buffer.byteLength(csv, 'utf8'),
    rowCount: result.rows.length,
    partialResult: result.partialResult,
    warnings: result.warnings,
    failures: result.failures,
    queryDigest: result.queryDigest,
    diagnostics: result.diagnostics,
    ...(request.inlineCsv ? { inlineCsv: csv } : {}),
  };
}
