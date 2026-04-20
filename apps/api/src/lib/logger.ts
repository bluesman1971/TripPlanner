/**
 * PII-safe logging helpers.
 *
 * Rules (from CLAUDE.md security constraints):
 *   - Never log booking refs, allergy data, names, or email addresses.
 *   - Log error type and message only — never the full error object from Supabase
 *     (which may embed raw SQL, query params, or PII in its details field).
 */

const REDACT_KEYS = new Set([
  'email', 'name', 'firstName', 'lastName',
  'booking_ref', 'allergy_flags', 'allergy_action', 'raw_text',
  'purposeNotes', 'purpose_notes',
  'emailAddress', 'emailAddresses',
  'password', 'token', 'secret', 'apiKey', 'api_key',
]);

/**
 * Recursively redact known-sensitive keys from an object before logging.
 */
export function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = REDACT_KEYS.has(key) ? '[REDACTED]' : redact(value, depth + 1);
  }
  return result;
}

/**
 * Extract only safe fields from a Supabase / unknown error before passing to
 * app.log.error(). Never log the full error object — it may contain PII.
 */
export function safeError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    return { message: err.message.slice(0, 200) };
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return {
      message: String(e['message'] ?? e['msg'] ?? 'unknown error').slice(0, 200),
      code:    e['code'] ? String(e['code']) : undefined,
    };
  }
  return { message: String(err).slice(0, 200) };
}

/**
 * Fastify req serializer — strips body and headers to prevent accidental PII logging.
 * Registered in app.ts via { logger: { serializers: { req: safeReqSerializer } } }.
 */
export function safeReqSerializer(req: {
  method?: string;
  url?: string;
  hostname?: string;
  remoteAddress?: string;
  remotePort?: number;
}) {
  return {
    method:        req.method,
    url:           req.url,
    hostname:      req.hostname,
    remoteAddress: req.remoteAddress,
    remotePort:    req.remotePort,
    // body and headers deliberately excluded
  };
}
