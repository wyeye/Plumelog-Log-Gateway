import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AuthPrincipal } from '../auth/authorize.js';
import type { AppConfig } from '../config/schema.js';
import { authorizeRequest } from '../auth/authorize.js';
import { createElasticsearchClient } from '../es/client.js';
import { PlumelogRepository } from '../es/repository.js';
import { registerErrorHandler } from './errors.js';
import { registerBoundaryRoute } from './routes/boundary.js';
import { registerContextRoute } from './routes/context.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetaRoute } from './routes/meta.js';
import { registerSearchRoute } from './routes/search.js';
import './types.js';

interface AuditPayload {
  timeRange?: { from: string; to: string };
  from?: string;
  to?: string;
  limit?: number;
  filters?: {
    apps?: string[];
    envs?: string[];
  };
}

function auditPayload(value: unknown): AuditPayload {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const payload = value as AuditPayload;
  return {
    timeRange: payload.timeRange ?? (payload.from && payload.to ? { from: payload.from, to: payload.to } : undefined),
    limit: payload.limit,
    filters: payload.filters,
  };
}

function auditWarnings(payload: unknown): number {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!parsed || typeof parsed !== 'object') {
      return 0;
    }
    const warnings = (parsed as { warnings?: unknown }).warnings;
    return Array.isArray(warnings) ? warnings.length : 0;
  } catch {
    return 0;
  }
}

function auditContext(request: { body?: unknown; query?: unknown; url: string; auth?: AuthPrincipal }) {
  const payload = request.url.includes('/meta/apps')
    ? auditPayload(request.query)
    : auditPayload(request.body);
  return {
    timeRange: payload.timeRange,
    limit: payload.limit,
    appsCount: payload.filters?.apps?.length ?? 0,
    envsCount: payload.filters?.envs?.length ?? 0,
  };
}

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const client = createElasticsearchClient(config);
  const repository = new PlumelogRepository(client, config);

  app.addHook('onRequest', async (request) => {
    request.id = request.headers['x-request-id']?.toString() || randomUUID();
    if (request.url.startsWith('/api/v1/')) {
      request.auth = authorizeRequest(request, config);
    }
  });

  app.addHook('onSend', async (request, _reply, payload) => {
    if (request.url.startsWith('/api/v1/')) {
      request.auditWarningsCount = auditWarnings(payload);
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) {
      return;
    }
    app.log.info({
      requestId: request.id,
      principal: request.auth?.name ?? null,
      endpoint: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...auditContext(request),
      warningsCount: request.auditWarningsCount ?? 0,
    }, 'audit request');
  });

  app.addHook('onError', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) {
      return;
    }
    app.log.warn({
      requestId: request.id,
      principal: request.auth?.name ?? null,
      endpoint: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...auditContext(request),
    }, 'audit request failed');
  });

  app.addHook('onClose', async () => {
    await repository.close();
  });

  registerErrorHandler(app, config);
  registerHealthRoute(app);
  registerMetaRoute(app, config, repository);
  registerSearchRoute(app, repository);
  registerContextRoute(app, repository);
  registerBoundaryRoute(app, repository);
  return app;
}
