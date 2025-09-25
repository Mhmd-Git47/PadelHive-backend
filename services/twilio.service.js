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

async function sendWhatsapp(to, message) {
  try {
    const whatsapp = await client.messages.create({
      to: `whatsapp:${to}`,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      contentSid: process.env.TWILIO_WA_AUTH_TEMPLATE_SID,
      contentVariables: JSON.stringify({ 1: message }),
    });
    return whatsapp;
  } catch (err) {
    console.error("Twilio WhatsApp error", err);
    throw err;
  }
}

module.exports = { sendSms, sendWhatsapp };
