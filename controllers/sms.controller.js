const { sendSms, sendWhatsapp } = require("../services/twilio.service");

async function testSms(req, res) {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: "Phone and Message are required" });
  }

  try {
    const result = await sendWhatsapp(phone, message);
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ error: "failed to send sms", details: err.message });
  }
}

module.exports = {
  testSms,
};
