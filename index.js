const express = require("express");
const cors = require("cors");
const participantsRouter = require("./routes/participants");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");

const challongeTournamentRoutes = require("./routes/tournamentRoutes");
const tournamentRoutes = require("./routes/tournament.routes");
const participantsRoutes = require("./routes/participant.routes");
const matchesRoutes = require("./routes/match.routes");
const groupRoutes = require("./routes/group.routes");
const stageRoutes = require("./routes/stage.routes");
const paymentsRoutes = require("./routes/payments.routes");
const companyRoutes = require("./routes/company.routes");

const pool = require("./db");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json());

// api integration
app.use("/api", challongeTournamentRoutes);

// tournaments - postgre
app.use("/tournaments", tournamentRoutes);
app.use("/participants", participantsRoutes);
app.use("/matches", matchesRoutes);
app.use("/groups", groupRoutes);
app.use("/stages", stageRoutes);
app.use("/payments", paymentsRoutes);
app.use("/company", companyRoutes);

// get images
app.use("/images/users", express.static("images/users"));

// backend integration
app.use("/api/participants", participantsRouter);

// admin
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// Change later (uncomment to use them)
// Static file access
// app.use("/images/users", express.static("images/users"));

// // 🔐 Auth & Admin
// app.use("/api/auth", authRoutes);
// app.use("/api/admin", adminRoutes);

// // 🌐 External Integrations
// app.use("/api/integrations/challonge", challongeTournamentRoutes);

// // 🏆 Core App API
// app.use("/api/tournaments", tournamentRoutes);
// app.use("/api/participants", participantsRoutes);
// app.use("/api/matches", matchesRoutes);
// app.use("/api/groups", groupRoutes);
// app.use("/api/stages", stageRoutes);

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✅ /test-db query result:", result.rows[0]);
    res.send(`Database time: ${result.rows[0].now}`);
  } catch (error) {
    console.error("❌ /test-db error:", error.message);
    res.status(500).send("Database connection failed");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
