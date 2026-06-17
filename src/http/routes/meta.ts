import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/schema.js';
import type { PlumelogRepository } from '../../es/repository.js';
import { metaAppsQuerySchema } from '../../schema/meta.js';

export function registerMetaRoute(app: FastifyInstance, _config: AppConfig, repository: PlumelogRepository): void {
  app.get('/api/v1/meta/apps', async (request) => {
    const query = metaAppsQuerySchema.parse(request.query);
    return repository.listApps(query);
  });
}
