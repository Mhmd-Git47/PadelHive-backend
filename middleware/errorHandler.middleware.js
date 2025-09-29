const { AppError } = require("../utils/errors");

function errorHandler(err, req, res, next) {
  console.error("Error:", err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  return res.status(500).json({
    error: "Something went wrong. Please try again later.",
  });
}

module.exports = errorHandler;
