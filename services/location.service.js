const pool = require("../db");
const { AppError } = require("../utils/errors");
const { createActivityLog } = require("./activityLog.service");

// Create a new location
const createLocation = async (companyId, locationData) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO locations 
       (name, company_id, address, city, country, created_at, updated_at, longitude, latitude)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7)
       RETURNING *`,
      [
        locationData.name,
        companyId,
        locationData.address,
        locationData.city,
        locationData.country,
        locationData.longitude,
        locationData.latitude,
      ]
    );

    const location = result.rows[0];

    await createActivityLog(
      {
        scope: "superadmin",
        company_id: null,
        actor_id: null,
        actor_name: "Superadmin",
        actor_role: "superadmin",
        action_type: "ADD_LOCATION",
        entity_id: location.id,
        entity_type: "location",
        description: `A new location "${location.name}" was added by Superadmin.`,
        status: "Success",
      },
      client
    );

    await client.query("COMMIT");

    return location;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating location:", err);
    throw new AppError(`Failed to create location: ${err.message}`, 500);
  } finally {
    client.release();
  }
};

// Get all locations (optionally filter by company)
const getLocations = async (companyId = null) => {
  let query = "SELECT * FROM locations";
  const values = [];

  if (companyId) {
    query += " WHERE company_id = $1";
    values.push(companyId);
  }

  const result = await pool.query(query, values);
  return result.rows;
};

// Get a location by ID
const getLocationById = async (id) => {
  if (!id) {
    throw new Error("Location ID is required");
  }
  const result = await pool.query("SELECT * FROM locations WHERE id = $1", [
    id,
  ]);
  if (result.rows.length === 0) throw new AppError("Location not found", 404);
  return result.rows[0];
};

// Update location
const updateLocation = async (id, updateData) => {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updateData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const query = `UPDATE locations SET ${fields.join(
    ", "
  )} WHERE id = $${idx} RETURNING *`;
  const result = await pool.query(query, values);

  if (result.rows.length === 0) throw new AppError("Location not updated", 404);
  return result.rows[0];
};

// Delete location
const deleteLocation = async (id) => {
  const result = await pool.query("DELETE FROM locations WHERE id = $1", [id]);
  if (result.rowCount === 0) throw new AppError("Location not found", 404);
  return true;
};

const getAllCities = async () => {
  const result = await pool.query(`
    SELECT DISTINCT city FROM locations WHERE city IS NOT NULL ORDER BY city ASC`);
  return result.rows;
};

module.exports = {
  createLocation,
  getLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
  getAllCities,
};
