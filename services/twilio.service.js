require("dotenv").config();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN 
);

async function sendSms(to, message) {
  try {
    const sms = await client.messages.create({
      body: message,
      from: process.env.TWILIO_SMS_FROM,
      to,
    });
    return sms;
  } catch (err) {
    console.error("Twilio SMS error", err);
    throw err;
  }
}

module.exports = { sendSms };
