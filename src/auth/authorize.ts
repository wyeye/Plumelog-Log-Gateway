import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/schema.js';
import { AppError } from '../http/errors.js';
import { readCredential } from './credentials.js';

export function authorizeRequest(request: FastifyRequest, config: AppConfig): void {
  const credential = readCredential(request);
  if (!credential) {
    throw new AppError('UNAUTHORIZED', 401, {}, 'authentication required');
  }

  const allowed = config.auth.apiKeys.some((item) => item.token === credential.token);
  if (!allowed) {
    throw new AppError('UNAUTHORIZED', 401, {}, 'authentication required');
  }
}
