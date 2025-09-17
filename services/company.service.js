const pool = require("../db");
const { updateAdmin } = require("./auth.service");

const getCompanyById = async (id) => {
  const result = await pool.query("SELECT * FROM companies WHERE id = $1", [
    id,
  ]);
  return result.rows[0];
};

const createCompany = async (adminId, companyData) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const insertQuery = `
      INSERT INTO companies (
        club_name,
        owner_name,
        address,
        phone_number,
        courts_number,
        created_at,
        updated_at,
        admin_id,
        latitude, 
        longitude, 
        country, 
        city
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [
      companyData.clubName,
      companyData.ownerName,
      companyData.address,
      companyData.phoneNumber,
      companyData.courtsNumber,
      adminId,
      companyData.latitude,
      companyData.longitude,
      companyData.country,
      companyData.city,
    ];

    const result = await client.query(insertQuery, values);

    await updateAdmin(
      adminId,
      {
        company_id: result.rows[0].id,
      },
      client
    );

    await client.query("COMMIT");

    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const updateCompany = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updateData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  const query = `
    UPDATE companies SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const getPublicCompanyById = async (id) => {
  const result = await pool.query(
    `
    SELECT 
      id,
      club_name,
      city,
      country,
      created_at,
      updated_at
    FROM companies
    WHERE id = $1
    `,
    [id]
  );

  if (!result.rows[0]) return null;

  return result.rows[0];
};

module.exports = {
  getCompanyById,
  createCompany,
  updateCompany,
  getPublicCompanyById
};
