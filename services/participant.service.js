const pool = require("../db");

const paymentService = require("./payments.service");

const createParticipant = async (participantData) => {
  const { tournament_id, name, comment } = participantData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const participantRes = await client.query(
      `
      INSERT INTO participants (tournament_id, name, comment, created_at, updated_at, padelhive_user1_id, padelhive_user2_id)
      VALUES ($1, $2, $3, NOW(), NOW(), $4, $5)
      RETURNING *
      `,
      [
        tournament_id,
        name,
        comment,
        participantData.padelhive_user1_id,
        participantData.padelhive_user2_id,
      ]
    );

    console.log(participantData.padelhive_user1_id);

    const participant = participantRes.rows[0];

    participantData.participant_id = participant.id;
    participantData.amount = 25;

    // should add amount also, be carefull
    await paymentService.createPaymentParticipant(participantData, client);

    await client.query("COMMIT");
    return participant;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const updateParticipant = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updateData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  const query = `
    UPDATE participants SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const getAllParticipants = async () => {
  const result = await pool.query(`SELECT * FROM participants ORDER BY id`);
  return result.rows;
};

const getParticipantById = async (id) => {
  const result = await pool.query(`SELECT * FROM participants WHERE id = $1`, [
    id,
  ]);
  return result.rows[0];
};

const getParticipantsByTournamentId = async (tournamentId) => {
  const result = await pool.query(
    `SELECT * FROM participants WHERE tournament_id = $1`,
    [tournamentId]
  );

  return result.rows;
};

const deleteParticipant = async (id) => {
  const result = await pool.query(`DELETE FROM participants WHERE id = $1`, [
    id,
  ]);
  return result.rowCount > 0;
};

module.exports = {
  createParticipant,
  getAllParticipants,
  getParticipantById,
  updateParticipant,
  getParticipantsByTournamentId,
  deleteParticipant,
};
