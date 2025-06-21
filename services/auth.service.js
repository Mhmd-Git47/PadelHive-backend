const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const registerUser = async ({ username, password, role }) => {
  const hashed = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO admins (username, password, role) VALUES ($1, $2, $3) RETURNING *',
    [username, hashed, role || 'user']
  );
  return result.rows[0];
};

const loginUser = async ({ username, password }) => {
  const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user) throw new Error('Admin not found');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error('Invalid credentials');

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'SECRET_KEY',
    { expiresIn: '1h' }
  );
  return token;
};

module.exports = { registerUser, loginUser };
