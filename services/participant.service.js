const pool = require("../db");

const paymentService = require("./payments.service");
const matchHelper = require("../helpers/match.helper");
const tournamentHelper = require("../helpers/tournament.helper");
const {
  sendDisqualificationEmail,
  sendTournamentJoinEmail,
  sendTournamentLeftEmail,
} = require("../helpers/email.helper");
const { AppError } = require("../utils/errors");
const { createActivityLog, getActorDetails } = require("./activityLog.service");

const createParticipant = async (participantData, userId, userRole) => {
  const { tournament_id, name, comment } = participantData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch tournament to get max_allowed_elo_rate && is registration is open
    const tournamentRes = await client.query(
      `SELECT id, name, start_at, location_id, open_registration, max_allowed_elo_rate, tournament_type, tournament_format, company_id FROM tournaments WHERE id = $1`,
      [tournament_id]
    );

    if (tournamentRes.rows.length === 0) {
      throw new AppError("Tournament not found", 404);
    }

    const tournament = tournamentRes.rows[0];

    // check if tournament registration is closed only for users
    if (!tournament.open_registration && userRole === "user") {
      throw new AppError(`Cannot register: Registration is closed.`, 400);
    }

    // ❌ Prevent same user registered twice in same team (in tournament type double )
    if (
      participantData?.padelhive_user1_id ===
        participantData?.padelhive_user2_id &&
      tournament.tournament_format !== "americano_single"
    ) {
      throw new AppError(
        "Cannot register: Player 1 and Player 2 must be different users.",
        400
      );
    }

    // 2️⃣ Check if participant(s) Elo is within allowed range
    const usersElo = [
      participantData.padelhive_user1_elo,
      participantData.padelhive_user2_elo,
    ].filter((e) => e != null);

    if (tournament.max_allowed_elo_rate != null) {
      const invalidUsers = usersElo.filter(
        (elo) => elo > tournament.max_allowed_elo_rate
      );

      if (invalidUsers.length > 0) {
        throw new AppError(
          `Cannot register: user(s) exceed tournament max Elo of ${tournament.max_allowed_elo_rate}`,
          400
        );
      }
    }

    // ⭐ Americano Single: force single-player registration
    if (tournament.tournament_format === "americano_single") {
      if (!participantData.user_id) {
        throw new AppError(
          "A valid user_id is required for Americano registration.",
          400
        );
      }

      // Americano only accepts ONE player
      participantData.padelhive_user1_id = participantData.user_id;
      participantData.padelhive_user2_id = null;
    }

    // 3️⃣ Check if user1 or user2 is already registered in participants table
    if (tournament.tournament_format === "americano_single") {
      const duplicateSingle = await client.query(
        `
    SELECT id FROM participants
    WHERE tournament_id = $1
    AND (padelhive_user1_id = $2)
    `,
        [tournament_id, participantData.user_id]
      );

      if (duplicateSingle.rows.length > 0) {
        throw new AppError(
          "You are already registered in this tournament.",
          400
        );
      }
    } else {
      const duplicateCheck = await client.query(
        `
        SELECT id, name 
        FROM participants
        WHERE tournament_id = $1
          AND (
            padelhive_user1_id = $2 OR padelhive_user2_id = $2 OR
            padelhive_user1_id = $3 OR padelhive_user2_id = $3
          )
        `,
        [
          tournament_id,
          participantData.padelhive_user1_id,
          participantData.padelhive_user2_id,
        ]
      );

      if (duplicateCheck.rows.length > 0) {
        throw new AppError(
          `Cannot register: one or both users are already registered in another team.`,
          400
        );
      }
    }

    // Get location
    const locationRes = await client.query(
      `SELECT id, name FROM locations WHERE id = $1`,
      [tournament.location_id]
    );

    const location = locationRes.rows[0];

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

    // 7️⃣ Get participant count registered in tournament
    const res = await client.query(
      `SELECT COUNT(*) AS count FROM participants WHERE tournament_id = $1`,
      [tournament_id]
    );

    const participantCount = parseInt(res.rows[0].count, 10);

    // 8️⃣ update tournament to set participants_count
    await client.query(
      `UPDATE tournaments SET participants_count = $1 WHERE id = $2`,
      [participantCount, tournament_id]
    );

    // 9️⃣ work with activity log
    const actor = await getActorDetails(userId, userRole);

    await createActivityLog(
      {
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor.name,
        action_type: "ADD_PARTICIPANT",
        entity_id: participant.id,
        entity_type: "participant",
        description: `A new participant "${participant.name}" has been added to tournament "${tournament.name}".`,
        status: "Success",
        tournament_id: tournament_id,
      },
      client
    );

    await client.query("COMMIT");
    if (global.io) {
      global.io
        .to(`tournament_${participant.tournament_id}`)
        .emit("participant-created", participant);
    }

    // --- SEND JOIN TOURNAMENT EMAIL ---
    const userIds = [
      participantData.padelhive_user1_id,
      participantData.padelhive_user2_id,
      participantData.user_id,
    ].filter(Boolean);

    if (userIds.length > 0) {
      try {
        const usersRes = await client.query(
          "SELECT id, display_name, email FROM users WHERE id = ANY($1::uuid[])",
          [userIds]
        );
        const users = usersRes.rows;

        // Fire-and-forget emails
        for (const user of users) {
          sendTournamentJoinEmail(user, tournament, location.name).catch(
            (err) => {
              console.error(
                "Failed sending tournament email to",
                user.email,
                err
              );
              // do NOT throw error
            }
          );
        }
      } catch (err) {
        // Fail silently if the query itself fails
        console.error("Failed fetching users for email", err);
      }
    }

    return participant;
  } catch (error) {
    await client.query("ROLLBACK");

    try {
      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor?.name || "Unknown",
        action_type: "ADD_PARTICIPANT_FAILED",
        entity_id: null,
        entity_type: "participant",
        description: `Failed registering participant "${name}"${
          tournament ? ` to tournament "${tournament.name}"` : ""
        }.`,
        status: "Failed",
        tournament_id: tournament_id,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log participant error:", logErr);
    }

    throw error;
  } finally {
    client.release();
  }
};

const updateParticipant = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new AppError(`No fields provided to update`, 400);
  }

  // 1️⃣ Fetch existing participant
  const existingRes = await pool.query(
    `SELECT * FROM participants WHERE id = $1`,
    [id]
  );

  if (existingRes.rows.length === 0) {
    throw new AppError(`Participant not found`, 404);
  }

  const existing = existingRes.rows[0];
  const tournamentId = existing.tournament_id;

  // Extract new users if included in update
  const newUser1 = updateData.padelhive_user1_id ?? existing.padelhive_user1_id;
  const newUser2 = updateData.padelhive_user2_id ?? existing.padelhive_user2_id;

  // 2️⃣ Validate user1 & user2 are not same
  if (newUser1 === newUser2) {
    throw new AppError(`Both players cannot be the same user`, 400);
  }

  // 3️⃣ Check if either user is already registered in another team
  const duplicateCheck = await pool.query(
    `
    SELECT id, name 
    FROM participants
    WHERE tournament_id = $1
      AND id <> $2
      AND (
        padelhive_user1_id = $3 OR
        padelhive_user2_id = $3 OR
        padelhive_user1_id = $4 OR
        padelhive_user2_id = $4
      )
    `,
    [tournamentId, id, newUser1, newUser2]
  );

  if (duplicateCheck.rows.length > 0) {
    const otherTeam = duplicateCheck.rows[0];
    throw new AppError(
      `Cannot update team: one of the selected players is already registered in another team ("${otherTeam.name}").`,
      400
    );
  }

  // 4️⃣ Build dynamic SQL update statement
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
    UPDATE participants 
    SET ${fields.join(", ")} 
    WHERE id = $${idx}
    RETURNING *;
  `;

  const result = await pool.query(query, values);
  const updatedParticipant = result.rows[0];

  // 5️⃣ Emit socket update
  if (global.io && updatedParticipant) {
    global.io
      .to(`tournament_${updatedParticipant.tournament_id}`)
      .emit("participant-updated", updatedParticipant);
  }

  return updatedParticipant;
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

const disqualifyParticipant = async (
  tournamentId,
  participantId,
  userId,
  userRole
) => {
  const client = await pool.connect();
  let updatedParticipant = null;
  let tournament = null;
  let actor = null;
  let updatedCount = 0;
  let users = [];

  // ✅ Normalize IDs
  const cleanTournamentId = tournamentId?.trim?.() || tournamentId;
  const cleanParticipantId = participantId?.trim?.() || participantId;

  console.log("🟡 [disqualifyParticipant] Starting process...");
  console.log("Tournament ID:", cleanTournamentId);
  console.log("Participant ID:", cleanParticipantId);

  try {
    await client.query("BEGIN");
    console.log("✅ Transaction started");

    // 1️⃣ Fetch tournament
    const tournamentRes = await client.query(
      `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
      [cleanTournamentId]
    );
    tournament = tournamentRes.rows[0];
    if (!tournament) throw new AppError("Tournament not found", 404);

    console.log("🎾 Tournament found:", tournament.name);

    // 2️⃣ Mark participant as disqualified
    const disqualifyRes = await client.query(
      `UPDATE participants 
       SET is_disqualified = true, updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [cleanParticipantId]
    );
    updatedParticipant = disqualifyRes.rows[0];
    if (!updatedParticipant) throw new AppError("Participant not found", 404);
    console.log("🚫 Participant disqualified:", updatedParticipant?.id);

    // 3️⃣ Update user_tournaments_history
    await client.query(
      `UPDATE user_tournaments_history
       SET status = 'disqualified', updated_at = NOW()
       WHERE participant_id = $1`,
      [cleanParticipantId]
    );

    // 4️⃣ Update matches involving this participant
    const matchesRes = await client.query(
      `SELECT id, player1_id, player2_id, winner_id, scores_csv, state 
       FROM matches 
       WHERE tournament_id = $1 
       AND (player1_id = $2 OR player2_id = $2)`,
      [cleanTournamentId, cleanParticipantId]
    );

    for (const match of matchesRes.rows) {
      let winnerId = null;
      let scores = "6-0";

      if (String(match.player1_id).trim() === String(cleanParticipantId)) {
        winnerId = match.player2_id;
        scores = "0-6";
      } else if (
        String(match.player2_id).trim() === String(cleanParticipantId)
      ) {
        winnerId = match.player1_id;
        scores = "6-0";
      }

      if (winnerId) {
        try {
          await matchHelper.updateMatchHelper(match.id, {
            winner_id: winnerId,
            scores_csv: scores,
            state: "completed",
          });
          updatedCount++;
        } catch (updateErr) {
          console.error(`❌ Failed to update match ${match.id}:`, updateErr);
        }
      }
    }

    // 5️⃣ Fetch linked users
    const usersRes = await client.query(
      `SELECT DISTINCT id, display_name, email 
       FROM users 
       WHERE id = $1 OR id = $2`,
      [
        updatedParticipant.padelhive_user1_id,
        updatedParticipant.padelhive_user2_id,
      ]
    );
    users = usersRes.rows;

    // 6️⃣ Fetch actor
    actor = await getActorDetails(userId, userRole);

    // 7️⃣ Commit
    await client.query("COMMIT");
    console.log("✅ Transaction committed successfully");

    // 8️⃣ Log success (outside transaction for reliability)
    try {
      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor.name,
        action_type: "DISQUALIFY_PARTICIPANT",
        entity_id: updatedParticipant.id,
        entity_type: "participant",
        description: `Participant "${updatedParticipant.name}" was disqualified from tournament "${tournament.name}".`,
        status: "Success",
        tournament_id: tournament.id,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to record disqualification log:", logErr);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error disqualifying participant:", err);

    // 🔥 Attempt failure log (safe even if tournament/actor undefined)
    try {
      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id || null,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor?.name || "Unknown",
        action_type: "DISQUALIFY_PARTICIPANT_FAILED",
        entity_id: updatedParticipant?.id || cleanParticipantId,
        entity_type: "participant",
        description: `Failed to disqualify participant "${
          updatedParticipant?.name || "unknown"
        }"${tournament ? ` in tournament "${tournament.name}"` : ""}.`,
        status: "Failed",
        tournament_id: tournament?.id || cleanTournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log disqualification error:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }

  // 9️⃣ Send emails after commit
  try {
    for (const user of users) {
      console.log(`📨 Sending disqualification email to ${user.email}...`);
      await sendDisqualificationEmail(
        user,
        tournament,
        "Violation of tournament rules"
      );
    }
  } catch (err) {
    console.error("⚠️ Error sending disqualification emails:", err);
  }

  // 🔟 Emit socket update
  if (global.io) {
    global.io
      .to(`tournament_${updatedParticipant.tournament_id}`)
      .emit("participant-updated", updatedParticipant);
  }

  console.log("🎯 Disqualification completed:", {
    participantId: updatedParticipant.id,
    updatedMatches: updatedCount,
  });

  return {
    disqualified: updatedParticipant,
    updatedMatches: updatedCount,
  };
};

const deleteParticipant = async (participantId, userId, userRole) => {
  const client = await pool.connect();

  // Variables that must exist also in catch
  let participantRow = null;
  let updatedTournament = null;
  let actor = null;

  try {
    await client.query("BEGIN");

    // Fetch participant
    const participantRes = await client.query(
      `SELECT * FROM participants WHERE id = $1`,
      [participantId]
    );

    participantRow = participantRes.rows[0];
    if (!participantRow) throw new AppError("Participant not found", 404);

    // 1️⃣ Update history
    await tournamentHelper.onDeleteParticipantUpdateTournamentHistory(
      participantId,
      client
    );

    // 2️⃣ Delete payment data
    await paymentService.deletePaymentParticipant(
      participantId,
      participantRow.tournament_id,
      client
    );

    // 3️⃣ Delete participant
    const res = await client.query(`DELETE FROM participants WHERE id = $1`, [
      participantId,
    ]);

    // 4️⃣ Decrement participants_count
    const tournamentRes = await client.query(
      `UPDATE tournaments 
         SET participants_count = GREATEST(participants_count - 1, 0)
         WHERE id = $1
         RETURNING *`,
      [participantRow.tournament_id]
    );

    updatedTournament = tournamentRes.rows[0];

    // Activity log
    actor = await getActorDetails(userId, userRole);

    await createActivityLog(
      {
        scope: "company",
        company_id: updatedTournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor.name,
        action_type: "DELETE_PARTICIPANT",
        entity_id: participantRow.id,
        entity_type: "participant",
        description: `Participant "${participantRow.name}" has been removed from tournament "${updatedTournament.name}".`,
        status: "Success",
        tournament_id: updatedTournament.id,
      },
      client
    );

    await client.query("COMMIT");

    // SOCKET EVENTS
    if (global.io) {
      global.io
        .to(`tournament_${participantRow.tournament_id}`)
        .emit("participant-deleted", participantRow);

      global.io
        .to(`tournament_${participantRow.tournament_id}`)
        .emit("tournament-updated", updatedTournament);
    }

    // SEND LEFT EMAILS
    const userIds = [
      participantRow.padelhive_user1_id,
      participantRow.padelhive_user2_id,
      participantRow.user_id,
    ].filter(Boolean);

    if (userIds.length > 0) {
      const usersRes = await client.query(
        `SELECT id, display_name, email FROM users WHERE id = ANY($1::uuid[])`,
        [userIds]
      );
      for (const user of usersRes.rows) {
        try {
          sendTournamentLeftEmail(user, updatedTournament);
        } catch (err) {
          console.error("Email sending failed (non-blocking):", err);
        }
      }
    }

    return res.rowCount > 0;
  } catch (err) {
    await client.query("ROLLBACK");

    // SAFE FAILURE LOGGING
    try {
      await createActivityLog(
        {
          scope: "company",
          company_id: updatedTournament?.company_id || null,
          actor_id: userId,
          actor_role: userRole,
          actor_name: actor?.name || "Unknown",
          action_type: "DELETE_PARTICIPANT_FAILED",
          entity_id: participantRow?.id || null,
          entity_type: "participant",
          description: `Failed to remove participant "${
            participantRow?.name || "unknown"
          }"${
            updatedTournament
              ? ` from tournament "${updatedTournament.name}"`
              : ""
          }.`,
          status: "Failed",
          tournament_id: updatedTournament?.id || null,
        },
        client
      );
    } catch (logErr) {
      console.error("⚠️ Failed to log participant delete error:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }
};

const isParticipantNameValid = async (name, tournamentId) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS count 
     FROM participants 
     WHERE name = $1 AND tournament_id = $2`,
    [name, tournamentId]
  );

  return Number(result.rows[0].count) === 0;
};

const switchParticipantsInTournament = async (p1Id, p2Id, tournamentId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (p1Id === p2Id) {
      throw new AppError("Cannot switch the same participant", 400);
    }

    // 1️⃣ Fetch both participants
    const participant1Res = await client.query(
      `SELECT id, name, padelhive_user1_id, padelhive_user2_id 
       FROM participants 
       WHERE id = $1 AND tournament_id = $2`,
      [p1Id, tournamentId]
    );

    const participant2Res = await client.query(
      `SELECT id, name, padelhive_user1_id, padelhive_user2_id 
       FROM participants 
       WHERE id = $1 AND tournament_id = $2`,
      [p2Id, tournamentId]
    );

    if (participant1Res.rowCount === 0 || participant2Res.rowCount === 0) {
      throw new AppError("Participant not found in this tournament", 404);
    }

    const p1 = participant1Res.rows[0];
    const p2 = participant2Res.rows[0];

    // 2️⃣ Swap fields using a temporary placeholder
    await client.query(
      `UPDATE participants 
       SET name = $1, padelhive_user1_id = $2, padelhive_user2_id = $3
       WHERE id = $4`,
      [p2.name, p2.padelhive_user1_id, p2.padelhive_user2_id, p1.id]
    );

    await client.query(
      `UPDATE participants 
       SET name = $1, padelhive_user1_id = $2, padelhive_user2_id = $3
       WHERE id = $4`,
      [p1.name, p1.padelhive_user1_id, p1.padelhive_user2_id, p2.id]
    );

    await client.query("COMMIT");

    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw new AppError("An error occurred while switching participants", 500);
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
  isParticipantNameValid,
  switchParticipantsInTournament,
};
