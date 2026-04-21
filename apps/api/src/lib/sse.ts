import type { FastifyRequest, FastifyReply } from 'fastify';

export const PING_INTERVAL_MS = 15_000;
export const REPLAY_CHUNK_SIZE = 512;

export interface SSESession {
  /** Write a single SSE event. No-op if client has already disconnected. */
  writeEvent(event: Record<string, unknown>): void;
  /** Call on the first real AI chunk to stop the keep-alive ping. */
  onFirstChunk(): void;
  /** True once the client has closed the connection. */
  isAborted(): boolean;
  /** Stop the ping timer and close the raw response. Call in finally{}. */
  end(): void;
}

/**
 * Initialises an SSE session: sets headers, hijacks the Fastify reply,
 * starts the keep-alive ping, and registers a close listener so the
 * isAborted() flag is set immediately when the client disconnects.
 */
export function startSSE(reply: FastifyReply, request: FastifyRequest): SSESession {
  const raw = reply.raw;

  raw.setHeader('Content-Type', 'text/event-stream');
  raw.setHeader('Cache-Control', 'no-cache');
  raw.setHeader('Connection', 'keep-alive');
  raw.setHeader('X-Accel-Buffering', 'no');
  raw.setHeader(
    'Access-Control-Allow-Origin',
    process.env.CORS_ORIGIN || 'http://localhost:5174',
  );

  reply.hijack();
  raw.flushHeaders();

  let aborted = false;
  let firstChunkReceived = false;
  let pingTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (!firstChunkReceived && !aborted) {
      raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }
  }, PING_INTERVAL_MS);

  const stopPing = () => {
    if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null; }
  };

  // When the client navigates away mid-stream: abort flag prevents further writes
  // and DB side-effects (inserts, status updates, email sends) are skipped.
  request.raw.on('close', () => { aborted = true; stopPing(); });

  return {
    writeEvent(event) {
      if (!aborted) raw.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    onFirstChunk() {
      firstChunkReceived = true;
      stopPing();
    },
    isAborted() { return aborted; },
    end() {
      stopPing();
      raw.end();
    },
  };
}
