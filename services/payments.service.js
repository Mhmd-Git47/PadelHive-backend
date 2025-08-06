const pool = require("../db");

const createPaymentParticipant = async (participantData, client) => {
  const {
    participant_id,
    tournament_id,
    amount,
    user_id,
    padelhive_user1_id,
    padelhive_user2_id,
  } = participantData;

  const payments = [];

  if (!client) {
    throw new Error("Client must be passed from outer transaction");
  }

  if (padelhive_user1_id !== null && padelhive_user2_id !== null) {
    console.log(padelhive_user1_id);
    const result1 = await client.query(
      `
      INSERT INTO payments (participant_id, tournament_id, amount, user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [participant_id, tournament_id, amount, padelhive_user1_id]
    );

    const result2 = await client.query(
      `
      INSERT INTO payments (participant_id, tournament_id, amount, user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [participant_id, tournament_id, amount, padelhive_user2_id]
    );

    payments.push(result1.rows[0], result2.rows[0]);
  } else if (user_id !== null) {
    console.log("USer: ", user_id);
    const result = await client.query(
      `
      INSERT INTO payments (participant_id, tournament_id, amount)
      VALUES ($1, $2, $3)
      RETURNING *`,
      [participant_id, tournament_id, amount]
    );

    payments.push(result.rows[0]);
  }

  return payments;
};

const getPaymentsByTournamentId = async (tournamentId) => {
  const res = await pool.query(
    `
        SELECT * FROM payments WHERE tournament_id = $1 ORDER BY created_at DESC`,
    [tournamentId]
  );

  return res.rows;
};

const updatePayment = async (id, updatedData) => {
  if (Object.keys(updatedData).length === 0) {
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updatedData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  fields.push(`updated_at = NOW()`);
  fields.push(`paid_at = NOW()`);
  const query = `
    UPDATE payments SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};


module.exports = {
  createPaymentParticipant,
  getPaymentsByTournamentId,
  updatePayment,
};
