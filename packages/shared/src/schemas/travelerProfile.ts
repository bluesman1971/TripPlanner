import { z } from 'zod';

export const TravelerRoleSchema = z.enum([
  'primary', 'partner', 'child', 'parent', 'sibling', 'friend', 'colleague',
]);

export const AgeGroupSchema = z.enum([
  '20s', '30s', '40s', '50s', '60s', '70s+',
  'teen',        // 13–17
  'child',       // 6–12
  'young-child', // 0–5
]);

export const TravelerSchema = z.object({
  role:      TravelerRoleSchema,
  age_group: AgeGroupSchema,
  notes:     z.string().default(''), // e.g. "uses walking stick", "very active"
});

export const INTEREST_OPTIONS = [
  'food-wine', 'art-museums', 'architecture', 'history',
  'outdoor-nature', 'markets', 'music-performance',
  'shopping', 'cooking-classes', 'beaches', 'sports',
] as const;

export const TravelerProfileSchema = z.object({
  /** All people on the trip including the primary traveler */
  travelers: z.array(TravelerSchema).min(1),

  /** Physical capacity */
  daily_walking:        z.enum(['low', 'medium', 'high']),
  activity_level:       z.enum(['relaxed', 'moderate', 'active']),
  physical_limitations: z.string().default(''),

  /** Interests — 1 to 5, used to prioritise research */
  interests: z.array(z.string()).min(1).max(5),

  /** Dining */
  dietary_restrictions: z.array(z.string()).default([]),
  dining_style:         z.enum(['adventurous', 'mixed', 'familiar']),
  budget_tier:          z.enum(['budget', 'mid-range', 'upscale', 'luxury']),

  /** Pacing — maps to activities-per-day in AI prompts */
  itinerary_pace: z.enum(['relaxed', 'balanced', 'packed']),
});

export type TravelerRole    = z.infer<typeof TravelerRoleSchema>;
export type AgeGroup        = z.infer<typeof AgeGroupSchema>;
export type Traveler        = z.infer<typeof TravelerSchema>;
export type TravelerProfile = z.infer<typeof TravelerProfileSchema>;
