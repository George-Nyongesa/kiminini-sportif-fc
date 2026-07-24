// db/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/db');

async function seed() {
  try {
    console.log('Seeding roles and default admin...');

    // 1. Ensure essential roles exist
    const roles = ['fan', 'player', 'coach', 'tm', 'treasurer', 'admin'];
    for (const roleName of roles) {
      await query(
        `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [roleName]
      );
    }

    // 2. Fetch the admin role ID
    const { rows: roleRows } = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    const adminRoleId = roleRows[0].id;

    // 3. Hash default admin password
    const rawPassword = 'ChangeMe2026!';
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const adminEmail = 'admin@kimininisportif.co.ke';

    // 4. Insert or update default admin user
    await query(
      `INSERT INTO users (full_name, email, password_hash, role_id, is_membership_active, must_change_password, is_active)
       VALUES ($1, $2, $3, $4, TRUE, TRUE, TRUE)
       ON CONFLICT (email) DO UPDATE 
       SET password_hash = $3, role_id = $4, must_change_password = TRUE, is_active = TRUE`,
      ['Super Admin', adminEmail, passwordHash, adminRoleId]
    );

    console.log(`\n✅ Admin account ready:`);
    console.log(`Email:    ${adminEmail}`);
    console.log(`Password: ${rawPassword}\n`);
  } catch (err) {
    console.error('Error seeding database:', err);
  } finally {
    await pool.end();
  }
}

seed();