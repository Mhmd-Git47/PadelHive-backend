// controllers/contact.controller.js
const { sendContactEmail } = require("../services/email.service");

const submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
      return res
        .status(400)
        .json({ error: "Name, email, and message are required." });
    }

    // you can configure this in env variables
    const to = process.env.CONTACT_RECEIVER_EMAIL || "support@padelhivelb.com";

    await sendContactEmail({ to, name, email, phone, message });

    res
      .status(200)
      .json({ success: true, message: "Contact form submitted successfully." });
  } catch (err) {
    console.error("Error in submitContactForm:", err);
    res.status(500).json({ error: "Failed to send contact form." });
  }
};

module.exports = { submitContactForm };
