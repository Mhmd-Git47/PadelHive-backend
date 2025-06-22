const express = require("express");
const router = express.Router();
const pool = require("../db");

// get participants
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM participants");

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);

    res.status(500).send("Server Error");
  }
});

// Add a participant
router.post("/", async (req, res) => {
  try {
    const {
      player1_name,
      player2_name,
      phone_number,
      category,
      team_name,
      district,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO participants (player1_name, player2_name, phone_number, category, created_at, team_name, district) 
       VALUES ($1, $2, $3, $4, NOW(), $5, $6) RETURNING *`,
      [player1_name, player2_name, phone_number, category, team_name, district]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
