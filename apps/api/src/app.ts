import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { clerkPlugin } from '@clerk/fastify';
import { clientRoutes } from './routes/clients';
import { tripRoutes } from './routes/trips';
import { bookingRoutes } from './routes/bookings';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  });

  await app.register(multipart);
  await app.register(clerkPlugin);

  // Routes
  await app.register(clientRoutes);
  await app.register(tripRoutes);
  await app.register(bookingRoutes);

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
