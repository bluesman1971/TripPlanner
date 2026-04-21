import { Worker, type Job } from 'bullmq';
import { getRedis } from '../lib/redis';
import { getSupabase } from '../lib/supabase';
import { generateDocx } from '../services/docxGenerator';
import { uploadDocxToR2 } from '../lib/r2';
import { safeError } from '../lib/logger';
import { sendDocumentReadyEmail } from '../services/email';
import {
  type DocumentJobData,
  type DocumentJobResult,
  DOCUMENT_QUEUE_NAME,
} from '../queues/document.queue';

async function processDocumentJob(
  job: Job<DocumentJobData, DocumentJobResult>,
): Promise<DocumentJobResult> {
  const { tripId, consultantId, versionId, markdownContent, destination, mapsApiKey } = job.data;
  const supabase = getSupabase();

  await job.updateProgress(10);

  const docxBuffer = await generateDocx(markdownContent, { destination, mapsApiKey });

  await job.updateProgress(60);

  const r2Key = await uploadDocxToR2(docxBuffer, tripId);

  await job.updateProgress(80);

  // Save the R2 key and advance trip status in parallel
  const [versionRes] = await Promise.all([
    supabase
      .from('itinerary_versions')
      .update({ docx_r2_key: r2Key })
      .eq('id', versionId)
      .select('version_number')
      .single(),

    supabase
      .from('trips')
      .update({ status: 'review', updated_at: new Date().toISOString() })
      .eq('id', tripId),
  ]);

  await job.updateProgress(100);

  const versionNumber = (versionRes.data?.version_number as number | null) ?? 1;

  // Fire-and-forget notification — fetch consultant for email/prefs
  const { data: consultant } = await supabase
    .from('consultants')
    .select('id, name, email, email_notifications')
    .eq('id', consultantId)
    .single();

  if (consultant) {
    sendDocumentReadyEmail(
      consultant as { id: string; name: string; email: string; email_notifications: boolean },
      { id: tripId, destination },
      versionNumber,
    );
  }

  return {
    versionNumber,
    downloadPath: `/trips/${tripId}/document/download`,
  };
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function startDocumentWorker(): Worker<DocumentJobData, DocumentJobResult> {
  const worker = new Worker<DocumentJobData, DocumentJobResult>(
    DOCUMENT_QUEUE_NAME,
    processDocumentJob,
    {
      connection: getRedis(),
      concurrency: 2,
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`[document] Job ${job.id} completed — v${result.versionNumber} for trip ${job.data.tripId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[document] Job ${job?.id} failed: ${safeError(err).message}`);
  });

  return worker;
}
