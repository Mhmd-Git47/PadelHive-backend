const authService = require("../services/auth.service");

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

exports.register = async (req, res) => {
  try {
    const {
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

    const image_url = req.file ? req.file.filename : null;

    const user = await authService.registerUser({
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

    res.status(201).json({ message: "User registered", user });
  } catch (err) {
    console.error("User register error:", err);
    res.status(400).json({ error: err.message });
  }
};

// users
exports.login = async (req, res) => {
  try {
    const result = await authService.loginUser(req.body);
    res.status(200).json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    const result = await authService.verifyAndInsertUser(token);
    res
      .status(201)
      .json({ message: "Email verified and user registered", user: result });
  } catch (err) {
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

exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const userData = {
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      email: req.body.email,
      phoneNumber: req.body.phone_number,
      nationality: req.body.nationality,
      dateOfBirth: req.body.date_of_birth,
      gender: req.body.gender,
      address: req.body.address,
      imageName: req.file
        ? req.file.filename
        : req.body.existingImageName || null,
    };

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
