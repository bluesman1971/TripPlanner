import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { getSupabase } from '../lib/supabase';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { generateDocx } from '../services/docxGenerator';
import { uploadDocxToR2, downloadR2AsBuffer } from '../lib/r2';

/** Returns the trip row if it belongs to the consultant, null otherwise. */
async function getTripForConsultant(
  tripId: string,
  consultantId: string,
  supabase: ReturnType<typeof getSupabase>,
) {
  const { data } = await supabase
    .from('trips')
    .select(`
      id, destination, destination_country, status,
      clients!inner(consultant_id)
    `)
    .eq('id', tripId)
    .eq('clients.consultant_id', consultantId)
    .single();
  return data;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_STATUSES = ['draft', 'review', 'complete'];

export async function documentRoutes(app: FastifyInstance) {

  // POST /trips/:id/document
  // Generates a DOCX from the latest itinerary version and uploads it to R2.
  // Gate: trip status must be draft, review, or complete.
  // Returns: { versionNumber, downloadPath }
  app.post(
    '/trips/:id/document',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getSupabase();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(tripId, consultant.id, supabase);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      if (!ALLOWED_STATUSES.includes(trip.status as string)) {
        return reply.status(400).send({
          error: `Cannot generate document: trip status is '${trip.status}'. Complete the draft first.`,
        });
      }

      // Fetch latest itinerary version
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
        const docxBuffer = await generateDocx(version.markdown_content, {
          destination: trip.destination as string,
          mapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
        });

        const r2Key = await uploadDocxToR2(docxBuffer, tripId);

        // Attach the R2 key to the itinerary version
        await supabase
          .from('itinerary_versions')
          .update({ docx_r2_key: r2Key })
          .eq('id', version.id);

        // Advance trip status to 'review'
        await supabase
          .from('trips')
          .update({ status: 'review', updated_at: new Date().toISOString() })
          .eq('id', tripId);

        return reply.status(200).send({
          versionNumber: version.version_number,
          downloadPath: `/trips/${tripId}/document/download`,
        });

      } catch (err) {
        app.log.error(safeError(err));
        return reply.status(500).send({ error: 'Document generation failed. Please try again.' });
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
      const supabase = getSupabase();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(tripId, consultant.id, supabase);
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
      const supabase = getSupabase();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(tripId, consultant.id, supabase);
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
