import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { AppError } from '../http/errors.js';
import { configSchema, type AppConfig } from './schema.js';

const envPattern = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(input: string): string {
  return input.replace(envPattern, (_whole, key: string) => process.env[key] ?? '');
}

export function loadConfig(configPath = process.env.PLUMELOG_CONFIG_PATH ?? 'config.yaml'): AppConfig {
  try {
    const rawText = readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(expandEnv(rawText));
    return configSchema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError('INVALID_CONFIG', 500, { issues: error.issues }, 'configuration is invalid');
    }
    if (error instanceof Error) {
      throw new AppError('INVALID_CONFIG', 500, {}, 'configuration is invalid');
    }
    throw error;
  }
}
