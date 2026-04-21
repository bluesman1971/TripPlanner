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

const provider = new AnthropicProvider();

const PING_INTERVAL_MS = 15_000;
const REPLAY_CHUNK_SIZE = 512;

function writeSSE(raw: NodeJS.WritableStream, event: Record<string, unknown>) {
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

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
          reply.raw.setHeader('Content-Type', 'text/event-stream');
          reply.raw.setHeader('Cache-Control', 'no-cache');
          reply.raw.setHeader('Connection', 'keep-alive');
          reply.raw.setHeader('X-Accel-Buffering', 'no');
          reply.raw.setHeader(
            'Access-Control-Allow-Origin',
            process.env.CORS_ORIGIN || 'http://localhost:5174',
          );
          reply.hijack();
          reply.raw.flushHeaders();

          for (let i = 0; i < tail.length; i += REPLAY_CHUNK_SIZE) {
            writeSSE(reply.raw, { type: 'chunk', text: tail.slice(i, i + REPLAY_CHUNK_SIZE) });
          }
          writeSSE(reply.raw, { type: 'done', versionNumber: savedVersion.version_number });
          reply.raw.end();
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
      const [versionResult, bookingsResult, latestVersionResult] = await Promise.all([
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

        supabase
          .from('itinerary_versions')
          .select('version_number')
          .eq('trip_id', tripId)
          .order('version_number', { ascending: false })
          .limit(1)
          .single(),
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
      const nextVersionNumber = ((latestVersionResult.data?.version_number as number | null) ?? 0) + 1;

      const userMessage = buildRevisionUserMessage({
        destination: trip.destination as string,
        destination_country: trip.destination_country as string,
        currentItinerary,
        feedback,
        bookings,
      });

      // ── Switch to SSE ─────────────────────────────────────────────────────
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.setHeader(
        'Access-Control-Allow-Origin',
        process.env.CORS_ORIGIN || 'http://localhost:5174',
      );

      reply.hijack();
      reply.raw.flushHeaders();

      let fullContent = '';
      let firstChunk = true;
      let pingTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (firstChunk) writeSSE(reply.raw, { type: 'ping' });
      }, PING_INTERVAL_MS);

      const stopPing = () => {
        if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null; }
      };

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
          if (firstChunk) { firstChunk = false; stopPing(); }
          fullContent += chunk.text;
          writeSSE(reply.raw, { type: 'chunk', text: chunk.text });
        }

        const usage = await handle.getUsage();

        // ── Save as new version (never overwrite) ─────────────────────────────
        await supabase
          .from('itinerary_versions')
          .insert({
            trip_id: tripId,
            version_number: nextVersionNumber,
            markdown_content: fullContent,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            model_used: usage.model,
          });

        // ── Advance status to 'review' if it was still 'draft' ────────────────
        if (trip.status === 'draft') {
          await supabase
            .from('trips')
            .update({ status: 'review', updated_at: new Date().toISOString() })
            .eq('id', tripId);
        }

        writeSSE(reply.raw, { type: 'done', versionNumber: nextVersionNumber });

      } catch (err) {
        app.log.error(safeError(err));
        writeSSE(reply.raw, { type: 'error', message: 'Revision failed. Please try again.' });
      } finally {
        stopPing();
        reply.raw.end();
      }
    },
  );
}
