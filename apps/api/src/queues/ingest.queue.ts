import { Queue } from 'bullmq';
import { getRedis } from '../lib/redis';

// ─── Job shapes ───────────────────────────────────────────────────────────────

export interface IngestJobData {
  tripId: string;
  consultantId: string;
  /** Absolute path to the temp file written during upload */
  filePath: string;
  originalFilename: string;
  mimeType: string;
  /** True for .png/.jpg/.jpeg/.webp — AI uses vision instead of text extraction */
  isImage: boolean;
}

export interface IngestJobResult {
  bookingId: string;
  bookingSlug: string;
}

// ─── Queue singleton ──────────────────────────────────────────────────────────

export const INGEST_QUEUE_NAME = 'booking-ingest';

let queue: Queue<IngestJobData, IngestJobResult> | null = null;

export function getIngestQueue(): Queue<IngestJobData, IngestJobResult> {
  if (!queue) {
    queue = new Queue(INGEST_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return queue;
}
