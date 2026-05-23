require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    // Drop existing triggers first
    await pool.query('DROP TRIGGER IF EXISTS therapy_sessions_audit ON therapy_sessions');
    await pool.query('DROP TRIGGER IF EXISTS transcripts_audit ON transcripts');
    await pool.query('DROP FUNCTION IF EXISTS audit_trigger_func()');
    console.log('Dropped old triggers');

    // Create function with proper escaping
    await pool.query(`
      CREATE OR REPLACE FUNCTION audit_trigger_func()
      RETURNS TRIGGER AS $func$
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
      $func$ LANGUAGE plpgsql
    `);
    console.log('Created audit_trigger_func');

    // Create triggers
    await pool.query(`
      CREATE TRIGGER therapy_sessions_audit
        AFTER UPDATE ON therapy_sessions
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()
    `);
    console.log('Created therapy_sessions_audit trigger');

    await pool.query(`
      CREATE TRIGGER transcripts_audit
        AFTER UPDATE ON transcripts
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()
    `);
    console.log('Created transcripts_audit trigger');

    // Verify
    const triggers = await pool.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema='public'");
    console.log('\nActive triggers:', triggers.rows.map(r => r.trigger_name).join(', '));

    console.log('\n✅ All done!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

main();
