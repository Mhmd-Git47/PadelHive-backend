// controllers/contact.controller.js
const { sendWelcomeEmail } = require("../helpers/email.helper");
const { sendContactEmail, sendEmail } = require("../services/email.service");

const submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
      return res
        .status(400)
        .json({ error: "Name, email, and message are required." });
    }

    // you can configure this in env variables
    const to = process.env.ZOHO_EMAIL;

    await sendContactEmail(to, name, email, phone, message);

    res
      .status(200)
      .json({ success: true, message: "Contact form submitted successfully." });
  } catch (err) {
    console.error("Error in submitContactForm:", err);
    res.status(500).json({ error: "Failed to send contact form." });
  }
};

const sendTestingEmails = async (req, res) => {
  try {
    const emails = [
      "solarsunpower123@gmail.com",
      "rawass_adel@hotmail.com",
      "solarsun819@gmail.com",
      "heal.his.off1@premiere-urgence-lib.org",
    ];

    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    for (let i = 0; i < 5; i++) {
      await Promise.all(
        emails.map(async (email) => {
          try {
            await sendWelcomeEmail({
              email: email,
              display_name: email,
            });
            // await sendEmail({
            //   to: email,
            //   subject: "test email",
            //   text: "test emailss",
            //   html: "test email",
            // });
            console.log(`Sent to ${email}`);
          } catch (err) {
            console.error(`Failed to send to ${email}:`, err.message);
          }
        })
      );
      await delay(2000);
    }

    res.json({ success: true, message: "Test emails sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error sending emails" });
  }
};

module.exports = { submitContactForm, sendTestingEmails };
