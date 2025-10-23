const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const groupController = require("../controllers/group.controller");

router.post(
  "/create",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  groupController.createGroupsWithParticipants
);
router.post(
  "/update",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  groupController.updateGroupsController
);
// this will update a specific group
router.patch(
  "/update/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  groupController.updateGroup
);

router.post(
  "/generate-matches",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  groupController.generateMatchesAfterGroupConfirmation
);
router.get("/", groupController.getGroupsByStageId);
router.get("/participants", groupController.getParticipantsByGroupId);
router.get("/group-standings", groupController.getGroupStandings);
router.get("/sorted-standings", groupController.getSortedGroupStandings);

module.exports = router;

// router.post("/", groupController.createGroupsWithParticipants); // renamed from /create
// router.get("/", groupController.getGroupsByStageId); // expects stage_id as query param?
// router.get("/:groupId/participants", groupController.getParticipantsByGroupId);
// router.get("/:groupId/standings", groupController.getGroupStandings);
