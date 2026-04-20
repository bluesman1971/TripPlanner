import { Worker, type Job } from 'bullmq';
import { unlinkSync } from 'fs';
import { getRedis } from '../lib/redis';
import { getSupabase } from '../lib/supabase';
import { extractText } from '../services/extractor';
import { parseBookingDocument } from '../services/bookingParser';
import { type IngestJobData, type IngestJobResult, INGEST_QUEUE_NAME } from '../queues/ingest.queue';

async function processIngestJob(
  job: Job<IngestJobData, IngestJobResult>,
): Promise<IngestJobResult> {
  const { tripId, filePath, originalFilename, isImage } = job.data;
  const supabase = getSupabase();

  try {
    // ── Step 1: Extract text ──────────────────────────────────────────────
    let rawText: string;

    if (isImage) {
      // Image-based PDFs: for now record that vision processing is needed.
      // Full vision support added in Week 5 with R2 integration.
      rawText = `[IMAGE FILE: ${originalFilename}] — Vision-based extraction not yet implemented. Upload a text-based PDF or document instead.`;
    } else {
      const extracted = await extractText(filePath);
      if (!extracted || extracted.trim().length < 50) {
        throw new Error(
          `Could not extract readable text from ${originalFilename}. ` +
          `The file may be a scanned/image PDF. Try uploading a text-based version.`,
        );
      }
      rawText = extracted;
    }

    await job.updateProgress(40);

    // ── Step 2: AI parsing ────────────────────────────────────────────────
    const parsed = await parseBookingDocument(rawText);

    await job.updateProgress(80);

    // ── Step 3: Upsert booking row ────────────────────────────────────────
    const { data: booking, error } = await supabase
      .from('bookings')
      .upsert(
        {
          trip_id:               tripId,
          booking_slug:          parsed.booking_slug,
          booking_type:          parsed.booking_type,
          booking_ref:           parsed.booking_ref,
          date:                  parsed.date,
          start_time:            parsed.start_time,
          end_time:              parsed.end_time,
          meeting_point_address: parsed.meeting_point_address ?? '',
          drop_off_address:      parsed.drop_off_address ?? '',
          included_meals:        parsed.included_meals,
          included_transport:    parsed.included_transport,
          allergy_flags:         parsed.allergy_flags,
          consultant_flags:      parsed.consultant_flags,
          raw_text:              rawText,
          ingested_at:           new Date().toISOString(),
        },
        { onConflict: 'trip_id,booking_slug' },
      )
      .select('id, booking_slug')
      .single();

    if (error || !booking) {
      throw new Error(`Failed to save booking: ${error?.message ?? 'unknown error'}`);
    }

    await job.updateProgress(100);

    return { bookingId: booking.id, bookingSlug: booking.booking_slug };

  } finally {
    // Always clean up the temp file
    try { unlinkSync(filePath); } catch { /* ignore */ }
  }
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function startIngestWorker(): Worker<IngestJobData, IngestJobResult> {
  const worker = new Worker<IngestJobData, IngestJobResult>(
    INGEST_QUEUE_NAME,
    processIngestJob,
    {
      connection: getRedis(),
      concurrency: 3,
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`[ingest] Job ${job.id} completed — booking: ${result.bookingSlug}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[ingest] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
