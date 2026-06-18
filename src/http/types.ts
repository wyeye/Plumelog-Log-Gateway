import type { AuthPrincipal } from '../auth/authorize.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPrincipal;
    auditWarningsCount?: number;
  }
}
