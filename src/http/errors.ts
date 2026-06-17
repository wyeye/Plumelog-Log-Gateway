import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

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

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (_request, reply) => {
    await reply.status(404).send({
      error: {
        code: 'INVALID_REQUEST',
        message: 'route not found',
        details: {},
      },
    });
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'request is invalid',
          details: { issues: error.issues },
        },
      });
      return;
    }

    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    app.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'internal server error',
        details: {},
      },
    });
  });
}
