import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { AnthropicProvider } from '../ai/anthropic.provider';
import { MODEL_CONFIG } from '../config/models';
import { getDB } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { RESEARCH_SYSTEM_PROMPT, buildResearchUserMessage } from '../services/researchPrompt';
import { startSSE, REPLAY_CHUNK_SIZE } from '../lib/sse';

const provider = new AnthropicProvider();

export async function researchRoutes(app: FastifyInstance) {

  // POST /trips/:id/research/stream
  // Starts a streaming research generation for the trip.
  // Gate: trip must have documents_ingested = true.
  // Query param: ?resumeFrom=N — if a saved note exists, replay from char offset N
  //   instead of running a fresh AI call. Useful when the client disconnects mid-stream.
  // Returns SSE: { type: 'chunk', text } | { type: 'done' } | { type: 'ping' } | { type: 'error', message }
  app.post(
    '/trips/:id/research/stream',
    { preHandler: [requireAuth], config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: 60000 } } },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { resumeFrom } = request.query as { resumeFrom?: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      // ── Ownership check ──────────────────────────────────────────────────────
      const { data: trip } = await supabase
        .from('trips')
        .select(`
          id, destination, destination_country, departure_city,
          start_date, end_date, duration_days,
          purpose, purpose_notes, status, documents_ingested,
          clients!inner(consultant_id)
        `)
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // ── Gate check ───────────────────────────────────────────────────────────
      if (!trip.documents_ingested) {
        return reply.status(400).send({
          error: 'Cannot start research: no documents have been ingested yet.',
        });
      }

      // ── Resume path: replay saved note from offset ───────────────────────────
      const resumeOffset = resumeFrom !== undefined ? parseInt(resumeFrom, 10) : NaN;
      if (!Number.isNaN(resumeOffset)) {
        const { data: savedNote } = await supabase
          .from('research_notes')
          .select('content')
          .eq('trip_id', tripId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (savedNote?.content) {
          const tail = savedNote.content.slice(resumeOffset);
          const sse = startSSE(reply, request);
          for (let i = 0; i < tail.length; i += REPLAY_CHUNK_SIZE) {
            sse.writeEvent({ type: 'chunk', text: tail.slice(i, i + REPLAY_CHUNK_SIZE) });
          }
          sse.writeEvent({ type: 'done' });
          sse.end();
          return;
        }
        // No saved note — fall through to fresh generation
      }

      // ── Fetch context for fresh generation ───────────────────────────────────
      const { data: brief } = await supabase
        .from('trip_brief')
        .select('brief_json')
        .eq('trip_id', tripId)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      const briefJson = (brief?.brief_json ?? {}) as Record<string, unknown>;
      const travelerProfile = briefJson.traveler_profile as Record<string, unknown> | undefined;
      const discovery = briefJson.discovery as Record<string, unknown> | undefined;

      const { data: bookings } = await supabase
        .from('bookings')
        .select('booking_slug, booking_type, date, start_time, end_time, meeting_point_address')
        .eq('trip_id', tripId)
        .order('date', { ascending: true });

      const userMessage = buildResearchUserMessage({
        destination: trip.destination as string,
        destination_country: trip.destination_country as string,
        departure_city: trip.departure_city as string,
        start_date: trip.start_date as string | null,
        end_date: trip.end_date as string | null,
        duration_days: trip.duration_days as number | null,
        purpose: trip.purpose as string,
        purpose_notes: trip.purpose_notes as string,
        travelerProfile: (travelerProfile as unknown) as Parameters<typeof buildResearchUserMessage>[0]['travelerProfile'],
        discovery: (discovery as unknown) as Parameters<typeof buildResearchUserMessage>[0]['discovery'],
        bookings: (bookings ?? []) as Parameters<typeof buildResearchUserMessage>[0]['bookings'],
      });

      // ── Switch to SSE ────────────────────────────────────────────────────────
      const sse = startSSE(reply, request);

      let fullContent = '';
      let firstChunk = true;

      try {
        const handle = provider.streamWithUsage(
          {
            system: RESEARCH_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
            maxTokens: 8192,
          },
          { model: MODEL_CONFIG.balanced.model },
        );

        for await (const chunk of handle) {
          if (sse.isAborted()) break;
          if (firstChunk) { firstChunk = false; sse.onFirstChunk(); }
          fullContent += chunk.text;
          sse.writeEvent({ type: 'chunk', text: chunk.text });
        }

        // Skip all side-effects if the client disconnected mid-generation
        if (!sse.isAborted()) {
          const usage = await handle.getUsage();

          await supabase
            .from('research_notes')
            .insert({
              trip_id: tripId,
              content: fullContent,
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              model_used: usage.model,
            });

          await supabase
            .from('trips')
            .update({ status: 'research', updated_at: new Date().toISOString() })
            .eq('id', tripId);

          sse.writeEvent({ type: 'done' });
        }

      } catch (err) {
        app.log.error(safeError(err));
        sse.writeEvent({ type: 'error', message: 'Research generation failed. Please try again.' });
      } finally {
        sse.end();
      }
    },
  );

  // GET /trips/:id/research
  // Returns the latest saved research notes for a trip.
  app.get(
    '/trips/:id/research',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const { data: trip } = await supabase
        .from('trips')
        .select('id, clients!inner(consultant_id)')
        .eq('id', tripId)
        .eq('clients.consultant_id', consultant.id)
        .single();

      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const { data: note } = await supabase
        .from('research_notes')
        .select('id, content, created_at')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return reply.send(note ?? null);
    },
  );
}
