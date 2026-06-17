import type { FastifyInstance } from 'fastify';
import type { PlumelogRepository } from '../../es/repository.js';
import { contextRequestSchema } from '../../schema/context.js';

export function registerContextRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/context', async (request) => {
    const body = contextRequestSchema.parse(request.body);
    return repository.getContext(body);
  });
}
