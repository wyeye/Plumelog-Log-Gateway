import type { AppConfig } from '../config/schema.js';

type RedactionPattern = {
  type: string;
  pattern: RegExp;
  replace?: (match: string) => string;
};

const REDACTION_PATTERNS: RedactionPattern[] = [
  { type: 'authorization', pattern: /\bAuthorization\s*:\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi },
  { type: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { type: 'cookie', pattern: /\bCookie\s*:\s*[^;\r\n]*(?:;[^;\r\n]*)*/gi },
  { type: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: 'secret', pattern: /\b(password|passwd|pwd|secret|token|access_token|refresh_token)\s*[:=]\s*["']?[^"'\s&;,]{3,}["']?/gi },
  { type: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'phone', pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g },
  { type: 'id_card', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { type: 'bank_card', pattern: /(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g },
];

function replacementFor(config: AppConfig, type: string): string {
  return config.redaction.replacement === '[REDACTED]'
    ? `[REDACTED:${type}]`
    : config.redaction.replacement;
}

export function redactText(input: string, config: AppConfig): string {
  if (!config.redaction.enabled || input.length === 0) {
    return input;
  }

  const maxChars = config.redaction.maxInputChars;
  const head = input.slice(0, maxChars);
  const truncated = input.length > maxChars;
  let output = head;

  for (const item of REDACTION_PATTERNS) {
    output = output.replace(item.pattern, item.replace ?? (() => replacementFor(config, item.type)));
  }

  return truncated ? `${output}${replacementFor(config, 'truncated_scan')}` : output;
}
