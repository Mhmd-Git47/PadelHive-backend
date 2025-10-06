const authService = require("../services/auth.service");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

exports.registerAdm = async (req, res, next) => {
  try {
    const user = await authService.registerAdmin(req.body);
    res.status(201).json({ message: "User registered", user });
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
// Register user (initial, pending email verification)
// ----------------------------
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

exports.getUserById = async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.params.id);
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
    if (req.user.id !== userId) {
      return res
        .status(403)
        .json({ message: "Forbidden: cannot update other users" });
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
  if (!id) {
    return res.status(400).json({ error: "Missing User Id" });
  }

  try {
    const result = await authService.deleteUser(id);
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
