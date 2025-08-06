const groupService = require("../services/group.service");

exports.createGroups = async (req, res) => {
  try {
    const { tournament_id, stage_id, group_count } = req.body;

    const result = await groupService.createGroups(
      tournament_id,
      stage_id,
      group_count
    );
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating groups: ", err.message);
    res.status(500).json({ error: "Failed to create groups" });
  }
};

// body for creating
// {
//   "tournament_id": 100005,
//   "stage_id": 100000,
//   "groupsData": [
//     {
//       "name": "Group A",
//       "index": 0,
//       "participantIds": [100000, 100001, 100002, 100003]
//     },
//     {
//       "name": "Group B",
//       "index": 1,
//       "participantIds": [100004, 100005, 100006, 100007]
//     }
//   ]
// }
exports.createGroupsWithParticipants = async (req, res) => {
  try {
    const { tournament_id, stage_id, groupsData } = req.body;

    const result = await groupService.createGroupsWithParticipants(
      tournament_id,
      stage_id,
      groupsData
    );
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating groups: ", err.message);
    res.status(500).json({ error: "Failed to create groups" });
  }
};

// for generating matches after groups are confirmed
exports.generateMatchesAfterGroupConfirmation = async (req, res) => {
  const { tournamentId, stageId } = req.body;

  try {
    const result = await groupService.generateMatchesAfterGroupConfirmation(
      tournamentId,
      stageId
    );
    res.status(200).json(result);
  } catch (err) {
    console.error("Match generation error:", err);
    res.status(500).json({ message: "Failed to generate matches." });
  }
};

// http://localhost:3000/groups?stage_id=100000
exports.getGroupsByStageId = async (req, res) => {
  try {
    const { stage_id } = req.query;

    if (!stage_id) {
      return res
        .status(400)
        .json({ error: "Missing stage_id in query params" });
    }

    const groups = await groupService.getGroupsByStageId(stage_id);
    res.status(200).json(groups);
  } catch (err) {
    console.error("Error fetching groups by stage:", err.message);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
};

// http://localhost:3000/groups/participants?group_id=100005
exports.getParticipantsByGroupId = async (req, res) => {
  try {
    const { group_id } = req.query;

    if (!group_id) {
      return res
        .status(400)
        .json({ error: "Missing group_id in query params" });
    }

    const participants = await groupService.getParticipantsByGroupId(group_id);
    res.status(200).json(participants);
  } catch (err) {
    console.error("Error fetching participants by stage:", err.message);
    res.status(500).json({ error: "Failed to fetch participants" });
  }
};

exports.getGroupStandings = async (req, res) => {
  try {
    const { tournament_id } = req.query;
    const standings = await groupService.getGroupStandings(tournament_id);
    res.json(standings);
  } catch (err) {
    console.error("Error fetching standings by stage:", err.message);
    res.status(500).json({ error: "Failed to fetch standings" });
  }
};
