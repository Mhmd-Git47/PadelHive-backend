// utils/errors.js
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // marks safe errors
  }
}

module.exports = { AppError };
