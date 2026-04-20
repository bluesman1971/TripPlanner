import Fastify from 'fastify';
import cors from '@fastify/cors';
import { clerkPlugin } from '@clerk/fastify';
import { clientRoutes } from './routes/clients';
import { tripRoutes } from './routes/trips';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  });

  await app.register(clerkPlugin);

  // Routes
  await app.register(clientRoutes);
  await app.register(tripRoutes);

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
