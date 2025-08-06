const pool = require("../db");

const getMatchesByTournamentId = async (tournamentId) => {
  const matches = await pool.query(
    `SELECT * FROM matches WHERE tournament_id = $1`,
    [tournamentId]
  );
  return matches.rows;
};

module.exports = { getMatchesByTournamentId };
