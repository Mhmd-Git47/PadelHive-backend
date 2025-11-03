const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const http = require("http");

// Load .env.production if NODE_ENV=production, else default .env
const envFile =
  process.env.NODE_ENV === "production" ? ".env.production" : ".env";
require("dotenv").config({ path: envFile });

// routes
const participantsRouter = require("./routes/participants");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const tournamentRoutes = require("./routes/tournament.routes");
const participantsRoutes = require("./routes/participant.routes");
const matchesRoutes = require("./routes/match.routes");
const groupRoutes = require("./routes/group.routes");
const stageRoutes = require("./routes/stage.routes");
const paymentsRoutes = require("./routes/payments.routes");
const companyRoutes = require("./routes/company.routes");
const sponsorRoutes = require("./routes/sponsor.routes");
const reportRoutes = require("./routes/report.routes");
const contactRoutes = require("./routes/contact.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const smsRoutes = require("./routes/sms.routes");
const locationRoutes = require("./routes/location.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const errorHandler = require("./middleware/errorHandler.middleware");

// cron
const tournamentCron = require("./cron/tournament.cron");
require("./cron/user.cron");

console.log("Current NODE_ENV:", process.env.NODE_ENV);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors(process.env.CORS_ORIGINS));

app.use(express.json());

// api integration
// app.use("/api", challongeTournamentRoutes);

// tournaments - postgre
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/participants", participantsRoutes);
app.use("/api/matches", matchesRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/stages", stageRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/sponsors", sponsorRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/subscribe", subscriptionRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/dashboard", dashboardRoutes);

// sms
app.use("/api/sms", smsRoutes);

// get images
app.use("/api/images/users", express.static("assets/images/users"));
app.use("/api/images/tournaments", express.static("assets/images/tournaments"));
app.use("/api/images/sponsors", express.static("assets/images/sponsors"));

// backend integration
app.use("/api/participants", participantsRouter);

// admin
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// for error handling
app.use(errorHandler);
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

// Web Socket setup
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
});

global.io = io;

// CRON
// Attach io instance to cron job
tournamentCron.setSocketInstance(io);

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  // Client joins a tournament room
  socket.on("joinTournament", (tournamentId) => {
    socket.join(`tournament_${tournamentId}`);
    console.log(`📌 Client ${socket.id} joined tournament_${tournamentId}`);
  });

  // Client leaves a tournament room
  socket.on("leaveTournament", (tournamentId) => {
    socket.leave(`tournament_${tournamentId}`);
    console.log(`📌 Client ${socket.id} left tournament_${tournamentId}`);
  });

  socket.on("watchEmailVerification", (email) => {
    socket.join(`verify_${email}`);
    console.log(`📌 Client ${socket.id} is watching email ${email}`);
  });

  // --- NEW USER-RELATED SOCKET EVENTS ---
  socket.on("joinUsersRoom", () => {
    socket.join(`users_room`);
    console.log(`👥 ${socket.id} joined users_room`);
  });

  socket.on("leaveUsersRoom", () => {
    socket.leave("users_room");
    console.log(`👥 ${socket.id} left users_room`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
