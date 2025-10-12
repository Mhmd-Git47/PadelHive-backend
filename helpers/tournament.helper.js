async function updatePlacementsForTournament(finalMatch, client) {
  const winnerId = finalMatch.winner_id;
  const runnerUpId =
    finalMatch.player1_id === winnerId
      ? finalMatch.player2_id
      : finalMatch.player1_id;

  if (winnerId) {
    await updatePlacementsToTournamentHistory(
      winnerId,
      finalMatch.tournament_id,
      client,
      1
    );
  }

  if (runnerUpId) {
    await updatePlacementsToTournamentHistory(
      runnerUpId,
      finalMatch.tournament_id,
      client,
      2
    );
  }

  await client.query(
    `UPDATE tournaments 
     SET updated_at = NOW(),
         first_place_participant_id = $1,
         second_place_participant_id = $2,
         state = 'completed'
     WHERE id = $3`,
    [winnerId, runnerUpId, finalMatch.tournament_id]
  );
}

async function getEloRateForTournament(tournament) {
  const category = tournament.category.trim();
  const getEloFromCategory = (category) => {
    if (!category || category.length > 2) return null;

    // Extract main category and modifier

    const main = category[0]; // "A", "B", "C", "D"

    const modifier = category.slice(1); // "+", "-", or ""
    console.log("main: ", main);
    console.log("modifier: ", modifier);

    // Base Elo for main categories
    const baseEloMap = {
      D: 900,
      C: 1050,
      B: 1200,
      A: 1350,
      "A+": 1500,
    };
    console.log("Base elo map: ", baseEloMap[main]);

    let baseElo = baseEloMap[main];

    if (!baseElo) return null; // invalid category

    // Adjust Elo based on modifier
    if (modifier === "-") baseElo += 25; // roughly midpoint for "-" range
    else if (modifier === "+") baseElo += 75; // roughly midpoint for "+" range
    else baseElo += 50; // midpoint for normal

    return baseElo;
  };

  let eloRate = getEloFromCategory(category);
  if (eloRate !== null) {
    return eloRate;
  }

  switch (category) {
    case "C+/B+":
      return 1349;
    case "C-/B-":
      return 1249;
    case "D+/C+":
      return 1199;
    case "D-/C-":
      return 1099;
    case "E/D":
      return 1049;
  }
  return null;
}

async function addToUserTournamentsHistory(participant, tournamentId, client) {
  // Solo Player
  if (participant.user_id) {
    await client.query(
      'INSERT INTO user_tournaments_history (user_id, tournament_id, participant_id, status, registered_at) VALUES ($1, $2, $3, "registered", NOW())',
      [participant.user_id, tournamentId, participant.id]
    );
  }

  // Team Players
  if (participant.padelhive_user1_id) {
    await client.query(
      `
    INSERT INTO user_tournaments_history (user_id, tournament_id, participant_id, status, registered_at)
    VALUES ($1, $2, $3, 'registered', now())
  `,
      [
        participant.padelhive_user1_id,
        participant.tournament_id,
        participant.id,
      ]
    );
  }

  if (participant.padelhive_user2_id) {
    await client.query(
      `
    INSERT INTO user_tournaments_history (user_id, tournament_id, participant_id, status, registered_at)
    VALUES ($1, $2, $3, 'registered', now())
  `,
      [
        participant.padelhive_user2_id,
        participant.tournament_id,
        participant.id,
      ]
    );
  }
}

async function updatePlacementsToTournamentHistory(
  participantId,
  tournamentId,
  client,
  placement
) {
  const tournamentHistoryRes = await client.query(
    `SELECT * FROM user_tournaments_history WHERE participant_id = $1 AND tournament_id = $2`,
    [participantId, tournamentId]
  );

  const tournamentHistory = tournamentHistoryRes.rows[0];

  if (tournamentHistory) {
    // Update existing record
    await client.query(
      `UPDATE user_tournaments_history 
       SET placement = $1, status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [placement, tournamentHistory.id]
    );
  } else {
    // Insert new record if not exists
    await client.query(
      `INSERT INTO user_tournaments_history 
       (participant_id, tournament_id, placement, status, completed_at, updated_at)
       VALUES ($1, $2, $3, 'completed', NOW(), NOW())`,
      [participantId, tournamentId, placement]
    );
  }
}

async function onDeleteParticipantUpdateTournamentHistory(
  participantId,
  client
) {
  // Check if participant exists and if disqualified
  const participantRes = await client.query(
    `SELECT id, is_disqualified FROM participants WHERE id = $1`,
    [participantId]
  );

  const participant = participantRes.rows[0];
  if (!participant) {
    throw new Error(`Participant with id ${participantId} not found`);
  }

  if (participant.is_disqualified) {
    // If participant was disqualified → keep participant_id but mark status
    await client.query(
      `UPDATE user_tournaments_history
       SET status = 'disqualified',
           updated_at = NOW()
       WHERE participant_id = $1`,
      [participantId]
    );
  } else {
    // If participant is deleted normally → delete tournament from history
    await client.query(
      `DELETE FROM user_tournaments_history WHERE participant_id = $1`,
      [participantId]
    );
  }
}

module.exports = {
  updatePlacementsForTournament,
  addToUserTournamentsHistory,
  onDeleteParticipantUpdateTournamentHistory,
  updatePlacementsToTournamentHistory,
  getEloRateForTournament,
};
