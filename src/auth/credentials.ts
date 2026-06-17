import type { FastifyRequest } from 'fastify';

export type RequestCredential =
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; token: string }
  | null;

export function readCredential(request: FastifyRequest): RequestCredential {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return { type: 'bearer', token: authorization.slice('Bearer '.length).trim() };
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    return { type: 'apiKey', token: apiKey.trim() };
  }

  return null;
}
