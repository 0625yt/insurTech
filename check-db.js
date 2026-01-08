const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'insurtech',
  user: 'insurtech_user',
  password: 'insurtech_password_2024'
});

async function check() {
  try {
    // Check users
    const users = await pool.query('SELECT user_code, username, name, password_hash FROM users LIMIT 5');
    console.log('=== USERS ===');
    console.log(users.rows);

    // Check policies
    const policies = await pool.query('SELECT id, policy_number, customer_name FROM policies LIMIT 5');
    console.log('\n=== POLICIES ===');
    console.log(policies.rows);

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    pool.end();
  }
}

check();
