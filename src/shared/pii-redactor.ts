/**
 * PII redaction for log sanitization.
 * Prevents accidental leakage of personal information in log output.
 */

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { pattern: /\b\d{5}(-\d{4})?\b/g, replacement: '[ZIP_REDACTED]' },
  { pattern: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[CARD_REDACTED]' },
];

const PII_FIELD_NAMES = new Set([
  'email', 'phone', 'ssn', 'dateofbirth', 'dob', 'password', 'secret',
  'addressline1', 'addressline2', 'firstname', 'lastname',
  'creditcard', 'cardnumber', 'apikey', 'token', 'auth',
]);

export function redactPii(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    let result = data;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
    }
    return result;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactPii(item));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (PII_FIELD_NAMES.has(key.toLowerCase())) {
        result[key] = typeof value === 'string' ? `[${key.toUpperCase()}_REDACTED]` : '[REDACTED]';
      } else {
        result[key] = redactPii(value);
      }
    }
    return result;
  }

  return data;
}

export function redactString(text: string): string {
  return redactPii(text) as string;
}
