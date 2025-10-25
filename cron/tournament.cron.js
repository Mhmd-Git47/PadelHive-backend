const cron = require("node-cron");
const tournamentService = require("../services/tournament.service");
const pool = require("../db");

let io;

function setSocketInstance(socketInstance) {
  io = socketInstance;
}

// tournament updates cron
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const now = new Date();

      const result = await pool.query(
        `SELECT * FROM tournaments WHERE state = 'pending'`
      );
      const tournaments = result.rows;

      for (const t of tournaments) {
        // --- Start tournament if start_at reached ---
        if (
          t.start_at &&
          new Date(t.start_at) <= now &&
          t.state === "pending"
        ) {
          const updatedTournament = await tournamentService.updateTournament(
            t.id,
            {
              state: "in progress",
              started_at: now,
            }
          );

          if (io) {
            io.emit("tournament-updated", updatedTournament);
          }
          console.log(`Tournament ${t.name} started!`);
        }

        // --- Registration logic ---
        if (
          t.registration_deadline &&
          new Date(t.registration_deadline) <= now
        ) {
          // ⛔ Deadline reached → registration always closed
          if (t.open_registration) {
            const updatedTournament = await tournamentService.updateTournament(
              t.id,
              { open_registration: false }
            );
            if (io) io.emit("tournament-updated", updatedTournament);
            console.log(`Tournament ${t.name} registration closed (deadline).`);
          }
        } else {
          // ⏳ Deadline not reached → check participant count
          if (
            t.max_allowed_teams !== null &&
            t.participants_count >= t.max_allowed_teams &&
            t.open_registration
          ) {
            // Close if full
            const updatedTournament = await tournamentService.updateTournament(
              t.id,
              { open_registration: false }
            );
            if (io) io.emit("tournament-updated", updatedTournament);
            console.log(`Tournament ${t.name} registration closed (full).`);
          } else if (
            t.participants_count < t.max_allowed_teams &&
            !t.open_registration
          ) {
            // Reopen if space available before deadline
            const updatedTournament = await tournamentService.updateTournament(
              t.id,
              { open_registration: true }
            );
            if (io) io.emit("tournament-updated", updatedTournament);
            console.log(
              `Tournament ${t.name} registration reopened (slot freed).`
            );
          }
        }
      }
    } catch (err) {
      console.error("Error updating tournament states: ", err);
    }
  },
  { timezone: "Etc/UTC" }
);

// check if tournament.participants_count is correct with participants count (get from table)
cron.schedule(
  "0 0 * * *",
  async () => {
    try {
      console.log("Running daily participant count reconciliation...");

      const result = await pool.query(
        `SELECT id, participants_count FROM tournaments WHERE state = 'pending'`
      );
      const tournaments = result.rows;

      for (const t of tournaments) {
        const res = await pool.query(
          `SELECT COUNT(*) AS count FROM participants WHERE tournament_id = $1`,
          [t.id]
        );
        const realCount = parseInt(res.rows[0].count, 10);

        if (realCount !== t.participants_count) {
          const updatedTournament = await tournamentService.updateTournament(
            t.id,
            { participants_count: realCount }
          );

          if (io) io.emit("tournament-updated", updatedTournament);
          console.log(
            `Reconciled participants_count for tournament ${t.id}: ${t.participants_count} → ${realCount}`
          );
        }
      }
    } catch (err) {
      console.error("Error reconciling participant counts: ", err);
    }
  },
  { timezone: "Etc/UTC" }
);

module.exports = {
  setSocketInstance,
};
