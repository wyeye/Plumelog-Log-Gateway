import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/schema.js';
import { authorizeRequest } from '../auth/authorize.js';
import { createElasticsearchClient } from '../es/client.js';
import { PlumelogRepository } from '../es/repository.js';
import { registerErrorHandler } from './errors.js';
import { registerContextRoute } from './routes/context.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetaRoute } from './routes/meta.js';
import { registerSearchRoute } from './routes/search.js';

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const client = createElasticsearchClient(config);
  const repository = new PlumelogRepository(client, config);

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/v1/')) {
      authorizeRequest(request, config);
    }
  });

  app.addHook('onClose', async () => {
    await repository.close();
  });

  registerErrorHandler(app);
  registerHealthRoute(app);
  registerMetaRoute(app, config, repository);
  registerSearchRoute(app, repository);
  registerContextRoute(app, repository);
  return app;
}
