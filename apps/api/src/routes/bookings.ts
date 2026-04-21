import type { FastifyInstance } from 'fastify';
import path from 'path';
import { getAuth } from '@clerk/fastify';
import { getDB, getTripForConsultant } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { uploadToR2 } from '../lib/r2';
import { getIngestQueue } from '../queues/ingest.queue';
import { isImageFile, checkFileReadable } from '../services/extractor';
import { decryptJson, isEncrypted, encryptJson } from '../lib/encryption';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { deleteFromR2 } from '../lib/r2';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.html', '.htm',
  '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per CLAUDE.md security constraint

export async function bookingRoutes(app: FastifyInstance) {

  // ── POST /trips/:tripId/bookings/upload ───────────────────────────────────
  // Accepts a multipart booking confirmation file, enqueues an ingest job.
  // Returns 202 Accepted with the job ID.
  app.post(
    '/trips/:tripId/bookings/upload',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tripId } = request.params as { tripId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Verify the trip belongs to this consultant
      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // Parse multipart upload
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const originalFilename = data.filename;
      const ext = path.extname(originalFilename).toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return reply.status(400).send({
          error: `File type not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
        });
      }

      // Read file buffer (enforces size limit)
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of data.file) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_FILE_BYTES) {
          return reply.status(413).send({ error: 'File exceeds 20 MB limit' });
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Pre-validate readability before spending R2 bandwidth and a queue slot
      const readability = await checkFileReadable(buffer, ext);
      if (!readability.ok) {
        return reply.status(422).send({ error: readability.guidance });
      }

      // Upload to R2 for durable storage (worker downloads from here)
      const r2Key = await uploadToR2(buffer, originalFilename, tripId, data.mimetype);

      // Record the upload in the documents table
      await supabase.from('documents').insert({
        trip_id: tripId,
        doc_type: 'booking_upload',
        r2_key: r2Key,
        original_filename: originalFilename,
      });

      // Enqueue the ingest job
      const queue = getIngestQueue();
      const job = await queue.add('ingest', {
        tripId,
        consultantId: consultant.id,
        r2Key,
        originalFilename,
        mimeType: data.mimetype,
        isImage: isImageFile(originalFilename),
      });

      return reply.status(202).send({
        jobId: job.id,
        message: `File "${originalFilename}" queued for processing`,
      });
    },
  );

  // ── GET /trips/:tripId/bookings/job/:jobId ────────────────────────────────
  // Poll for job status. Verifies trip ownership before exposing any job data.
  app.get(
    '/trips/:tripId/bookings/job/:jobId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tripId, jobId } = request.params as { tripId: string; jobId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      const queue = getIngestQueue();
      const job = await queue.getJob(jobId);

      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      // Prevent cross-tenant job data leak: confirm the job belongs to this trip
      if (job.data?.tripId !== tripId || job.data?.consultantId !== consultant.id) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      const state = await job.getState();
      const progress = job.progress;

      if (state === 'completed') {
        return reply.send({
          status: 'completed',
          result: job.returnvalue,
        });
      }

      if (state === 'failed') {
        return reply.send({
          status: 'failed',
          error: job.failedReason ?? 'Unknown error',
        });
      }

      return reply.send({ status: state, progress });
    },
  );

  // ── GET /trips/:tripId/bookings ───────────────────────────────────────────
  // List all ingested bookings for a trip.
  app.get(
    '/trips/:tripId/bookings',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tripId } = request.params as { tripId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Verify ownership
      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, booking_slug, booking_type, booking_ref, date, start_time, end_time, ' +
          'meeting_point_address, drop_off_address, included_meals, included_transport, ' +
          'allergy_flags, consultant_flags, ingested_at',
        )
        .eq('trip_id', tripId)
        .order('date', { ascending: true });

      if (error) {
        app.log.error(safeError(error));
        return reply.status(500).send({ error: 'Failed to fetch bookings' });
      }

      // Decrypt sensitive fields before returning to caller
      type BookingRow = { allergy_flags?: string | null; [key: string]: unknown };
      const rows = (data as unknown as BookingRow[]) ?? [];
      const decrypted = rows.map((booking) => ({
        ...booking,
        allergy_flags: booking.allergy_flags && isEncrypted(booking.allergy_flags)
          ? decryptJson(booking.allergy_flags)
          : booking.allergy_flags,
      }));

      return reply.send(decrypted);
    },
  );

  // ── DELETE /trips/:tripId/bookings/:bookingId ─────────────────────────────
  // Remove a single booking and its source document from R2.
  app.delete(
    '/trips/:tripId/bookings/:bookingId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tripId, bookingId } = request.params as { tripId: string; bookingId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Verify trip ownership
      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // Fetch the booking to confirm it belongs to this trip
      const { data: booking } = await supabase
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .eq('trip_id', tripId)
        .single();

      if (!booking) {
        return reply.status(404).send({ error: 'Booking not found' });
      }

      // Look up associated document for R2 cleanup (best-effort)
      const { data: doc } = await supabase
        .from('documents')
        .select('r2_key')
        .eq('trip_id', tripId)
        .eq('doc_type', 'booking_upload')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Delete booking row first (FK constraints)
      const { error: deleteError } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId);

      if (deleteError) {
        app.log.error(safeError(deleteError));
        return reply.status(500).send({ error: 'Failed to delete booking' });
      }

      // Best-effort R2 cleanup — don't fail the request if this errors
      if (doc?.r2_key) {
        try {
          await deleteFromR2(doc.r2_key);
          await supabase.from('documents').delete().eq('r2_key', doc.r2_key);
        } catch (err) {
          app.log.warn({ err }, 'R2 cleanup failed after booking delete');
        }
      }

      return reply.status(204).send();
    },
  );

  // ── POST /trips/:tripId/bookings/manual ───────────────────────────────────
  // Insert a booking manually (no file required).
  app.post(
    '/trips/:tripId/bookings/manual',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { tripId } = request.params as { tripId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Verify trip ownership
      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const body = request.body as Record<string, unknown>;

      // booking_slug and booking_type are required
      if (!body.booking_slug || typeof body.booking_slug !== 'string') {
        return reply.status(400).send({ error: 'booking_slug is required' });
      }
      if (!body.booking_type || typeof body.booking_type !== 'string') {
        return reply.status(400).send({ error: 'booking_type is required' });
      }

      const ALLOWED_TYPES = ['tour', 'transfer', 'restaurant', 'accommodation', 'activity', 'flight', 'other'];
      if (!ALLOWED_TYPES.includes(body.booking_type as string)) {
        return reply.status(400).send({ error: `booking_type must be one of: ${ALLOWED_TYPES.join(', ')}` });
      }

      const allergyFlags = body.allergy_flags
        ? encryptJson(body.allergy_flags)
        : null;

      const { data: newBooking, error: insertError } = await supabase
        .from('bookings')
        .insert({
          trip_id: tripId,
          booking_slug: body.booking_slug as string,
          booking_type: body.booking_type as string,
          booking_ref: (body.booking_ref as string | null) ?? null,
          date: (body.date as string | null) ?? null,
          start_time: (body.start_time as string | null) ?? null,
          end_time: (body.end_time as string | null) ?? null,
          meeting_point_address: (body.meeting_point_address as string | null) ?? null,
          drop_off_address: (body.drop_off_address as string | null) ?? null,
          included_meals: (body.included_meals as boolean) ?? false,
          included_transport: (body.included_transport as boolean) ?? false,
          allergy_flags: allergyFlags,
          consultant_flags: (body.consultant_flags as string[]) ?? [],
          summary: (body.summary as string | null) ?? null,
          ingested_at: new Date().toISOString(),
        })
        .select('id, booking_slug, booking_type, date, start_time, end_time, meeting_point_address, ingested_at')
        .single();

      if (insertError || !newBooking) {
        app.log.error(safeError(insertError));
        return reply.status(500).send({ error: 'Failed to create booking' });
      }

      return reply.status(201).send(newBooking);
    },
  );
}
