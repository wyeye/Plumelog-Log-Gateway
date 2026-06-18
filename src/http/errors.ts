import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from '../config/schema.js';
import { redactText } from '../security/redact.js';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details: Record<string, unknown> = {},
    message: string,
  ) {
    super(message);
  }
}

export function wrapElasticsearchError(error: unknown): AppError {
  return new AppError('ES_QUERY_FAILED', 502, {}, 'elasticsearch query failed');
}

export function registerErrorHandler(app: FastifyInstance, config: AppConfig): void {
  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({
      requestId: request.id,
      error: {
        code: 'INVALID_REQUEST',
        message: 'route not found',
        details: {},
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        requestId: request.id,
        error: {
          code: 'INVALID_REQUEST',
          message: 'request is invalid',
          details: { issues: error.issues },
          requestId: request.id,
        },
      });
      return;
    }

    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        requestId: request.id,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
      return;
    }

    app.log.error({
      requestId: request.id,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: redactText(error instanceof Error ? error.message : 'unknown error', config),
    }, 'unhandled error');
    void reply.status(500).send({
      requestId: request.id,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'internal server error',
        details: {},
        requestId: request.id,
      },
    });
  });
}
