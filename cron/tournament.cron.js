const cron = require("node-cron");
const tournamentService = require("../services/tournament.service");
const pool = require("../db");
const { createActivityLog } = require("../services/activityLog.service");

let io;

function setSocketInstance(socketInstance) {
  io = socketInstance;
}

// tournament updates cron
cron.schedule(
  "* * * * *",
  async () => {
    const now = new Date();

    try {
      const result = await pool.query(
        `SELECT * FROM tournaments WHERE state = 'pending'`
      );
      const tournaments = result.rows;

      for (const t of tournaments) {
        try {
          // --- 1️⃣ Start tournament if start_at reached ---
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

            if (io) io.emit("tournament-updated", updatedTournament);

            await safeLog({
              scope: "both",
              company_id: t.company_id,
              action_type: "TOURNAMENT_STARTED",
              entity_id: t.id,
              description: `Tournament "${
                t.name
              }" automatically started at ${now.toISOString()}.`,
              tournament_id: t.id,
            });

            console.log(`🏁 Tournament ${t.name} started!`);
          }

          // --- 2️⃣ Handle registration state changes ---
          if (
            t.registration_deadline &&
            new Date(t.registration_deadline) <= now
          ) {
            // ⛔ Deadline reached → always close registration
            if (t.open_registration) {
              const updatedTournament =
                await tournamentService.updateTournament(t.id, {
                  open_registration: false,
                });

              if (io) io.emit("tournament-updated", updatedTournament);

              await safeLog({
                scope: "company",
                company_id: t.company_id,
                action_type: "TOURNAMENT_REGISTRATION_CLOSED",
                entity_id: t.id,
                description: `Tournament "${t.name}" registration automatically closed (deadline reached).`,
                tournament_id: t.id,
              });

              console.log(
                `Tournament ${t.name} registration closed (deadline).`
              );
            }
          } else {
            // ⏳ Deadline not reached → check capacity
            const isFull =
              t.max_allowed_teams !== null &&
              t.participants_count >= t.max_allowed_teams;
            const hasSpace =
              t.max_allowed_teams !== null &&
              t.participants_count < t.max_allowed_teams;

            if (isFull && t.open_registration) {
              const updatedTournament =
                await tournamentService.updateTournament(t.id, {
                  open_registration: false,
                });

              if (io) io.emit("tournament-updated", updatedTournament);

              await safeLog({
                scope: "company",
                company_id: t.company_id,
                action_type: "TOURNAMENT_REGISTRATION_CLOSED",
                entity_id: t.id,
                description: `Tournament "${t.name}" registration automatically closed (full capacity reached).`,
                tournament_id: t.id,
              });

              console.log(`Tournament ${t.name} registration closed (full).`);
            } else if (hasSpace && !t.open_registration) {
              const updatedTournament =
                await tournamentService.updateTournament(t.id, {
                  open_registration: true,
                });

              if (io) io.emit("tournament-updated", updatedTournament);

              await safeLog({
                scope: "company",
                company_id: t.company_id,
                action_type: "TOURNAMENT_REGISTRATION_REOPENED",
                entity_id: t.id,
                description: `Tournament "${t.name}" registration automatically reopened (slot freed before deadline).`,
                tournament_id: t.id,
              });

              console.log(
                `Tournament ${t.name} registration reopened (slot freed).`
              );
            }
          }
        } catch (tErr) {
          // ⚠️ Don’t let one bad tournament stop the others
          console.error(`Error processing tournament ${t.id}:`, tErr);
          await safeLog({
            scope: "system",
            company_id: t.company_id,
            action_type: "TOURNAMENT_CRON_ERROR",
            entity_id: t.id,
            description: `Error auto-updating tournament "${t.name}": ${tErr.message}`,
            tournament_id: t.id,
            status: "Failed",
          });
        }
      }
    } catch (err) {
      console.error("❌ Error updating tournament states:", err);
      await safeLog({
        scope: "system",
        action_type: "TOURNAMENT_CRON_ERROR",
        entity_type: "system",
        description: `Cron job failed entirely: ${err.message}`,
        status: "Failed",
      });
    }
  },
  { timezone: "Etc/UTC" }
);

// Helper for safe non-blocking log writes
async function safeLog({
  scope,
  company_id,
  action_type,
  entity_id,
  description,
  tournament_id,
  status = "Success",
}) {
  try {
    await createActivityLog({
      scope,
      company_id,
      actor_id: null,
      actor_role: "system",
      actor_name: "System Cron",
      action_type,
      entity_id,
      entity_type: "tournament",
      description,
      status,
      tournament_id,
    });
  } catch (err) {
    console.error("⚠️ Failed to log cron activity:", err.message);
  }
}

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
