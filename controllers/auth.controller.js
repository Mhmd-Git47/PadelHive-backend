const authService = require("../services/auth.service");

exports.register = async (req, res) => {
  try {
    console.log("Register request body:", req.body); // DEBUG LOG
    const user = await authService.registerUser(req.body);
    console.log("User inserted:", user); // DEBUG LOG
    res.status(201).json({ message: "User registered", user });
  } catch (err) {
    console.error("Register error:", err); // DEBUG LOG
    res.status(400).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const token = await authService.loginUser(req.body);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};
