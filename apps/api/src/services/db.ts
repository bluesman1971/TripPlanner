/**
 * Scoped database access helpers.
 *
 * Route handlers MUST import the Supabase client via `getDB()` from this
 * module instead of importing directly from `lib/supabase`. Every helper here
 * enforces the correct ownership filter so the consultant_id check can never
 * be accidentally omitted.
 *
 * Workers (BullMQ) are exempt — they have no user context and may import
 * from lib/supabase directly.
 */

import { getSupabase } from '../lib/supabase';

export type DB = ReturnType<typeof getSupabase>;

/** Returns the Supabase service-role client. Use this instead of importing lib/supabase in routes. */
export function getDB(): DB {
  return getSupabase();
}

// ─── Trips ────────────────────────────────────────────────────────────────────
// trips.consultant_id is enforced via an inner join on clients.

/**
 * Returns the trip row if it belongs to the consultant, null otherwise.
 * The `select` string controls which columns are fetched — always includes
 * the ownership join `clients!inner(consultant_id)`.
 */
export async function getTripForConsultant(
  db: DB,
  tripId: string,
  consultantId: string,
  select = 'id, status, destination, destination_country, clients!inner(consultant_id)',
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from('trips')
    .select(select)
    .eq('id', tripId)
    .eq('clients.consultant_id', consultantId)
    .single();
  return data as Record<string, unknown> | null;
}

// ─── Clients ──────────────────────────────────────────────────────────────────
// clients has consultant_id directly.

/** Returns the client row if it belongs to the consultant, null otherwise. */
export async function getClientForConsultant(
  db: DB,
  clientId: string,
  consultantId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('consultant_id', consultantId)
    .single();
  return data as Record<string, unknown> | null;
}

/** Returns all clients for the consultant, ordered by name. */
export async function getClientsForConsultant(
  db: DB,
  consultantId: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await db
    .from('clients')
    .select('*')
    .eq('consultant_id', consultantId)
    .order('name');
  return (data ?? []) as Record<string, unknown>[];
}
