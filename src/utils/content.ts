import { AppError } from '../http/errors.js';

export function buildContentPreview(content: string, maxChars: number): { contentPreview: string; contentTruncated: boolean } {
  if (content.length <= maxChars) {
    return { contentPreview: content, contentTruncated: false };
  }
  return { contentPreview: content.slice(0, maxChars), contentTruncated: true };
}

export function normalizeValues(input: string[] | undefined): string[] | undefined {
  const values = (input ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function normalizeContentTerms(input: string[] | undefined, maxLength: number): string[] | undefined {
  const values = normalizeValues(input);
  for (const value of values ?? []) {
    if (value.length > maxLength) {
      throw new AppError('CONTENT_TERM_TOO_LONG', 400, { maxLength }, 'content term is too long');
    }
  }
  return values;
}

export function ensureContentTermTotal(groups: Array<string[] | undefined>, maxTerms: number): void {
  const total = groups.reduce((sum, group) => sum + (group?.length ?? 0), 0);
  if (total > maxTerms) {
    throw new AppError('INVALID_REQUEST', 400, { maxTerms }, 'content terms exceed allowed maximum');
  }
}
