import { Queue } from 'bullmq';
import { getRedis } from '../lib/redis';

// ─── Job shapes ───────────────────────────────────────────────────────────────

export interface DocumentJobData {
  tripId: string;
  consultantId: string;
  /** The itinerary_versions.id to update with the docx_r2_key on completion */
  versionId: string;
  markdownContent: string;
  destination: string;
  mapsApiKey: string | undefined;
}

export interface DocumentJobResult {
  versionNumber: number;
  downloadPath: string;
}

// ─── Queue singleton ──────────────────────────────────────────────────────────

export const DOCUMENT_QUEUE_NAME = 'document-generation';

let queue: Queue<DocumentJobData, DocumentJobResult> | null = null;

export function getDocumentQueue(): Queue<DocumentJobData, DocumentJobResult> {
  if (!queue) {
    queue = new Queue(DOCUMENT_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return queue;
}
