import { getAuth } from '@clerk/fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Prehandler that rejects unauthenticated requests.
 * Attach to any route that requires a logged-in consultant.
 *
 * Usage in a route:
 *   { preHandler: [requireAuth] }
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = getAuth(request);
  if (!userId) {
    await reply.status(401).send({ error: 'Unauthorized' });
  }
}
