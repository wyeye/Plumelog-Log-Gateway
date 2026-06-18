import type { AppConfig } from '../config/schema.js';
import type { SearchRequest } from '../schema/search.js';
import type { CursorTieBreakerType, SearchCursor } from './cursor.js';

type Clause = Record<string, unknown>;
type SortOrder = 'asc' | 'desc';

export interface LogQueryClauses {
  filter: Clause[];
  must: Clause[];
  should: Clause[];
  must_not: Clause[];
  minimum_should_match?: number;
}

function pushTermsFilter(filters: Clause[], field: string, values: string[] | undefined): void {
  if (values && values.length > 0) {
    filters.push({ terms: { [field]: values } });
  }
}

function pushOrPhraseGroup(target: Clause[], field: string, values: string[] | undefined): void {
  if (!values || values.length === 0) {
    return;
  }
  target.push({
    bool: {
      should: values.map((value) => ({ match_phrase: { [field]: value } })),
      minimum_should_match: 1,
    },
  });
}

function pushPhraseClauses(target: Clause[], field: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    target.push({ match_phrase: { [field]: value } });
  }
}

function buildSourceFilter(config: AppConfig): Record<string, string[]> | undefined {
  if (!config.search.sourceFiltering) {
    return undefined;
  }

  return {
    includes: [
      config.plumelog.fields.time,
      config.plumelog.fields.app,
      config.plumelog.fields.env,
      config.plumelog.fields.level,
      config.plumelog.fields.traceId,
      config.plumelog.fields.host,
      config.plumelog.fields.logger,
      config.plumelog.fields.method,
      config.plumelog.fields.thread,
      config.plumelog.fields.message,
    ],
  };
}

function unmappedTypeForTieBreaker(type: CursorTieBreakerType): 'keyword' | 'long' | 'date' {
  return type;
}

function buildSortField(field: string, order: SortOrder, tieBreakerType: CursorTieBreakerType): Clause {
  return {
    [field]: {
      order,
      unmapped_type: unmappedTypeForTieBreaker(tieBreakerType),
      missing: order === 'desc' ? '_last' : '_first',
    },
  };
}

function buildTimeSortField(field: string, order: SortOrder): Clause {
  return {
    [field]: {
      order,
      unmapped_type: 'date',
      missing: order === 'desc' ? '_last' : '_first',
    },
  };
}

function buildSeqSortField(field: string, order: SortOrder): Clause {
  return {
    [field]: {
      order,
      unmapped_type: 'long',
      missing: order === 'desc' ? '_last' : '_first',
    },
  };
}

export function buildLogSort(
  config: AppConfig,
  sortMode: SearchCursor['sortMode'],
  order: SortOrder,
): Clause[] {
  const sort = [buildTimeSortField(config.plumelog.fields.time, order)];

  if (sortMode !== 'time_only') {
    sort.push(buildSeqSortField(config.plumelog.fields.seq, order));
    if (config.search.tieBreakerField) {
      sort.push(buildSortField(config.search.tieBreakerField, order, config.search.tieBreakerType));
    }
  }

  return sort;
}

export function buildLogQueryClauses(
  config: AppConfig,
  request: Pick<SearchRequest, 'timeRange' | 'filters'>,
): LogQueryClauses {
  const filter: Clause[] = [
    {
      range: {
        [config.plumelog.fields.time]: {
          gte: request.timeRange.from,
          lt: request.timeRange.to,
        },
      },
    },
  ];
  const must: Clause[] = [];
  const should: Clause[] = [];
  const mustNot: Clause[] = [];

  pushTermsFilter(filter, config.plumelog.fields.app, request.filters.apps);
  pushTermsFilter(filter, config.plumelog.fields.env, request.filters.envs);
  pushTermsFilter(filter, config.plumelog.fields.level, request.filters.levels);
  pushTermsFilter(filter, config.plumelog.fields.traceId, request.filters.traceIds);
  pushTermsFilter(filter, config.plumelog.fields.host, request.filters.hosts);
  pushOrPhraseGroup(must, config.plumelog.fields.logger, request.filters.loggers);
  pushOrPhraseGroup(must, config.plumelog.fields.method, request.filters.methods);
  pushPhraseClauses(must, config.plumelog.fields.message, request.filters.content?.all);
  pushPhraseClauses(should, config.plumelog.fields.message, request.filters.content?.any);
  pushPhraseClauses(mustNot, config.plumelog.fields.message, request.filters.content?.not);

  return {
    filter,
    must,
    should,
    must_not: mustNot,
    ...(should.length > 0 ? { minimum_should_match: 1 } : {}),
  };
}

export function buildSearchQuery(config: AppConfig, request: SearchRequest, cursor: SearchCursor | null): Record<string, unknown> {
  const clauses = buildLogQueryClauses(config, request);
  const sourceFilter = buildSourceFilter(config);

  return {
    query: {
      bool: clauses,
    },
    sort: buildLogSort(config, cursor?.sortMode ?? 'time_seq', 'desc'),
    size: request.limit + 1,
    ...(cursor && cursor.values.length > 0 ? { search_after: cursor.values } : {}),
    track_total_hits: config.search.trackTotalHits,
    ...(sourceFilter ? { _source: sourceFilter } : {}),
  };
}

export function buildBoundaryQuery(
  config: AppConfig,
  request: Pick<SearchRequest, 'timeRange' | 'filters'>,
  direction: 'earliest' | 'latest',
  sortMode: 'time_seq' | 'time_only',
): Record<string, unknown> {
  const order = direction === 'earliest' ? 'asc' : 'desc';
  const clauses = buildLogQueryClauses(config, request);

  return {
    query: {
      bool: clauses,
    },
    sort: buildLogSort(config, sortMode, order),
    size: 1,
    track_total_hits: false,
  };
}
