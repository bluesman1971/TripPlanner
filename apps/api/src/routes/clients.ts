import type { FastifyInstance } from 'fastify';
import { getAuth } from '@clerk/fastify';
import { z } from 'zod';
import { getDB } from '../services/db';
import { getOrCreateConsultant } from '../lib/consultant';
import { safeError } from '../lib/logger';
import { requireAuth } from '../middleware/auth';

const CreateClientSchema = z.object({
  name:         z.string().min(1),
  email:        z.string().email(),
  phone:        z.string().default(''),
  addressLine:  z.string().default(''),
  city:         z.string().default(''),
  country:      z.string().default(''),
  postalCode:   z.string().default(''),
});

const CLIENT_SELECT = 'id, name, email, phone, address_line, city, country, postal_code, created_at';

export async function clientRoutes(app: FastifyInstance) {

  // POST /clients
  app.post('/clients', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = CreateClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { userId } = getAuth(request);
    const supabase = getDB();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('clients')
      .insert({
        consultant_id: consultant.id,
        name:          parsed.data.name,
        email:         parsed.data.email,
        phone:         parsed.data.phone,
        address_line:  parsed.data.addressLine,
        city:          parsed.data.city,
        country:       parsed.data.country,
        postal_code:   parsed.data.postalCode,
      })
      .select(CLIENT_SELECT)
      .single();

    if (error) {
      app.log.error(safeError(error));
      return reply.status(500).send({ error: 'Failed to create client' });
    }

    return reply.status(201).send(data);
  });

  // PATCH /clients/:id — update contact info
  app.patch('/clients/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CreateClientSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
    }

    const { userId } = getAuth(request);
    const supabase = getDB();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const updates: Record<string, string> = {};
    if (parsed.data.name)        updates.name         = parsed.data.name;
    if (parsed.data.email)       updates.email        = parsed.data.email;
    if (parsed.data.phone        !== undefined) updates.phone         = parsed.data.phone;
    if (parsed.data.addressLine  !== undefined) updates.address_line  = parsed.data.addressLine;
    if (parsed.data.city         !== undefined) updates.city          = parsed.data.city;
    if (parsed.data.country      !== undefined) updates.country       = parsed.data.country;
    if (parsed.data.postalCode   !== undefined) updates.postal_code   = parsed.data.postalCode;

    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .eq('consultant_id', consultant.id)
      .select(CLIENT_SELECT)
      .single();

    if (error) {
      app.log.error(safeError(error));
      return reply.status(500).send({ error: 'Failed to update client' });
    }

    return reply.send(data);
  });

  // GET /clients
  app.get('/clients', { preHandler: [requireAuth] }, async (request, reply) => {
    const { userId } = getAuth(request);
    const supabase = getDB();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('consultant_id', consultant.id)
      .order('created_at', { ascending: false });

    if (error) {
      app.log.error(safeError(error));
      return reply.status(500).send({ error: 'Failed to fetch clients' });
    }

    return reply.send(data ?? []);
  });

  // GET /clients/:id
  app.get('/clients/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = getAuth(request);
    const supabase = getDB();
    const consultant = await getOrCreateConsultant(userId!, supabase);

    const { data, error } = await supabase
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('id', id)
      .eq('consultant_id', consultant.id)
      .single();

    if (error) {
      app.log.error(safeError(error));
      return reply.status(404).send({ error: 'Client not found' });
    }

    return reply.send(data);
  });
}
