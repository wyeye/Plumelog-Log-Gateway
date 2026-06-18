import type { FastifyInstance } from 'fastify';
import { enforceScope, enforceTimeRangePolicy, requirePrincipal } from '../../auth/authorize.js';
import type { AppConfig } from '../../config/schema.js';
import type { PlumelogRepository } from '../../es/repository.js';
import { metaAppsQuerySchema } from '../../schema/meta.js';
import { resolveOptionalTimeRange } from '../../utils/time.js';

export function registerMetaRoute(app: FastifyInstance, _config: AppConfig, repository: PlumelogRepository): void {
  app.get('/api/v1/meta/apps', async (request) => {
    const principal = requirePrincipal(request);
    enforceScope(principal, 'meta:read');
    const query = metaAppsQuerySchema.parse(request.query);
    enforceTimeRangePolicy(principal, resolveOptionalTimeRange(query.from, query.to, _config.meta.defaultTimeRangeHours));
    return repository.listApps(query, principal);
  });
}
