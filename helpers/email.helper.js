const emailService = require("../services/email.service");

// Welcome email
async function sendWelcomeEmail(user) {
  const subject = "🎉 Welcome to PadelHive!";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <p>Hi <b>${user.display_name}</b>,</p>

      <p>Welcome to <b>PadelHiveLB</b> — you’re now officially a registered player! 🎾</p>

      <p>From today, you can join tournaments, compete with other players, and track your stats right from your profile. We built PadelHiveLB to make your padel journey smoother, fairer, and more exciting.</p>

      <p>Here’s what you’ll love about playing with us:</p>
      <ul>
        <li><b>Smart category matching</b> – always find the right level for your games.</li>
        <li><b>Quick sign-up & easy team registration</b> – less hassle, more playing.</li>
        <li><b>Real-time ELO rankings</b> after every match – instant feedback on your progress.</li>
        <li><b>Live scoring</b> from group stage to finals – stay in the moment.</li>
        <li><b>Track your stats & chase the leaderboard</b> – see your growth match by match.</li>
      </ul>

      <p>…and this is just the start. We’re rolling out many new features soon — stay tuned!</p>

      <p>Thanks for joining our growing community of padel enthusiasts. If you have any questions, just reply to this email — our team’s always here to help.</p>

      <p>See you on the court,<br>
      <b>The PadelHiveLB Team</b></p>
      <img 
        src="https://padelhivelb.com/assets/images/icons/FULL-LOGO-1200X630-16.jpg" 
        alt="PadelHive Logo" 
        draggable="false"
        style="
          display: block;
          max-width: 300px;
          width: 100%;     
          height: auto;
          margin: 20px 0 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          user-select: none;
        "
      ></img>
    </div>`;

  const text = `
Hi ${user.display_name},

Welcome to PadelHiveLB — you’re now officially a registered player! 🎾

From today, you can join tournaments, compete with other players, and track your stats right from your profile.

Here’s what you’ll love about playing with us:
- Smart category matching – always find the right level for your games.
- Quick sign-up & easy team registration – less hassle, more playing.
- Real-time ELO rankings after every match – instant feedback on your progress.
- Live scoring from group stage to finals – stay in the moment.
- Track your stats & chase the leaderboard – see your growth match by match.

…and this is just the start. We’re rolling out many new features soon — stay tuned!

Thanks for joining our growing community of padel enthusiasts. If you have any questions, just reply to this email — our team’s always here to help.

See you on the court,
The PadelHiveLB Team
  `;

  return emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });
}

// Tournament join email
async function sendTournamentJoinEmail(user, tournament, locationName) {
  const subject = `✅ You joined ${tournament.name}!`;
  const startDateFormatted = formatDate(tournament.start_at);

  const html = `
    <h2>Hi ${user.display_name},</h2>

    <p>Great news — you’ve successfully joined the <b>${tournament.name}</b> tournament! 🎉</p>

    <p><b>Start Date:</b> ${startDateFormatted}</p>
    <p><b>Location:</b> ${locationName}</p>

    <p>As a participant, you’ll be able to:</p>
    <ul>
      <li>View your match schedule and opponents as soon as they’re published</li>
      <li>Get live scoring updates during the tournament</li>
      <li>Earn ELO points and climb the leaderboard</li>
      <li>Track your match stats directly from your profile</li>
    </ul>

    <p>We’re excited to see you on the court. Play hard and good luck! 💪</p>

    <p>— The PadelHiveLB Team</p>
  `;

  const text = `
Hi ${user.display_name},

Great news — you’ve successfully joined the ${tournament.name} tournament!

Start Date: ${startDateFormatted}
Location: ${tournament.location}

As a participant, you’ll be able to:
- View your match schedule and opponents as soon as they’re published
- Get live scoring updates during the tournament
- Earn ELO points and climb the leaderboard
- Track your match stats directly from your profile

We’re excited to see you on the court. Play hard and good luck!

— The PadelHiveLB Team
  `;

  return emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });
}

// payment confirmation
async function sendTournamentPaymentConfirmationEmail(
  user,
  tournament,
  payment
) {
  const subject = `💳 Payment Confirmed for ${tournament.name}!`;
  const startDateFormatted = formatDate(tournament.start_at);

  const html = `
    <h2>Hi ${user.display_name},</h2>

    <p>✅ Your payment for the <b>${
      tournament.name
    }</b> tournament has been successfully received!</p>

    <p><b>Payment Details:</b></p>
    <ul>
      <li><b>Amount:</b> $${payment.amount}</li>
      <li><b>Date:</b> ${formatDate(payment.date)}</li>
    </ul>

    <p><b>Tournament Details:</b></p>
    <ul>
      <li><b>Start Date:</b> ${startDateFormatted}</li>
    </ul>

    <p>Your spot is now officially secured. 🎾</p>

    <p>You’ll receive updates about your schedule, opponents, and match results through PadelHiveLB.</p>

    <p>Thanks for being part of our community — we can’t wait to see you compete!</p>

    <p>— The PadelHiveLB Team</p>
  `;

  const text = `
Hi ${user.display_name},

Your payment for the ${
    tournament.name
  } tournament has been successfully received!

Payment Details:
- Amount: $${payment.amount}
- Method: ${payment.method}
- Date: ${formatDate(payment.date)}
- Transaction ID: ${payment.transactionId}

Tournament Details:
- Start Date: ${startDateFormatted}
- Location: ${tournament.location}

Your spot is now officially secured. 🎾

You’ll receive updates about your schedule, opponents, and match results through PadelHiveLB.

Thanks for being part of our community — we can’t wait to see you compete!

— The PadelHiveLB Team
  `;

  return emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });
}

async function sendDisqualificationEmail(user, tournament, reason) {
  const subject = `⚠️ Disqualification from ${tournament.name}`;

  const html = `
    <h2>Hello ${user.display_name},</h2>

    <p>We regret to inform you that you have been <b>disqualified</b> from the <b>${tournament.name}</b> tournament.</p>

    <p><b>Reason:</b> ${reason}</p>

    <p>If you believe this was a mistake or have any questions, please <a href="mailto:support@padelhivelb.com">contact our support team</a> immediately so we can review your case.</p>

    <br>
    <p>— The PadelHiveLB Team</p>
  `;

  const text = `Hello ${user.display_name},

We regret to inform you that you have been disqualified from the ${tournament.name} tournament.

Reason: ${reason}

If you believe this was a mistake or have any questions, please contact our support team immediately at support@padelhivelb.com.

— The PadelHiveLB Team`;

  return emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });
}

async function sendPasswordResetSuccessEmail(user) {
  const subject = "🔑 Your PadelHive password was reset successfully";

  const html = `
    <h2>Hello ${user.name},</h2>

    <p>This is a confirmation that your <b>PadelHive</b> account password was just changed successfully.</p>

    <p>If you made this change, no further action is needed. 👍</p>

    <p>If you did <b>not</b> make this change, please contact our support team immediately at <a href="mailto:support@padelhivelb.com">support@padelhivelb.com</a></p>

    <br>
    <p>Stay safe,<br>The PadelHive Team</p>
  `;

  const text = `
Hello ${user.name},

This is a confirmation that your PadelHive account password was just changed successfully.

If you made this change, no further action is needed.

If you did NOT make this change, please contact our support team immediately at support@padelhivelb.com

Stay safe,
The PadelHive Team
  `;

  return emailService.sendEmail({ to: user.email, subject, html, text });
}

async function sendTournamentLeftEmail(user, tournament) {
  const startDateFormatted = formatDate(tournament.start_at);

  const subject = `⚠️ You’ve left the ${tournament.name} Tournament`;

  const html = `
    <h2>Hello ${user.display_name},</h2>

    <p>This is to confirm that you have <b>left/forfeited</b> the <b>${tournament.name}</b> tournament.</p>

    <p><b>Start Date:</b> ${startDateFormatted}</p>

    <p>If you left by mistake or would like to rejoin (if spots are still available), please <a href="mailto:support@padelhivelb.com">contact our support team</a> as soon as possible.</p>

    <p>We hope to see you back in future tournaments and on the leaderboard soon!</p>

    <br>
    <p>— The PadelHiveLB Team</p>
  `;

  const text = `Hello ${user.display_name},

This is to confirm that you have left/forfeited the ${tournament.name} tournament.
Start Date: ${startDateFormatted}

If you left by mistake or would like to rejoin (if spots are still available), please contact our support team at support@padelhivelb.com as soon as possible.

We hope to see you back in future tournaments and on the leaderboard soon!

— The PadelHiveLB Team`;

  return emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const sendPasswordResetOtpEmail = async (email, otp) => {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color:#f4f6f8; padding:30px 0; display:flex; justify-content:center;">
      <div style="background-color:#fff; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); width:100%; max-width:400px; padding:30px; text-align:center;">
        <div style="margin-bottom:20px;">
          <img src='https://padelhivelb.com/assets/images/home/logonew.png' alt='Logo' width='80'/>
        </div>
        <h2 style="font-size:22px; margin-bottom:10px; color:#333;">Password Reset OTP</h2>
        <p style="font-size:16px; color:#555; margin-bottom:30px;">
          Use the following OTP to reset your password. It is valid for 10 minutes.
        </p>
        <div style="font-size:28px; font-weight:bold; letter-spacing:6px; background-color:#f1f5f9; padding:15px 0; border-radius:8px; margin-bottom:30px; color:#C5FF3E;">
          ${otp}
        </div>
        <p style="font-size:14px; color:#777;">If you didn't request a password reset, please ignore this email.</p>
      </div>
    </div>
  `;

  return emailService.sendEmail({
    to: email,
    subject: "Your Password Reset OTP",
    html,
    text: `Your OTP is ${otp}`,
  });
};

module.exports = {
  sendWelcomeEmail,
  sendTournamentJoinEmail,
  sendDisqualificationEmail,
  sendTournamentLeftEmail,
  sendPasswordResetSuccessEmail,
  sendPasswordResetOtpEmail,
  sendTournamentPaymentConfirmationEmail,
};
