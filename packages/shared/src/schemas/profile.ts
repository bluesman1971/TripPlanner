import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const InterestSchema = z.enum([
  'food', 'history', 'architecture', 'art', 'music',
  'nightlife', 'nature', 'outdoors', 'sport', 'shopping',
  'wellness', 'markets', 'photography', 'local-culture',
]);

export const DiningSchema = z.object({
  restrictions: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  foodie_level: z.number().int().min(1).max(10),
  fine_dining: z.boolean().default(false),
  tasting_menus: z.boolean().default(false),
  street_food: z.boolean().default(false),
  market_food: z.boolean().default(false),
  adventurous_cuisine: z.boolean().default(false),
  alcohol: z.boolean().default(true),
  wine_interest: z.boolean().default(false),
  cocktail_interest: z.boolean().default(false),
  cuisine_loves: z.array(z.string()).default([]),
  cuisine_avoid: z.array(z.string()).default([]),
  kitchen_counter_seating: z.boolean().default(false),
});

export const PhysicalSchema = z.object({
  walking_comfort_km: z.number(),
  limitations: z.array(z.string()).default([]),
  active_interests: z.array(z.string()).default([]),
  hiking: z.boolean().default(false),
  cycling: z.boolean().default(false),
});

export const AccommodationProfileSchema = z.object({
  type: z.enum(['hotel', 'boutique-hotel', 'apartment', 'rental', 'flexible']),
  location_priority: z.enum(['central', 'quiet', 'flexible']),
  must_haves: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
});

export const ClientProfileSchema = z.object({
  client_id: z.string(),
  name: z.string(),
  email: z.string().email(),
  date_created: z.string().regex(dateRegex),
  date_updated: z.string().regex(dateRegex),
  group_type: z.enum(['couple', 'family', 'friends', 'solo', 'group']),
  group_size: z.number().int().positive(),
  ages: z.array(z.number().int().positive()),
  children: z.boolean().default(false),
  children_ages: z.array(z.number().int()).default([]),
  accessibility_needs: z.array(z.string()).default([]),
  travel_style: z.enum(['relaxed', 'moderate', 'packed']),
  adventure_level: z.enum(['cautious', 'moderate', 'adventurous']),
  structure_preference: z.enum(['planned', 'flexible', 'spontaneous']),
  budget_tier: z.enum(['budget', 'mid', 'mid-luxury', 'luxury']),
  dining_budget: z.enum(['casual', 'mid', 'fine', 'mixed']),
  activity_spend: z.enum(['low', 'moderate', 'high']),
  interests: z.array(InterestSchema),
  dining: DiningSchema,
  physical: PhysicalSchema,
  accommodation: AccommodationProfileSchema,
  past_destinations: z.array(z.string()).default([]),
  travel_loves: z.array(z.string()).default([]),
  travel_dislikes: z.array(z.string()).default([]),
  hard_nos: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export type ClientProfile = z.infer<typeof ClientProfileSchema>;
export type Interest = z.infer<typeof InterestSchema>;
export type Dining = z.infer<typeof DiningSchema>;
