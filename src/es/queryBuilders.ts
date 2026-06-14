import type { AppConfig } from '../config/schema.js';
import type { SearchRequest } from '../schema/search.js';
import type { SearchCursor } from './cursor.js';

type Clause = Record<string, unknown>;

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

  return {
    query: {
      bool: clauses,
    },
    sort: cursor?.sortMode === 'time_only'
      ? [{ [config.plumelog.fields.time]: { order: 'desc' } }]
      : [
          { [config.plumelog.fields.time]: { order: 'desc' } },
          { [config.plumelog.fields.seq]: { order: 'desc' } },
        ],
    size: request.limit,
    ...(cursor && cursor.values.length > 0 ? { search_after: cursor.values } : {}),
    track_total_hits: true,
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
    sort: sortMode === 'time_only'
      ? [{ [config.plumelog.fields.time]: { order } }]
      : [
          { [config.plumelog.fields.time]: { order } },
          { [config.plumelog.fields.seq]: { order } },
        ],
    size: 1,
    track_total_hits: false,
  };
}
