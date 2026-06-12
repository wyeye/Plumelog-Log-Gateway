import type { AppConfig } from '../config/schema.js';
import type { SearchRequest } from '../schema/search.js';
import type { SearchCursor } from './cursor.js';

type Clause = Record<string, unknown>;

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

export function buildSearchQuery(config: AppConfig, request: SearchRequest, cursor: SearchCursor | null): Record<string, unknown> {
  const filters: Clause[] = [
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

  pushTermsFilter(filters, config.plumelog.fields.app, request.filters.apps);
  pushTermsFilter(filters, config.plumelog.fields.env, request.filters.envs);
  pushTermsFilter(filters, config.plumelog.fields.level, request.filters.levels);
  pushTermsFilter(filters, config.plumelog.fields.traceId, request.filters.traceIds);
  pushTermsFilter(filters, config.plumelog.fields.host, request.filters.hosts);
  pushOrPhraseGroup(must, config.plumelog.fields.logger, request.filters.loggers);
  pushOrPhraseGroup(must, config.plumelog.fields.method, request.filters.methods);
  pushPhraseClauses(must, config.plumelog.fields.message, request.filters.content?.all);
  pushPhraseClauses(should, config.plumelog.fields.message, request.filters.content?.any);
  pushPhraseClauses(mustNot, config.plumelog.fields.message, request.filters.content?.not);

  return {
    query: {
      bool: {
        filter: filters,
        must,
        should,
        must_not: mustNot,
        ...(should.length > 0 ? { minimum_should_match: 1 } : {}),
      },
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
