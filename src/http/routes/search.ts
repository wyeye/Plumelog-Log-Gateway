import type { FastifyInstance } from 'fastify';
import type { PlumelogRepository } from '../../es/repository.js';
import { searchRequestSchema } from '../../schema/search.js';

export function registerSearchRoute(app: FastifyInstance, repository: PlumelogRepository): void {
  app.post('/api/v1/logs/search', async (request) => {
    const body = searchRequestSchema.parse(request.body);
    return repository.searchLogs(body);
  });
}
