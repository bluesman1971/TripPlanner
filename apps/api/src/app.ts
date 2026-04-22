import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { clerkPlugin } from '@clerk/fastify';
import { clientRoutes } from './routes/clients';
import { tripRoutes } from './routes/trips';
import { bookingRoutes } from './routes/bookings';
import { researchRoutes } from './routes/research';
import { draftRoutes } from './routes/draft';
import { documentRoutes } from './routes/document';
import { revisionRoutes } from './routes/revise';
import { portalRoutes } from './routes/portal';
import { unsubscribeRoutes } from './routes/unsubscribe';
import { safeReqSerializer } from './lib/logger';
import { getSupabase } from './lib/supabase';
import { getRedis } from './lib/redis';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
      serializers: {
        // Strip body and headers from request logs to prevent accidental PII leakage
        req: safeReqSerializer,
      },
    },
  });

  // ── Security headers ──────────────────────────────────────────────────────
  await app.register(helmet, {
    // Allow same-origin framing for the consultant dashboard iframe (if needed)
    frameguard: { action: 'sameorigin' },
    // Disable CSP here — the frontend sets its own via Vite; API is JSON-only
    contentSecurityPolicy: false,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: 120,          // 120 requests per minute per identity
    timeWindow: 60000, // 1 minute
    // Tighter limit on the upload endpoint is set at the route level
    // Key by Clerk userId when authenticated so rate limit is per-consultant,
    // not per-IP (which breaks multi-user NAT and is trivially bypassed by
    // changing IP). We decode (but do not verify) the JWT to extract the sub —
    // verification happens separately in requireAuth. Fall back to IP for
    // unauthenticated or malformed requests.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          const b64 = auth.slice(7).split('.')[1];
          if (b64) {
            const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
            if (typeof payload.sub === 'string') return payload.sub;
          }
        } catch {
          // malformed token — fall through to IP
        }
      }
      return req.ip;
    },
    errorResponseBuilder: () => ({
      error: 'Too many requests — please slow down',
      retryAfter: 60,
    }),
  });

  // ── Multipart (file uploads) ──────────────────────────────────────────────
  await app.register(multipart);

  // ── Auth ──────────────────────────────────────────────────────────────────
  await app.register(clerkPlugin);

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(clientRoutes);
  await app.register(tripRoutes);
  await app.register(bookingRoutes);
  await app.register(researchRoutes);
  await app.register(draftRoutes);
  await app.register(documentRoutes);
  await app.register(revisionRoutes);
  // Portal routes have both Clerk-protected (token create) and public (token view/pdf) endpoints
  await app.register(portalRoutes);
  // Public — no Clerk auth; HMAC-signed token identifies the consultant
  await app.register(unsubscribeRoutes);

  // Liveness — always fast; confirms the process is running
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness — confirms downstream dependencies are reachable
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    let ready = true;

    try {
      const { error } = await Promise.race([
        getSupabase().from('consultants').select('id').limit(1),
        new Promise<{ error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000),
        ),
      ]);
      checks.supabase = error ? 'fail' : 'ok';
      if (error) ready = false;
    } catch {
      checks.supabase = 'fail';
      ready = false;
    }

    try {
      const pong = await Promise.race([
        getRedis().ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000),
        ),
      ]);
      checks.redis = pong === 'PONG' ? 'ok' : 'fail';
      if (pong !== 'PONG') ready = false;
    } catch {
      checks.redis = 'fail';
      ready = false;
    }

    const status = ready ? 200 : 503;
    return reply.status(status).send({ status: ready ? 'ready' : 'degraded', checks });
  });

  return app;
}
