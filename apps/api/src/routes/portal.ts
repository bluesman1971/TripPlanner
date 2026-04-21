import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { getDB, type DB } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { generatePdf } from '../services/pdfGenerator';

const PDF_MIME = 'application/pdf';
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5174';

// ─── Token validation helper ──────────────────────────────────────────────────

type PortalTokenRow = {
  id: string;
  trip_id: string;
  revoked: boolean;
  expires_at: string | null;
};

async function resolveValidToken(
  token: string,
  supabase: DB,
): Promise<{ tokenRow: PortalTokenRow; tripId: string } | null> {
  const { data } = await supabase
    .from('portal_tokens')
    .select('id, trip_id, revoked, expires_at')
    .eq('token', token)
    .single();

  if (!data) return null;
  if (data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  return { tokenRow: data as PortalTokenRow, tripId: data.trip_id as string };
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function portalRoutes(app: FastifyInstance) {

  // POST /trips/:id/portal/token
  // Consultant-only. Generates a shareable token for the trip.
  // Returns { token, portalUrl } — the URL the client visits.
  app.post(
    '/trips/:id/portal/token',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Ownership check — also fetch end_date to calculate default token expiry
      const { data: trip } = await supabase
        .from('trips')
        .select('id, end_date, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const token = crypto.randomBytes(32).toString('base64url');

      // Default expiry: 90 days after trip end date, or 90 days from now if no end date.
      const MS_90_DAYS = 90 * 24 * 60 * 60 * 1000;
      const expiresAt = trip.end_date
        ? new Date(new Date(trip.end_date as string).getTime() + MS_90_DAYS).toISOString()
        : new Date(Date.now() + MS_90_DAYS).toISOString();

      await supabase.from('portal_tokens').insert({
        trip_id: tripId,
        token,
        expires_at: expiresAt,
      });

      return reply.status(201).send({
        token,
        portalUrl: `${FRONTEND_URL}/portal/${token}`,
      });
    },
  );

  // GET /portal/:token
  // Public — no Clerk JWT required. Token is the auth mechanism.
  // Returns trip metadata + latest itinerary version markdown.
  app.get(
    '/portal/:token',
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const supabase = getDB();

      const resolved = await resolveValidToken(token, supabase);
      if (!resolved) {
        return reply.status(404).send({ error: 'Portal link not found or has expired.' });
      }

      const { tripId } = resolved;

      // Fetch trip + client name
      const { data: trip } = await supabase
        .from('trips')
        .select(`
          id, destination, destination_country, start_date, end_date,
          duration_days, purpose, status,
          clients!inner(name)
        `)
        .eq('id', tripId)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found.' });
      }

      // Fetch latest itinerary version
      const { data: version } = await supabase
        .from('itinerary_versions')
        .select('version_number, markdown_content, created_at')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (!version?.markdown_content) {
        return reply.status(404).send({ error: 'No itinerary available yet.' });
      }

      const clientsData = trip.clients as unknown as { name: string } | { name: string }[];
      const clientName = Array.isArray(clientsData) ? clientsData[0]?.name : clientsData?.name;

      return reply.send({
        trip: {
          id: trip.id,
          destination: trip.destination,
          destinationCountry: trip.destination_country,
          startDate: trip.start_date,
          endDate: trip.end_date,
          durationDays: trip.duration_days,
          clientName: clientName ?? '',
        },
        itinerary: {
          versionNumber: version.version_number,
          markdownContent: version.markdown_content,
          createdAt: version.created_at,
        },
      });
    },
  );

  // DELETE /trips/:id/portal/token
  // Consultant-only. Revokes all active portal tokens for the trip.
  // Returns 204 on success.
  app.delete(
    '/trips/:id/portal/token',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // Ownership check
      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      await supabase
        .from('portal_tokens')
        .update({ revoked: true })
        .eq('trip_id', tripId)
        .eq('revoked', false);

      return reply.status(204).send();
    },
  );

  // GET /portal/:token/pdf
  // Public — no Clerk JWT required.
  // Generates a PDF from the latest itinerary and streams it.
  app.get(
    '/portal/:token/pdf',
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const supabase = getDB();

      const resolved = await resolveValidToken(token, supabase);
      if (!resolved) {
        return reply.status(404).send({ error: 'Portal link not found or has expired.' });
      }

      const { tripId } = resolved;

      const { data: trip } = await supabase
        .from('trips')
        .select('id, destination')
        .eq('id', tripId)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found.' });
      }

      const { data: version } = await supabase
        .from('itinerary_versions')
        .select('version_number, markdown_content')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (!version?.markdown_content) {
        return reply.status(404).send({ error: 'No itinerary available yet.' });
      }

      try {
        const pdfBuffer = await generatePdf(
          version.markdown_content,
          `Itinerary — ${trip.destination}`,
        );

        const filename = `itinerary-${(trip.destination as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}-v${version.version_number}.pdf`;

        return reply
          .header('Content-Type', PDF_MIME)
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(pdfBuffer);

      } catch (err) {
        app.log.error(safeError(err));
        return reply.status(500).send({ error: 'PDF generation failed. Please try again.' });
      }
    },
  );
}
