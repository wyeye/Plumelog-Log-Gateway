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

interface ElasticsearchErrorInfo {
  statusCode?: number;
  errorType?: string;
  causedByType?: string;
  reason?: string;
  rootCauseTypes: string[];
  rootCauseReasons: string[];
  message?: string;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function stringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5);
}

function extractElasticsearchErrorInfo(error: unknown): ElasticsearchErrorInfo {
  const candidate = error as {
    message?: unknown;
    meta?: {
      statusCode?: unknown;
      body?: {
        error?: {
          type?: unknown;
          reason?: unknown;
          caused_by?: { type?: unknown };
          root_cause?: Array<{ type?: unknown; reason?: unknown }>;
        };
      };
    };
  };
  const metaError = candidate.meta?.body?.error;
  return {
    statusCode: typeof candidate.meta?.statusCode === 'number' ? candidate.meta.statusCode : undefined,
    errorType: typeof metaError?.type === 'string' ? metaError.type : undefined,
    causedByType: typeof metaError?.caused_by?.type === 'string' ? metaError.caused_by.type : undefined,
    reason: firstNonEmptyString(metaError?.reason, candidate.message),
    rootCauseTypes: stringArray(metaError?.root_cause?.map((item) => item?.type)),
    rootCauseReasons: stringArray(metaError?.root_cause?.map((item) => item?.reason)),
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  };
}

function errorContainsTimeout(value: string | undefined): boolean {
  return typeof value === 'string' && /timeout|timed out/i.test(value);
}

function isElasticsearchTimeout(info: ElasticsearchErrorInfo): boolean {
  return info.statusCode === 408
    || errorContainsTimeout(info.errorType)
    || errorContainsTimeout(info.causedByType)
    || errorContainsTimeout(info.reason)
    || errorContainsTimeout(info.message)
    || info.rootCauseTypes.some((value) => errorContainsTimeout(value))
    || info.rootCauseReasons.some((value) => errorContainsTimeout(value));
}

function isElasticsearchRejected(info: ElasticsearchErrorInfo): boolean {
  const values = [info.errorType, info.causedByType, info.reason, info.message, ...info.rootCauseTypes, ...info.rootCauseReasons]
    .filter((value): value is string => typeof value === 'string');
  return values.some((value) => /rejected|rejection/i.test(value));
}

function compactDetails(details: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

export function policyRejected(
  reason: string,
  details: Record<string, unknown> = {},
  message = 'request exceeds API key policy',
): AppError {
  return new AppError('POLICY_REJECTED', 403, { reason, ...details }, message);
}

export function wrapElasticsearchError(
  error: unknown,
  diagnostics: { phase?: string } & object = {},
): AppError {
  const info = extractElasticsearchErrorInfo(error);
  const phase = diagnostics.phase;

  if (phase === 'index_resolve' && isElasticsearchTimeout(info)) {
    return new AppError('INDEX_RESOLVE_TIMEOUT', 504, compactDetails({
      ...diagnostics,
      statusCode: info.statusCode,
      errorType: info.errorType,
      causedByType: info.causedByType,
      reason: info.reason,
      rootCauseTypes: info.rootCauseTypes,
      rootCauseReasons: info.rootCauseReasons,
    }), 'index resolution timed out');
  }

  if (phase === 'index_resolve') {
    return new AppError('INDEX_RESOLVE_FAILED', 502, compactDetails({
      ...diagnostics,
      statusCode: info.statusCode,
      errorType: info.errorType,
      causedByType: info.causedByType,
      reason: info.reason,
      rootCauseTypes: info.rootCauseTypes,
      rootCauseReasons: info.rootCauseReasons,
    }), 'index resolution failed');
  }

  if (isElasticsearchTimeout(info)) {
    return new AppError('ES_TIMEOUT', 504, compactDetails({
      ...diagnostics,
      statusCode: info.statusCode,
      errorType: info.errorType,
      causedByType: info.causedByType,
      reason: info.reason,
      rootCauseTypes: info.rootCauseTypes,
      rootCauseReasons: info.rootCauseReasons,
    }), 'elasticsearch query timed out');
  }

  if (isElasticsearchRejected(info)) {
    return new AppError('ES_REJECTED', 503, compactDetails({
      ...diagnostics,
      statusCode: info.statusCode,
      errorType: info.errorType,
      causedByType: info.causedByType,
      reason: info.reason,
      rootCauseTypes: info.rootCauseTypes,
      rootCauseReasons: info.rootCauseReasons,
    }), 'elasticsearch rejected query');
  }

  return new AppError('ES_QUERY_FAILED', 502, compactDetails({
    ...diagnostics,
    statusCode: info.statusCode,
    errorType: info.errorType,
    causedByType: info.causedByType,
    reason: info.reason,
    rootCauseTypes: info.rootCauseTypes,
    rootCauseReasons: info.rootCauseReasons,
  }), 'elasticsearch query failed');
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
