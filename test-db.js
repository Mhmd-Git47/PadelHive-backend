const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'padel_user',
  password: 'securepassword',
  database: 'padel_db',
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error(err);
  else console.log('Server time:', res.rows[0]);
  pool.end();
});
