const authService = require("../services/auth.service");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { AppError } = require("../utils/errors");

exports.registerAdm = async (req, res, next) => {
  try {
    const user = await authService.registerAdmin(req.body);
    res.status(201).json({ message: "User registered", user: user });
  } catch (err) {
    console.error("Register error:", err);
    next(err);
  }
};

exports.loginAdm = async (req, res, next) => {
  try {
    const token = await authService.loginAdmin(req.body);
    res.json({ token });
  } catch (err) {
    next(err);
  }
};
// ----------------------------

// Delete admin
// ----------------------------
exports.deleteAdminController = async (req, res, next) => {
  const { id } = req.params;

  try {
    const result = await authService.deleteAdmin(id);

    res.status(200).json({
      success: true,
      message: "Admin deleted successfully",
    });
  } catch (err) {
    console.error("❌ Controller error:", err.message);
    next(err);
  }
};

// ----------------------------
// Update admin
// ----------------------------
exports.updateAdminBySuperController = async (req, res, next) => {
  const { id } = req.params;
  const { username, password } = req.body;

  try {
    if (!username && !password) {
      throw new AppError("No fields provided to update", 400);
    }

    const updatedAdmin = await authService.updateAdminBySuper(
      id,
      username,
      password
    );

    res.status(200).json({
      success: true,
      message: "Admin updated successfully",
      data: updatedAdmin,
    });
  } catch (err) {
    console.error("❌ Controller error:", err.message);
    next(err);
  }
};

// ----------------------------
// Register user (initial, pending email verification)
// ----------------------------
exports.registerUserFromSuperAdmin = async (req, res, next) => {
  let {
    first_name,
    last_name,
    email,
    phone_number,
    gender,
    password,
    display_name,
    country_code,
    expected_category,
  } = req.body;

  let userId = req.user?.id;

  // Calculate ELO & category (optional, to prevent frontend tampering)
  let calculatedElo = 900; // default beginner
  let calculatedCategory = "D-";

  switch ((expected_category || "").toLowerCase()) {
    case "beginner":
      calculatedElo = 900;
      calculatedCategory = "D-";
      break;
    case "intermediate":
      calculatedElo = 1050;
      calculatedCategory = "C-";
      break;
    case "advanced":
      calculatedElo = 1200;
      calculatedCategory = "B-";
      break;
    case "professional":
      calculatedElo = 1350;
      calculatedCategory = "A-";
      break;
    case "elite":
      calculatedElo = 1500;
      calculatedCategory = "A+";
      break;
  }

  const category = calculatedCategory;
  const elo_rate = calculatedElo;

  // Call service to create the user
  try {
    const result = await authService.registerUserFromSuperAdm(
      {
        first_name,
        last_name,
        email,
        phone_number,
        gender,
        password,
        category,
        elo_rate,
        display_name,
        country_code,
      },
      userId
    );

    res.status(201).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
};

exports.registerUserFromAdmin = async (req, res, next) => {
  let { gender, display_name, expected_category } = req.body;
  let userId = req.user?.id;
  let userRole = req.user?.role;

  // Calculate ELO & category (optional, to prevent frontend tampering)
  let calculatedElo = 900;
  let calculatedCategory = "D-";

  switch ((expected_category || "").toLowerCase()) {
    case "beginner":
      calculatedElo = 900;
      calculatedCategory = "D-";
      break;
    case "intermediate":
      calculatedElo = 1050;
      calculatedCategory = "C-";
      break;
    case "advanced":
      calculatedElo = 1200;
      calculatedCategory = "B-";
      break;
    case "professional":
      calculatedElo = 1350;
      calculatedCategory = "A-";
      break;
    case "elite":
      calculatedElo = 1500;
      calculatedCategory = "A+";
      break;
  }

  const category = calculatedCategory;
  const elo_rate = calculatedElo;

  // Call service to create the user
  try {
    const result = await authService.registerUserFromAdm(
      {
        gender,
        category,
        elo_rate,
        display_name,
      },
      userId,
      userRole
    );

    res.status(201).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
};

exports.register = async (req, res, next) => {
  try {
    let {
      first_name,
      last_name,
      email,
      phone_number,
      nationality,
      date_of_birth,
      gender,
      address,
      password,
      category,
      elo_rate,
      display_name,
      country_code,
      expected_category,
    } = req.body;

    // Calculate ELO & category
    let calculatedElo = 900; // default beginner
    let calculatedCategory = "D-";

    switch ((expected_category || "").toLowerCase()) {
      case "beginner":
        calculatedElo = 900;
        calculatedCategory = "D-";
        break;
      case "intermediate":
        calculatedElo = 1050;
        calculatedCategory = "C-";
        break;
      case "advanced":
        calculatedElo = 1200;
        calculatedCategory = "B-";
        break;
      case "professional":
        calculatedElo = 1350;
        calculatedCategory = "A-";
        break;
      case "elite":
        calculatedElo = 1500;
        calculatedCategory = "A+";
        break;
    }

    // Ensure frontend did not tamper
    if (!elo_rate || Number(elo_rate) !== calculatedElo) {
      elo_rate = calculatedElo;
      category = calculatedCategory;
    }

    // Handle profile image
    let image_url = null;
    if (req.file) {
      const filename = `user-${Date.now()}.webp`;
      const outputPath = path.join(
        __dirname,
        "..",
        "assets",
        "images",
        "users",
        filename
      );

      await sharp(req.file.buffer)
        .resize({ width: 512, height: 512, fit: "cover" })
        .webp({ quality: 80 })
        .toFile(outputPath);

      image_url = filename;
    }

    // Call service to create pending registration & send verification email
    const pending = await authService.registerUser({
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
    });

    res.status(201).json({
      message: "Registration pending. Please verify your email.",
      pending_id: pending.pending_id,
    });
  } catch (err) {
    next(err);
  }
};

// ----------------------------
// Login
// ----------------------------
exports.login = async (req, res, next) => {
  try {
    const result = await authService.loginUser(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

// ----------------------------
// Email verification
// ----------------------------
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;
    const user = await authService.verifyAndInsertUser(token);
    res.status(201).json({
      message: "Email verified successfully",
      user,
    });
  } catch (err) {
    next(err);
  }
};

// ----------------------------
// Resend email verification
// ----------------------------
exports.resendEmailVerification = async (req, res, next) => {
  try {
    const { pending_id, email } = req.body;
    const result = await authService.resendEmailVerification({
      pending_id,
      email,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error("Resend email verification error:", err);
    next(err);
  }
};

// ----------------------------
// Start registration via SMS (OTP)
// ----------------------------
exports.startRegistrationSms = async (req, res, next) => {
  try {
    const { pending_id } = req.body;
    const result = await authService.startRegistrationSms({ pending_id });
    res.status(201).json(result);
  } catch (err) {
    console.error("Start SMS registration error:", err);
    next(err);
  }
};

// ----------------------------
// Resend SMS OTP
// ----------------------------
exports.resendSmsOtp = async (req, res, next) => {
  try {
    const { pending_id } = req.body;
    const result = await authService.resendSmsOtp({ pending_id });
    res.status(200).json(result);
  } catch (err) {
    console.error("Resend SMS OTP error:", err);
    next(err);
  }
};

// ----------------------------
// Verify registration via SMS (OTP)
// ----------------------------
exports.verifyRegistrationSms = async (req, res, next) => {
  try {
    const { pending_id, otp } = req.body;

    if (!pending_id || !otp) {
      return res.status(400).json({ error: "Missing pending_id or OTP" });
    }

    const user = await authService.verifyRegistrationSms(pending_id, otp);
    res.status(201).json({ message: "Registration verified", user });
  } catch (err) {
    console.error("Verify SMS registration error:", err);
    next(err);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const result = await authService.getUsers();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed fetching users." });
  }
};

exports.getUsersForSuperAdm = async (req, res, next) => {
  try {
    const result = await authService.getUsersForSuperAdm();

    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    const currentUserId = req.user?.id;
    const userId = req.params.id;
    // if (currentUserId !== userId) {
    //   throw new AppError("Invalid request.", 401);
    // }
    const user = await authService.getUserById(userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
};

exports.getUserViewById = async (req, res, next) => {
  try {
    const user = await authService.getUserViewById(req.params.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
};

const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "assets/images/users");
exports.updateUser = async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Ensure the authenticated user matches the user being updated
    if (req.user.role !== "superadmin") {
      if (req.user.id !== userId) {
        return res
          .status(403)
          .json({ message: "Forbidden: cannot update other users" });
      }
    }

    // Fetch existing user from DB
    const existingUser = await authService.getUserById(userId);
    if (!existingUser)
      return res.status(404).json({ message: "User not found" });

    let newImageName = existingUser.imageName; // preserve old image

    // 1️⃣ Process new image if uploaded
    if (req.file) {
      newImageName = `user-${Date.now()}.webp`; // unique filename
      const outputPath = path.join(IMAGE_UPLOAD_PATH, newImageName);

      await sharp(req.file.buffer)
        .resize({ width: 512, height: 512, fit: "cover" })
        .webp({ quality: 80 })
        .toFile(outputPath);

      // Delete old image if exists
      if (existingUser.imageName) {
        const oldPath = path.join(IMAGE_UPLOAD_PATH, existingUser.imageName);
        fs.unlink(oldPath, (err) => {
          if (err) console.warn("Failed to delete old image:", err.message);
        });
      }
    }

    // 2️⃣ Prepare user data for update
    const userData = {
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      // email: req.body.email,
      // phoneNumber: req.body.phone_number,
      nationality: req.body.nationality,
      dateOfBirth: req.body.date_of_birth || existingUser.dateOfBirth,
      gender: req.body.gender,
      address: req.body.address,
      imageName: newImageName,
    };

    // 3️⃣ Update user in DB
    const updatedUser = await authService.updateUser(userId, userData);

    res.json(updatedUser);
  } catch (err) {
    console.error("Update user error:", err);
    next(err);
  }
};

exports.updateUserBySuperAdm = async (req, res, next) => {
  try {
    const userId = req.params.id;

    // 1️⃣ Only superadmin can update users
    if (req.user.role !== "superadmin") {
      return res
        .status(403)
        .json({ message: "Forbidden: Only superadmin can update users" });
    }

    // 2️⃣ Check if user exists
    const existingUser = await authService.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Prepare allowed fields safely (ignore undefined)
    const userData = {};
    const mapKeys = {
      first_name: "firstName",
      last_name: "lastName",
      email: "email",
      display_name: "display_name",
      nationality: "nationality",
      gender: "gender",
      address: "address",
      date_of_birth: "dateOfBirth",
      phone_number: "phone_number",
    };

    for (const [reqKey, modelKey] of Object.entries(mapKeys)) {
      const value = req.body[reqKey];
      if (value !== undefined && value !== null && value !== "") {
        // for date_of_birth, keep existing if invalid or empty
        if (reqKey === "date_of_birth") {
          userData[modelKey] = new Date(value) || existingUser.dateOfBirth;
        } else {
          userData[modelKey] = value;
        }
      }
    }

    // If nothing to update
    if (Object.keys(userData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    // 4️⃣ Update user in DB
    const updatedUser = await authService.updateUserBySuperAdm(
      userId,
      userData
    );

    // 5️⃣ Send result
    return res.status(200).json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("❌ Update user error:", err);
    next(err);
  }
};

exports.lookupUser = async (req, res, next) => {
  const { identifier } = req.query;

  if (!identifier) {
    return res.status(400).json({ error: "Missing identifier" });
  }

  try {
    const result = await authService.lookupUser(identifier);

    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.deleteUser = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const userRole = req.user?.role;
  if (!id) {
    return res.status(400).json({ error: "Missing User Id" });
  }

  try {
    const result = await authService.deleteUser(id, userId, userRole);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.deleteUserImage = async (req, res) => {
  try {
    const userId = req.params.id;

    // find the user
    const user = await authService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.image_url) {
      return res.status(400).json({ message: "User has no image to delete" });
    }

    // delete the image from disk
    const imagePath = path.join(IMAGE_UPLOAD_PATH, user.image_url);
    fs.unlink(imagePath, (err) => {
      if (err) console.warn("Failed to delete image from disk:", err.message);
    });

    // clear the DB field
    user.image_url = null;
    await authService.updateUser(userId, {
      image_url: null,
    });
    res.status(200).json({ message: "User image deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error deleting user image" });
  }
};

exports.forgotPasswordOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPasswordOtp(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.resetPasswordOtp = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await authService.resetPasswordWithOtp({
      email,
      otp,
      newPassword,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// verify if password is correct
exports.verifyPassword = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const userId = req.user?.id;
    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Identifier and password are required." });
    }

    const result = await authService.verifyPassword(
      identifier,
      password,
      userId
    );

    return res.json(result);
  } catch (err) {
    console.error("Error verifying password: ", err);
    next(err);
  }
};

// change display name
exports.changeDisplayName = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { newDisplayName } = req.body;

    if (!newDisplayName) {
      return res.status(400).json({ message: "Display name is required." });
    }

    const result = await authService.changeDisplayName(userId, newDisplayName);

    return res.status(200).json({
      message: "Display name updated successfully.",
      user: result,
    });
  } catch (err) {
    console.error("Error changing display name:", err);
    next(err);
  }
};

exports.changePhoneNumber = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { countryCode, phoneNumber } = req.body;

    const updated = await authService.changePhoneNumber(
      userId,
      countryCode,
      phoneNumber
    );

    res.status(200).json({
      message: "Phone number updated successfully.",
      user: updated,
    });
  } catch (err) {
    console.error("Error updating phone number:", err);
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { oldPassword, newPassword } = req.body;

    if (!userId) {
      throw new AppError("Unauthorized. Please log in again.", 401);
    }

    const result = await authService.changePassword(
      oldPassword,
      newPassword,
      userId
    );

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
};

exports.searchUsers = async (req, res, next) => {
  try {
    const query = req.query.query?.trim();
    const users = await authService.searchUsers(query);

    res.json(users);
  } catch (err) {
    next(err);
  }
};
