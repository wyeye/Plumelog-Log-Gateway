import { Client } from '@elastic/elasticsearch';
import type { AppConfig } from '../config/schema.js';

export function createElasticsearchClient(config: AppConfig): Client {
  return new Client({
    node: config.elasticsearch.node,
    auth: config.elasticsearch.username
      ? {
          username: config.elasticsearch.username,
          password: config.elasticsearch.password ?? '',
        }
      : undefined,
    ssl: {
      rejectUnauthorized: config.elasticsearch.tls.rejectUnauthorized,
    },
  });
}
