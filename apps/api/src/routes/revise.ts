import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { AnthropicProvider } from '../ai/anthropic.provider';
import { MODEL_CONFIG } from '../config/models';
import { getDB, getTripForConsultant } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { REVISION_SYSTEM_PROMPT, buildRevisionUserMessage } from '../services/revisionPrompt';
import { fitToTokenBudget, CONTEXT_BUDGETS } from '../services/contextManager';
import { startSSE, REPLAY_CHUNK_SIZE } from '../lib/sse';

const provider = new AnthropicProvider();

const ALLOWED_STATUSES = ['draft', 'review', 'complete'];

export async function revisionRoutes(app: FastifyInstance) {

  // POST /trips/:id/revise/stream
  // Streams a revised itinerary based on consultant/client feedback.
  // Gate: trip status must be draft, review, or complete (a draft must exist).
  // Body: { feedback: string }
  // Query param: ?resumeFrom=N — if a saved version exists, replay from char offset N.
  //   Gate is bypassed for resume paths.
  // Returns SSE: { type: 'chunk', text } | { type: 'done', versionNumber } | { type: 'ping' } | { type: 'error', message }
  app.post(
    '/trips/:id/revise/stream',
    { preHandler: [requireAuth], config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: 60000 } } },
    async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
      const { resumeFrom } = request.query as { resumeFrom?: string };
      const { userId } = getAuth(request);
      const supabase = getDB();
      const consultant = await getOrCreateConsultant(userId!, supabase);

      const trip = await getTripForConsultant(supabase, tripId, consultant.id);
      if (!trip) return reply.status(404).send({ error: 'Trip not found' });

      // ── Resume path: replay saved version from offset ────────────────────────
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
        // No saved version — fall through to gate + fresh generation
      }

      // ── Gate check ────────────────────────────────────────────────────────────
      if (!ALLOWED_STATUSES.includes(trip.status as string)) {
        return reply.status(400).send({
          error: `Cannot revise: trip status is '${trip.status}'. A draft must exist first.`,
        });
      }

      const body = request.body as { feedback?: string } | undefined;
      const feedback = body?.feedback?.trim() ?? '';
      if (!feedback) {
        return reply.status(400).send({ error: 'Feedback is required.' });
      }

      // ── Fetch context ─────────────────────────────────────────────────────
      const [versionResult, bookingsResult] = await Promise.all([
        supabase
          .from('itinerary_versions')
          .select('markdown_content')
          .eq('trip_id', tripId)
          .order('version_number', { ascending: false })
          .limit(1)
          .single(),

        supabase
          .from('bookings')
          .select('booking_slug, booking_type, date, start_time, end_time, meeting_point_address, consultant_flags')
          .eq('trip_id', tripId)
          .order('date', { ascending: true }),
      ]);

      const rawItinerary = versionResult.data?.markdown_content ?? '';
      if (!rawItinerary) {
        return reply.status(400).send({
          error: 'No itinerary draft found. Generate a draft first.',
        });
      }

      // ── Apply context budget to current itinerary ────────────────────────────
      const { content: currentItinerary, truncated } = fitToTokenBudget(
        rawItinerary,
        CONTEXT_BUDGETS.revision.currentItinerary,
      );
      if (truncated) {
        app.log.warn({ tripId }, 'itinerary truncated to fit revision context budget');
      }

      const bookings = (bookingsResult.data ?? []) as Parameters<typeof buildRevisionUserMessage>[0]['bookings'];

      const userMessage = buildRevisionUserMessage({
        destination: trip.destination as string,
        destination_country: trip.destination_country as string,
        currentItinerary,
        feedback,
        bookings,
      });

      // ── Switch to SSE ─────────────────────────────────────────────────────
      const sse = startSSE(reply, request);

      let fullContent = '';
      let firstChunk = true;

      try {
        const handle = provider.streamWithUsage(
          {
            system: REVISION_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
            maxTokens: 12000,
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

          if (trip.status === 'draft') {
            await supabase
              .from('trips')
              .update({ status: 'review', updated_at: new Date().toISOString() })
              .eq('id', tripId);
          }

          sse.writeEvent({ type: 'done', versionNumber: versionNumber as number });
        }

      } catch (err) {
        app.log.error(safeError(err));
        sse.writeEvent({ type: 'error', message: 'Revision failed. Please try again.' });
      } finally {
        sse.end();
      }
    },
  );
}
