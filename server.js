// const express = require("express");
// const axios = require("axios");
// const cors = require("cors");
// require('dotenv').config();


// const app = express();
// const PORT = 3000;

// app.use(cors());

// const CHALLONGE_API_KEY = process.env.CHALLONGE_API_KEY;
// const CHALLONGE_USERNAME = "Mhmd_R";

// // Get all tournaments
// app.get("/api/tournaments", async (req, res) => {
//   try {
//     const respone = await axios.get(
//       `https://api.challonge.com/v1/tournaments.json`,
//       {
//         params: {
//           api_key: CHALLONGE_API_KEY,
//         },
//       }
//     );
//     res.json(respone.data);
//   } catch (error) {
//     console.error("Error fetching tournaments:", error);
//     res.status(500).json({ error: "Failed to fetch tournaments" });
//   }
// });

// // get single tournament information
// app.get("/api/tournament/:id", async (req, res) => {
//   try {
//     const response = await axios.get(
//       `https://api.challonge.com/v1/tournaments/${req.params.id}.json`,
//       {
//         params: {
//           api_key: CHALLONGE_API_KEY,
//         },
//       }
//     );
//     res.json(response.data);
//   } catch (error) {
//     console.error("Error fetching tournament:", error);
//     res.status(500).json({ error: "Failed to fetch tournament" });
//   }
// });

// // get participants of a tournament
// app.get("/api/tournament/:id/participants", async (req, res) => {
//   try {
//     const response = await axios.get(
//       `https://api.challonge.com/v1/tournaments/${req.params.id}/participants.json`,
//       {
//         params: {
//           api_key: CHALLONGE_API_KEY,
//         },
//       }
//     );
//     res.json(response.data);
//   } catch (error) {
//     console.error("Error fetching participants:", error);
//     res.status(500).json({ error: "Failed to fetch participants" });
//   }
// });

// // get matches of a tournament
// app.get("/api/tournament/:id/matches", async (req, res) => {
//   try {
//     const response = await axios.get(
//       `https://api.challonge.com/v1/tournaments/${req.params.id}/matches.json`,
//       {
//         params: {
//           api_key: CHALLONGE_API_KEY,
//         },
//       }
//     );
//     res.json(response.data);
//   } catch (error) {
//     console.error("Error fetching matches:", error);
//     res.status(500).json({ error: "Failed to fetch matches" });
//   }
// });

// // get standings of a tournament
// async function getStandings(tournamentId) {
//   try {
//     const res = await axios.get(
//       `https://api.challonge.com/v1/tournaments/${tournamentId}.json`,
//       {
//         params: {
//           api_key: CHALLONGE_API_KEY,
//           include_participants: 1,
//         },
//       }
//     );

//     const participants = res.data.tournament.participants;

//     // Sort by final_rank
//     const standings = participants
//       .filter((p) => p.participant.final_rank !== null)
//       .sort((a, b) => a.participant.final_rank - b.participant.final_rank);

//     return standings.map((p) => ({
//       name: p.participant.name,
//       finalRank: p.participant.final_rank,
//     }));
//   } catch (error) {
//     console.error("Error fetching standings:", error);
//     return [];
//   }
// }

// app.get("/api/standings/:tournamentId", async (req, res) => {
//   const standings = await getStandings(req.params.tournamentId);
//   res.json(standings);
// });

// app.get("/api/tournament/:id/group-standings", async (req, res) => {
//   try {
//     const [participantsRes, matchesRes] = await Promise.all([
//       axios.get(
//         `https://api.challonge.com/v1/tournaments/${req.params.id}/participants.json`,
//         {
//           params: { api_key: CHALLONGE_API_KEY },
//         }
//       ),
//       axios.get(
//         `https://api.challonge.com/v1/tournaments/${req.params.id}/matches.json`,
//         {
//           params: { api_key: CHALLONGE_API_KEY },
//         }
//       ),
//     ]);

//     const participants = participantsRes.data.map((p) => p.participant);
//     const matches = matchesRes.data.map((m) => m.match);

//     // Build a map for quick participant access
//     const participantStats = {};
//     participants.forEach((p) => {
//       participantStats[p.group_player_ids[0]] = {
//         group_id: p.group_id || null,
//         participant_id: p.id,
//         group_player_ids: p.group_player_ids,
//         name: p.name,
//         setWins: 0,
//         matchWins: 0,
//         matchLosses: 0,
//         matchTies: 0,
//         points: 0,
//         history: [],
//         totalScore: 0,
//       };
//     });

//     matches.forEach((match) => {
//       const p1 = participantStats[match.player1_id];
//       const p2 = participantStats[match.player2_id];

//       if (!p1 || !p2) return;

//       const scores = match.scores_csv?.split(",") || [];

//       scores.forEach((score) => {
//         const [s1, s2] = score.split("-").map(Number);
//         if (s1 > s2) p1.setWins++;
//         else if (s2 > s1) p2.setWins++;

//         p1.totalScore = (p1.totalScore || 0) + s1;
//         p2.totalScore = (p2.totalScore || 0) + s2;

//       });

//       if (match.winner_id === match.player1_id) {
//         p1.matchWins++;
//         p1.points += 3;
//         p1.history.push("W");
//         p2.matchLosses++;
//         p2.history.push("L");
//       } else if (match.winner_id === match.player2_id) {
//         p2.matchWins++;
//         p2.points += 3;
//         p2.history.push("W");
//         p1.matchLosses++;
//         p1.history.push("L");
//       } else {
//         p1.matchTies++;
//         p2.matchTies++;
//         p1.points += 1;
//         p2.points += 1;
//         p1.history.push("T");
//         p2.history.push("T");
//       }
//     });

//     // Return as flat array (you can group on frontend if needed)
//     const result = Object.values(participantStats);

//     res.json(result);
//   } catch (error) {
//     console.error("Error fetching group standings:", error.message);
//     res.status(500).json({ error: "Failed to get group standings" });
//   }
// });

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });
