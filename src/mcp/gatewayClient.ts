import type { BoundaryRequest, BoundaryResponse } from '../schema/boundary.js';
import type { ContextRequest, ContextResponse } from '../schema/context.js';
import type { MetaAppsQuery, MetaAppsResponse } from '../schema/meta.js';
import type { SearchRequest, SearchResponse } from '../schema/search.js';
import type { McpConfig } from './config.js';
import { randomUUID } from 'node:crypto';

interface GatewayErrorPayload {
  requestId?: string;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export interface GatewayClientErrorPayload {
  code: string;
  message: string;
  status: number;
  requestId: string;
  details?: Record<string, unknown>;
}

export interface GatewayResponseMeta {
  requestId: string;
  durationMs: number;
  attempts: number;
  path: string;
  method: string;
}

export interface GatewayResponseEnvelope<T> {
  data: T;
  meta: GatewayResponseMeta;
}

export class GatewayClientError extends Error {
  constructor(public readonly payload: GatewayClientErrorPayload) {
    super(payload.message);
  }
}

function createRequestId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof GatewayClientError) {
    return isRetryableStatus(error.payload.status)
      || error.payload.code === 'GATEWAY_NETWORK_ERROR'
      || error.payload.code === 'GATEWAY_TIMEOUT';
  }
  return true;
}

function getGatewayRequestId(response: Response, payload?: GatewayErrorPayload): string | undefined {
  return response.headers.get('x-request-id')
    ?? payload?.requestId
    ?? payload?.error?.requestId;
}

export class GatewayClient {
  constructor(private readonly config: McpConfig) {}

  private async fetchWithTimeout(path: string, init: RequestInit, requestId: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);
    try {
      return await fetch(`${this.config.gatewayBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'x-request-id': requestId,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      throw new GatewayClientError({
        code: isTimeout ? 'GATEWAY_TIMEOUT' : 'GATEWAY_NETWORK_ERROR',
        message: isTimeout ? 'gateway request timed out' : 'gateway network request failed',
        status: 0,
        requestId,
        details: {
          timeoutMs: this.config.timeoutMs,
          path,
          method: init.method ?? 'GET',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse<T>(response: Response, requestId: string): Promise<T> {
    const text = await response.text();
    let payload: T | GatewayErrorPayload | null = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as T | GatewayErrorPayload;
      } catch {
        throw new GatewayClientError({
          code: 'GATEWAY_NON_JSON_RESPONSE',
          message: 'gateway returned a non-JSON response',
          status: response.status,
          requestId: response.headers.get('x-request-id') ?? requestId,
          details: {
            bodyPreview: text.slice(0, 500),
          },
        });
      }
    }

    if (!response.ok) {
      const errorPayload = (payload ?? {}) as GatewayErrorPayload;
      throw new GatewayClientError({
        code: errorPayload.error?.code ?? 'GATEWAY_HTTP_ERROR',
        message: errorPayload.error?.message ?? 'gateway request failed',
        status: response.status,
        requestId: getGatewayRequestId(response, errorPayload) ?? requestId,
        details: errorPayload.error?.details,
      });
    }

    return payload as T;
  }

  private async requestEnvelope<T>(path: string, init: RequestInit): Promise<GatewayResponseEnvelope<T>> {
    const requestId = createRequestId();
    const maxAttempts = 3;
    const startedAt = Date.now();
    const method = init.method ?? 'GET';
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(path, init, requestId);
        const data = await this.parseResponse<T>(response, requestId);
        return {
          data,
          meta: {
            requestId,
            durationMs: Date.now() - startedAt,
            attempts: attempt,
            path,
            method,
          },
        };
      } catch (error) {
        lastError = error;
        if (error instanceof GatewayClientError) {
          error.payload.details = {
            ...error.payload.details,
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            path,
            method,
          };
        }
        if (attempt >= maxAttempts || !isRetryableError(error)) {
          throw error;
        }
        await sleep(100 * (2 ** (attempt - 1)));
      }
    }

    throw lastError;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.requestEnvelope<T>(path, init);
    return response.data;
  }

  async listApps(query: MetaAppsQuery): Promise<MetaAppsResponse> {
    const search = new URLSearchParams();
    if (query.from) {
      search.set('from', query.from);
    }
    if (query.to) {
      search.set('to', query.to);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.request<MetaAppsResponse>(`/api/v1/meta/apps${suffix}`, { method: 'GET' });
  }

  async searchLogs(body: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('/api/v1/logs/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async searchLogsDetailed(body: SearchRequest): Promise<GatewayResponseEnvelope<SearchResponse>> {
    return this.requestEnvelope<SearchResponse>('/api/v1/logs/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getLogContext(body: ContextRequest): Promise<ContextResponse> {
    return this.request<ContextResponse>('/api/v1/logs/context', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async findLogBoundary(body: BoundaryRequest): Promise<BoundaryResponse> {
    return this.request<BoundaryResponse>('/api/v1/logs/boundary', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
