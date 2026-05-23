require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    // Check tables
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    console.log('Tables:', tables.rows.map(x => x.table_name).join(', '));

    // Check users table columns
    const cols = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position"
    );
    console.log('\nUsers columns:', cols.rows.map(x => x.column_name).join(', '));

    // Count users
    const count = await pool.query('SELECT COUNT(*) FROM users');
    console.log('\nUser count:', count.rows[0].count);

    // Create admin user if none exist
    if (count.rows[0].count === '0') {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 12);
      await pool.query(
        'INSERT INTO users (id, email, name, "passwordHash", "isAdmin", "isActive") VALUES ($1, $2, $3, $4, true, true)',
        [require('crypto').randomBytes(12).toString('hex'), 'admin@emet.app', 'Admin', hash]
      );
      console.log('\nCreated admin user: admin@emet.app / admin123');
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

main();
