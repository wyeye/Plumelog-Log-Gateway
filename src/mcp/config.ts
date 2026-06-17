import { AppError } from '../http/errors.js';

export interface McpConfig {
  gatewayBaseUrl: string;
  apiToken: string;
}

export function loadMcpConfig(): McpConfig {
  const gatewayBaseUrl = process.env.PLUMELOG_GATEWAY_BASE_URL?.trim() ?? 'http://127.0.0.1:8787';
  const apiToken = process.env.PLUMELOG_GATEWAY_TOKEN?.trim() ?? '';

  if (!apiToken) {
    throw new AppError('INVALID_CONFIG', 500, {}, 'PLUMELOG_GATEWAY_TOKEN is required');
  }

  return {
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/$/, ''),
    apiToken,
  };
}
