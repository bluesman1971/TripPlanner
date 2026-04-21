import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { z } from 'zod';
import { TripPurposeSchema, TripStatusSchema, DiscoverySchema, TravelerProfileSchema } from '@trip-planner/shared';
import { getSupabase } from '../lib/supabase';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';

// ─── Request schemas ──────────────────────────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const CreateTripSchema = z.object({
  clientId: z.string().uuid(),
  destination: z.string().min(1),
  destinationSlug: z.string().min(1),
  destinationCountry: z.string().min(1),
  departureCity: z.string().default(''),
  startDate: z.string().regex(dateRegex).optional(),
  endDate: z.string().regex(dateRegex).optional(),
  durationDays: z.number().int().positive().optional(),
  purpose: TripPurposeSchema,
  purposeNotes: z.string().default(''),
  discovery: DiscoverySchema,
  travelerProfile: TravelerProfileSchema,
});

const UpdateBriefSchema = z.object({
  destination: z.string().optional(),
  destinationCountry: z.string().optional(),
  departureCity: z.string().optional(),
  startDate: z.string().regex(dateRegex).optional(),
  endDate: z.string().regex(dateRegex).optional(),
  durationDays: z.number().int().positive().optional(),
  purpose: TripPurposeSchema.optional(),
  purposeNotes: z.string().optional(),
  status: TripStatusSchema.optional(),
  documentsIngested: z.boolean().optional(),
  discovery: DiscoverySchema.partial().optional(),
  briefJson: z.record(z.unknown()).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Verify a trip belongs to the given consultant. Returns the trip row or null. */
async function getTripForConsultant(
  tripId: string,
  consultantId: string,
  supabase: ReturnType<typeof getSupabase>,
) {
  const { data } = await supabase
    .from('trips')
    .select(`
      id, destination, destination_slug, destination_country, departure_city,
      start_date, end_date, duration_days, purpose, purpose_notes,
      status, documents_ingested, created_at, updated_at,
      clients!inner(consultant_id)
    `)
    .eq('id', tripId)
    .eq('clients.consultant_id', consultantId)
    .single();

  return data;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function tripRoutes(app: FastifyInstance) {

  // GET /trips — list all trips for the logged-in consultant
  app.get('/trips', { preHandler: [requireAuth] }, async (request, reply) => {
    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('trips')
      .select(`
        id, destination, destination_slug, status, documents_ingested,
        start_date, end_date, purpose, created_at, updated_at,
        clients!inner(id, name, consultant_id)
      `)
      .eq('clients.consultant_id', consultant.id)
      .order('created_at', { ascending: false });

    if (error) {
      app.log.error(safeError(error));
      return reply.status(500).send({ error: 'Failed to fetch trips' });
    }

    return reply.send(data ?? []);
  });

  // POST /trips — create a new trip
  app.post('/trips', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = CreateTripSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    // Verify the client belongs to this consultant
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', parsed.data.clientId)
      .eq('consultant_id', consultant.id)
      .single();

    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({
        client_id: parsed.data.clientId,
        destination: parsed.data.destination,
        destination_slug: parsed.data.destinationSlug,
        destination_country: parsed.data.destinationCountry,
        departure_city: parsed.data.departureCity,
        start_date: parsed.data.startDate ?? null,
        end_date: parsed.data.endDate ?? null,
        duration_days: parsed.data.durationDays ?? null,
        purpose: parsed.data.purpose,
        purpose_notes: parsed.data.purposeNotes,
        status: 'setup',
        documents_ingested: false,
      })
      .select('id, destination, status, created_at')
      .single();

    if (tripError || !trip) {
      app.log.error(safeError(tripError));
      return reply.status(500).send({ error: 'Failed to create trip' });
    }

    // Insert initial brief_json (version 1)
    const initialBrief = {
      trip_id: trip.id,
      destination: parsed.data.destination,
      destination_slug: parsed.data.destinationSlug,
      destination_country: parsed.data.destinationCountry,
      departure_city: parsed.data.departureCity,
      purpose: parsed.data.purpose,
      purpose_notes: parsed.data.purposeNotes,
      status: 'setup',
      documents_ingested: false,
      discovery: parsed.data.discovery,
      traveler_profile: parsed.data.travelerProfile,
      pre_booked: [],
      version_history: [{ date: new Date().toISOString().slice(0, 10), note: 'Trip created' }],
    };

    await supabase
      .from('trip_brief')
      .insert({ trip_id: trip.id, brief_json: initialBrief, version: 1 });

    return reply.status(201).send(trip);
  });

  // GET /trips/:id — get a single trip with brief and bookings
  app.get('/trips/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const trip = await getTripForConsultant(id, consultant.id, supabase);
    if (!trip) {
      return reply.status(404).send({ error: 'Trip not found' });
    }

    // Fetch the latest brief version
    const { data: brief } = await supabase
      .from('trip_brief')
      .select('brief_json, version, created_at')
      .eq('trip_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    // Fetch bookings
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, booking_slug, booking_type, date, start_time, end_time, meeting_point_address, ingested_at')
      .eq('trip_id', id)
      .order('date', { ascending: true });

    // Fetch itinerary versions (metadata only, not full content)
    const { data: itineraries } = await supabase
      .from('itinerary_versions')
      .select('id, version_number, docx_r2_key, created_at')
      .eq('trip_id', id)
      .order('version_number', { ascending: false });

    return reply.send({
      ...trip,
      brief: brief ?? null,
      bookings: bookings ?? [],
      itineraryVersions: itineraries ?? [],
    });
  });

  // PATCH /trips/:id/brief — update brief fields and save a new brief version
  app.patch('/trips/:id/brief', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateBriefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const trip = await getTripForConsultant(id, consultant.id, supabase);
    if (!trip) {
      return reply.status(404).send({ error: 'Trip not found' });
    }

    const updates = parsed.data;

    // Update the trips table with any top-level field changes
    const tripUpdates: Record<string, unknown> = {};
    if (updates.destination)        tripUpdates.destination = updates.destination;
    if (updates.destinationCountry) tripUpdates.destination_country = updates.destinationCountry;
    if (updates.departureCity)      tripUpdates.departure_city = updates.departureCity;
    if (updates.startDate)          tripUpdates.start_date = updates.startDate;
    if (updates.endDate)            tripUpdates.end_date = updates.endDate;
    if (updates.durationDays)       tripUpdates.duration_days = updates.durationDays;
    if (updates.purpose)            tripUpdates.purpose = updates.purpose;
    if (updates.purposeNotes !== undefined) tripUpdates.purpose_notes = updates.purposeNotes;
    if (updates.status)             tripUpdates.status = updates.status;
    if (updates.documentsIngested !== undefined) tripUpdates.documents_ingested = updates.documentsIngested;

    if (Object.keys(tripUpdates).length > 0) {
      await supabase.from('trips').update(tripUpdates).eq('id', id);
    }

    // Get the current latest brief to build the new version
    const { data: currentBrief } = await supabase
      .from('trip_brief')
      .select('brief_json, version')
      .eq('trip_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const currentVersion = currentBrief?.version ?? 0;
    const currentJson = (currentBrief?.brief_json ?? {}) as Record<string, unknown>;

    // Merge updates into the existing brief JSON
    const newBriefJson: Record<string, unknown> = {
      ...currentJson,
      ...(updates.briefJson ?? {}),
    };

    if (updates.status) newBriefJson.status = updates.status;
    if (updates.documentsIngested !== undefined) newBriefJson.documents_ingested = updates.documentsIngested;
    if (updates.discovery) {
      newBriefJson.discovery = { ...(currentJson.discovery as object ?? {}), ...updates.discovery };
    }

    // Append to version history
    const versionHistory = Array.isArray(currentJson.version_history)
      ? currentJson.version_history
      : [];
    newBriefJson.version_history = [
      ...versionHistory,
      { date: new Date().toISOString().slice(0, 10), note: `Brief updated (v${currentVersion + 1})` },
    ];

    const { data: newBrief, error } = await supabase
      .from('trip_brief')
      .insert({ trip_id: id, brief_json: newBriefJson, version: currentVersion + 1 })
      .select('brief_json, version, created_at')
      .single();

    if (error) {
      app.log.error(safeError(error));
      return reply.status(500).send({ error: 'Failed to update brief' });
    }

    return reply.send(newBrief);
  });
}
