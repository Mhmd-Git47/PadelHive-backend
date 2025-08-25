const jwt = require("jsonwebtoken");
const pool = require("../db"); // make sure to require your DB connection

// ✅ Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed token" });

  jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY", (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// ✅ Role checks
function authorizeAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
  next();
}

function authorizeSuperAdmin(req, res, next) {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Super Admins only" });
  }
  next();
}

// ✅ Ownership check
async function checkTournamentOwnership(req, res, next) {
  try {
    const tournamentId = req.params.id;
    const userCompanyId = req.user.company_id; 
    console.log('userCompanyId: ', userCompanyId);

    const result = await pool.query(
      `SELECT company_id FROM tournaments WHERE id = $1`,
      [tournamentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    if (result.rows[0].company_id !== userCompanyId) {
      return res.status(403).json({ error: "Access denied" });
    }

    next();
  } catch (err) {
    console.error("Ownership check failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// ✅ Export all together
module.exports = {
  authenticateToken,
  authorizeAdmin,
  authorizeSuperAdmin,
  checkTournamentOwnership,
};
