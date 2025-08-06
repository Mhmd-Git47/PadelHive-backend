const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).json({ error: "Malformed token" });

  jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY", (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admins only" });
  next();
};

const authorizeSuperAdmin = (req, res, next) => {
  if (req.user.role !== "superadmin")
    return res.status(403).json({ error: "Super Admins only" });
  next();
};

module.exports = { authenticateToken, authorizeAdmin, authorizeSuperAdmin };
