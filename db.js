// const { Pool } = require("pg");

// const pool = new Pool({
//   // user: process.env.PGUSER,
//   // host: process.env.PGHOST,
//   // database: process.env.PGDATABASE,
//   // password: process.env.PGPASSWORD || "",
//   // port: Number(process.env.PGPORT),
//   connectionString: process.env.DATABASE_URL,
//   ssl: {
//     rejectUnauthorized: false,
//   },
// });

// module.exports = pool;

require("dotenv").config();
const { Pool } = require("pg");

console.log("✅ Creating DB pool with DATABASE_URL...");
console.log("DB URL:", process.env.DATABASE_URL); // You can remove this later

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  
});

// Optional: test connection immediately
pool
  .query("SELECT NOW()")
  .then((res) => {
    console.log("✅ DB connected successfully:", res.rows[0]);
  })
  .catch((err) => {
    console.error("❌ DB connection error:", err.message);
  });

module.exports = pool;
