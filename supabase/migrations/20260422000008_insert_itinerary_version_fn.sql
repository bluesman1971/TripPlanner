-- Atomic insert_itinerary_version function.
-- Uses pg_advisory_xact_lock to prevent concurrent requests from assigning
-- the same version_number to a trip (the UNIQUE constraint is a safety net;
-- this lock prevents the wasted work of a retryable collision).
CREATE OR REPLACE FUNCTION insert_itinerary_version(
  p_trip_id       uuid,
  p_markdown      text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_model_used    text
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  -- Per-trip exclusive lock held for the duration of this transaction.
  -- The lock key is the lower 63 bits of md5(trip_id) cast to bigint.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_trip_id::text), 1, 16))::bit(64)::bigint
  );

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM itinerary_versions
   WHERE trip_id = p_trip_id;

  INSERT INTO itinerary_versions
    (trip_id, version_number, markdown_content, input_tokens, output_tokens, model_used)
  VALUES
    (p_trip_id, v_next, p_markdown, p_input_tokens, p_output_tokens, p_model_used);

  RETURN v_next;
END;
$$;
