import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/schema.js';
import type { PlumelogRepository } from '../../es/repository.js';

export function registerHealthRoute(app: FastifyInstance, config: AppConfig, repository: PlumelogRepository): void {
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/live', async () => ({ status: 'ok' }));
  app.get('/ready', async (request, reply) => {
    const startedAt = Date.now();
    try {
      await repository.ping(config.observability.readyTimeoutMs);
      return {
        status: 'ok',
        checks: {
          elasticsearch: 'ok',
        },
        durationMs: Date.now() - startedAt,
        requestId: request.id,
      };
    } catch {
      return reply.status(503).send({
        status: 'unavailable',
        checks: {
          elasticsearch: 'unavailable',
        },
        durationMs: Date.now() - startedAt,
        requestId: request.id,
      });
    }
  });
}
