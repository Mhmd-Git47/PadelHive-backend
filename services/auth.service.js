const { sendVerificationEmail } = require("./email.service");

const pool = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const registerAdmin = async ({
  username,
  password,
  role,
  company_id = null,
}) => {
  const hashed = await bcrypt.hash(password, 10);
  const result = await pool.query(
    "INSERT INTO admins (username, password, role, company_id) VALUES ($1, $2, $3, $4) RETURNING *",
    [username, hashed, role || "superadmin", company_id]
  );
  return result.rows[0];
};

const loginAdmin = async ({ username, password }) => {
  const result = await pool.query("SELECT * FROM admins WHERE username = $1", [
    username,
  ]);
  const user = result.rows[0];
  if (!user) throw new Error("Admin not found");

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error("Invalid credentials");

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role ?? "admin",
      company_id: user.company_id || null,
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: "1h" }
  );
  console.log(`token: `, token);
  return token;
};

const updateAdmin = async (id, updatedData, clientt) => {
  const client = clientt || (await pool.connect());
  const isClientProvided = !!clientt;

  if (Object.keys(updatedData).length === 0) {
    throw new Error(`No fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updatedData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  // Add updated_at
  fields.push(`updated_at = NOW()`);

  // Add id to values for WHERE clause
  values.push(id);

  const query = `
    UPDATE admins
    SET ${fields.join(", ")}
    WHERE id = $${idx}
    RETURNING *;
  `;

  try {
    await client.query("BEGIN");
    const result = await client.query(query, values);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    if (!isClientProvided) {
      client.release();
    }
  }
};

// user

const registerUser = async ({
  first_name,
  last_name,
  email,
  phone_number,
  nationality,
  date_of_birth,
  gender,
  address,
  image_url,
  password,
  category,
  elo_rate,
  display_name,
}) => {
  // 1. Check if email already registered
  const existing = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  if (existing.rows.length > 0) {
    throw new Error("Email already registered");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // 2. Generate verification token (JWT with email and other user data if you want)
  const token = jwt.sign(
    {
      first_name,
      last_name,
      email,
      phone_number,
      nationality,
      date_of_birth,
      gender,
      address,
      image_url,
      hashedPassword,
      category,
      elo_rate,
      display_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 3. Send verification email with token
  await sendVerificationEmail(email, token);

  // 4. Return message — user not inserted yet
  return { message: "Verification email sent. Please verify your email." };
};

const loginUser = async ({ email, password }) => {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  const user = result.rows[0];

  if (!user) {
    throw new Error("User not found!");
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    throw new Error("Invalid credentials");
  }

  const token = jwt.sign(
    { id: user.id, role: "user" },
    process.env.JWT_SECRET,
    {
      expiresIn: "2h",
    }
  );

  return {
    token,
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      display_name: user.display_name,
      email: user.email,
      phone_number: user.phone_number,
    },
  };
};

const verifyAndInsertUser = async (token) => {
  let userData;
  try {
    userData = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new Error("Invalid or expired token");
  }

  const existing = await pool.query("SELECT * FROM users WHERE email = $1", [
    userData.email,
  ]);
  if (existing.rows.length > 0) {
    throw new Error("Email already verified");
  }

  const result = await pool.query(
    `INSERT INTO users (
      first_name, last_name, email, phone_number, nationality,
      date_of_birth, gender, address, image_url, password, elo_rate, category, display_name
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11, $12, $13) RETURNING id, email`,
    [
      userData.first_name,
      userData.last_name,
      userData.email,
      userData.phone_number,
      userData.nationality,
      userData.date_of_birth,
      userData.gender,
      userData.address,
      userData.image_url,
      userData.hashedPassword,
      userData.elo_rate ?? 1000,
      userData.category ?? "D",
      userData.display_name,
    ]
  );

  return result.rows[0];
};

const getUsers = async () => {
  const result =
    await pool.query(`SELECT id, email, first_name, last_name, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, user_status, display_name, category 
     FROM users`);
  return result.rows;
};

const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT id, email, first_name, last_name, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, user_status, display_name 
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("User not found");
  }

  return result.rows[0];
};

const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "images/users");

const updateUser = async (userId, userData) => {
  const client = await pool.connect();

  try {
    // Step 1: Get current image from DB
    const currentResult = await client.query(
      `SELECT image_url FROM users WHERE id = $1`,
      [userId]
    );

    if (currentResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const currentImage = currentResult.rows[0].image_url;

    // Step 2: Build update dynamically
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, rawValue] of Object.entries(userData)) {
      if (rawValue === undefined) continue;

      const column = (() => {
        switch (key) {
          case "firstName":
            return "first_name";
          case "lastName":
            return "last_name";
          case "phoneNumber":
            return "phone_number";
          case "dateOfBirth":
            return "date_of_birth";
          case "imageName":
            return "image_url";
          default:
            return key;
        }
      })();

      const value =
        column === "date_of_birth" && rawValue ? new Date(rawValue) : rawValue;

      fields.push(`${column} = $${idx}`);
      values.push(value);
      idx++;
    }

    // Always update updated_at
    fields.push(`updated_at = NOW()`);

    const query = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;

    values.push(userId);

    // Step 3: Run the update
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      throw new Error("User not updated");
    }

    const updatedUser = result.rows[0];

    // Step 4: Delete old image if necessary
    if (
      userData.imageName &&
      currentImage &&
      currentImage !== userData.imageName
    ) {
      const oldImagePath = path.join(IMAGE_UPLOAD_PATH, currentImage);
      fs.unlink(oldImagePath, (err) => {
        if (err) {
          console.error("Failed to delete old image:", err.message);
        } else {
          console.log("Old image deleted:", oldImagePath);
        }
      });
    }

    return updatedUser;
  } catch (err) {
    throw err;
  } finally {
    client.release();
  }
};

const lookupUser = async (identifier) => {
  const result = await pool.query(
    `
      SELECT id, email, display_name FROM users WHERE email = $1 OR display_name = $1 LIMIT 1
    `,
    [identifier]
  );

  return result.rows[0];
};

const deleteUser = async (userId) => {
  const result = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  return result.rowCount > 0;
};

module.exports = {
  registerAdmin,
  loginAdmin,
  updateAdmin,
  registerUser,
  loginUser,
  verifyAndInsertUser,
  getUserById,
  updateUser,
  lookupUser,
  deleteUser,
  getUsers,
};
