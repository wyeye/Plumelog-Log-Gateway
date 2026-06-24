import { AppError } from '../http/errors.js';

export interface McpConfig {
  gatewayBaseUrl: string;
  apiToken: string;
  timeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadMcpConfig(): McpConfig {
  const gatewayBaseUrl = process.env.PLUMELOG_GATEWAY_BASE_URL?.trim() ?? 'http://127.0.0.1:8787';
  const apiToken = process.env.PLUMELOG_GATEWAY_TOKEN?.trim() ?? '';
  const timeoutMs = parsePositiveInt(process.env.PLUMELOG_GATEWAY_TIMEOUT_MS?.trim(), 30_000);

  if (!apiToken) {
    throw new AppError('INVALID_CONFIG', 500, {}, 'PLUMELOG_GATEWAY_TOKEN is required');
  }

  return {
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/$/, ''),
    apiToken,
    timeoutMs,
  };
}
