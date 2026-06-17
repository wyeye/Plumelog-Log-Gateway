import type { BoundaryRequest, BoundaryResponse } from '../schema/boundary.js';
import type { ContextRequest, ContextResponse } from '../schema/context.js';
import type { MetaAppsQuery, MetaAppsResponse } from '../schema/meta.js';
import type { SearchRequest, SearchResponse } from '../schema/search.js';
import type { McpConfig } from './config.js';

interface GatewayErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

function formatGatewayError(payload: GatewayErrorPayload): string {
  const code = payload.error?.code ?? 'GATEWAY_ERROR';
  const message = payload.error?.message ?? 'gateway request failed';
  return `${code}: ${message}`;
}

export class GatewayClient {
  constructor(private readonly config: McpConfig) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.gatewayBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    const payload = await response.json() as T | GatewayErrorPayload;
    if (!response.ok) {
      throw new Error(formatGatewayError(payload as GatewayErrorPayload));
    }
    return payload as T;
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
