-- Sprint 4 Batch-1 security/performance: add foreign-key indexes
-- PostgreSQL does not auto-index FK columns. Without these, every
-- trip-scoped query does a full table scan. Critical before beta load.

CREATE INDEX IF NOT EXISTS clients_consultant_id_idx
  ON clients(consultant_id);

CREATE INDEX IF NOT EXISTS trips_client_id_idx
  ON trips(client_id);

-- Compound index for ORDER BY version_number DESC LIMIT 1 pattern
CREATE INDEX IF NOT EXISTS itinerary_versions_trip_id_version_idx
  ON itinerary_versions(trip_id, version_number DESC);

CREATE INDEX IF NOT EXISTS research_notes_trip_id_idx
  ON research_notes(trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS trip_brief_trip_id_idx
  ON trip_brief(trip_id, version DESC);

CREATE INDEX IF NOT EXISTS documents_trip_id_idx
  ON documents(trip_id);

CREATE INDEX IF NOT EXISTS bookings_trip_id_idx
  ON bookings(trip_id);
