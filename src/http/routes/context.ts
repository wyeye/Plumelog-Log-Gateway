import type { FastifyInstance } from 'fastify';
import { enforceRequestPolicy, enforceScope, requirePrincipal } from '../../auth/authorize.js';
import type { PlumelogRepository } from '../../es/repository.js';
import { contextRequestSchema } from '../../schema/context.js';

export function registerContextRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/context', async (request) => {
    const principal = requirePrincipal(request);
    enforceScope(principal, 'logs:context');
    const body = contextRequestSchema.parse(request.body);
    return repository.getContext(enforceRequestPolicy(principal, body), principal, { requestId: request.id });
  });
}
