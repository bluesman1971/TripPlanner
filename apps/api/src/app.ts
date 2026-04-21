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
import { safeReqSerializer } from './lib/logger';

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
    max: 120,          // 120 requests per minute per IP
    timeWindow: 60000, // 1 minute
    // Tighter limit on the upload endpoint is set at the route level
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

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
