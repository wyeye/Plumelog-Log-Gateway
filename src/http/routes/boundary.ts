import type { FastifyInstance } from 'fastify';
import type { PlumelogRepository } from '../../es/repository.js';
import { boundaryRequestSchema } from '../../schema/boundary.js';

export function registerBoundaryRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/boundary', async (request) => {
    const body = boundaryRequestSchema.parse(request.body);
    return repository.findBoundary(body);
  });
}
