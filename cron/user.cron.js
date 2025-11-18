const cron = require("node-cron");
const pool = require("../db");
const path = require("path");
const fs = require("fs");
const dayjs = require("dayjs");

const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "images/users");

// Cleanup expired pending registrations daily at midnight
cron.schedule(
  "0 0 * * *",
  async () => {
    try {
      console.log("Running daily cleanup for expired pending registrations...");

      const { rows } = await pool.query(
        "SELECT * FROM pending_registrations WHERE expires_at < NOW()"
      );

      for (const pending of rows) {
        // Delete image if exists
        if (pending.image_url) {
          const imagePath = path.join(IMAGE_UPLOAD_PATH, pending.image_url);
          fs.unlink(imagePath, (err) => {
            if (err) console.warn("Failed to delete image:", err.message);
            else console.log("Deleted expired registration image:", imagePath);
          });
        }

        // Delete pending registration
        await pool.query("DELETE FROM pending_registrations WHERE id = $1", [
          pending.id,
        ]);
        console.log(`Deleted expired pending registration id: ${pending.id}`);
      }

      if (rows.length === 0)
        console.log("No expired pending registrations found.");
    } catch (err) {
      console.error("Error cleaning up expired pending registrations:", err);
    }
  },
  { timezone: "Etc/UTC" }
);

// Activity Log Cleanup - Runs every day at midnight
cron.schedule("0 0 * * *", async () => {
  console.log("🧹 Running activity log cleanup job...");

  try {
    const twoWeeksAgo = dayjs().subtract(14, "day").toISOString();

    const result = await pool.query(
      `DELETE FROM activity_logs 
       WHERE created_at < $1`,
      [twoWeeksAgo]
    );

    console.log(`✅ Deleted ${result.rowCount} old activity log entries.`);
  } catch (err) {
    console.error("❌ Error deleting old activity logs:", err);
  }
});
