import { buildApp } from './http/app.js';
import { loadConfig } from './config/loadConfig.js';

const config = loadConfig();
const app = buildApp(config);

const closeApp = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => {
  void closeApp('SIGINT');
});

process.on('SIGTERM', () => {
  void closeApp('SIGTERM');
});

await app.listen({ port: config.server.port, host: '0.0.0.0' });
