import type { FastifyInstance } from 'fastify';
import { enforceRequestPolicy, enforceScope, requirePrincipal } from '../../auth/authorize.js';
import type { PlumelogRepository } from '../../es/repository.js';
import { boundaryRequestSchema } from '../../schema/boundary.js';

export function registerBoundaryRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/boundary', async (request) => {
    const principal = requirePrincipal(request);
    enforceScope(principal, 'logs:boundary');
    const body = boundaryRequestSchema.parse(request.body);
    return repository.findBoundary(enforceRequestPolicy(principal, body), principal, { requestId: request.id });
  });
}
