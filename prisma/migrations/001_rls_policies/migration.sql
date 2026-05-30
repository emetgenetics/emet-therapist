-- Enable pgcrypto extension for column-level encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable Row-Level Security on therapy_sessions
ALTER TABLE therapy_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY therapy_sessions_isolation ON therapy_sessions
  USING (user_id = current_setting('app.current_user_id', true)::text);

-- Enable Row-Level Security on transcripts
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY transcripts_isolation ON transcripts
  USING (
    session_id IN (
      SELECT id FROM therapy_sessions
      WHERE user_id = current_setting('app.current_user_id', true)::text
    )
  );

-- Enable Row-Level Security on session_events
ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_events_isolation ON session_events
  USING (user_id = current_setting('app.current_user_id', true)::text);

-- Enable Row-Level Security on consent_records
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_records_isolation ON consent_records
  USING (user_id = current_setting('app.current_user_id', true)::text);

-- Enable Row-Level Security on bls_configurations
ALTER TABLE bls_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY bls_configurations_isolation ON bls_configurations
  USING (user_id = current_setting('app.current_user_id', true)::text);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
  VALUES (
    current_setting('app.current_user_id', true),
    TG_OP,
    TG_TABLE_NAME,
    NEW.id,
    jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply audit triggers
CREATE TRIGGER therapy_sessions_audit
  AFTER UPDATE ON therapy_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER transcripts_audit
  AFTER UPDATE ON transcripts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
