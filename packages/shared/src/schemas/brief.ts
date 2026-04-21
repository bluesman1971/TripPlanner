import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

export const TripStatusSchema = z.enum([
  'setup', 'ingestion', 'research', 'draft', 'review', 'complete',
]);

export const TripPurposeSchema = z.enum([
  'anniversary', 'vacation', 'honeymoon', 'birthday', 'family',
  'business-leisure', 'solo-exploration', 'other',
]);

export const DatesSchema = z.object({
  start: z.string().regex(dateRegex, 'Expected YYYY-MM-DD'),
  end: z.string().regex(dateRegex, 'Expected YYYY-MM-DD'),
  duration_days: z.number().int().positive(),
  flexible: z.boolean(),
  flexibility_notes: z.string().default(''),
});

export const HardConstraintsSchema = z.object({
  depart_by: z.string().nullable().default(null),
  depart_by_notes: z.string().default(''),
  arrive_after: z.string().nullable().default(null),
  arrive_after_notes: z.string().default(''),
});

export const PreBookedSchema = z.object({
  name: z.string(),
  booking_file: z.string().optional(),
  date: z.string().regex(dateRegex),
  start_time: z.string().regex(timeRegex),
  end_time: z.string(),
  meeting_point_address: z.string().default(''),
  drop_off_address: z.string().optional(),
  included_meals: z.boolean().default(false),
  included_transport: z.boolean().default(false),
  ingested: z.boolean().default(false),
  ingestion_flags: z.array(z.string()).default([]),
});

export const DiscoveryRatioLabelSchema = z.enum([
  'balanced', 'classic-leaning', 'mostly-bespoke', 'fully-bespoke',
]);

export const DiscoverySchema = z.object({
  destination_visits: z.number().int().min(0).default(0),
  previously_seen: z.array(z.string()).default([]),
  ratio_classic_pct: z.number().int().min(0).max(100),
  ratio_hidden_pct: z.number().int().min(0).max(100),
  ratio_label: DiscoveryRatioLabelSchema,
  must_sees: z.array(z.string()).default([]),
  already_done: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export const VersionHistoryEntrySchema = z.object({
  date: z.string().regex(dateRegex),
  note: z.string(),
});

export const BriefSchema = z.object({
  trip_id: z.string(),
  client_id: z.string(),
  destination: z.string(),
  destination_slug: z.string(),
  destination_country: z.string(),
  departure_city: z.string().default(''),
  dates: DatesSchema,
  purpose: TripPurposeSchema,
  purpose_notes: z.string().default(''),
  group_override: z.unknown().nullable().default(null),
  status: TripStatusSchema,
  hard_constraints: HardConstraintsSchema,
  pre_booked: z.array(PreBookedSchema).default([]),
  documents_ingested: z.boolean().default(false),
  discovery: DiscoverySchema,
  version_history: z.array(VersionHistoryEntrySchema).default([]),
});

export type TripBrief = z.infer<typeof BriefSchema>;
export type TripStatus = z.infer<typeof TripStatusSchema>;
export type TripPurpose = z.infer<typeof TripPurposeSchema>;
export type PreBooked = z.infer<typeof PreBookedSchema>;
export type Discovery = z.infer<typeof DiscoverySchema>;
