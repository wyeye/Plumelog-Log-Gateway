import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/schema.js';
import { READ_SCOPES } from '../config/schema.js';
import { AppError } from '../http/errors.js';
import type { LogFilters } from '../schema/logFilters.js';
import { readCredential } from './credentials.js';

export type AuthScope = typeof READ_SCOPES[number];

export interface AuthPrincipal {
  name: string;
  scopes: string[];
  allowedApps: string[];
  allowedEnvs: string[];
  maxTimeRangeHours?: number;
  maxLimit?: number;
  allowRawContent: boolean;
}

interface PolicyRequest {
  timeRange?: {
    from: string;
    to: string;
  };
  limit?: number;
  filters?: LogFilters;
}

function digestToken(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(digestToken(actual), digestToken(expected));
}

function toPrincipal(apiKey: AppConfig['auth']['apiKeys'][number]): AuthPrincipal {
  return {
    name: apiKey.name,
    scopes: apiKey.scopes,
    allowedApps: apiKey.allowedApps,
    allowedEnvs: apiKey.allowedEnvs,
    maxTimeRangeHours: apiKey.maxTimeRangeHours,
    maxLimit: apiKey.maxLimit,
    allowRawContent: apiKey.allowRawContent,
  };
}

export function authorizeRequest(request: FastifyRequest, config: AppConfig): AuthPrincipal {
  const credential = readCredential(request);
  if (!credential) {
    throw new AppError('UNAUTHORIZED', 401, {}, 'authentication required');
  }

  for (const item of config.auth.apiKeys) {
    if (tokenMatches(credential.token, item.token)) {
      return toPrincipal(item);
    }
  }

  throw new AppError('UNAUTHORIZED', 401, {}, 'authentication required');
}

export function requirePrincipal(request: FastifyRequest): AuthPrincipal {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, {}, 'authentication required');
  }
  return request.auth;
}

export function enforceScope(principal: AuthPrincipal, scope: AuthScope): void {
  if (!principal.scopes.includes(scope)) {
    throw new AppError('FORBIDDEN', 403, { scope }, 'permission denied');
  }
}

function ensureTimeRangeLimit(principal: AuthPrincipal, request: PolicyRequest): void {
  if (!principal.maxTimeRangeHours || !request.timeRange) {
    return;
  }
  const from = new Date(request.timeRange.from).getTime();
  const to = new Date(request.timeRange.to).getTime();
  const rangeHours = (to - from) / 3_600_000;
  if (Number.isFinite(rangeHours) && rangeHours > principal.maxTimeRangeHours) {
    throw new AppError('FORBIDDEN', 403, { maxTimeRangeHours: principal.maxTimeRangeHours }, 'time range exceeds API key limit');
  }
}

export function enforceTimeRangePolicy(principal: AuthPrincipal, timeRange: { from: string; to: string }): void {
  ensureTimeRangeLimit(principal, { timeRange });
}

function ensureLimit(principal: AuthPrincipal, request: PolicyRequest): void {
  if (principal.maxLimit && request.limit && request.limit > principal.maxLimit) {
    throw new AppError('FORBIDDEN', 403, { maxLimit: principal.maxLimit }, 'limit exceeds API key limit');
  }
}

function constrainValues(
  requested: string[] | undefined,
  allowed: string[],
  fieldName: 'apps' | 'envs',
): string[] | undefined {
  if (allowed.length === 0) {
    return requested;
  }
  if (!requested || requested.length === 0) {
    return [...allowed];
  }
  const disallowed = requested.filter((item) => !allowed.includes(item));
  if (disallowed.length > 0) {
    throw new AppError('FORBIDDEN', 403, { field: fieldName }, `${fieldName} exceeds API key limit`);
  }
  return requested;
}

export function enforceRequestPolicy<T extends PolicyRequest>(principal: AuthPrincipal, request: T): T {
  ensureTimeRangeLimit(principal, request);
  ensureLimit(principal, request);
  if (!request.filters) {
    return request;
  }

  return {
    ...request,
    filters: {
      ...request.filters,
      apps: constrainValues(request.filters.apps, principal.allowedApps, 'apps'),
      envs: constrainValues(request.filters.envs, principal.allowedEnvs, 'envs'),
    },
  };
}

export function appEnvAllowed(principal: AuthPrincipal | undefined, app: unknown, env: unknown): boolean {
  if (!principal) {
    return true;
  }
  const appValue = typeof app === 'string' ? app : null;
  const envValue = typeof env === 'string' ? env : null;
  const appAllowed = principal.allowedApps.length === 0 || (appValue !== null && principal.allowedApps.includes(appValue));
  const envAllowed = principal.allowedEnvs.length === 0 || (envValue !== null && principal.allowedEnvs.includes(envValue));
  return appAllowed && envAllowed;
}
