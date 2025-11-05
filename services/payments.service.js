const pool = require("../db");
const { AppError } = require("../utils/errors");
const {
  sendTournamentPaymentConfirmationEmail,
  sendPaymentReminderEmail,
} = require("../helpers/email.helper");

const { getActorDetails, createActivityLog } = require("./activityLog.service");

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
    SELECT 
      p.*, 
      g.name AS group_name
    FROM payments p
    LEFT JOIN group_participants gp ON gp.participant_id = p.participant_id
    LEFT JOIN groups g ON g.id = gp.group_id
    WHERE p.tournament_id = $1
    ORDER BY p.created_at DESC
    `,
    [tournamentId]
  );

  return res.rows;
};

const getPaymentsByCompanyId = async (companyId) => {
  const res = await pool.query(
    `
    SELECT p.*
    FROM payments p
    INNER JOIN tournaments t ON p.tournament_id = t.id
    WHERE t.company_id = $1 AND t.state = $2
  `,
    [companyId, "pending"]
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

const setPaymentPaid = async (id, userId, userRole) => {
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
      `SELECT id, name, company_id, start_at FROM tournaments WHERE id = $1`,
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
    const updatedPayment = result.rows[0];

    await client.query("COMMIT");

    // ✅ Log success activity
    try {
      const actor = await getActorDetails(userId, userRole);

      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id || null,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor?.name || "Unknown",
        action_type: "PAYMENT_MARKED_PAID",
        entity_id: updatedPayment.id,
        entity_type: "payment",
        description: `Payment of $${payment.amount} for "${
          user.display_name
        }" in tournament "${
          tournament?.name || "Unknown Tournament"
        }" marked as paid by ${actor?.name || "System"}.`,
        status: "Success",
        tournament_id: payment.tournament_id,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log payment update:", logErr);
    }

    // ✅ trigger email send but don’t block response
    if (user && tournament) {
      sendTournamentPaymentConfirmationEmail(user, tournament, {
        amount: payment.amount,
        date: updatedPayment.paid_at,
      }).catch((err) => {
        console.error("❌ Failed to send payment confirmation email:", err);
      });
    }

    return updatedPayment;
  } catch (err) {
    await client.query("ROLLBACK");

    // ❌ Log failure
    try {
      const actor = await getActorDetails(userId, userRole);
      const tournamentRes = await pool.query(
        `SELECT id, name, company_id FROM tournaments WHERE id = (
           SELECT tournament_id FROM payments WHERE id = $1
         )`,
        [id]
      );
      const tournament = tournamentRes.rows[0];

      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id || null,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor?.name || "Unknown",
        action_type: "PAYMENT_MARKED_PAID_FAILED",
        entity_id: id,
        entity_type: "payment",
        description: `Failed to mark payment ${id} as paid. Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournament?.id || null,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log failed payment action:", logErr);
    }

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

const deletePaymentParticipant = async (
  participantId,
  tournamentId,
  client
) => {
  await client.query(
    `DELETE FROM payments WHERE participant_id = $1 AND tournament_id = $2`,
    [participantId, tournamentId]
  );
};

const sendReminderPayment = async (
  userId,
  tournamentId,
  actorId,
  actorRole
) => {
  const client = await pool.connect();

  try {
    const paymentRes = await client.query(
      `SELECT amount, due_date FROM payments WHERE user_id = $1 AND tournament_id = $2`,
      [userId, tournamentId]
    );

    const payment = paymentRes.rows[0];
    if (!payment) {
      throw new AppError(
        "No Payment found for the user in this tournament.",
        404
      );
    }

    const userRes = await client.query(
      `SELECT id, email, display_name FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];

    const tournamentRes = await client.query(
      `SELECT id, name, start_at, category, company_id FROM tournaments WHERE id = $1`,
      [tournamentId]
    );
    const tournament = tournamentRes.rows[0];

    // ✅ Send the actual reminder email
    if (user && tournament) {
      await sendPaymentReminderEmail(user, {
        ...tournament,
        entry_fee: payment.amount,
      });

      // ✅ Log success
      try {
        const actor = await getActorDetails(actorId, actorRole);

        await createActivityLog({
          scope: "company",
          company_id: tournament.company_id,
          actor_id: actorId,
          actor_role: actorRole,
          actor_name: actor?.name || "Unknown",
          action_type: "PAYMENT_REMINDER_SENT",
          entity_id: user.id,
          entity_type: "user",
          description: `Payment reminder sent to ${user.display_name} (${user.email}) for tournament "${tournament.name}" (amount: $${payment.amount}).`,
          status: "Success",
          tournament_id: tournamentId,
        });
      } catch (logErr) {
        console.error("⚠️ Failed to log payment reminder activity:", logErr);
      }
    }
  } catch (err) {
    console.error("❌ Error sending payment reminder:", err);

    // ❌ Log failure
    try {
      const actor = await getActorDetails(actorId, actorRole);
      const tournamentRes = await pool.query(
        `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
        [tournamentId]
      );
      const tournament = tournamentRes.rows[0];

      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id || null,
        actor_id: actorId,
        actor_role: actorRole,
        actor_name: actor?.name || "Unknown",
        action_type: "PAYMENT_REMINDER_FAILED",
        entity_id: userId,
        entity_type: "user",
        description: `Failed to send payment reminder to user ${userId} for tournament "${
          tournament?.name || "Unknown"
        }". Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log failed reminder action:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createPaymentParticipant,
  getPaymentsByTournamentId,
  getPaymentsByCompanyId,
  updatePayment,
  getTournamentPaymentByUserId,
  setPaymentPaid,
  deletePaymentParticipant,
  sendReminderPayment,
};
