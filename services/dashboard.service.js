const { AppError } = require(`../utils/errors`);

const pool = require(`../db`);

const calcGrowth = (current, previous) => {
  if (!previous || previous === 0) return 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
};

// ✅ Superadmin Dashboard Stats
const getDashboardStats = async () => {
  try {
    // Run all queries in parallel
    const [
      currTournaments,
      prevTournaments,
      allUsersLength,
      currUsers,
      prevUsers,
      currMatches,
      prevMatches,
      //   currRevenue,
      //   prevRevenue,
    ] = await Promise.all([
      // 🏆 Active tournaments (this month)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM tournaments
        WHERE state = 'in progress'
          AND created_at >= date_trunc('month', CURRENT_DATE);
      `),

      // 🏆 Active tournaments (last month)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM tournaments
        WHERE state = 'in progress'
          AND created_at >= date_trunc('month', CURRENT_DATE - interval '1 month')
          AND created_at < date_trunc('month', CURRENT_DATE);
      `),

      // 👥 Registered players
      pool.query(`
        SELECT COUNT(*) AS count
        FROM users
      `),

      // 👥 Registered players (this month)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE created_at >= date_trunc('month', CURRENT_DATE);
      `),

      // 👥 Registered players (last month)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE created_at >= date_trunc('month', CURRENT_DATE - interval '1 month')
          AND created_at < date_trunc('month', CURRENT_DATE);
      `),

      // 🎯 Matches (this week)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM matches
        WHERE created_at >= date_trunc('week', CURRENT_DATE);
      `),

      // 🎯 Matches (last week)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM matches
        WHERE created_at >= date_trunc('week', CURRENT_DATE - interval '1 week')
          AND created_at < date_trunc('week', CURRENT_DATE);
      `),

      // 💰 Revenue (this month)
      //   pool.query(`
      //     SELECT COALESCE(SUM(amount), 0) AS total
      //     FROM payments
      //     WHERE status = 'paid'
      //       AND paid_at >= date_trunc('month', CURRENT_DATE);
      //   `),

      //   // 💰 Revenue (last month)
      //   pool.query(`
      //     SELECT COALESCE(SUM(amount), 0) AS total
      //     FROM payments
      //     WHERE status = 'paid'
      //       AND paid_at >= date_trunc('month', CURRENT_DATE - interval '1 month')
      //       AND paid_at < date_trunc('month', CURRENT_DATE);
      //   `),
    ]);

    // ✅ Format the response
    return {
      activeTournaments: {
        value: parseInt(currTournaments.rows[0].count),
        growth: calcGrowth(
          parseInt(currTournaments.rows[0].count),
          parseInt(prevTournaments.rows[0].count)
        ),
        compareText: "from last month",
      },
      registeredPlayers: {
        value: parseInt(currUsers.rows[0].count),
        growth: calcGrowth(
          parseInt(currUsers.rows[0].count),
          parseInt(prevUsers.rows[0].count)
        ),
        compareText: "from last month",
        allUsersLength: parseInt(allUsersLength.rows[0].count),
      },
      matchesThisWeek: {
        value: parseInt(currMatches.rows[0].count),
        growth: calcGrowth(
          parseInt(currMatches.rows[0].count),
          parseInt(prevMatches.rows[0].count)
        ),
        compareText: "from last week",
      },
      //   revenueThisMonth: {
      //     value: parseFloat(currRevenue.rows[0].total),
      //     growth: calcGrowth(
      //       parseFloat(currRevenue.rows[0].total),
      //       parseFloat(prevRevenue.rows[0].total)
      //     ),
      //     compareText: "from last month",
      //   },
    };
  } catch (err) {
    console.error("Superadmin Dashboard service error:", err);
    throw new AppError(err, 500);
  }
};

const getAllTournaments = async (
  limit = 4,
  orderBy = "start_at",
  orderDir = "ASC"
) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.start_at,
        t.completed_at,
        t.participants_count,
        t.state,
        t.private,
        t.created_at,
        COALESCE(l.name, 'No locations') AS location_name
      FROM tournaments t
      LEFT JOIN locations l ON l.id = t.location_id
      ORDER BY 
        CASE 
          WHEN t.private = true THEN 3
          WHEN t.state = 'in progress' THEN 1
          WHEN t.state = 'pending' THEN 2
          WHEN t.state = 'completed' THEN 4
          ELSE 4
        END,
        t.${orderBy} ${orderDir}
      
    `;

    const res = await pool.query(query);
    return res.rows;
  } catch (err) {
    console.error("❌ Error fetching tournaments:", err);
    throw new AppError("Failed to fetch tournaments", 500);
  }
};

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const getHealthStatus = async () => {
  const status = {
    system: {},
    uptime: {},
    backup: {},
    security: {},
    resources: {},
  };

  try {
    // ✅ Check DB
    const dbStart = Date.now();
    await pool.query("SELECT 1");
    const dbLatency = Date.now() - dbStart;

    status.system = {
      label: "All systems operational",
      description: `Database OK (latency: ${dbLatency}ms)`,
      status: "ok",
    };

    // 🕓 Server uptime (os-level)
    const uptimeHours = (os.uptime() / 3600).toFixed(1);
    const uptimeDays = (os.uptime() / 86400).toFixed(2);

    status.uptime = {
      label: `Server uptime: ${uptimeDays} days`,
      description: `${uptimeHours} hours total`,
      status: "ok",
    };

    // 💾 Check latest backup file
    const backupDir = path.join(__dirname, "../../backups");
    let backupInfo = "No backups found";
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir);
      const recent = files
        .map((f) => ({
          name: f,
          time: fs.statSync(path.join(backupDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time)[0];
      if (recent) {
        backupInfo = `${timeAgo(new Date(recent.time))}`;
      }
    }

    status.backup = {
      label: "Database backup completed",
      description: backupInfo,
      status: backupInfo.includes("No backups") ? "error" : "ok",
    };

    // 🔒 Run local security audit
    let securityMessage = "No issues found";
    try {
      const auditOutput = execSync("npm audit --json", { encoding: "utf-8" });
      const parsed = JSON.parse(auditOutput);
      const totalVulns =
        parsed.metadata.vulnerabilities.high +
        parsed.metadata.vulnerabilities.critical;
      if (totalVulns > 0) {
        securityMessage = `${totalVulns} high/critical vulnerabilities`;
      }
    } catch (err) {
      securityMessage = "Audit failed (check npm)";
    }

    status.security = {
      label: "Security scan",
      description: securityMessage,
      status: securityMessage.includes("vulnerabilities") ? "warn" : "ok",
    };

    // 🧠 Resource stats
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    const load = os.loadavg()[0].toFixed(2);

    status.resources = {
      label: "System resources",
      description: `CPU Load: ${load} | Free RAM: ${freeMem}GB / ${totalMem}GB`,
      status: load > 2 ? "warn" : "ok",
    };

    return status;
  } catch (err) {
    throw new AppError(`System health check failed: ${err.message}`, 500);
  }
};

// Helper to format "time ago"
function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

module.exports = {
  getDashboardStats,
  getAllTournaments,
  getHealthStatus,
};
