const pool = require("../db");
const {
  getParticipantsByTournamentId,
} = require("../services/participant.service");
const matchService = require("./match.service");
const matchHelper = require("../helpers/match.helper");

const { getMatchesByTournamentId } = require("../shared/matchGrouped.shared");
const { createActivityLog, getActorDetails } = require("./activityLog.service");
const { AppError } = require("../utils/errors");

const createGroups = async (tournamentId, stageId, groupCount) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const groups = [];

    for (let i = 0; i < groupCount; i++) {
      const result = await client.query(
        `
        INSERT INTO groups (
          tournament_id, name, group_index, created_at, updated_at, stage_id
        ) VALUES ($1, $2, $3, NOW(), NOW(), $4)
        RETURNING *;
        `,
        [tournamentId, `Group ${String.fromCharCode(65 + i)}`, i, stageId]
      );

      groups.push(result.rows[0]);
    }

    await client.query("COMMIT");
    return groups;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const createGroupsWithParticipants = async (
  tournamentId,
  stageId,
  groupsData,
  userId,
  userRole
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tournamentRes = await client.query(
      `SELECT id, company_id, name FROM tournaments WHERE id = $1`,
      [tournamentId]
    );

    if (tournamentRes.rowCount === 0) {
      throw new AppError(`Tournament not found`, 404);
    }

    const tournament = tournamentRes.rows[0];
    const actor = await getActorDetails(userId, userRole);

    const createdGroups = [];
    let i = 0;

    for (const group of groupsData) {
      const scheduledTime = group.scheduled_time || null;

      // 1️⃣ Insert the group
      const groupResult = await client.query(
        `INSERT INTO groups (
           tournament_id, 
           name, 
           group_index, 
           scheduled_time, 
           created_at, 
           updated_at, 
           stage_id
         )
         VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
         RETURNING *;`,
        [tournamentId, group.name, i, scheduledTime, stageId]
      );

      const createdGroup = groupResult.rows[0];
      createdGroups.push(createdGroup);
      i++;

      // 2️⃣ Insert participants for this group
      for (const pid of group.participantIds || []) {
        await client.query(
          `INSERT INTO group_participants (group_id, participant_id)
           VALUES ($1, $2);`,
          [createdGroup.id, pid]
        );
      }

      // 3️⃣ Log activity for this group creation
      try {
        await createActivityLog(
          {
            scope: "company",
            company_id: tournament.company_id,
            actor_id: userId,
            actor_role: userRole,
            actor_name: actor.name,
            action_type: "ADD_TOURNAMENT_GROUP",
            entity_id: createdGroup.id,
            entity_type: "group",
            description: `Group "${createdGroup.name}" created in tournament "${tournament.name}" by ${actor.name}.`,
            status: "Success",
            tournament_id: tournamentId,
          },
          client
        );
      } catch (logErr) {
        console.error("⚠️ Failed to log group creation:", logErr);
      }
    }

    await client.query("COMMIT");

    // 4️⃣ Emit socket event with updated groups
    if (global.io) {
      const updatedGroups = await getGroupsByStageId(stageId);
      const groupsWithParticipants = await Promise.all(
        updatedGroups.map(async (g) => {
          const participants = await getParticipantsByGroupId(g.id);
          return { ...g, participants };
        })
      );

      global.io.to(`tournament_${tournamentId}`).emit("groups-updated", {
        tournamentId,
        stageId,
        groups: groupsWithParticipants,
      });
    }

    return createdGroups;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating groups:", err);
    // ⚠️ Attempt to log failure
    try {
      let actorDetails = null;

      // Safely attempt to fetch actor only if missing
      try {
        actorDetails = await getActorDetails(userId, userRole);
      } catch (actorErr) {
        console.warn("⚠️ Could not fetch actor details:", actorErr);
      }

      // Try fetching tournament info too
      let tournament = null;
      try {
        const tournamentRes = await pool.query(
          `SELECT id, company_id, name FROM tournaments WHERE id = $1`,
          [tournamentId]
        );
        tournament = tournamentRes.rows[0] || null;
      } catch (tErr) {
        console.warn("⚠️ Could not fetch tournament for failure log:", tErr);
      }

      // Log failure safely
      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actorDetails?.name || "Unknown",
        action_type: "ADD_TOURNAMENT_GROUP_FAILED",
        entity_id: null,
        entity_type: "group",
        description: `Failed to create groups for tournament "${
          tournament?.name || tournamentId
        }". Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log group creation failure:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }
};

// if need to update groups to another
const updateGroupParticipants = async (
  tournamentId,
  stageId,
  groupsData,
  userId,
  userRole
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔹 Fetch tournament info for logging
    const tournamentRes = await client.query(
      `SELECT id, name, company_id FROM tournaments WHERE id=$1`,
      [tournamentId]
    );
    if (tournamentRes.rowCount === 0) {
      throw new AppError("Tournament not found", 404);
    }

    const tournament = tournamentRes.rows[0];
    const actor = await getActorDetails(userId, userRole);

    // 🔹 Get existing groups
    const existingGroupsRes = await client.query(
      `SELECT * FROM groups WHERE tournament_id=$1 AND stage_id=$2 ORDER BY group_index`,
      [tournamentId, stageId]
    );
    const existingGroups = existingGroupsRes.rows;

    const updatedGroups = [];
    const createdGroups = [];
    const deletedGroups = [];

    for (let i = 0; i < groupsData.length; i++) {
      const groupData = groupsData[i];
      let groupId;

      if (existingGroups[i]) {
        // 🟢 Update existing group
        groupId = existingGroups[i].id;

        await client.query(
          `UPDATE groups SET name=$1, updated_at=NOW() WHERE id=$2`,
          [groupData.name, groupId]
        );

        await client.query(`DELETE FROM group_participants WHERE group_id=$1`, [
          groupId,
        ]);

        for (const pid of groupData.participantIds || []) {
          await client.query(
            `INSERT INTO group_participants (group_id, participant_id) VALUES ($1,$2)`,
            [groupId, pid]
          );
        }

        updatedGroups.push(groupId);

        // ✅ Log update activity
        try {
          await createActivityLog(
            {
              scope: "company",
              company_id: tournament.company_id,
              actor_id: userId,
              actor_role: userRole,
              actor_name: actor.name,
              action_type: "UPDATE_TOURNAMENT_GROUP",
              entity_id: groupId,
              entity_type: "group",
              description: `Group "${groupData.name}" updated by ${actor.name} in tournament "${tournament.name}".`,
              status: "Success",
              tournament_id: tournamentId,
            },
            client
          );
        } catch (logErr) {
          console.error("⚠️ Failed to log group update:", logErr);
        }
      } else {
        // 🟢 Create new group
        const res = await client.query(
          `INSERT INTO groups (tournament_id, stage_id, name, group_index, created_at, updated_at)
           VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id`,
          [tournamentId, stageId, groupData.name, i]
        );
        groupId = res.rows[0].id;

        for (const pid of groupData.participantIds || []) {
          await client.query(
            `INSERT INTO group_participants (group_id, participant_id) VALUES ($1,$2)`,
            [groupId, pid]
          );
        }

        createdGroups.push(groupId);

        // ✅ Log creation activity
        try {
          await createActivityLog(
            {
              scope: "company",
              company_id: tournament.company_id,
              actor_id: userId,
              actor_role: userRole,
              actor_name: actor.name,
              action_type: "ADD_TOURNAMENT_GROUP",
              entity_id: groupId,
              entity_type: "group",
              description: `New group "${groupData.name}" created by ${actor.name} in tournament "${tournament.name}".`,
              status: "Success",
              tournament_id: tournamentId,
            },
            client
          );
        } catch (logErr) {
          console.error("⚠️ Failed to log group creation:", logErr);
        }
      }
    }

    // 🔴 Delete extra old groups
    if (existingGroups.length > groupsData.length) {
      const idsToRemove = existingGroups
        .slice(groupsData.length)
        .map((g) => g.id);

      await client.query(
        `DELETE FROM group_participants WHERE group_id = ANY($1::int[])`,
        [idsToRemove]
      );
      await client.query(`DELETE FROM groups WHERE id = ANY($1::int[])`, [
        idsToRemove,
      ]);

      deletedGroups.push(...idsToRemove);

      // ✅ Log deletions
      for (const gid of idsToRemove) {
        try {
          await createActivityLog(
            {
              scope: "company",
              company_id: tournament.company_id,
              actor_id: userId,
              actor_role: userRole,
              actor_name: actor.name,
              action_type: "DELETE_TOURNAMENT_GROUP",
              entity_id: gid,
              entity_type: "group",
              description: `Group ID ${gid} deleted by ${actor.name} in tournament "${tournament.name}".`,
              status: "Success",
              tournament_id: tournamentId,
            },
            client
          );
        } catch (logErr) {
          console.error("⚠️ Failed to log group deletion:", logErr);
        }
      }
    }

    await client.query("COMMIT");

    // 🧾 Summary log (one overall success)
    try {
      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor.name,
        action_type: "UPDATE_GROUPS_SUMMARY",
        entity_id: null,
        entity_type: "group",
        description: `${createdGroups.length} group(s) created, ${updatedGroups.length} updated, and ${deletedGroups.length} deleted by ${actor.name} in tournament "${tournament.name}".`,
        status: "Success",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log summary:", logErr);
    }

    // 🔔 Emit updates via socket
    if (global.io) {
      const updatedGroupsList = await getGroupsByStageId(stageId);
      const groupsWithParticipants = await Promise.all(
        updatedGroupsList.map(async (g) => {
          const participants = await getParticipantsByGroupId(g.id);
          return { ...g, participants };
        })
      );

      global.io.to(`tournament_${tournamentId}`).emit("groups-updated", {
        tournamentId,
        stageId,
        groups: groupsWithParticipants,
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating groups:", err);

    // 🟥 Log failure
    try {
      let actorDetails = null;
      try {
        actorDetails = await getActorDetails(userId, userRole);
      } catch (actorErr) {
        console.warn("⚠️ Could not fetch actor details:", actorErr);
      }

      const tournamentRes = await pool.query(
        `SELECT id, name, company_id FROM tournaments WHERE id=$1`,
        [tournamentId]
      );
      const tournament = tournamentRes.rows[0];

      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actorDetails?.name || "Unknown",
        action_type: "UPDATE_TOURNAMENT_GROUP_FAILED",
        entity_id: null,
        entity_type: "group",
        description: `Failed to update groups for tournament "${
          tournament?.name || tournamentId
        }". Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log group update failure:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }
};

// groups are generated previously, this function only generate matches and stages...
const generateMatchesAfterGroupConfirmation = async (
  tournamentId,
  stageId,
  userId,
  userRole
) => {
  const client = await pool.connect();

  try {
    // 🔹 Step 1: Prevent duplicate generation
    const existingMatches = await pool.query(
      `SELECT COUNT(*) FROM matches WHERE tournament_id = $1 AND stage_id = $2`,
      [tournamentId, stageId]
    );

    if (Number(existingMatches.rows[0].count) > 0) {
      throw new AppError(
        "Matches have already been generated for this stage.",
        400
      );
    }

    await client.query("BEGIN");

    // 🔹 Step 2: Fetch tournament and actor info for logging
    const tournamentRes = await client.query(
      `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
      [tournamentId]
    );
    if (tournamentRes.rowCount === 0) {
      throw new AppError("Tournament not found", 404);
    }

    const tournament = tournamentRes.rows[0];
    const actor = await getActorDetails(userId, userRole);

    // 🔹 Step 3: Generate matches
    await matchHelper.generateMatchesForStages(tournamentId, stageId, client);

    await client.query("COMMIT");

    // 🟢 Step 4: Log success
    try {
      await createActivityLog(
        {
          scope: "company",
          company_id: tournament.company_id,
          actor_id: userId,
          actor_role: userRole,
          actor_name: actor.name,
          action_type: "GENERATE_MATCHES",
          entity_id: null,
          entity_type: "match",
          description: `Matches successfully generated for stage ID ${stageId} in tournament "${tournament.name}" by ${actor.name}.`,
          status: "Success",
          tournament_id: tournamentId,
        },
        client
      );
    } catch (logErr) {
      console.error("⚠️ Failed to log match generation success:", logErr);
    }

    // 🔔 Emit socket update
    if (global.io) {
      global.io.to(`tournament_${tournamentId}`).emit("matches-generated", {
        tournamentId,
        stageId,
        message: "Matches have been generated successfully.",
      });
    }

    return { message: "Matches generated successfully." };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error generating matches:", err);

    // 🔴 Step 5: Log failure
    try {
      let actorDetails = null;
      try {
        actorDetails = await getActorDetails(userId, userRole);
      } catch (actorErr) {
        console.warn("⚠️ Could not fetch actor details:", actorErr);
      }

      const tournamentRes = await pool.query(
        `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
        [tournamentId]
      );
      const tournament = tournamentRes.rows[0];

      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actorDetails?.name || "Unknown",
        action_type: "GENERATE_MATCHES_FAILED",
        entity_id: null,
        entity_type: "match",
        description: `Failed to generate matches for stage ID ${stageId} in tournament "${
          tournament?.name || tournamentId
        }". Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log match generation failure:", logErr);
    }

    throw err;
  } finally {
    client.release();
  }
};

const getGroupsByStageId = async (stageId) => {
  const result = await pool.query(
    `SELECT * FROM groups WHERE stage_id = $1 ORDER BY group_index`,
    [stageId]
  );
  return result.rows;
};

const getParticipantsByGroupId = async (groupId) => {
  const result = await pool.query(
    `SELECT p.* FROM group_participants gp JOIN participants p ON gp.participant_id = p.id WHERE gp.group_id = $1 `,
    [groupId]
  );
  return result.rows;
};

const getGroupStandings = async (tournamentId) => {
  const [participants, matches] = await Promise.all([
    getParticipantsByTournamentId(tournamentId),
    getMatchesByTournamentId(tournamentId),
  ]);

  // Get group info for each participant
  const groupParticipantRes = await pool.query(
    `SELECT participant_id, group_id FROM group_participants WHERE participant_id = ANY($1::int[])`,
    [participants.map((p) => p.id)]
  );

  const participantGroupMap = {};
  groupParticipantRes.rows.forEach((row) => {
    participantGroupMap[row.participant_id] = row.group_id;
  });

  const stats = {};

  participants.forEach((p) => {
    const groupId = participantGroupMap[p.id];
    if (!groupId) return;

    stats[p.id] = {
      participant_id: p.id,
      name: p.name,
      setWins: 0,
      matchWins: 0,
      matchLosses: 0,
      matchTies: 0,
      losesPoints: 0,
      totalScore: 0,
      history: [],
      match_diffs: 0,
      groupId,
      is_disqualified: p.is_disqualified,
    };
  });

  matches.forEach((match) => {
    if (match.group_id === null) return;
    const p1 = stats[match.player1_id];
    const p2 = stats[match.player2_id];
    if (!p1 || !p2 || match.state !== "completed") return;

    const scores = match.scores_csv?.split(",") || [];
    scores.forEach((score) => {
      const [s1, s2] = score.split("-").map(Number);
      if (s1 > s2) {
        p1.setWins++;
        p2.losesPoints += s2;
        const diff = s1 - s2;
        p1.match_diffs += diff;
        p2.match_diffs -= diff;
      } else if (s2 > s1) {
        p2.setWins++;
        p1.losesPoints += s1;
        const diff = s2 - s1;
        p2.match_diffs += diff;
        p1.match_diffs -= diff;
      }

      p1.totalScore += s1;
      p2.totalScore += s2;
    });

    if (match.winner_id === match.player1_id) {
      p1.matchWins++;
      p1.history.push("W");
      p2.matchLosses++;
      p2.history.push("L");
    } else if (match.winner_id === match.player2_id) {
      p2.matchWins++;
      p2.history.push("W");
      p1.matchLosses++;
      p1.history.push("L");
    } else {
      p1.matchTies++;
      p2.matchTies++;
      p1.history.push("T");
      p2.history.push("T");
    }
  });

  // Group by groupId
  const groupedStats = {};

  Object.values(stats).forEach((stat) => {
    if (!groupedStats[stat.groupId]) {
      groupedStats[stat.groupId] = [];
    }
    groupedStats[stat.groupId].push(stat);
  });

  return groupedStats;
};

async function getSortedGroupStandings(tournamentId) {
  const [participants, matches] = await Promise.all([
    getParticipantsByTournamentId(tournamentId),
    getMatchesByTournamentId(tournamentId),
  ]);

  // Map participant → group
  const groupParticipantRes = await pool.query(
    `SELECT participant_id, group_id FROM group_participants WHERE participant_id = ANY($1::int[])`,
    [participants.map((p) => p.id)]
  );

  const participantGroupMap = {};
  groupParticipantRes.rows.forEach((row) => {
    participantGroupMap[row.participant_id] = row.group_id;
  });

  const stats = {};
  participants.forEach((p) => {
    const groupId = participantGroupMap[p.id];
    if (!groupId) return;

    stats[p.id] = {
      participant_id: p.id,
      name: p.name,
      matchWins: 0,
      matchLosses: 0,
      matchTies: 0,
      match_diffs: 0,
      totalScore: 0,
      history: [],
      groupId,
      is_disqualified: p.is_disqualified,
    };
  });

  // Aggregate stats
  matches.forEach((match) => {
    if (match.group_id === null) return;
    const p1 = stats[match.player1_id];
    const p2 = stats[match.player2_id];
    if (!p1 || !p2 || match.state !== "completed") return;

    const scores = match.scores_csv?.split(",") || [];
    let p1Total = 0,
      p2Total = 0;

    scores.forEach((score) => {
      const [s1, s2] = score.split("-").map(Number);
      if (!isNaN(s1) && !isNaN(s2)) {
        p1Total += s1;
        p2Total += s2;
        const diff = s1 - s2;
        p1.match_diffs += diff;
        p2.match_diffs -= diff;
        p1.totalScore += s1;
        p2.totalScore += s2;
      }
    });

    if (match.winner_id === p1.participant_id) {
      p1.matchWins++;
      p1.history.push("W");
      p2.matchLosses++;
      p2.history.push("L");
    } else if (match.winner_id === p2.participant_id) {
      p2.matchWins++;
      p2.history.push("W");
      p1.matchLosses++;
      p1.history.push("L");
    } else {
      p1.matchTies++;
      p2.matchTies++;
      p1.history.push("T");
      p2.history.push("T");
    }
  });

  // Group participants by groupId
  const groupedStats = {};
  Object.values(stats).forEach((stat) => {
    if (!groupedStats[stat.groupId]) groupedStats[stat.groupId] = [];
    groupedStats[stat.groupId].push(stat);
  });

  // Sort each group
  Object.keys(groupedStats).forEach((groupId) => {
    groupedStats[groupId].sort((a, b) => {
      const aWins = a.history.filter((h) => h === "W").length;
      const bWins = b.history.filter((h) => h === "W").length;

      // Step 1: history
      if (bWins !== aWins) return bWins - aWins;

      // Step 2: match difference
      if (b.match_diffs !== a.match_diffs) return b.match_diffs - a.match_diffs;

      // Step 3: head-to-head
      const headToHead = matches.find(
        (m) =>
          (m.player1_id === a.participant_id &&
            m.player2_id === b.participant_id) ||
          (m.player1_id === b.participant_id &&
            m.player2_id === a.participant_id)
      );
      if (headToHead && headToHead.winner_id) {
        if (headToHead.winner_id === b.participant_id) return 1;
        if (headToHead.winner_id === a.participant_id) return -1;
      }

      // Step 4: fallback to total points
      return b.totalScore - a.totalScore;
    });
  });

  return groupedStats;
}

const updateGroup = async (
  id,
  updatedData,
  clientt,
  userId = null,
  userRole = null
) => {
  const client = clientt || (await pool.connect());

  if (Object.keys(updatedData).length === 0) {
    throw new Error("No data provided for update");
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

  const query = `
    UPDATE groups SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  try {
    await client.query("BEGIN");

    const result = await client.query(query, values);
    const updatedGroup = result.rows[0];

    // ✅ If group not found
    if (!updatedGroup) {
      throw new Error("Group not found");
    }

    // ✅ Only log if scheduled_time was updated
    if ("scheduled_time" in updatedData) {
      const tournamentRes = await client.query(
        `SELECT id, company_id FROM tournaments WHERE id = $1`,
        [updatedGroup.tournament_id]
      );

      if (tournamentRes.rowCount === 0) {
        throw new AppError(`Tournament is not found`, 401);
      }

      const tournament = tournamentRes.rows[0];
      try {
        const actor = await getActorDetails(userId, userRole);

        await createActivityLog(
          {
            scope: "company",
            company_id: tournament.company_id,
            actor_id: userId,
            actor_role: userRole,
            actor_name: actor?.name || "Unknown",
            action_type: "GROUP_SCHEDULE_UPDATED",
            entity_id: updatedGroup.id,
            entity_type: "group",
            description: `Group "${
              updatedGroup.name
            }" scheduled time updated to ${
              updatedData.scheduled_time
                ? new Date(updatedData.scheduled_time).toLocaleString()
                : "unspecified time"
            }.`,
            status: "Success",
            tournament_id: updatedGroup.tournament_id,
          },
          client
        );
      } catch (logErr) {
        console.error("⚠️ Failed to log group schedule update:", logErr);
      }
    }

    // ✅ If stage is completed after this update
    if (updatedGroup.stage_id && updatedGroup.state === "completed") {
      const stageGroupsRes = await client.query(
        `SELECT state FROM groups WHERE stage_id = $1`,
        [updatedGroup.stage_id]
      );

      const allCompleted = stageGroupsRes.rows.every(
        (group) => group.state === "completed"
      );

      if (allCompleted) {
        await client.query(
          `UPDATE stages SET state = $1, completed_at = $2 WHERE id = $3`,
          ["completed", new Date(), updatedGroup.stage_id]
        );
      }
    }

    await client.query("COMMIT");

    // ✅ Emit socket event
    if (global.io) {
      global.io
        .to(`tournament_${updatedGroup.tournament_id}`)
        .emit("groups-updated", { group: updatedGroup });
    }

    return updatedGroup;
  } catch (err) {
    await client.query("ROLLBACK");

    // 🔥 Optional: log failed update attempt
    try {
      const actor = await getActorDetails(userId, userRole);

      // 🔹 Safely fetch tournament info
      let tournament = null;
      try {
        const res = await pool.query(
          `SELECT id, company_id FROM tournaments
         WHERE id = (SELECT tournament_id FROM groups WHERE id = $1 LIMIT 1)`,
          [id]
        );
        tournament = res.rows[0] || null;
      } catch (fetchErr) {
        console.warn("⚠️ Could not fetch tournament:", fetchErr);
      }

      // 🔹 Ensure valid integer entity_id
      const safeEntityId = parseInt(id, 10);

      await createActivityLog({
        scope: "company",
        company_id: tournament?.company_id || null,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actor?.name || "Unknown",
        action_type: "GROUP_UPDATE_FAILED",
        entity_id: Number.isFinite(safeEntityId) ? safeEntityId : null,
        entity_type: "group",
        description: `Failed to update group ${id}: ${err.message}`,
        status: "Failed",
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log group update error:", logErr);
    }

    throw err;
  } finally {
    if (!clientt) client.release();
  }
};

module.exports = {
  createGroups,
  createGroupsWithParticipants,
  getGroupsByStageId,
  getParticipantsByGroupId,
  getGroupStandings,
  updateGroup,
  generateMatchesAfterGroupConfirmation,
  updateGroupParticipants,
  getSortedGroupStandings,
};
