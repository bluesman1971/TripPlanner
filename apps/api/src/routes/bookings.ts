import type { FastifyInstance } from 'fastify';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAuth } from '@clerk/fastify';
import { getSupabase } from '../lib/supabase';
import { getOrCreateConsultant } from '../lib/consultant';
import { getIngestQueue } from '../queues/ingest.queue';
import { isImageFile } from '../services/extractor';
import { requireAuth } from '../middleware/auth';

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
      const supabase = getSupabase();
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

      // Write to a temp file — the worker reads it from there
      const tempPath = path.join(tmpdir(), `ingest-${randomUUID()}${ext}`);
      writeFileSync(tempPath, buffer);

      // Enqueue the ingest job
      const queue = getIngestQueue();
      const job = await queue.add('ingest', {
        tripId,
        consultantId: consultant.id,
        filePath: tempPath,
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
  // Poll for job status.
  app.get(
    '/trips/:tripId/bookings/job/:jobId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { jobId } = request.params as { tripId: string; jobId: string };
      const queue = getIngestQueue();
      const job = await queue.getJob(jobId);

      if (!job) {
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
      const supabase = getSupabase();
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
        app.log.error(error);
        return reply.status(500).send({ error: 'Failed to fetch bookings' });
      }

      return reply.send(data ?? []);
    },
  );
}
