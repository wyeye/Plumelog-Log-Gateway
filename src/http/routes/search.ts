import type { FastifyInstance } from 'fastify';
import { enforceRequestPolicy, enforceScope, requirePrincipal } from '../../auth/authorize.js';
import type { PlumelogRepository } from '../../es/repository.js';
import { searchRequestSchema } from '../../schema/search.js';

export function registerSearchRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/search', async (request) => {
    const principal = requirePrincipal(request);
    enforceScope(principal, 'logs:search');
    const body = searchRequestSchema.parse(request.body);
    return repository.searchLogs(enforceRequestPolicy(principal, body), principal);
  });
}
