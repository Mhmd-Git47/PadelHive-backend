const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  authorizeAdmin,
} = require("../middleware/auth.middleware");
const pool = require("../db");

router.get("/dashboard", authenticateToken, authorizeAdmin, (req, res) => {
  res.json({ message: "Welcome Admin", user: req.user });
});

router.get("/admins", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, role FROM admins WHERE role = 'admin'"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch admins:", error);
    res.status(500).json({ error: "Failed to fetch admins" });
  }
});

module.exports = router;
