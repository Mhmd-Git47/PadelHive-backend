const pool = require("../db");

const paymentService = require("./payments.service");
const matchHelper = require("../helpers/match.helper");
const tournamentHelper = require("../helpers/tournament.helper");

const createParticipant = async (participantData) => {
  const { tournament_id, name, comment } = participantData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch tournament to get max_allowed_elo_rate
    const tournamentRes = await client.query(
      `SELECT id, max_allowed_elo_rate FROM tournaments WHERE id = $1`,
      [tournament_id]
    );

    if (tournamentRes.rows.length === 0) {
      throw new Error("Tournament not found");
    }

    const tournament = tournamentRes.rows[0];

    // 2️⃣ Check if participant(s) Elo is within allowed range
    const usersElo = [
      participantData.padelhive_user1_elo,
      participantData.padelhive_user2_elo,
    ].filter((e) => e != null); // ignore nulls

    if (tournament.max_allowed_elo_rate != null) {
      const invalidUsers = usersElo.filter(
        (elo) => elo > tournament.max_allowed_elo_rate
      );

      if (invalidUsers.length > 0) {
        throw new Error(
          `Cannot register: user(s) exceed tournament max Elo of ${tournament.max_allowed_elo_rate}`
        );
      }
    }

    // 3️⃣ Check if user1 or user2 is already registered
    const checkQuery = `
      SELECT user_id
      FROM user_tournaments_history
      WHERE tournament_id = $1
        AND user_id IN ($2, $3)
    `;

    const checkRes = await client.query(checkQuery, [
      tournament_id,
      participantData.padelhive_user1_id,
      participantData.padelhive_user2_id,
    ]);

    if (checkRes.rows.length > 0) {
      const registeredUsers = checkRes.rows.map((r) => r.user_id);
      throw new Error(
        `Cannot register: user(s) already registered - ${registeredUsers.join(
          ", "
        )}`
      );
    }

    // 4️⃣ Insert participant normally
    const participantRes = await client.query(
      `
      INSERT INTO participants (tournament_id, name, comment, created_at, updated_at, padelhive_user1_id, padelhive_user2_id, preferred_time)
      VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6)
      RETURNING *
      `,
      [
        tournament_id,
        name,
        comment,
        participantData.padelhive_user1_id,
        participantData.padelhive_user2_id,
        participantData.preferred_time,
      ]
    );

    const participant = participantRes.rows[0];

    participantData.participant_id = participant.id;

    // 5️⃣ Add payment
    await paymentService.createPaymentParticipant(participantData, client);

    // 6️⃣ Add to user_tournaments_history
    await tournamentHelper.addToUserTournamentsHistory(
      participant,
      tournament_id,
      client
    );

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

  fields.push(`updated_at = NOW()`);

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
    `SELECT * FROM participants WHERE tournament_id = $1 ORDER BY created_at desc`,
    [tournamentId]
  );

  return result.rows;
};

const disqualifyParticipant = async (tournamentId, participantId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Mark participant as disqualified
    const disqualifyRes = await client.query(
      `UPDATE participants SET is_disqualified = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [participantId]
    );

    if (!disqualifyRes.rows[0]) {
      throw new Error("Participant not found");
    }

    // 2️⃣ Update tournament history status
    await client.query(
      `UPDATE user_tournaments_history
       SET status = 'disqualified', updated_at = NOW()
       WHERE participant_id = $1`,
      [participantId]
    );

    // 3️⃣ Get all matches of this participant in this tournament
    const matchesRes = await client.query(
      `SELECT * FROM matches WHERE tournament_id = $1 AND (player1_id = $2 OR player2_id = $2)`,
      [tournamentId, participantId]
    );

    const matches = matchesRes.rows;
    let updatedCount = 0;

    // 4️⃣ Iterate matches & force opponent win
    for (const match of matches) {
      let winnerId = null;
      let scores = "6-0";

      if (match.player1_id === participantId) {
        winnerId = match.player2_id;
        scores = "0-6";
      } else if (match.player2_id === participantId) {
        winnerId = match.player1_id;
        scores = "6-0";
      }

      if (!winnerId) {
        continue;
      }

      // ✅ Use updateMatch so Elo, groups, progression logic runs
      await matchHelper.updateMatchHelper(match.id, {
        winner_id: winnerId,
        scores_csv: scores,
        state: "completed",
      });

      updatedCount++;
    }

    await client.query("COMMIT");

    return {
      disqualified: disqualifyRes.rows[0],
      updatedMatches: updatedCount,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error disqualifying participant: ", err.message);
    throw err;
  } finally {
    client.release();
  }
};

const deleteParticipant = async (participantId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Update history first
    await tournamentHelper.onDeleteParticipantUpdateTournamentHistory(
      participantId,
      client
    );

    // 2️⃣ Delete participant row
    const res = await client.query(`DELETE FROM participants WHERE id = $1`, [
      participantId,
    ]);

    await client.query("COMMIT");
    return res.rowCount > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createParticipant,
  getAllParticipants,
  getParticipantById,
  updateParticipant,
  getParticipantsByTournamentId,
  deleteParticipant,
  disqualifyParticipant,
};
