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

  const html = `
                <div style="font-family: Arial, sans-serif; font-size: 16px; color: #333;">
                  <p>Click the button below to verify your email:</p>
                  <a 
                    href="${verificationLink}" 
                    style="
                      display: inline-block;
                      padding: 12px 24px;
                      background-color: #22c55e;
                      color: #ffffff;
                      text-decoration: none;
                      font-weight: bold;
                      border-radius: 6px;
                      margin-top: 12px;
                    "
                  >
                    Verify Email
                  </a>
                  <p style="margin-top: 12px; font-size: 14px; color: #555;">
                    Or click this link if the button doesn’t work: <br/>
                    <a href="${verificationLink}" style="color: #22c55e;">${verificationLink}</a>
                  </p>
                </div>
              `;

  await sendEmail({ to: toEmail, subject: "Please verify your email", html });

  // const mailOptions = {
  //   from: `"PadelHive" <${process.env.ZOHO_EMAIL}>`,
  //   to: toEmail,
  //   subject: "Please verify your email",
  //   html: `<p>Click the link below to verify your email:</p>
  //          <a href="${verificationLink}">${verificationLink}</a>`,
  // };

  // try {
  //   await transporter.sendMail(mailOptions);
  //   console.log("Verification email sent to:", toEmail);
  // } catch (error) {
  //   console.error("Error sending email:", error);
  //   throw new Error("Failed to send verification email");
  // }
}

async function sendEmail({ to, subject, html, text }) {
  const mailOptions = {
    from: `"PadelHive" <${process.env.ZOHO_EMAIL}>`,
    to,
    subject,
    html,
    text,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to: ${to} | Subject: ${subject}`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Failed to send email");
  }
}

module.exports = { sendVerificationEmail, sendEmail };
