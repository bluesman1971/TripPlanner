/**
 * AES-256-GCM application-level encryption for sensitive fields.
 *
 * Encrypted format (stored as text):  base64(iv):base64(authTag):base64(ciphertext)
 *
 * Usage:
 *   encryptJson(obj)  → encrypted string to store in DB
 *   decryptJson(str)  → original object
 *   encrypt(str)      → encrypted string
 *   decrypt(str)      → original string
 *
 * ENCRYPTION_KEY must be a 64-character hex string (32 bytes).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTED_PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit IV — recommended for GCM
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag

  return (
    ENCRYPTED_PREFIX +
    [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
  );
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    // Plaintext fallback — allows reading rows written before encryption was added
    return ciphertext;
  }

  const payload = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const [ivB64, tagB64, encB64] = payload.split(':');

  const iv  = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

/** Encrypt any JSON-serialisable value. */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt and parse a JSON-encrypted value. */
export function decryptJson<T = unknown>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T;
}

/** Returns true if a string was produced by encrypt(). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}
