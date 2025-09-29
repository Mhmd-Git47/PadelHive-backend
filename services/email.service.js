const nodemailer = require("nodemailer");

if (!process.env.ZOHO_EMAIL) {
  require("dotenv").config();
}

function createTransporter(email, appPassword) {
  return nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: true,
    debug: true,
  });
}

async function sendVerificationEmail(toEmail, token, userName) {
  const brandName = "PadelHive";
  const brandDomain = "padelhivelb.com";
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const currentYear = new Date().getFullYear();

  const html = `
  <!doctype html>
  <html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
  <head>
    <meta charset="utf-8">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Verify your email</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        background: #f5f7f9;
        border-radius: 12px;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
      }
      .container {
        width: 600px;
        max-width: 600px;
        border-radius: 12px;
        overflow: hidden;
        background: #ffffff;
        border: 1px solid #e6e8eb;
        margin: 20px auto;
      }
      .header {
        padding: 30px 24px;
        background: #1e293b;
        text-align: center;
      }
      .header img {
        max-width: 180px;
        height: auto;
        background: transparent;
      }
      .content {
        padding: 36px 30px;
        color: #334155;
      }
      .content h1 {
        margin: 0 0 10px 0;
        color: #0f172a;
        font-size: 28px;
        line-height: 36px;
        font-weight: 700;
      }
      .content p {
        margin: 0 0 16px 0;
        font-size: 16px;
        line-height: 24px;
      }
      .btn {
        background: #0f172a;
        border-radius: 8px;
        color: #ffffff !important;
        display: inline-block;
        font-size: 16px;
        font-weight: bold;
        line-height: 52px;
        text-align: center;
        text-decoration: none;
        width: 280px;
        max-width: 100%;
        margin: 16px 0;
        transition: background 0.3s ease;
      }
      .btn:hover {
        background: #334155;
      }
      .note {
        margin-top: 24px;
        color: #6b7280;
        font-size: 13px;
        line-height: 20px;
      }
      .footer {
        text-align: center;
        padding: 24px 30px;
        font-size: 12px;
        color: #94a3b8;
        border-top: 1px solid #e2e8f0;
      }
      .footer a {
        color: #94a3b8;
        text-decoration: none;
        margin: 0 5px;
      }
      @media only screen and (max-width:620px) {
        .container {
          width: 100% !important;
          border-radius: 0;
          box-shadow: none;
        }
        .content {
          padding: 24px 20px !important;
        }
        .header {
          padding: 20px 20px;
        }
        .footer {
          padding: 20px;
        }
      }
    </style>
  </head>

  <body>
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Confirm your email address to get started with ${brandName}.
    </div>

    <center style="width:100%;">
      <div style="height:30px;line-height:30px;font-size:30px;">&nbsp;</div>
      <table role="presentation" class="container" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td class="header">
            <img src="https://${brandDomain}/assets/images/home/logonew.png" alt="${brandName} Logo">
          </td>
        </tr>

        <tr>
          <td class="content">
            <h1>Verify your email</h1>
            <p>Hi ${userName},</p>
            <p>Thanks for signing up for ${brandName}! To activate your account, please click the button below to verify your email address.</p>
            <div style="text-align:center;">
              <a href="${verificationLink}" class="btn">Confirm Email Address</a>
            </div>
            <p class="note">This link will expire in <strong>10 minutes</strong>. If you did not sign up for ${brandName}, you can safely ignore this email.</p>
          </td>
        </tr>

        <tr>
          <td class="footer">
            © ${currentYear} ${brandName} · 
            <a href="https://${brandDomain}">${brandDomain}</a>
          </td>
        </tr>
      </table>
      <div style="height:30px;line-height:30px;font-size:30px;">&nbsp;</div>
    </center>
  </body>
  </html>
  `;

  await sendNoReplyEmail({
    to: toEmail,
    subject: "Please verify your email",
    html,
  });
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = createTransporter(
    process.env.ZOHO_EMAIL,
    process.env.ZOHO_APP_PASSWORD
  );
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

async function sendNoReplyEmail({ to, subject, html, text }) {
  const transporter = createTransporter(
    process.env.ZOHO_EMAIL_NOREPLY,
    process.env.ZOHO_NOREPLY_APP_PASSWORD
  );

  const mailOptions = {
    from: `"PadelHive" <${process.env.ZOHO_EMAIL_NOREPLY}>`,
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

async function sendRegistrationEmail({ to, subject, html, text }) {
  const transporter = createTransporter(
    process.env.ZOHO_EMAIL_REGISTRATION,
    process.env.ZOHO_REGISTRATION_APP_PASSWORD
  );

  const mailOptions = {
    from: `"PadelHive" <${process.env.ZOHO_EMAIL_REGISTRATION}>`,
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

async function sendContactEmail({ to, name, email, phone, message }) {
  const toEmail = to;
  const subject = `New Contact Form Submission from ${name}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2 style="color: #333;">New Contact Message</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-wrap; background-color: #f4f4f4; padding: 15px; border-radius: 8px;">${message}</p>
    </div>
  `;

  const text = `
    New Contact Form Submission:
    Name: ${name}
    Email: ${email}
    Phone: ${phone}
    Message:
    ${message}
  `;

  await sendEmail({ to: toEmail, subject, html, text });
}

module.exports = {
  sendVerificationEmail,
  sendEmail,
  sendContactEmail,
  sendRegistrationEmail,
  sendNoReplyEmail
};
