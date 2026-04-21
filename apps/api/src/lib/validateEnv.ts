// Fail-fast env validation — called before app.listen() so missing or
// malformed config is surfaced at startup, not on the first request.

const REQUIRED = [
  'CLERK_SECRET_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'UPSTASH_REDIS_URL',
  'ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'CORS_ORIGIN',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // ENCRYPTION_KEY must be exactly 64 hex chars (256-bit key for AES-256-GCM)
  const encKey = process.env.ENCRYPTION_KEY!;
  if (!/^[0-9a-f]{64}$/i.test(encKey)) {
    console.error('[startup] ENCRYPTION_KEY must be a 64-character hex string (256-bit)');
    process.exit(1);
  }

  // SUPABASE_URL must look like a URL
  const supabaseUrl = process.env.SUPABASE_URL!;
  if (!supabaseUrl.startsWith('https://')) {
    console.error('[startup] SUPABASE_URL must start with https://');
    process.exit(1);
  }
}
