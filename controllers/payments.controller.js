const paymentService = require("../services/payments.service");
const { validate: isUuid } = require("uuid");

exports.getPaymentsByTournamentId = async (req, res) => {
  console.log("API hit with params:", req.params);
  try {
    const { tournamentId } = req.params;
    console.log("tournamentId:", tournamentId);

    const payments = await paymentService.getPaymentsByTournamentId(
      tournamentId
    );
    res.json(payments);
  } catch (err) {
    console.error("Error fetching payments:", err); // log full error
    res.status(500).json({ error: err.message }); // send actual DB error
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
