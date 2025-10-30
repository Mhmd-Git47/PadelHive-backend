const paymentService = require("../services/payments.service");

exports.getPaymentsByTournamentId = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const payments = await paymentService.getPaymentsByTournamentId(
      tournamentId
    );
    res.json(payments);
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getPaymentsByCompanyId = async (req, res) => {
  try {
    const { companyId } = req.params;
    console.log("Incoming companyId:", companyId);

    if (!companyId) {
      return res
        .status(400)
        .json({ error: "companyId parameter is required." });
    }

    const payments = await paymentService.getPaymentsByCompanyId(companyId);
    return res.status(200).json({ success: true, payments });
  } catch (err) {
    console.error("Error fetching payments by company:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.updatePayment = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    const updatedParticipant = await paymentService.updatePayment(
      id,
      updateData
    );
    return res.json(updatedParticipant);
  } catch (err) {
    console.error(`Failed updating stage participant: ${err}`);
    return res.status(500).json({
      message: "Failed to update payment. Please try again later.",
      error: "Server error while updating stage participant.",
    });
  }
};

exports.markPaymentAsPaid = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Payment ID is required" });
    }

    const payment = await paymentService.setPaymentPaid(id);

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.status(200).json({
      message: "Payment marked as paid successfully",
      payment,
    });
  } catch (err) {
    console.error("Error in markPaymentAsPaid:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getTournamentPaymentsByUserId = async (req, res) => {
  try {
    const { tournamentId, userId } = req.params;
    const payments = await paymentService.getTournamentPaymentByUserId(
      userId,
      tournamentId
    );
    res.json(payments);
  } catch (err) {
    console.error("Error fetching payments: ", err.message);
    res.status(500).json({ error: "Failed to get payments" });
  }
};

exports.sendReminderPayment = async (req, res, next) => {
  const userId = req.body.userId;
  const tournamentId = req.body.tournamentId;

  try {
    await paymentService.sendReminderPayment(userId, tournamentId);
    res
      .status(200)
      .json({ message: "Payment reminder email sent successfully." });
  } catch (err) {
    next(err);
  }
};
