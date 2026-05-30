require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    // Check if updated_at exists on users, if not add it
    const userCols = await pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position");
    const cols = userCols.rows;
    console.log('Current users columns:', cols.map(c => `${c.column_name} (${c.is_nullable})`).join(', '));

    const hasUpdatedAt = cols.find(c => c.column_name === 'updated_at');
    if (!hasUpdatedAt) {
      await pool.query('ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT now()');
      console.log('Added updated_at to users');
    }

    // Check if bls_configurations exists
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tableNames = tables.rows.map(r => r.table_name);
    console.log('Existing tables:', tableNames.join(', '));

    if (!tableNames.includes('bls_configurations')) {
      await pool.query(`
        CREATE TABLE bls_configurations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          visual_pattern TEXT DEFAULT 'horizontal',
          visual_speed INTEGER DEFAULT 60,
          visual_intensity FLOAT DEFAULT 0.7,
          visual_color_primary TEXT DEFAULT '#8B5CF6',
          visual_color_secondary TEXT DEFAULT '#C4B5FD',
          auditory_frequency INTEGER DEFAULT 440,
          auditory_volume FLOAT DEFAULT 0.15,
          auditory_waveform TEXT DEFAULT 'sine',
          is_default BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT now(),
          updated_at TIMESTAMP DEFAULT now()
        );
      `);
      console.log('Created bls_configurations');
    }

    if (!tableNames.includes('consent_records')) {
      await pool.query(`
        CREATE TABLE consent_records (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          consent_type TEXT NOT NULL,
          granted BOOLEAN NOT NULL,
          version TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      console.log('Created consent_records');
    }

    // Add mfa columns if missing
    const hasMfaSecret = cols.find(c => c.column_name === 'mfa_secret');
    const hasMfaEnabled = cols.find(c => c.column_name === 'mfa_enabled');
    if (!hasMfaSecret) {
      await pool.query('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
      console.log('Added mfa_secret');
    }
    if (!hasMfaEnabled) {
      await pool.query('ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT false');
      console.log('Added mfa_enabled');
    }

    // Add user_id to session_events if missing
    if (tableNames.includes('session_events')) {
      const eventCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='session_events'");
      const eventColNames = eventCols.rows.map(r => r.column_name);
      if (!eventColNames.includes('user_id')) {
        await pool.query('ALTER TABLE session_events ADD COLUMN user_id TEXT');
        console.log('Added user_id to session_events');
      }
    }

    // Create admin user
    const count = await pool.query('SELECT COUNT(*) FROM users');
    if (count.rows[0].count === '0') {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 12);
      const { randomBytes } = require('crypto');
      await pool.query(
        'INSERT INTO users (id, email, name, password_hash, is_admin, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, true, true, now(), now())',
        [randomBytes(12).toString('hex'), 'admin@emet.app', 'Admin', hash]
      );
      console.log('\n✓ Created admin user: admin@emet.app / admin123');
    } else {
      console.log(`\n✓ ${count.rows[0].count} user(s) already exist`);
    }

    console.log('\n✅ Database migration complete!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

main();
