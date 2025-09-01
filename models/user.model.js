const pool = require("../db");

const User = {
  findByEmail: async (email) => {
    const res = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    return res.rows[0];
  },

  updateResetToken: async (email, token, expiry) => {
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3",
      [token, expiry, email]
    );
  },

  updatePassword: async (email, newPassword) => {
    await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE email = $2",
      [newPassword, email]
    );
  },
};

module.exports = User;
