const express = require("express");
const router = express.Router();

const groupController = require("../controllers/group.controller");

router.post("/create", groupController.createGroupsWithParticipants);
router.post("/update", groupController.updateGroupsController);
// this will update a specific group
router.patch("/update/:id", groupController.updateGroup);

router.post(
  "/generate-matches",
  groupController.generateMatchesAfterGroupConfirmation
);
router.get("/", groupController.getGroupsByStageId);
router.get("/participants", groupController.getParticipantsByGroupId);
router.get("/group-standings", groupController.getGroupStandings);

module.exports = router;

// router.post("/", groupController.createGroupsWithParticipants); // renamed from /create
// router.get("/", groupController.getGroupsByStageId); // expects stage_id as query param?
// router.get("/:groupId/participants", groupController.getParticipantsByGroupId);
// router.get("/:groupId/standings", groupController.getGroupStandings);
