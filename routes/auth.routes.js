const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "images/users/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// admin routes
router.post("/register-admin", authController.registerAdm);
router.post("/login-admin", authController.loginAdm);

// user routes
router.post("/register", upload.single("image_url"), authController.register);
router.post("/login", authController.login);
router.get("/users", authController.getUsers);
router.get("/user/:id", authController.getUserById);
router.put("/user/:id", upload.single("image"), authController.updateUser);
router.delete("/user/:id", authController.deleteUser);
// GET /users/lookup?identifier=some@email.com
router.get("/lookup", authController.lookupUser);

// verification email
router.get("/verify-email", authController.verifyEmail);

module.exports = router;
