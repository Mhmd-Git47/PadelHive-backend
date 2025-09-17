const pool = require("../db");

const createSubscription = async (email) => {
  const result = await pool.query(
    "INSERT INTO subscriptions (email) VALUES ($1) RETURNING *",
    [email]
  );
  return result.rows[0];
};

const getAllSubscriptions = async () => {
  const result = await pool.query(
    "SELECT * FROM subscriptions ORDER BY created_at DESC"
  );
  return result.rows;
};

module.exports = {
  createSubscription,
  getAllSubscriptions,
};
