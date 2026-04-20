import { buildApp } from './app';
import { startIngestWorker } from './workers/ingest.worker';

const start = async () => {
  const app = await buildApp();

  // Start background worker (same process — fine for Railway single-dyno deployment)
  const worker = startIngestWorker();

  const shutdown = async () => {
    await worker.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
