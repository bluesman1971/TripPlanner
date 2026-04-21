/**
 * Signed unsubscribe tokens — no DB storage required.
 *
 * Format: `<base64url(consultantId)>.<hmac-sha256-hex>`
 *
 * The HMAC is keyed with ENCRYPTION_KEY so tokens cannot be forged without
 * access to the server secret. Tokens do not expire — revocation is the
 * act of setting email_notifications=false in the DB.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is not set');
  return key;
}

function sign(consultantId: string): string {
  return createHmac('sha256', getKey()).update(consultantId).digest('hex');
}

export function createUnsubscribeToken(consultantId: string): string {
  const id = Buffer.from(consultantId).toString('base64url');
  const sig = sign(consultantId);
  return `${id}.${sig}`;
}

/**
 * Returns the consultantId if the token is valid, or null otherwise.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const dot = token.indexOf('.');
    if (dot === -1) return null;

    const id = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    const providedSig = token.slice(dot + 1);
    const expectedSig = sign(id);

    // Timing-safe comparison — both must be the same length first
    if (providedSig.length !== expectedSig.length) return null;
    const match = timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expectedSig, 'hex'),
    );
    return match ? id : null;
  } catch {
    return null;
  }
}
