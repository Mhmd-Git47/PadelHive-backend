const crypto = require("crypto");
const bcrypt = require("bcrypt");

function generateOtp(length = 4) {
  return Math.floor(
    10 ** (length - 1) + Math.random() * 9 * 10 ** (length - 1)
  ).toString();
}

async function hashOtp(otp) {
  return await bcrypt.hash(otp, 10);
}

async function verifyOtp(otp, hash) {
  return await bcrypt.compare(otp, hash);
}

module.exports = { generateOtp, hashOtp, verifyOtp };
