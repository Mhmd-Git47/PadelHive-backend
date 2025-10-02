const pool = require("../db");
const { AppError } = require("../utils/errors");
const {
  sendTournamentPaymentConfirmationEmail,
} = require("../helpers/email.helper");

const createPaymentParticipant = async (participantData, client) => {
  const {
    participant_id,
    tournament_id,
    user_id,
    padelhive_user1_id,
    padelhive_user2_id,
  } = participantData;

  const payments = [];

  if (!client) {
    throw new Error("Client must be passed from outer transaction");
  }

  // ✅ Always get amount and dueDate first
  const tournamentRes = await client.query(
    `SELECT id, registration_fee, registration_type, payment_deadline FROM tournaments WHERE id = $1`,
    [tournament_id]
  );

  if (tournamentRes.rows.length === 0) {
    throw new Error("Tournament not found");
  }
  let amount = 0;
  let dueDate = null;
  let status = "pending";
  let paidAt = null;
  if (tournamentRes.rows[0].registration_type === "free") {
    amount = 0;
    dueDate = null;
    status = "paid";
    paidAt = new Date();
  } else {
    amount = tournamentRes.rows[0].registration_fee ?? 0;
    dueDate = tournamentRes.rows[0].payment_deadline
      ? new Date(tournamentRes.rows[0].payment_deadline)
      : null;
    status = "pending";
    paidAt = null;
  }

  const insertPayment = async (userId) => {
    const res = await client.query(
      `
      INSERT INTO payments 
        (participant_id, tournament_id, amount, user_id, due_date, status, paid_at)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        participant_id,
        tournament_id,
        amount,
        userId,
        dueDate ? dueDate.toISOString() : null,
        status,
        paidAt ? paidAt.toISOString() : null,
      ]
    );
    return res.rows[0];
  };

  // 👥 Doubles team
  if (padelhive_user1_id && padelhive_user2_id) {
    payments.push(await insertPayment(padelhive_user1_id));
    payments.push(await insertPayment(padelhive_user2_id));
  }

  // 👤 Single player
  else if (user_id) {
    payments.push(await insertPayment(user_id));
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
  const query = `
    UPDATE payments SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const setPaymentPaid = async (id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paymentRes = await client.query(
      `SELECT user_id, tournament_id, amount, created_at 
       FROM payments WHERE id = $1`,
      [id]
    );

    const payment = paymentRes.rows[0];
    if (!payment) {
      throw new AppError("No Payment found.", 404);
    }

    const userRes = await client.query(
      `SELECT id, email, display_name FROM users WHERE id = $1`,
      [payment.user_id]
    );
    const user = userRes.rows[0];

    const tournamentRes = await client.query(
      `SELECT id, name, start_at FROM tournaments WHERE id = $1`,
      [payment.tournament_id]
    );
    const tournament = tournamentRes.rows[0];

    const query = `
      UPDATE payments 
      SET status = $1, paid_at = NOW(), updated_at = NOW() 
      WHERE id = $2 
      RETURNING *;
    `;
    const result = await client.query(query, ["paid", id]);

    await client.query("COMMIT");

    // ✅ trigger email send but don’t block response
    if (user && tournament) {
      sendTournamentPaymentConfirmationEmail(user, tournament, {
        amount: payment.amount,
        date: payment.paid_at,
      }).catch((err) => {
        console.error("❌ Failed to send payment confirmation email:", err);
      });
    }

    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating payment:", err);
    throw err;
  } finally {
    client.release();
  }
};

const getTournamentPaymentByUserId = async (userId, tournamentId) => {
  const res = await pool.query(
    `
      SELECT status FROM payments WHERE user_id = $1 AND tournament_id = $2 LIMIT 1`,
    [userId, tournamentId]
  );

  return res.rows[0];
};

module.exports = {
  createPaymentParticipant,
  getPaymentsByTournamentId,
  updatePayment,
  getTournamentPaymentByUserId,
  setPaymentPaid,
};
