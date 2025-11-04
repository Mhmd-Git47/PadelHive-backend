const { sendVerificationEmail, sendEmail } = require("./email.service");
const { AppError } = require("../utils/errors");

const pool = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { generateOtp, hashOtp, verifyOtp } = require("../utils/otp");
const {
  sendWelcomeEmail,
  sendPasswordResetSuccessEmail,
  sendPasswordResetOtpEmail,
} = require("../helpers/email.helper");
const { createActivityLog, getActorDetails } = require("./activityLog.service");

const registerAdmin = async (
  { username, password, role, companyId, locationId },
  userId
) => {
  try {
    const hashed = await bcrypt.hash(password, 10);

    // Ensure null is passed correctly (not "null" string)
    const normalizedCompanyId =
      companyId && companyId !== "null" ? companyId : null;

    const normalizedLocationId =
      locationId && locationId !== "null" ? locationId : null;

    const result = await pool.query(
      "INSERT INTO admins (username, password, role, company_id, location_id) VALUES ($1, $2, $3, $4, $5) RETURNING username, role, company_id, location_id",
      [username, hashed, role, normalizedCompanyId, normalizedLocationId]
    );

    const adm = result.rows[0];

    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: null,
      actor_name: "Superadmin",
      actor_role: "superadmin",
      action_type: "ADD_ADMIN",
      entity_id: adm.id,
      entity_type: "admin",
      description: `A new admin "${adm.username}" (role: ${adm.role}) was added by superadmin.`,
      status: "Success",
    });

    return result.rows[0];
  } catch (err) {
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: null,
      actor_name: "Superadmin",
      actor_role: "superadmin",
      action_type: "ADD_ADMIN_FAILED",
      entity_id: null,
      entity_type: "admin",
      description: `Registration of ${username} admin has failed. `,
      status: "Failed",
    });
    console.error(err.message);
    throw new AppError(`An error occured. ${err.message}`, 500);
  }
};

const loginAdmin = async ({ username, password }) => {
  const result = await pool.query("SELECT * FROM admins WHERE username = $1", [
    username,
  ]);
  const user = result.rows[0];
  if (!user) throw new AppError("Admin not found", 401);

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError("Invalid credentials", 401);

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      company_id: user.company_id || null,
      location_id: user.location_id || null,
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: "2h" }
  );
  return token;
};

const updateAdminBySuper = async (id, newUsername, newPassword) => {
  // 1️⃣ Check if admin exists
  const adminRes = await pool.query(`SELECT id FROM admins WHERE id = $1`, [
    id,
  ]);

  if (adminRes.rowCount === 0) {
    throw new AppError("Admin not found", 404);
  }

  // 2️⃣ Build dynamic query
  const fields = [];
  const values = [];
  let index = 1;

  if (newUsername) {
    fields.push(`username = $${index++}`);
    values.push(newUsername);
  }

  if (newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    fields.push(`password = $${index++}`);
    values.push(hashedPassword);
  }

  // 3️⃣ Prevent empty updates
  if (fields.length === 0) {
    throw new AppError("No fields to update", 400);
  }

  // 4️⃣ Add WHERE condition
  const query = `
    UPDATE admins
    SET ${fields.join(", ")}
    WHERE id = $${index}
    RETURNING id, username, role;
  `;
  values.push(id);

  // 5️⃣ Execute
  const result = await pool.query(query, values);
  return result.rows[0];
};

const updateAdmin = async (id, updatedData, clientt) => {
  const client = clientt || (await pool.connect());
  const isClientProvided = !!clientt;

  if (Object.keys(updatedData).length === 0) {
    throw new AppError(`No fields provided to update`, 401);
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
    throw new AppError("Error while updating admin", 500);
  } finally {
    if (!isClientProvided) {
      client.release();
    }
  }
};

const deleteAdmin = async (id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adminRes = await client.query(
      `SELECT id, username, location_id, company_id, role 
       FROM admins 
       WHERE id = $1`,
      [id]
    );

    if (adminRes.rowCount === 0) {
      throw new AppError("Admin not found", 404);
    }

    const admin = adminRes.rows[0];

    // === SUPERADMIN ===
    if (admin.role === "superadmin") {
      await client.query(`DELETE FROM admins WHERE id = $1`, [id]);
      console.log("✅ Superadmin deleted successfully");
    }

    // === COMPANY ADMIN ===
    else if (admin.role === "company_admin") {
      // 1️⃣ Get all related location IDs before deleting
      const locRes = await client.query(
        `SELECT id FROM locations WHERE company_id = $1`,
        [admin.company_id]
      );
      const locationIds = locRes.rows.map((l) => l.id);

      // 2️⃣ Nullify references from admins first
      await client.query(
        `UPDATE admins SET company_id = NULL, location_id = NULL WHERE company_id = $1`,
        [admin.company_id]
      );

      // 3️⃣ Delete locations linked to this company
      if (locationIds.length > 0) {
        await client.query(`DELETE FROM locations WHERE company_id = $1`, [
          admin.company_id,
        ]);
      }

      // 4️⃣ Delete the company
      await client.query(`DELETE FROM companies WHERE id = $1`, [
        admin.company_id,
      ]);

      // 5️⃣ Delete the admin
      await client.query(`DELETE FROM admins WHERE id = $1`, [id]);

      console.log("✅ Company admin, company, and locations deleted");
    }

    // === LOCATION ADMIN ===
    else if (admin.role === "location_admin") {
      if (admin.location_id) {
        const locationId = admin.location_id;

        // 1️⃣ Set foreign keys to NULL first
        await client.query(
          `UPDATE admins SET location_id = NULL, company_id = NULL WHERE id = $1`,
          [id]
        );

        // 2️⃣ Delete the location now that the reference is removed
        await client.query(`DELETE FROM locations WHERE id = $1`, [locationId]);
      }

      // 3️⃣ Finally delete the admin itself
      await client.query(`DELETE FROM admins WHERE id = $1`, [id]);
      console.log("✅ Location admin and location deleted");
    }

    // === UNKNOWN ROLE ===
    else {
      throw new AppError(`Unknown admin role: ${admin.role}`, 400);
    }

    await createActivityLog(
      {
        scope: "superadmin",
        company_id: null,
        actor_id: null,
        actor_name: "Superadmin",
        actor_role: "superadmin",
        action_type: "DELETE_ADMIN",
        entity_type: "admin",
        entity_id: null,
        description: `"${admin.username}" admin has been deleted.`,
        status: "Success",
      },
      client
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting admin:", err.message);
    throw err;
  } finally {
    client.release();
  }
};

// user

const OTP_TTL_MINUTES = parseInt(process.env.OTP_TTL_MINUTES) || 5;
const OTP_MAX_PER_HOUR = parseInt(process.env.OTP_MAX_PER_HOUR) || 2;
const OTP_WAIT_TIME_MINUTES = parseInt(process.env.OTP_WAIT_TIME_MINUTES) || 10;
const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";
const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "assets/images/users");

// verification via sms
const startRegistrationSms = async (payload) => {
  const { pending_id } = payload;

  const otp = generateOtp(4);
  const otp_hashed = await hashOtp(otp);
  const otp_expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const now = new Date();

  if (pending_id) {
    const r = await pool.query(
      "SELECT * FROM pending_registrations WHERE id = $1",
      [pending_id]
    );
    if (!r.rows.length)
      throw new AppError("Pending registration not found", 401);

    await pool.query(
      `UPDATE pending_registrations
       SET otp_hashed = $1,
           otp_expires_at = $2,
           otp_used = FALSE,
           otp_sent_count = COALESCE(otp_sent_count,0) + 1,
           otp_last_sent_at = $3
       WHERE id = $4`,
      [otp_hashed, otp_expires_at, now, pending_id]
    );

    const phone = `${r.rows[0].country_code || ""}${r.rows[0].phone_number}`;
    console.log("Verification code: ", otp);

    return { pending_id, message: "OTP sent via SMS" };
  }
};

const resendSmsOtp = async ({ pending_id }) => {
  if (!pending_id) throw new AppError("Missing pending_id", 401);

  const r = await pool.query(
    "SELECT * FROM pending_registrations WHERE id = $1",
    [pending_id]
  );
  if (!r.rows.length) throw new AppError("Pending registration not found", 401);

  const pending = r.rows[0];

  if (pending.phone_verified) throw new AppError("Phone already verified", 401);

  const now = new Date();
  const OTP_MAX_SENDS = 3;
  const OTP_WAIT_MINUTES = 10;

  let lastSent = pending.otp_last_sent_at
    ? new Date(pending.otp_last_sent_at)
    : null;
  let otpSentCount = pending.otp_sent_count || 0;

  // Reset counter if last send was > OTP_WAIT_MINUTES ago
  if (lastSent && now - lastSent > OTP_WAIT_MINUTES * 60 * 1000) {
    otpSentCount = 0;
  }

  if (otpSentCount >= OTP_MAX_SENDS) {
    throw new AppError(
      `Maximum OTP resend reached. Please wait ${OTP_WAIT_MINUTES} minutes before trying again.`,
      429
    );
  }

  // Generate OTP
  const otp = generateOtp(4);
  const otp_hashed = await hashOtp(otp);
  const otp_expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  otpSentCount += 1;

  await pool.query(
    `UPDATE pending_registrations
     SET otp_hashed = $1,
         otp_expires_at = $2,
         otp_sent_count = $3,
         otp_last_sent_at = $4,
         otp_used = FALSE
     WHERE id = $5`,
    [otp_hashed, otp_expires_at, otpSentCount, now, pending_id]
  );

  const phone = `${pending.country_code || ""}${pending.phone_number}`;
  console.log("Verification code: ", otp);

  return { message: "OTP resent successfully", pending_id };
};

const verifyRegistrationSms = async (pending_id, otp) => {
  // 1️⃣ Fetch pending registration
  const { rows } = await pool.query(
    "SELECT * FROM pending_registrations WHERE id = $1",
    [pending_id]
  );

  if (rows.length === 0)
    throw new AppError("Pending registration not found", 401);

  const pending = rows[0];

  if (pending.otp_used) throw new AppError("OTP already used", 401);
  if (new Date(pending.expires_at) < new Date())
    throw new AppError("Registration expired", 401);
  if (new Date(pending.otp_expires_at) < new Date())
    throw new AppError("OTP expired", 401);

  // 2️⃣ Verify OTP
  const isValid = await verifyOtp(otp, pending.otp_hashed);
  if (!isValid) throw new AppError("Invalid OTP", 401);

  // 3️⃣ Insert user into users table
  const result = await pool.query(
    `INSERT INTO users 
      (first_name, last_name, email, phone_number, country_code, password,
       nationality, date_of_birth, gender, address, image_url,
       elo_rate, category, display_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     RETURNING id, first_name, last_name, email, phone_number, image_url, display_name`,
    [
      pending.first_name,
      pending.last_name,
      pending.email,
      pending.phone_number,
      pending.country_code,
      pending.password_hash,
      pending.nationality,
      pending.date_of_birth,
      pending.gender,
      pending.address,
      pending.image_url,
      pending.elo_rate,
      pending.category,
      pending.display_name,
    ]
  );

  // 4️⃣ Delete the pending registration row
  await pool.query("DELETE FROM pending_registrations WHERE id = $1", [
    pending_id,
  ]);

  await sendWelcomeEmail(result.rows[0]);

  return result.rows[0];
};

const registerUserFromSuperAdm = async (
  {
    first_name,
    last_name,
    email,
    phone_number,
    gender,
    password,
    display_name,
    country_code,
    elo_rate,
    category,
  },
  userId
) => {
  const client = await pool.connect();

  try {
    // 1️⃣ Check for duplicates
    const checkQuery = `
      SELECT 
        CASE 
          WHEN email = $1 THEN 'email'
          WHEN display_name = $2 THEN 'display_name'
          WHEN phone_number = $3 THEN 'phone_number'
        END AS conflict_field
      FROM users
      WHERE email = $1 OR display_name = $2 OR phone_number = $3
    `;

    const checkRes = await client.query(checkQuery, [
      email,
      display_name,
      phone_number,
    ]);

    if (checkRes.rows.length > 0) {
      const conflicts = checkRes.rows.map((r) => r.conflict_field);
      const messages = [];
      if (conflicts.includes("email"))
        messages.push("Email already registered");
      if (conflicts.includes("display_name"))
        messages.push("Display Name already registered");
      if (conflicts.includes("phone_number"))
        messages.push("Phone Number already registered");

      throw new AppError(messages.join(", "), 400);
    }

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3️⃣ Insert new user
    const insertQuery = `
      INSERT INTO users (
        first_name, last_name, email, country_code, phone_number,
        gender, password, elo_rate, category, display_name, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      RETURNING id, email, display_name, category, first_name, last_name, phone_number, created_at
    `;

    const insertRes = await client.query(insertQuery, [
      first_name,
      last_name,
      email,
      country_code,
      phone_number,
      gender,
      hashedPassword,
      elo_rate,
      category,
      display_name,
    ]);

    const newUser = insertRes.rows[0];

    // 5️⃣ Create Activity Log
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: userId?.toString(),
      actor_name: "Superadmin",
      actor_role: "superadmin",
      action_type: "ADD_USER",
      entity_type: "user",
      entity_id: newUser.id?.toString(),
      description: `A new user "${newUser.display_name}" (${email}) was added by superadmin.`,
      status: "Success",
    });

    // 6️⃣ Emit WebSocket Event
    if (global.io) {
      global.io.to("users_room").emit("usersUpdated", {
        action: "create",
        user: newUser,
        message: `${newUser.display_name} has been added by superadmin`,
      });
    }

    return {
      message: "User successfully created",
      user: newUser,
    };
  } catch (err) {
    console.error("❌ Error creating user by superadmin:", err.message);

    // 🧩 Log failure as well
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: userId?.toString(),
      actor_name: "Superadmin",
      actor_role: "superadmin",
      action_type: "ADD_USER_FAILED",
      entity_type: "user",
      entity_id: null,
      description: `Failed to create user "${display_name}" (${email}): ${err.message}`,
      status: "Failed",
    });

    throw err;
  } finally {
    client.release();
  }
};

const registerUserFromAdm = async (
  { gender, display_name, elo_rate, category },
  userId,
  userRole
) => {
  const client = await pool.connect();

  try {
    // 🧩 Generate a fake system email
    const email = `${display_name
      .toLowerCase()
      .replace(/\s+/g, "")}@padelhive.fake`;

    // 1️⃣ Check for duplicates
    const checkQuery = `
      SELECT 
        CASE 
          WHEN email = $1 THEN 'email'
          WHEN display_name = $2 THEN 'display_name'
        END AS conflict_field
      FROM users
      WHERE email = $1 OR display_name = $2
    `;

    const checkRes = await client.query(checkQuery, [email, display_name]);

    if (checkRes.rows.length > 0) {
      const conflicts = checkRes.rows.map((r) => r.conflict_field);
      const messages = [];
      if (conflicts.includes("email"))
        messages.push("Email already registered");
      if (conflicts.includes("display_name"))
        messages.push("Display Name already registered");

      throw new AppError(messages.join(", "), 400);
    }

    // 2️⃣ Use a default hashed password ("padel123")
    const password = "padel123";
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3️⃣ Insert user (mark as fake)
    const insertQuery = `
      INSERT INTO users (
        email, gender, password, elo_rate, category, display_name,
        created_at, is_fake
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),TRUE)
      RETURNING id, email, display_name, category, created_at, is_fake
    `;

    const insertRes = await client.query(insertQuery, [
      email,
      gender,
      hashedPassword,
      elo_rate,
      category,
      display_name,
    ]);

    const newUser = insertRes.rows[0];

    // 4️⃣ Fetch the actor’s details (who created this user)
    const currentUser = await getActorDetails(userId, userRole);

    // 5️⃣ Log activity
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: userId.toString(),
      actor_name:
        currentUser?.name || currentUser?.club_name || "Unknown Admin",
      actor_role: userRole,
      entity_id: newUser.id.toString(),
      action_type: "ADD_DUMMY_USER",
      entity_type: "user",
      description: `A new dummy user "${newUser.display_name}" has been added.`,
      status: "Success",
    });

    // 6️⃣ Emit socket update
    if (global.io) {
      global.io.to("users_room").emit("usersUpdated", {
        action: "create",
        user: newUser,
        message: `${newUser.display_name} has been added by ${userRole}`,
      });
    }

    return {
      message: "User successfully created by admin",
      user: newUser,
    };
  } catch (err) {
    console.error("❌ Error registering user from admin:", err.message);

    // Optional: log failure
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: userId?.toString() ?? null,
      actor_name: "Unknown",
      actor_role: userRole,
      action_type: "ADD_DUMMY_USER_FAILED",
      entity_type: "user",
      description: `Failed to create dummy user "${display_name}": ${err.message}`,
      status: "Failed",
    });

    throw err;
  } finally {
    client.release();
  }
};

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
  country_code,
}) => {
  const client = await pool.connect();

  try {
    // 1️⃣ Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new AppError(passwordValidation.reasons.join(", "), 400);
    }

    // 2️⃣ Check for existing email / username / phone
    const errors = [];

    const checkQueries = [
      client.query("SELECT 1 FROM users WHERE email = $1", [email]),
      client.query("SELECT 1 FROM users WHERE display_name = $1", [
        display_name,
      ]),
      client.query("SELECT 1 FROM users WHERE phone_number = $1", [
        phone_number,
      ]),
    ];

    const [existingEmail, existingDisplayName, existingPhone] =
      await Promise.all(checkQueries);

    if (existingEmail.rowCount > 0) errors.push("Email already registered");
    if (existingDisplayName.rowCount > 0)
      errors.push("Display Name already registered");
    if (existingPhone.rowCount > 0)
      errors.push("Phone Number already registered");

    if (errors.length > 0) {
      throw new AppError(errors.join(", "), 400);
    }

    // 3️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Generate JWT verification token
    const token = jwt.sign(
      {
        first_name,
        last_name,
        email,
        display_name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const token_expires_at = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // 5️⃣ Insert pending registration
    const insert = await client.query(
      `
      INSERT INTO pending_registrations (
        first_name, last_name, email, country_code, phone_number,
        nationality, date_of_birth, gender, address, image_url,
        password_hash, elo_rate, category, display_name,
        created_at, expires_at,
        email_token, email_token_expires_at, email_sent_count
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,NOW(),
        $15,$16,$17,1
      )
      RETURNING id
      `,
      [
        first_name,
        last_name,
        email,
        country_code,
        phone_number,
        nationality,
        date_of_birth,
        gender,
        address,
        image_url,
        hashedPassword,
        elo_rate,
        category,
        display_name,
        new Date(Date.now() + 24 * 60 * 60 * 1000), // expires in 24h
        token,
        token_expires_at,
      ]
    );

    const pending_id = insert.rows[0].id;

    // 6️⃣ Send verification email
    await sendVerificationEmail(email, token, display_name);

    // 7️⃣ Log activity
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: pending_id.toString(),
      actor_name: display_name,
      actor_role: "user",
      action_type: "SENT_REGISTRATION_EMAIL",
      entity_type: "user",
      entity_id: pending_id.toString(),
      description: `Verification email sent to ${email}. Awaiting verification.`,
      status: "Success",
    });

    return {
      message: "Verification email sent. Please verify your email.",
      pending_id,
    };
  } catch (err) {
    console.error("❌ Error registering user:", err.message);

    // ✅ Log failure separately (optional)
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: null,
      actor_name: display_name || email,
      actor_role: "user",
      action_type: "SENT_REGISTRATION_EMAIL_FAILED",
      entity_type: "user",
      description: `Failed to send verification email to ${email}: ${err.message}`,
      status: "Failed",
    });

    throw err;
  } finally {
    client.release();
  }
};

//validate password on registration
const validatePassword = (password) => {
  const errors = [];
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumeric = /[0-9]/.test(password);
  const isMinLength = password.length >= 8;

  if (!hasLowercase) {
    errors.push("Password must contain at least one lowercase letter.");
  }
  if (!hasUppercase) {
    errors.push("Password must contain at least one uppercase letter.");
  }
  if (!hasNumeric) {
    errors.push("Password must contain at least one numeric digit.");
  }
  if (!isMinLength) {
    errors.push("Password must be a minimum of 8 characters.");
  }

  return {
    isValid: errors.length === 0,
    reasons: errors,
  };
};

// Helper to generate token
function generateEmailToken(userData) {
  return jwt.sign(
    {
      email: userData.email,
      display_name: userData.display_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

const resendEmailVerification = async ({ pending_id, email }) => {
  let pending;

  // 0. Check if user is already registered
  if (email) {
    const rUser = await pool.query(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);
    if (rUser.rows.length) {
      throw new AppError("User with this email is already registered.", 409);
    }
  }

  // 1. Fetch pending registration
  if (pending_id) {
    const r = await pool.query(
      `SELECT * FROM pending_registrations WHERE id = $1`,
      [pending_id]
    );
    if (!r.rows.length)
      throw new AppError(`Pending registration not found`, 401);
    pending = r.rows[0];
  } else if (email) {
    const r = await pool.query(
      `SELECT * FROM pending_registrations WHERE email = $1`,
      [email]
    );
    if (!r.rows.length)
      throw new AppError(`Pending registration not found`, 401);
    pending = r.rows[0];
  } else {
    throw new AppError("Missing pending_id or email", 401);
  }

  // 2. Stop if already verified
  if (pending.email_verified) {
    throw new AppError("Email is already verified.", 409);
  }

  // 3. Rate limiting — max 3 per hour
  const now = new Date();
  if (pending.email_token_expires_at) {
    const lastSentAt = new Date(
      pending.email_token_expires_at.getTime() - 60 * 60 * 1000
    );

    const diffMs = now - lastSentAt;
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs < 1 && pending.email_sent_count >= 3) {
      throw new AppError(
        "Too many resend attempts. Please try again later.",
        429
      );
    }
  }

  // 4. Generate a new token valid for 1 hour
  const token = generateEmailToken(pending);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  // 5. Increment counter
  const newSentCount =
    pending.email_token_expires_at &&
    now - new Date(pending.email_token_expires_at) > 60 * 60 * 1000
      ? 1 // reset if last token expired > 1h ago
      : (pending.email_sent_count || 0) + 1;

  await pool.query(
    `UPDATE pending_registrations
     SET email_token = $1,
         email_token_expires_at = $2,
         email_sent_count = $3
     WHERE id = $4`,
    [token, expiresAt, newSentCount, pending.id]
  );

  // 6. Send the email
  await sendVerificationEmail(pending.email, token, pending.display_name);

  return { message: "Verification email resent successfully." };
};

const loginUser = async ({ identifier, password }) => {
  if (!identifier) throw new AppError("Identifier is required", 400);

  const firstChar = identifier[0];
  const rest = identifier.slice(1);

  const result = await pool.query(
    `
    SELECT *
    FROM users
    WHERE email = $1
       OR (
          LEFT(display_name, 1) ILIKE $2
          AND SUBSTRING(display_name FROM 2) = $3
       )
    LIMIT 1
    `,
    [identifier, firstChar, rest]
  );

  const user = result.rows[0];

  if (!user) {
    throw new AppError("Invalid identifier or password!", 401);
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    throw new AppError("Invalid credentials", 401);
  }

  const token = jwt.sign(
    { id: user.id, role: "user" },
    process.env.JWT_SECRET,
    { expiresIn: "4h" }
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

// email verification
const verifyAndInsertUser = async (token) => {
  const client = await pool.connect();
  let newUser = null;

  try {
    // 1️⃣ Verify JWT
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      throw new AppError("Invalid or expired token", 401);
    }

    // 2️⃣ Validate pending registration
    const pendingRes = await client.query(
      `
      SELECT * FROM pending_registrations
      WHERE email = $1 AND email_token = $2
      `,
      [payload.email, token]
    );

    if (pendingRes.rowCount === 0) {
      throw new AppError(
        "Invalid or expired token or no pending registration",
        401
      );
    }

    const pending = pendingRes.rows[0];

    // Check if token expired
    if (
      pending.email_token_expires_at &&
      new Date(pending.email_token_expires_at) < new Date()
    ) {
      throw new AppError("Verification token expired", 401);
    }

    // Check if already verified
    const existingUser = await client.query(
      "SELECT 1 FROM users WHERE email = $1",
      [payload.email]
    );
    if (existingUser.rowCount > 0) {
      throw new AppError("Email already verified", 401);
    }

    // 3️⃣ Begin transaction
    await client.query("BEGIN");

    // 4️⃣ Insert into users
    const insertRes = await client.query(
      `
      INSERT INTO users (
        first_name, last_name, email, phone_number, country_code, nationality,
        date_of_birth, gender, address, image_url, password, elo_rate,
        category, display_name, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING id, email, display_name, category, first_name, last_name, phone_number, created_at
      `,
      [
        pending.first_name,
        pending.last_name,
        pending.email,
        pending.phone_number,
        pending.country_code,
        pending.nationality,
        pending.date_of_birth,
        pending.gender,
        pending.address,
        pending.image_url,
        pending.password_hash,
        pending.elo_rate,
        pending.category,
        pending.display_name,
      ]
    );

    const newUser = insertRes.rows[0];

    // 5️⃣ Remove from pending table
    await client.query("DELETE FROM pending_registrations WHERE id = $1", [
      pending.id,
    ]);

    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: newUser.id,
      actor_name: newUser.display_name,
      actor_role: "user",
      action_type: "ADD_USER",
      entity_type: "user",
      description: `New user has been created: ${newUser.display_name}`,
      status: "Success",
    });

    // 6️⃣ Commit transaction
    await client.query("COMMIT");

    // 7️⃣ Emit WebSocket events after commit
    if (global.io) {
      // Notify the email verification watcher
      global.io.to(`verify_${newUser.email}`).emit("emailVerified", {
        email: newUser.email,
        message: "Email verified successfully",
      });

      // Notify dashboards / user lists
      global.io.to("users_room").emit("usersUpdated", {
        action: "create",
        user: newUser,
        message: `${newUser.display_name} has been added.`,
      });
    }

    // 8️⃣ Send welcome email
    await sendWelcomeEmail({
      display_name: newUser.display_name,
      email: newUser.email,
    });

    return newUser;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error verifying user:", err.message);
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: newUser?.id ?? null,
      actor_name: newUser?.display_name ?? "System",
      actor_role: "user",
      action_type: "ADD_USER_FAILED",
      entity_type: "user",
      description: `Failed creating new user ${
        newUser?.display_name ?? "Unknown"
      }: ${err.message}`,
      status: "Failed",
    });
    throw err;
  } finally {
    client.release();
  }
};

const getUsers = async () => {
  const result =
    await pool.query(`SELECT id, email, first_name, last_name,  gender, image_url,  created_at, elo_rate, display_name, category, rank
     FROM users WHERE is_fake = false`);
  return result.rows;
};

const getUsersForSuperAdm = async () => {
  const result =
    await pool.query(`SELECT id, email, first_name, last_name, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, display_name, category, rank
     FROM users`);
  return result.rows;
};

const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT id, email, first_name, last_name, category, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, user_status, display_name, rank 
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError("Invalid email or password", 404);
  }

  return result.rows[0];
};

const getUserViewById = async (userId) => {
  const result = await pool.query(
    `SELECT id, first_name, last_name, category, gender, image_url, elo_rate, display_name, rank 
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError("Invalid email or password", 404);
  }

  return result.rows[0];
};

const updateUser = async (userId, userData) => {
  const client = await pool.connect();

  try {
    // Step 1: Get current image from DB
    const currentResult = await client.query(
      `SELECT image_url FROM users WHERE id = $1`,
      [userId]
    );

    if (currentResult.rows.length === 0) {
      throw new AppError("Invalid email or password", 404);
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
      throw new AppError("User not updated", 401);
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
    if (err instanceof AppError) throw err; // preserve intentional errors
    console.log(err);
    throw new AppError("Error while updating user", 500);
  } finally {
    client.release();
  }
};

const lookupUser = async (identifier) => {
  if (!identifier) return null;
  const firstChar = identifier[0];
  const rest = identifier.slice(1);

  const result = await pool.query(
    `
      SELECT id, email, display_name, elo_rate
      FROM users
      WHERE email = $1
         OR (
            LEFT(display_name, 1) ILIKE $2
            AND SUBSTRING(display_name FROM 2) = $3
         )
      LIMIT 1
    `,
    [identifier, firstChar, rest]
  );

  return result.rows[0];
};

const deleteUser = async (targetUserId, actorId, actorRole) => {
  const client = await pool.connect();

  try {
    // 1️⃣ Fetch target user before deletion (for logging info)
    const userRes = await client.query(
      `SELECT id, display_name, email FROM users WHERE id = $1`,
      [targetUserId]
    );

    if (userRes.rowCount === 0) {
      throw new AppError("User not found", 404);
    }

    const targetUser = userRes.rows[0];

    // 2️⃣ Perform deletion
    const result = await client.query(`DELETE FROM users WHERE id = $1`, [
      targetUserId,
    ]);
    const deleted = result.rowCount > 0;

    // 4️⃣ Log deletion success
    await createActivityLog({
      scope: "superadmin",
      actor_id: actorId?.toString(),
      actor_name: "Unknown Admin, can be the user",
      actor_role: actorRole,
      action_type: "DELETE_USER",
      entity_type: "user",
      entity_id: targetUserId?.toString(),
      description: `User "${targetUser.display_name}" (${targetUser.email}) was deleted.`,
      status: deleted ? "Success" : "Failed",
    });

    return deleted;
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);

    // 5️⃣ Log deletion failure
    await createActivityLog({
      scope: actorRole === "superadmin" ? "superadmin" : "company",
      company_id: null,
      actor_id: actorId?.toString(),
      actor_name: "System",
      actor_role: actorRole,
      action_type: "DELETE_USER_FAILED",
      entity_type: "user",
      entity_id: targetUserId?.toString(),
      description: `Failed to delete user (ID: ${targetUserId}): ${err.message}`,
      status: "Failed",
    });

    throw err;
  } finally {
    client.release();
  }
};

const forgotPasswordOtp = async (email) => {
  const MAX_OTP_PER_HOUR = OTP_MAX_PER_HOUR;
  const WAIT_TIME_MINUTES = OTP_WAIT_TIME_MINUTES;

  // 1️⃣ Fetch user
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  const user = result.rows[0];
  if (!user) throw new AppError("Invalid email or password", 404);

  const now = new Date();
  const lastSent = user.otp_last_sent;
  const count = user.otp_send_count || 0;

  // 2️⃣ Check rate limit
  if (lastSent) {
    const diffMinutes = (now - new Date(lastSent)) / (1000 * 60);
    if (diffMinutes < WAIT_TIME_MINUTES && count >= MAX_OTP_PER_HOUR) {
      throw new AppError(
        `Please wait ${WAIT_TIME_MINUTES} minutes before requesting another OTP.`,
        429
      );
    } else if (diffMinutes >= WAIT_TIME_MINUTES) {
      // Reset counter after waiting period
      await pool.query("UPDATE users SET otp_send_count=0 WHERE id=$1", [
        user.id,
      ]);
    }
  }

  // 3️⃣ Generate 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // 4️⃣ Update user with OTP and count
  await pool.query(
    "UPDATE users SET reset_otp=$1, reset_otp_expiry=$2, otp_last_sent=NOW(), otp_send_count=otp_send_count+1 WHERE id=$3",
    [otp, expiry, user.id]
  );

  // 5️⃣ Send OTP email
  await sendPasswordResetOtpEmail(email, otp);

  return { message: "OTP sent to your email." };
};

const resetPasswordWithOtp = async ({ email, otp, newPassword }) => {
  // 1️⃣ Fetch user by email
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  const user = result.rows[0];
  if (!user) throw new AppError("Invalid email or password", 404);

  // 2️⃣ Verify OTP
  if (!user.reset_otp || user.reset_otp !== otp)
    throw new AppError("Invalid OTP", 401);

  // 3️⃣ Check OTP expiry
  if (new Date(user.reset_otp_expiry) < new Date())
    throw new AppError("OTP expired", 401);

  // 4️⃣ Hash new password
  const hashed = await bcrypt.hash(newPassword, 10);

  // 5️⃣ Update user password and clear OTP fields
  await pool.query(
    "UPDATE users SET password = $1, reset_otp = NULL, reset_otp_expiry = NULL WHERE id = $2",
    [hashed, user.id]
  );

  // 6️⃣ Send password reset success email
  try {
    await sendPasswordResetSuccessEmail({
      name: user.display_name,
      email: user.email,
    });
  } catch (err) {
    console.error("Error sending password reset email:", err);
  }

  return { message: "Password reset successful" };
};

// change display name
// 1st verify password if correct
const verifyPassword = async (identifier, password, userId) => {
  if (!identifier || !password) return { isVerified: false };

  // 1️⃣ Get current logged-in user
  const { rows, rowCount } = await pool.query(
    `SELECT id, email, display_name, password FROM users WHERE id = $1`,
    [userId]
  );

  if (rowCount === 0) {
    throw new AppError(
      "Your session may have expired. Please log in again to continue.",
      401
    );
  }

  const currentUser = rows[0];
  const { email, display_name } = currentUser;

  // 2️⃣ Validate identifier ownership
  if (identifier !== email && identifier !== display_name) {
    throw new AppError("You can only verify your own credentials.", 403);
  }

  // 3️⃣ Split for comparison logic
  const firstChar = display_name[0];
  const rest = display_name.slice(1);

  // 4️⃣ Match the logged-in user directly (no need to re-query other users)
  // const firstLetterMatches =
  //   identifier[0].toLowerCase() === firstChar.toLowerCase();
  // const restMatches = identifier.slice(1) === rest;

  // if (!firstLetterMatches || !restMatches) {
  //   console.log("ddd");
  //   return { isVerified: false };
  // }

  // 5️⃣ Check password hash
  const valid = await bcrypt.compare(password, currentUser.password);

  return { isVerified: valid, userId: valid ? userId : null };
};

// 2nd change display name
const changeDisplayName = async (userId, newDisplayName) => {
  // 1️⃣ Validate format
  const nameRegex = /^[A-Za-z0-9_]{3,20}$/;
  if (!nameRegex.test(newDisplayName)) {
    throw new AppError(
      "Display name must be 3–20 characters long and contain only letters, numbers, or underscores.",
      400
    );
  }

  // 2️⃣ Ensure user exists
  const userCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
    userId,
  ]);
  if (userCheck.rowCount === 0) {
    throw new AppError(
      "Your session may have expired. Please log in again.",
      401
    );
  }

  // 3️⃣ Ensure display name is unique (case-insensitive)
  const duplicateCheck = await pool.query(
    `SELECT id FROM users WHERE LOWER(display_name) = LOWER($1) AND id != $2`,
    [newDisplayName, userId]
  );

  if (duplicateCheck.rowCount > 0) {
    throw new AppError("This display name is already taken.", 409);
  }

  // 4️⃣ Update display name
  const updateResult = await pool.query(
    `UPDATE users SET display_name = $1 WHERE id = $2 RETURNING id, display_name`,
    [newDisplayName, userId]
  );

  return updateResult.rows[0];
};

const changePhoneNumber = async (userId, countryCode, phoneNumber) => {
  // 1️⃣ Validate input existence
  if (!countryCode || !phoneNumber) {
    throw new AppError("Country code and phone number are required.", 400);
  }

  // 2️⃣ Validate phone number format — numbers only, 6–15 digits (international safe range)
  const phoneRegex = /^[0-9]{6,15}$/;
  if (!phoneRegex.test(phoneNumber)) {
    throw new AppError(
      "Invalid phone number format. It must contain 6–15 digits only.",
      400
    );
  }

  // 3️⃣ Ensure user exists
  const userCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
    userId,
  ]);
  if (userCheck.rowCount === 0) {
    throw new AppError(
      "Your session may have expired. Please log in again.",
      401
    );
  }

  // 4️⃣ Ensure phone number is unique (global uniqueness)
  const duplicateCheck = await pool.query(
    `SELECT id FROM users WHERE country_code = $1 AND phone_number = $2 AND id != $3`,
    [countryCode, phoneNumber, userId]
  );

  if (duplicateCheck.rowCount > 0) {
    throw new AppError("This phone number is already registered.", 409);
  }

  // 5️⃣ Update phone info
  const updateResult = await pool.query(
    `UPDATE users 
     SET country_code = $1, phone_number = $2
     WHERE id = $3 
     RETURNING id, country_code, phone_number`,
    [countryCode, phoneNumber, userId]
  );

  return updateResult.rows[0];
};

const changePassword = async (oldPassword, newPassword, userId) => {
  // 1️⃣ Input validation
  if (!oldPassword || !newPassword) {
    throw new AppError("Password is required.", 400);
  }

  // 2️⃣ Fetch user
  const userRes = await pool.query(
    `SELECT id, password FROM users WHERE id = $1`,
    [userId]
  );

  if (userRes.rowCount === 0) {
    throw new AppError(
      "Your session may have expired. Please log in again.",
      401
    );
  }

  const user = userRes.rows[0];

  // 3️⃣ Compare passwords
  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    throw new AppError("Incorrect current password.", 401);
  }

  // 4️⃣ Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // 5️⃣ Update password
  await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [
    hashedPassword,
    user.id,
  ]);

  // 6️⃣ Optional: log the change or return confirmation
  return { message: "Password updated successfully." };
};

module.exports = {
  registerAdmin,
  loginAdmin,
  updateAdmin,
  updateAdminBySuper,
  registerUserFromSuperAdm,
  registerUserFromAdm,
  registerUser,
  deleteAdmin,
  loginUser,
  verifyAndInsertUser,
  getUserById,
  updateUser,
  lookupUser,
  deleteUser,
  getUsers,
  getUsersForSuperAdm,
  forgotPasswordOtp,
  resetPasswordWithOtp,
  startRegistrationSms,
  verifyRegistrationSms,
  resendEmailVerification,
  resendSmsOtp,
  getUserViewById,
  verifyPassword,
  changeDisplayName,
  changePhoneNumber,
  changePassword,
};
