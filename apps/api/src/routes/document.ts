import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { getDB, getTripForConsultant } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { downloadR2AsBuffer } from '../lib/r2';
import { getDocumentQueue, type DocumentJobResult } from '../queues/document.queue';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_STATUSES = ['draft', 'review', 'complete'];

export async function documentRoutes(app: FastifyInstance) {

  // POST /trips/:id/document
  // Enqueues a DOCX generation job. Returns 202 + { jobId }.
  // Gate: trip status must be draft, review, or complete.
  // Poll GET /trips/:id/document/job/:jobId for completion.
  app.post(
    '/trips/:id/document',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      if (!ALLOWED_STATUSES.includes(trip.status as string)) {
        return reply.status(400).send({
          error: `Cannot generate document: trip status is '${trip.status}'. Complete the draft first.`,
        });
      }

      // Fetch the latest itinerary version — gate requires one to exist
      const { data: version } = await supabase
        .from('itinerary_versions')
        .select('id, version_number, markdown_content')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (!version?.markdown_content) {
        return reply.status(400).send({
          error: 'No itinerary draft found. Generate a draft first.',
        });
      }

      try {
        const queue = getDocumentQueue();
        const job = await queue.add('generate', {
          tripId,
          consultantId: consultant.id,
          versionId: version.id as string,
          markdownContent: version.markdown_content as string,
          destination: trip.destination as string,
          mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
        });

        return reply.status(202).send({ jobId: job.id });

      } catch (err) {
        app.log.error(safeError(err));
        return reply.status(500).send({ error: 'Document generation failed. Please try again.' });
      }
    },
  );

  // GET /trips/:id/document/job/:jobId
  // Polls BullMQ for the status of a document generation job.
  // Returns: { status: 'waiting'|'active'|'completed'|'failed', result?, error? }
  app.get(
    '/trips/:id/document/job/:jobId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId, jobId } = request.params as { id: string; jobId: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      try {
        const queue = getDocumentQueue();
        const job = await queue.getJob(jobId);

        if (!job) {
          return reply.status(404).send({ error: 'Job not found' });
        }

        // Prevent cross-tenant job data leak: confirm the job belongs to this trip
        if (job.data?.tripId !== tripId) {
          return reply.status(404).send({ error: 'Job not found' });
        }

        const state = await job.getState();

        if (state === 'completed') {
          const result = job.returnvalue as DocumentJobResult;
          return reply.send({ status: 'completed', result });
        }

        if (state === 'failed') {
          return reply.send({
            status: 'failed',
            error: 'Document generation failed. Please try again.',
          });
        }

        return reply.send({ status: state });

      } catch (err) {
        app.log.error(safeError(err));
        return reply.status(500).send({ error: 'Could not retrieve job status.' });
      }
    },
  );

  // GET /trips/:id/document
  // Returns the latest generated document metadata, or null if none exists.
  app.get(
    '/trips/:id/document',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      const { data: version } = await supabase
        .from('itinerary_versions')
        .select('version_number, docx_r2_key, created_at')
        .eq('trip_id', tripId)
        .not('docx_r2_key', 'is', null)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (!version?.docx_r2_key) return reply.send(null);

      return reply.send({
        versionNumber: version.version_number,
        createdAt: version.created_at,
        downloadPath: `/trips/${tripId}/document/download`,
      });
    },
  );

  // GET /trips/:id/document/download
  // Authenticated download proxy — streams the DOCX file from R2.
  // No presigned URLs: download requires a valid Clerk JWT.
  app.get(
    '/trips/:id/document/download',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      const { data: version } = await supabase
        .from('itinerary_versions')
        .select('version_number, docx_r2_key')
        .eq('trip_id', tripId)
        .not('docx_r2_key', 'is', null)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (!version?.docx_r2_key) {
        return reply.status(404).send({ error: 'No document available yet.' });
      }

      try {
        const buffer = await downloadR2AsBuffer(version.docx_r2_key as string);
        const filename = `itinerary-v${version.version_number}.docx`;

        return reply
          .header('Content-Type', DOCX_MIME)
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(buffer);
      } catch (err) {
        app.log.error(safeError(err));
        return reply.status(500).send({ error: 'Download failed. Please try again.' });
      }
    },
  );
}
