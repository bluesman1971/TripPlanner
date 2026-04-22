import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { AnthropicProvider } from '../ai/anthropic.provider';
import { MODEL_CONFIG } from '../config/models';
import { getDB, getTripForConsultant } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { DRAFT_SYSTEM_PROMPT, buildDraftUserMessage } from '../services/draftPrompt';
import { fitToTokenBudget, CONTEXT_BUDGETS } from '../services/contextManager';
import { sendDraftReadyEmail } from '../services/email';
import { startSSE, REPLAY_CHUNK_SIZE } from '../lib/sse';

const provider = new AnthropicProvider();

const DRAFT_TRIP_SELECT =
  'id, destination, destination_country, departure_city, start_date, end_date, duration_days, purpose, purpose_notes, status, clients!inner(consultant_id)';

export async function draftRoutes(app: FastifyInstance) {

  // POST /trips/:id/draft/stream
  // Streams a full itinerary draft using the quality tier.
  // Gate: trip status must be 'research'.
  // Query param: ?resumeFrom=N — if a saved draft exists, replay from char offset N
  //   instead of running a fresh AI call. Gate is bypassed for resume paths.
  // Returns SSE: { type: 'chunk', text } | { type: 'done', versionNumber } | { type: 'ping' } | { type: 'error', message }
  app.post(
    '/trips/:id/draft/stream',
    { preHandler: [requireAuth], config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: 60000 } } },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { resumeFrom } = request.query as { resumeFrom?: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id, DRAFT_TRIP_SELECT);
      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      // ── Resume path: replay saved draft from offset ──────────────────────────
      const resumeOffset = resumeFrom !== undefined ? parseInt(resumeFrom, 10) : NaN;
      if (!Number.isNaN(resumeOffset)) {
        const { data: savedVersion } = await supabase
          .from('itinerary_versions')
          .select('version_number, markdown_content')
          .eq('trip_id', tripId)
          .order('version_number', { ascending: false })
          .limit(1)
          .single();

        if (savedVersion?.markdown_content) {
          const tail = savedVersion.markdown_content.slice(resumeOffset);
          const sse = startSSE(reply, request);
          for (let i = 0; i < tail.length; i += REPLAY_CHUNK_SIZE) {
            sse.writeEvent({ type: 'chunk', text: tail.slice(i, i + REPLAY_CHUNK_SIZE) });
          }
          sse.writeEvent({ type: 'done', versionNumber: savedVersion.version_number });
          sse.end();
          return;
        }
        // No saved draft — fall through to gate check + fresh generation
      }

      // ── Gate check ───────────────────────────────────────────────────────────
      if (trip.status !== 'research') {
        return reply.status(400).send({
          error: `Cannot generate draft: trip status is '${trip.status}'. Research must be complete first.`,
        });
      }

      // ── Fetch context ─────────────────────────────────────────────────────
      const [briefResult, bookingsResult, researchResult] =
        await Promise.all([
          supabase
            .from('trip_brief')
            .select('brief_json')
            .eq('trip_id', tripId)
            .order('version', { ascending: false })
            .limit(1)
            .single(),

          supabase
            .from('bookings')
            .select('booking_slug, booking_type, date, start_time, end_time, meeting_point_address, consultant_flags')
            .eq('trip_id', tripId)
            .order('date', { ascending: true }),

          supabase
            .from('research_notes')
            .select('content')
            .eq('trip_id', tripId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
        ]);

      const briefJson = (briefResult.data?.brief_json ?? {}) as Record<string, unknown>;
      const travelerProfile = briefJson.traveler_profile as Record<string, unknown> | undefined;
      const bookings = (bookingsResult.data ?? []) as Parameters<typeof buildDraftUserMessage>[0]['bookings'];
      const rawResearchContent = researchResult.data?.content ?? '';

      if (!rawResearchContent) {
        return reply.status(400).send({
          error: 'Cannot generate draft: no research notes found. Run research first.',
        });
      }

      // ── Apply context budget to research notes ───────────────────────────────
      const { content: researchContent, truncated } = fitToTokenBudget(
        rawResearchContent,
        CONTEXT_BUDGETS.draft.researchNotes,
      );
      if (truncated) {
        app.log.warn({ tripId }, 'research notes truncated to fit draft context budget');
      }

      const userMessage = buildDraftUserMessage({
        destination: trip.destination as string,
        destination_country: trip.destination_country as string,
        start_date: trip.start_date as string | null,
        end_date: trip.end_date as string | null,
        duration_days: trip.duration_days as number | null,
        purpose: trip.purpose as string,
        purpose_notes: trip.purpose_notes as string,
        travelerProfile: (travelerProfile as unknown) as Parameters<typeof buildDraftUserMessage>[0]['travelerProfile'],
        bookings,
        researchContent,
      });

      // ── Switch to SSE ─────────────────────────────────────────────────────
      const sse = startSSE(reply, request);

      let fullContent = '';
      let firstChunk = true;

      try {
        const handle = provider.streamWithUsage(
          {
            system: DRAFT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
            maxTokens: 12000,
          },
          { model: MODEL_CONFIG.quality.model },
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

          // Atomic insert: advisory lock inside the function prevents concurrent
          // requests from assigning the same version_number to this trip.
          const { data: versionNumber, error: insertErr } = await supabase.rpc(
            'insert_itinerary_version',
            {
              p_trip_id: tripId,
              p_markdown: fullContent,
              p_input_tokens: usage.inputTokens,
              p_output_tokens: usage.outputTokens,
              p_model_used: usage.model,
            },
          );
          if (insertErr) throw insertErr;

          await supabase
            .from('trips')
            .update({ status: 'draft', updated_at: new Date().toISOString() })
            .eq('id', tripId);

          // Fire-and-forget — email failure must never disrupt the SSE stream
          sendDraftReadyEmail(
            consultant,
            { id: tripId, destination: trip.destination as string },
            versionNumber as number,
          );

          sse.writeEvent({ type: 'done', versionNumber: versionNumber as number });
        }

      } catch (err) {
        app.log.error(safeError(err));
        sse.writeEvent({ type: 'error', message: 'Draft generation failed. Please try again.' });
      } finally {
        sse.end();
      }
    },
  );

  // GET /trips/:id/draft
  // Returns the latest saved draft (markdown_content + version metadata).
  app.get(
    '/trips/:id/draft',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) {
        return reply.status(404).send({ error: 'Trip not found' });
      }

      const { data: draft } = await supabase
        .from('itinerary_versions')
        .select('id, version_number, markdown_content, created_at')
        .eq('trip_id', tripId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      return reply.send(draft ?? null);
    },
  );
}
