const { AppError } = require("../utils/errors");

function errorHandler(err, req, res, next) {
  // Log full error on server for debugging
  console.error("Error:", err);

  // Controlled errors - safe to send to client
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Any other error - do NOT expose details
  return res.status(500).json({
    error: "Something went wrong. Please try again later.",
  });
}

module.exports = errorHandler;
