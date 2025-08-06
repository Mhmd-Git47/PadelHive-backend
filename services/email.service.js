const nodemailer = require("nodemailer");

if (!process.env.ZOHO_EMAIL) {
  require("dotenv").config();
}

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_APP_PASSWORD,
  },
  logger: true, 
  debug: true,
});

async function sendVerificationEmail(toEmail, token) {
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

  const mailOptions = {
    from: `"PadelHive" <${process.env.ZOHO_EMAIL}>`,
    to: toEmail,
    subject: "Please verify your email",
    html: `<p>Click the link below to verify your email:</p>
           <a href="${verificationLink}">${verificationLink}</a>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Verification email sent to:", toEmail);
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Failed to send verification email");
  }
}

module.exports = { sendVerificationEmail };
