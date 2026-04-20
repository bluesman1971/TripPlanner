import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { z } from 'zod';
import { getSupabase } from '../lib/supabase';
import { getOrCreateConsultant } from '../lib/consultant';
import { requireAuth } from '../middleware/auth';

const CreateClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export async function clientRoutes(app: FastifyInstance) {
  // POST /clients — create a new client for the logged-in consultant
  app.post('/clients', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = CreateClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('clients')
      .insert({
        consultant_id: consultant.id,
        name: parsed.data.name,
        email: parsed.data.email,
      })
      .select('id, name, email, created_at')
      .single();

    if (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to create client' });
    }

    return reply.status(201).send(data);
  });

  // GET /clients — list all clients for the logged-in consultant
  app.get('/clients', { preHandler: [requireAuth] }, async (request, reply) => {
    const { userId } = getAuth(request);
    const supabase = getSupabase();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('clients')
      .select('id, name, email, created_at')
      .eq('consultant_id', consultant.id)
      .order('created_at', { ascending: false });

    if (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch clients' });
    }

    return reply.send(data ?? []);
  });
}
