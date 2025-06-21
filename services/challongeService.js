const axios = require("axios");
require('dotenv').config();

const BASE_URL = "https://api.challonge.com/v1";
const API_KEY = process.env.CHALLONGE_API_KEY;

exports.getAllTournaments = async () => {
  const res = await axios.get(`${BASE_URL}/tournaments.json`, {
    params: { api_key: API_KEY },
  });
  return res.data;
};

exports.getTournament = async (id) => {
  const res = await axios.get(`${BASE_URL}/tournaments/${id}.json`, {
    params: { api_key: API_KEY },
  });
  return res.data;
};

exports.getParticipants = async (id) => {
  const res = await axios.get(`${BASE_URL}/tournaments/${id}/participants.json`, {
    params: { api_key: API_KEY },
  });
  return res.data;
};

exports.getMatches = async (id) => {
  const res = await axios.get(`${BASE_URL}/tournaments/${id}/matches.json`, {
    params: { api_key: API_KEY },
  });
  return res.data;
};

exports.getStandings = async (id) => {
  const res = await axios.get(`${BASE_URL}/tournaments/${id}.json`, {
    params: { api_key: API_KEY, include_participants: 1 },
  });

  const participants = res.data.tournament.participants;
  const sorted = participants
    .filter(p => p.participant.final_rank !== null)
    .sort((a, b) => a.participant.final_rank - b.participant.final_rank);

  return sorted.map(p => ({
    name: p.participant.name,
    finalRank: p.participant.final_rank,
  }));
};

exports.getGroupStandings = async (id) => {
  const [participantsRes, matchesRes] = await Promise.all([
    axios.get(`${BASE_URL}/tournaments/${id}/participants.json`, {
      params: { api_key: API_KEY },
    }),
    axios.get(`${BASE_URL}/tournaments/${id}/matches.json`, {
      params: { api_key: API_KEY },
    }),
  ]);

  const participants = participantsRes.data.map(p => p.participant);
  const matches = matchesRes.data.map(m => m.match);
  const stats = {};

  participants.forEach(p => {
    stats[p.group_player_ids[0]] = {
      participant_id: p.id,
      name: p.name,
      setWins: 0,
      matchWins: 0,
      matchLosses: 0,
      matchTies: 0,
      points: 0,
      totalScore: 0,
      history: [],
    };
  });

  matches.forEach(match => {
    const p1 = stats[match.player1_id];
    const p2 = stats[match.player2_id];
    if (!p1 || !p2) return;

    const scores = match.scores_csv?.split(",") || [];
    scores.forEach(score => {
      const [s1, s2] = score.split("-").map(Number);
      if (s1 > s2) p1.setWins++;
      else if (s2 > s1) p2.setWins++;

      p1.totalScore += s1;
      p2.totalScore += s2;
    });

    if (match.winner_id === match.player1_id) {
      p1.matchWins++; p1.points += 3; p1.history.push("W");
      p2.matchLosses++; p2.history.push("L");
    } else if (match.winner_id === match.player2_id) {
      p2.matchWins++; p2.points += 3; p2.history.push("W");
      p1.matchLosses++; p1.history.push("L");
    } else {
      p1.matchTies++; p2.matchTies++;
      p1.points++; p2.points++;
      p1.history.push("T"); p2.history.push("T");
    }
  });

  return Object.values(stats);
};
