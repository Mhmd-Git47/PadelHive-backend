function checkGroupStageCompleted(groups, stageId) {
  const stageGroups = groups.filter((group) => group.stage_id === stageId);

  if (stageGroups.length === 0) {
    console.log("No groups found for the stage: ", stageId);
    return false;
  }

  const allGroupsCompleted = stageGroups.every((group) => {
    return group.state === "completed";
  });

  if (allGroupsCompleted) {
    console.log("All groups are completed for the stage: ", stageId);
    return true;
  } else {
    console.log("Not all groups are completed for the stage: ", stageId);
    return false;
  }
}

module.exports = {
  checkGroupStageCompleted,
};
