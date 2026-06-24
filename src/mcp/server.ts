import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { BoundaryRequest } from '../schema/boundary.js';
import { boundaryRequestSchema } from '../schema/boundary.js';
import type { ContextRequest } from '../schema/context.js';
import { contextRequestObjectSchema, contextRequestSchema } from '../schema/context.js';
import type { MetaAppsQuery } from '../schema/meta.js';
import { metaAppsQuerySchema } from '../schema/meta.js';
import type { ExportLogsCsvRequest, SearchLogsAllPagesRequest, SearchLogsAutoRequest } from '../schema/mcp.js';
import { exportLogsCsvRequestSchema, searchLogsAllPagesRequestSchema, searchLogsAutoRequestSchema } from '../schema/mcp.js';
import type { SearchRequest } from '../schema/search.js';
import { searchRequestSchema } from '../schema/search.js';
import { loadMcpConfig } from './config.js';
import { GatewayClient, GatewayClientError } from './gatewayClient.js';
import { exportLogsCsv, searchLogsAllPages, searchLogsAuto } from './tools.js';

function toolTextResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolErrorResult(payload: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function callTool<T>(action: () => Promise<T>) {
  try {
    return toolTextResult(await action());
  } catch (error) {
    if (error instanceof GatewayClientError) {
      return toolErrorResult(error.payload);
    }
    return toolErrorResult({
      code: 'MCP_TOOL_ERROR',
      message: error instanceof Error ? error.message : 'unknown gateway error',
      status: 0,
      requestId: 'unknown',
    });
  }
}

export async function startMcpServer(): Promise<void> {
  const config = loadMcpConfig();
  const client = new GatewayClient(config);
  const server = new McpServer({ name: 'plumelog-log-gateway', version: '0.1.0' });

  server.registerTool(
    'list_apps',
    {
      title: 'List Apps',
      description: 'List available app/env combinations from the Plumelog gateway',
      inputSchema: metaAppsQuerySchema,
    },
    async (args: MetaAppsQuery) => callTool(() => client.listApps(args)),
  );

  server.registerTool(
    'search_logs',
    {
      title: 'Search Logs',
      description: 'Search logs with required timeRange and limit',
      inputSchema: searchRequestSchema,
    },
    async (args: SearchRequest) => callTool(() => client.searchLogs(searchRequestSchema.parse(args))),
  );

  server.registerTool(
    'search_logs_all_pages',
    {
      title: 'Search Logs All Pages',
      description: 'Automatically follow nextCursor until all pages are collected or limits are reached',
      inputSchema: searchLogsAllPagesRequestSchema,
    },
    async (args: SearchLogsAllPagesRequest) => callTool(() => searchLogsAllPages(client, searchLogsAllPagesRequestSchema.parse(args))),
  );

  server.registerTool(
    'search_logs_auto',
    {
      title: 'Search Logs Auto',
      description: 'Automatically split large time windows, continue across pages, and return partial results with diagnostics when needed',
      inputSchema: searchLogsAutoRequestSchema,
    },
    async (args: SearchLogsAutoRequest) => callTool(() => searchLogsAuto(client, searchLogsAutoRequestSchema.parse(args))),
  );

  server.registerTool(
    'export_logs_csv',
    {
      title: 'Export Logs CSV',
      description: 'Run automatic sliced search and write the aggregated rows to a CSV file',
      inputSchema: exportLogsCsvRequestSchema,
    },
    async (args: ExportLogsCsvRequest) => callTool(() => exportLogsCsv(client, exportLogsCsvRequestSchema.parse(args))),
  );

  server.registerTool(
    'get_log_context',
    {
      title: 'Get Log Context',
      description: 'Fetch trace or nearby context around a log record',
      inputSchema: contextRequestObjectSchema,
    },
    async (args: ContextRequest) => callTool(() => client.getLogContext(contextRequestSchema.parse(args))),
  );

  server.registerTool(
    'find_log_boundary',
    {
      title: 'Find Log Boundary',
      description: 'Find the earliest or latest matching log within up to 31 days',
      inputSchema: boundaryRequestSchema,
    },
    async (args: BoundaryRequest) => callTool(() => client.findLogBoundary(args)),
  );

  await server.connect(new StdioServerTransport());
}
