const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const multer = require("multer");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// ------------------ Multer setup ------------------
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};
const upload = multer({ storage, fileFilter });

// ------------------ Admin Routes ------------------
router.post(
  "/register-admin",
  authenticateToken,
  authorizeRoles("superadmin"),
  authController.registerAdm
);
router.post("/login-admin", authController.loginAdm);

// ------------------ User Routes ------------------
// Registration with optional profile image
router.post(
  "/admin/register-user",
  authenticateToken,
  authorizeRoles("superadmin"),
  authController.registerUserFromAdmin
);
router.post("/register", upload.single("image_url"), authController.register);
router.post("/login", authController.login);

// User management
router.get("/users", authController.getUsers);
router.get("/user/:id", authController.getUserById);
router.get("/user/:id/view", authController.getUserViewById);
router.put(
  "/user/:id",
  upload.single("image"),
  authenticateToken,
  authController.updateUser
);
router.delete("/user/:id", authenticateToken, authController.deleteUser);
router.delete(
  "/user/:id/image",
  authenticateToken,
  // authorizeRoles("admin", "superadmin"), // or just allow the user himself
  authController.deleteUserImage
);
// Lookup & Password management
router.get("/lookup", authController.lookupUser);
router.post("/forgot-password-otp", authController.forgotPasswordOtp);
router.post("/reset-password-otp", authController.resetPasswordOtp);

// ------------------ Email Verification ------------------
router.get("/verify-email", authController.verifyEmail);
router.post(
  "/resend-email-verification",
  authController.resendEmailVerification
);

// ------------------ SMS Registration Flow ------------------
// Start SMS verification (optional image upload handled in pending registration)
router.post(
  "/register/sms/start",
  // upload.single("image_url"),
  authController.startRegistrationSms
);

// Verify SMS OTP
router.post("/register/sms/verify", authController.verifyRegistrationSms);

// Resend OTP
router.post("/register/sms/resend", authController.resendSmsOtp);

// confirm password
router.post(
  "/verify-password",
  authenticateToken,
  authController.verifyPassword
);

// change display name after confirming password
router.put(
  "/change-display-name",
  authenticateToken,
  authController.changeDisplayName
);

router.put(
  "/change-phone-number",
  authenticateToken,
  authController.changePhoneNumber
);

router.put(
  "/change-password",
  authenticateToken,
  authController.changePassword
);

module.exports = router;
