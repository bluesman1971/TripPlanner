import { createClerkClient } from '@clerk/fastify';
import type { SupabaseClient } from '@supabase/supabase-js';

const clerkApiClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export interface Consultant {
  id: string;
  name: string;
  email: string;
  auth_user_id: string;
}

/**
 * Returns the consultant row for the given Clerk userId, creating it on
 * first access using the user's Clerk profile data.
 */
export async function getOrCreateConsultant(
  userId: string,
  supabase: SupabaseClient,
): Promise<Consultant> {
  const { data: existing } = await supabase
    .from('consultants')
    .select('id, name, email, auth_user_id')
    .eq('auth_user_id', userId)
    .single();

  if (existing) return existing as Consultant;

  const clerkUser = await clerkApiClient.users.getUser(userId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
  const name = [clerkUser.firstName, clerkUser.lastName]
    .filter(Boolean)
    .join(' ') || email;

  const { data: created, error } = await supabase
    .from('consultants')
    .insert({ auth_user_id: userId, name, email })
    .select('id, name, email, auth_user_id')
    .single();

  if (error || !created) {
    throw new Error(`Failed to create consultant record: ${error?.message}`);
  }

  return created as Consultant;
}
