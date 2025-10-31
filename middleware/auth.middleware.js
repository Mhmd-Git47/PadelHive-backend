const jwt = require("jsonwebtoken");
const pool = require("../db");
const { AppError } = require("../utils/errors");

// ✅ Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed token" });

  jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY", (err, user) => {
    if (err)
      if (err) {
        // Token expired
        if (err.name === "TokenExpiredError") {
          return res
            .status(401)
            .json({ error: "Token expired. Please logout and login again." });
        }
        // Invalid token / other verification errors
        return res.status(401).json({ error: "Invalid token" });
      }
    // Attach user info
    req.user = {
      id: user.id,
      role: user.role,
      company_id: user.company_id || null,
      location_id: user.location_id || null,
    };
    next();
  });
}

/**
 * Middleware: Authorize specific roles
 */
const authorizeRoles =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };

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

const authorizeCompanyOrLocationAdmin =
  (companyIdField, locationIdField) => (req, res, next) => {
    const user = req.user;
    const companyId = req.body[companyIdField] || req.params[companyIdField];
    const locationId = req.body[locationIdField] || req.params[locationIdField];

    if (user.role === "superadmin") return next();
    if (user.role === "company_admin" && user.company_id === companyId)
      return next();
    if (user.role === "location_admin" && user.location_id === locationId)
      return next();

    return next(new AppError("Forbidden: insufficient privileges", 403));
  };

// ✅ Ownership check
// async function checkTournamentOwnership(req, res, next) {
//   try {
//     const tournamentId = req.params.id;
//     const userCompanyId = req.user.company_id;
//     console.log("userCompanyId: ", userCompanyId);

//     const result = await pool.query(
//       `SELECT company_id FROM tournaments WHERE id = $1`,
//       [tournamentId]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: "Tournament not found" });
//     }

//     if (result.rows[0].company_id !== userCompanyId) {
//       return res.status(403).json({ error: "Access denied" });
//     }

//     next();
//   } catch (err) {
//     console.error("Ownership check failed:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// }

const checkTournamentOwnership = async (req, res, next) => {
  try {
    const tournamentId = req.params.id;
    const user = req.user;

    const result = await pool.query(
      "SELECT company_id, location_id FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const tournament = result.rows[0];

    // Superadmin bypass
    if (user.role === "superadmin") return next();

    // Company admin: must match company_id
    if (
      user.role === "company_admin" &&
      tournament.company_id === user.company_id
    ) {
      return next();
    }
    console.log(user);

    // Location admin: must match location_id
    if (
      user.role === "location_admin" &&
      tournament.location_id === user.location_id
    ) {
      return next();
    }

    return res.status(403).json({ error: "Access denied" });
  } catch (err) {
    console.error("Ownership check failed:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ✅ Export all together
module.exports = {
  authenticateToken,
  authorizeAdmin,
  authorizeSuperAdmin,
  checkTournamentOwnership,
  authorizeRoles,
  authorizeCompanyOrLocationAdmin,
};
