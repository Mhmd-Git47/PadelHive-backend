const activityLogService = require(`../services/activityLog.service`);

exports.getSuperAdmLog = async (req, res, next) => {
  try {
    const results = await activityLogService.getSuperAdmLog();
    res.json(results);
  } catch (err) {
    next(err);
  }
};

exports.getCompanyAdmLog = async (req, res, next) => {
  try {
    const companyId = req.params.companyId;
    const results = await activityLogService.getCompanyAdmLog(companyId);
    res.json(results);
  } catch (err) {
    next(err);
  }
};

exports.getTournamentLog = async (req, res, next) => {
  try {
    const tournamentId = req.params.tournamentId;
    const results = await activityLogService.getTournamentLog(tournamentId);
    res.json(results);
  } catch (err) {
    next(err);
  }
};
