-- Rename research_notes.content_markdown → content
-- The initial schema defined the column as content_markdown but all application
-- code (research.ts insert/select, TripPage ResearchNote interface) uses 'content'.
-- This migration aligns the DB column name with the codebase.

alter table research_notes
  rename column content_markdown to content;
