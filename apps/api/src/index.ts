import 'dotenv/config';
import { buildApp } from './app';
import { startIngestWorker } from './workers/ingest.worker';
import { startDocumentWorker } from './workers/document.worker';

const start = async () => {
  const app = await buildApp();

  // Start background workers (same process — fine for Railway single-dyno deployment)
  const ingestWorker = startIngestWorker();
  const documentWorker = startDocumentWorker();

  const shutdown = async () => {
    await Promise.all([ingestWorker.close(), documentWorker.close()]);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    await Promise.all([ingestWorker.close(), documentWorker.close()]);
    process.exit(1);
  }
};

start();
