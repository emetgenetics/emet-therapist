require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/001_rls_policies/migration.sql'), 'utf8');
    
    // Split by semicolons and run each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
        // Extract first few words for logging
        const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
        console.log(`✓ ${preview}...`);
      } catch (e) {
        // Skip "already exists" errors
        if (e.message.includes('already exists') || e.message.includes('duplicate')) {
          console.log(`⊘ Already exists: ${stmt.substring(0, 40)}...`);
        } else {
          console.error(`✗ Error: ${e.message}`);
        }
      }
    }
    
    console.log('\n✅ Migration complete!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

main();
