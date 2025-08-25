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
const sponsorRoutes = require("./routes/sponsor.routes");
const reportRoutes = require("./routes/report.routes");

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
app.use("/sponsors", sponsorRoutes);
app.use("/reports", reportRoutes);

// get images
app.use("/images/users", express.static("images/users"));
app.use("/images/tournaments", express.static("images/tournaments"));
app.use("/images/sponsors", express.static("images/sponsors"));

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
