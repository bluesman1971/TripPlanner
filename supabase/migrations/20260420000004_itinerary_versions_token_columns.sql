-- Add AI usage tracking columns to itinerary_versions.
-- research_notes already has these columns from the initial schema.
alter table itinerary_versions
  add column if not exists input_tokens  integer,
  add column if not exists output_tokens integer,
  add column if not exists model_used    text;
