import Fastify from 'fastify';
import cors from '@fastify/cors';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
