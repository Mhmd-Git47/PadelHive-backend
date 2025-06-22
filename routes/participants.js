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

// Delete a participant by ID
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Delete participant
    const deleteResult = await pool.query(
      "DELETE FROM participants WHERE id = $1 RETURNING *",
      [id]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ msg: "Participant not found" });
    }

    res.json({ msg: "Participant deleted", participant: deleteResult.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Edit (update) a participant by ID
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      player1_name,
      player2_name,
      phone_number,
      category,
      team_name,
      district,
    } = req.body;

    // Update participant
    const updateResult = await pool.query(
      `UPDATE participants 
       SET player1_name = $1,
           player2_name = $2,
           phone_number = $3,
           category = $4,
           team_name = $5,
           district = $6
       WHERE id = $7
       RETURNING *`,
      [player1_name, player2_name, phone_number, category, team_name, district, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ msg: "Participant not found" });
    }

    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});


module.exports = router;
