const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  host: 'localhost',
  user: 'insurtech_user',
  password: '1234',
  database: 'insurtech',
  port: 5432
});

(async () => {
  try {
    // Check if INVESTIGATOR user exists
    const checkUser = await pool.query(`
      SELECT u.id, u.user_code, u.name, r.role_code
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_code = 'INVESTIGATOR'
    `);

    if (checkUser.rows.length === 0) {
      console.log('No INVESTIGATOR user found. Creating one...');

      // Get INVESTIGATOR role id
      const roleResult = await pool.query(`SELECT id FROM roles WHERE role_code = 'INVESTIGATOR'`);
      const roleId = roleResult.rows[0].id;

      // Hash password
      const passwordHash = await bcrypt.hash('password123', 10);

      // Insert new investigator user
      await pool.query(`
        INSERT INTO users (user_code, username, name, email, password_hash, role_id, department, team, position, status)
        VALUES ('EMP007', 'haninv', '한조사', 'han.inv@insurtech.com', $1, $2, '심사부', '조사팀', '조사역', 'ACTIVE')
      `, [passwordHash, roleId]);

      console.log('Created INVESTIGATOR user: 한조사 (EMP007)');
    } else {
      console.log('INVESTIGATOR user already exists:', checkUser.rows[0]);
    }

    // Verify
    const users = await pool.query(`
      SELECT u.id, u.user_code, u.name, r.role_code
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.status = 'ACTIVE'
    `);
    console.log('\n=== All Active Users ===');
    console.log(JSON.stringify(users.rows, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
})();
