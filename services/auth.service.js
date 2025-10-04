const { sendVerificationEmail, sendEmail } = require("./email.service");
const { AppError } = require("../utils/errors");

const pool = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { generateOtp, hashOtp, verifyOtp } = require("../utils/otp");
const sharp = require("sharp");
const { sendSms } = require("../services/twilio.service");
const {
  sendWelcomeEmail,
  sendPasswordResetSuccessEmail,
  sendPasswordResetOtpEmail,
} = require("../helpers/email.helper");

const registerAdmin = async ({
  username,
  password,
  role,
  companyId,
  locationId,
}) => {
  const hashed = await bcrypt.hash(password, 10);

  // Ensure null is passed correctly (not "null" string)
  const normalizedCompanyId =
    companyId && companyId !== "null" ? companyId : null;

  const normalizedLocationId =
    locationId && locationId !== "null" ? locationId : null;

  const result = await pool.query(
    "INSERT INTO admins (username, password, role, company_id, location_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [username, hashed, role, normalizedCompanyId, normalizedLocationId]
  );

  return result.rows[0];
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
    { expiresIn: "1h" }
  );
  return token;
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
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    throw new AppError(passwordValidation.reasons.join(", "), 400);
  }

  // 1. Check if email, display_name, phone already exist
  const errors = [];

  const existingEmail = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  if (existingEmail.rows.length > 0) errors.push("Email already registered");

  const existingDisplayName = await pool.query(
    "SELECT * FROM users WHERE display_name = $1",
    [display_name]
  );
  if (existingDisplayName.rows.length > 0)
    errors.push("Display Name already registered");

  const existingPhoneNumber = await pool.query(
    "SELECT * FROM users WHERE phone_number = $1",
    [phone_number]
  );
  if (existingPhoneNumber.rows.length > 0)
    errors.push("Phone Number already registered");

  if (errors.length > 0) {
    throw new AppError(errors.join(", "), 400);
  }
  // 2. Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // 3. Generate verification token
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
      category,
      elo_rate,
      display_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // Define token expiration for DB
  const token_expires_at = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // 4. Insert into pending_registrations
  const insert = await pool.query(
    `INSERT INTO pending_registrations
      (first_name, last_name, email, country_code, phone_number,
       nationality, date_of_birth, gender, address, image_url,
       password_hash, elo_rate, category, display_name,
       created_at, expires_at,
       email_token, email_token_expires_at, email_sent_count)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$17,1)
     RETURNING id`,
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
      new Date(Date.now() + 24 * 60 * 60 * 1000), // pending expires in 24h
      token,
      token_expires_at,
    ]
  );

  const pending_id = insert.rows[0].id;

  // 5. Send verification email
  await sendVerificationEmail(email, token, display_name);

  // 6. Return pending info
  return {
    message: "Verification email sent. Please verify your email.",
    pending_id,
  };
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
    { expiresIn: "2h" }
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
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new AppError("Invalid or expired token", 401);
  }

  // find the pending row and ensure token matches and not expired
  const r = await pool.query(
    "SELECT * FROM pending_registrations WHERE email = $1 AND email_token = $2",
    [payload.email, token]
  );
  if (!r.rows.length)
    throw new AppError(
      "Invalid or expired token or no pending registration",
      401
    );

  const pending = r.rows[0];
  if (
    pending.email_token_expires_at &&
    new Date(pending.email_token_expires_at) < new Date()
  ) {
    throw new AppError("Verification token expired", 401);
  }

  // check user already exists
  const existing = await pool.query("SELECT 1 FROM users WHERE email = $1", [
    payload.email,
  ]);
  if (existing.rows.length) throw new AppError("Email already verified", 401);

  // insert into users table (map fields as needed)
  const result = await pool.query(
    `INSERT INTO users (
      first_name, last_name, email, phone_number, country_code, nationality,
      date_of_birth, gender, address, image_url, password, elo_rate, category, display_name, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     RETURNING id, email, display_name`,
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

  const newUser = result.rows[0];

  // remove pending registration (or mark email_verified = true, expires_at = NOW(), etc.)
  await pool.query("DELETE FROM pending_registrations WHERE id = $1", [
    pending.id,
  ]);

  // emit websocket event to room verify_<email>
  if (global.io) {
    global.io.to(`verify_${newUser.email}`).emit("emailVerified", {
      email: newUser.email,
      message: "Email verified successfully",
    });
  }
  await sendWelcomeEmail({
    display_name: newUser.display_name,
    email: newUser.email,
  });

  return newUser;
};

const getUsers = async () => {
  const result =
    await pool.query(`SELECT id, email, first_name, last_name, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, user_status, display_name, category, rank
     FROM users`);
  return result.rows;
};

const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT id, email, first_name, last_name, date_of_birth, gender, image_url, phone_number, nationality, address, created_at, updated_at, elo_rate, user_status, display_name, rank 
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
  const result = await pool.query(
    `
      SELECT id, email, display_name, elo_rate FROM users WHERE email = $1 OR display_name = $1 LIMIT 1
    `,
    [identifier]
  );

  return result.rows[0];
};

const deleteUser = async (userId) => {
  const result = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  return result.rowCount > 0;
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
    await sendPasswordResetSuccessEmail({ name: user.name, email: user.email });
  } catch (err) {
    console.error("Error sending password reset email:", err);
  }

  return { message: "Password reset successful" };
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
  forgotPasswordOtp,
  resetPasswordWithOtp,
  startRegistrationSms,
  verifyRegistrationSms,
  resendEmailVerification,
  resendSmsOtp,
};
