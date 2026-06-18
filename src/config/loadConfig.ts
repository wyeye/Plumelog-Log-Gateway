import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { AppError } from '../http/errors.js';
import { configSchema, type AppConfig } from './schema.js';

const envPattern = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(input: string): string {
  return input.replace(envPattern, (_whole, key: string) => process.env[key] ?? '');
}

function validateProductionConfig(config: AppConfig): void {
  const production = config.runtime.production || process.env.NODE_ENV === 'production';
  if (!production) {
    return;
  }

  const issues = [];
  if (!config.cursor.signingSecret) {
    issues.push({
      path: ['cursor', 'signingSecret'],
      message: 'cursor.signingSecret is required in production',
    });
  }
  if (!config.search.tieBreakerField) {
    issues.push({
      path: ['search', 'tieBreakerField'],
      message: 'search.tieBreakerField is required in production for stable pagination',
    });
  }

  if (issues.length > 0) {
    throw new AppError('INVALID_CONFIG', 500, { issues }, 'configuration is invalid');
  }
}

export function loadConfig(configPath = process.env.PLUMELOG_CONFIG_PATH ?? 'config.yaml'): AppConfig {
  try {
    const rawText = readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(expandEnv(rawText));
    const config = configSchema.parse(parsed);
    validateProductionConfig(config);
    return config;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof ZodError) {
      throw new AppError('INVALID_CONFIG', 500, { issues: error.issues }, 'configuration is invalid');
    }
    if (error instanceof Error) {
      throw new AppError('INVALID_CONFIG', 500, {}, 'configuration is invalid');
    }
    throw error;
  }
}
