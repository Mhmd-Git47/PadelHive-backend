const authService = require("../services/auth.service");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

exports.registerAdm = async (req, res) => {
  try {
    console.log("Register request body:", req.body);
    const user = await authService.registerAdmin(req.body);
    console.log("User inserted:", user);
    res.status(201).json({ message: "User registered", user });
  } catch (err) {
    console.error("Register error:", err);
    res.status(400).json({ error: err.message });
  }
};

exports.loginAdm = async (req, res) => {
  try {
    const token = await authService.loginAdmin(req.body);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

// ----------------------------
// Register user (initial, pending email verification)
// ----------------------------
exports.register = async (req, res) => {
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
    } = req.body;

    // Calculate ELO & category
    let calculatedElo = 900; // default beginner
    let calculatedCategory = "D-";

    switch ((category || "").toLowerCase()) {
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
    if (err.isOperational) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    return res.status(500).json({
      error: "Something went wrong. Please try again later.",
    });
  }
};

// ----------------------------
// Login
// ----------------------------
exports.login = async (req, res) => {
  try {
    const result = await authService.loginUser(req.body);
    res.status(200).json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

// ----------------------------
// Email verification
// ----------------------------
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    const user = await authService.verifyAndInsertUser(token);
    res.status(201).json({
      message: "Email verified successfully",
      user,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------
// Resend email verification
// ----------------------------
exports.resendEmailVerification = async (req, res) => {
  try {
    const { pending_id, email } = req.body;
    const result = await authService.resendEmailVerification({
      pending_id,
      email,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error("Resend email verification error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------
// Start registration via SMS (OTP)
// ----------------------------
exports.startRegistrationSms = async (req, res) => {
  try {
    const { pending_id } = req.body;
    const result = await authService.startRegistrationSms({ pending_id });
    res.status(201).json(result);
  } catch (err) {
    console.error("Start SMS registration error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------
// Resend SMS OTP
// ----------------------------
exports.resendSmsOtp = async (req, res) => {
  try {
    const { pending_id } = req.body;
    const result = await authService.resendSmsOtp({ pending_id });
    res.status(200).json(result);
  } catch (err) {
    console.error("Resend SMS OTP error:", err);
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------
// Verify registration via SMS (OTP)
// ----------------------------
exports.verifyRegistrationSms = async (req, res) => {
  try {
    const { pending_id, otp } = req.body;

    if (!pending_id || !otp) {
      return res.status(400).json({ error: "Missing pending_id or OTP" });
    }

    const user = await authService.verifyRegistrationSms(pending_id, otp);
    res.status(201).json({ message: "Registration verified", user });
  } catch (err) {
    console.error("Verify SMS registration error:", err);
    res.status(400).json({ error: err.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const result = await authService.getUsers();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed fetching users." });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await authService.getUserById(req.params.id);
    res.json(user);
  } catch (err) {
    if (err.message === "User not found") {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};

const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "images/users");
exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    let newImageName = req.body.existingImageName || null;

    // 1️⃣ Process new image if uploaded
    if (req.file) {
      newImageName = `user-${Date.now()}.webp`; // unique filename
      const outputPath = path.join(IMAGE_UPLOAD_PATH, newImageName);

      // Resize, compress, convert to WebP
      await sharp(req.file.buffer)
        .resize({ width: 512, height: 512, fit: "cover" })
        .webp({ quality: 80 })
        .toFile(outputPath);

      // Delete old image if exists
      if (req.body.existingImageName) {
        const oldPath = path.join(
          IMAGE_UPLOAD_PATH,
          req.body.existingImageName
        );
        fs.unlink(oldPath, (err) => {
          if (err) console.warn("Failed to delete old image:", err.message);
        });
      }
    }

    // 2️⃣ Prepare user data for update
    const userData = {
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      email: req.body.email,
      phoneNumber: req.body.phone_number,
      nationality: req.body.nationality,
      dateOfBirth: req.body.date_of_birth,
      gender: req.body.gender,
      address: req.body.address,
      imageName: newImageName,
    };

    // 3️⃣ Update user in DB
    const updatedUser = await authService.updateUser(userId, userData);

    res.json(updatedUser);
  } catch (err) {
    console.error("Update user error:", err);
    res.status(400).json({ error: err.message });
  }
};
exports.lookupUser = async (req, res) => {
  const { identifier } = req.query;

  if (!identifier) {
    return res.status(400).json({ error: "Missing identifier" });
  }

  try {
    const result = await authService.lookupUser(identifier);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Missing User Id" });
  }

  try {
    const result = await authService.deleteUser(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Error deleting user" });
  }
};

exports.forgotPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPasswordOtp(email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.resetPasswordOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await authService.resetPasswordWithOtp({
      email,
      otp,
      newPassword,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
