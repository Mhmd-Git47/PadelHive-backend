const paymentService = require("../services/payments.service");

exports.getPaymentsByTournamentId = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const payments = await paymentService.getPaymentsByTournamentId(
      tournamentId
    );
    res.json(payments);
  } catch (err) {
    console.error("Error fetching payments: ", err.message);
    res.status(500).json({ error: "Failed to get payments" });
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
