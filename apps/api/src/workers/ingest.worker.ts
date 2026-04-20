import { Worker, type Job } from 'bullmq';
import { unlinkSync } from 'fs';
import { getRedis } from '../lib/redis';
import { getSupabase } from '../lib/supabase';
import { downloadFromR2ToTemp } from '../lib/r2';
import { extractText } from '../services/extractor';
import { parseBookingDocument } from '../services/bookingParser';
import { encryptJson, encrypt } from '../lib/encryption';
import { safeError } from '../lib/logger';
import { type IngestJobData, type IngestJobResult, INGEST_QUEUE_NAME } from '../queues/ingest.queue';

async function processIngestJob(
  job: Job<IngestJobData, IngestJobResult>,
): Promise<IngestJobResult> {
  const { tripId, r2Key, originalFilename, isImage } = job.data;
  const supabase = getSupabase();
  let tempPath: string | null = null;

  try {
    // ── Step 1: Download from R2 to temp file ─────────────────────────────
    tempPath = await downloadFromR2ToTemp(r2Key);

    // ── Step 2: Extract text ──────────────────────────────────────────────
    let rawText: string;

    if (isImage) {
      // Image files need Claude vision — full pipeline added in Sprint 3.
      rawText = '[IMAGE FILE] — Vision-based extraction not yet implemented. Upload a text-based PDF or document instead.';
    } else {
      const extracted = await extractText(tempPath);
      if (!extracted || extracted.trim().length < 50) {
        throw new Error(
          `Could not extract readable text from the uploaded file. ` +
          `It may be a scanned/image PDF. Try uploading a text-based version.`,
        );
      }
      rawText = extracted;
    }

    await job.updateProgress(40);

    // ── Step 3: AI parsing ────────────────────────────────────────────────
    const parsed = await parseBookingDocument(rawText);

    await job.updateProgress(80);

    // ── Step 4: Encrypt sensitive fields before DB insert ─────────────────
    // allergy_flags and raw_text contain medical PII — encrypted at application level.
    const encryptedAllergyFlags = parsed.allergy_flags
      ? encryptJson(parsed.allergy_flags)
      : null;
    const encryptedRawText = encrypt(rawText);

    // ── Step 5: Upsert booking row ────────────────────────────────────────
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
          allergy_flags:         encryptedAllergyFlags,  // encrypted
          consultant_flags:      parsed.consultant_flags, // not PII — action items only
          raw_text:              encryptedRawText,        // encrypted
          ingested_at:           new Date().toISOString(),
        },
        { onConflict: 'trip_id,booking_slug' },
      )
      .select('id, booking_slug')
      .single();

    if (error || !booking) {
      throw new Error(`Failed to save booking: ${safeError(error).message}`);
    }

    await job.updateProgress(100);

    return { bookingId: booking.id, bookingSlug: booking.booking_slug };

  } finally {
    // Always clean up the local temp file (R2 copy is kept for re-ingestion)
    if (tempPath) {
      try { unlinkSync(tempPath); } catch { /* ignore */ }
    }
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
    // Log job ID and slug only — no PII
    console.log(`[ingest] Job ${job.id} completed — slug: ${result.bookingSlug}`);
  });

  worker.on('failed', (job, err) => {
    // Log job ID and safe error message only — never the full error object
    console.error(`[ingest] Job ${job?.id} failed: ${safeError(err).message}`);
  });

  return worker;
}
