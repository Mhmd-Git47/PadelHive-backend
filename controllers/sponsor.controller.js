const sponsorService = require("../services/sponsor.service");

exports.createSponsor = async (req, res) => {
  try {
    const logoUrl = req.file
      ? `${req.protocol}://${req.get("host")}/images/sponsors/${
          req.file.filename
        }`
      : null;

    const sponsorData = {
      ...req.body,
      logo_url: logoUrl,
    };

    const sponsor = await sponsorService.createSponsor(sponsorData);
    res.status(201).json(sponsor);
  } catch (err) {
    console.error("Error creating sponsor:", err.message);
    res.status(500).json({ error: "Failed to create sponsor" });
  }
};

exports.updateSponsor = async (req, res) => {
  try {
    const { id } = req.params;

    let updateData = { ...req.body };

    if (req.file) {
      updateData.logo_url = `${req.protocol}://${req.get(
        "host"
      )}/images/sponsors/${req.file.filename}`;
    }

    const updatedSponsor = await sponsorService.updateSponsor(id, updateData);

    if (!updatedSponsor) {
      return res.status(404).json({ error: "Sponsor not found" });
    }

    res.json(updatedSponsor);
  } catch (err) {
    console.error("Error updating sponsor:", err.message);
    res.status(500).json({ error: "Failed to update sponsor" });
  }
};

exports.deleteSponsor = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await sponsorService.deleteSponsor(id);

    if (!success) {
      return res.status(404).json({ error: "Sponsor not found" });
    }

    res.json({ message: "Sponsor deleted successfully" });
  } catch (err) {
    console.error("Error deleting sponsor:", err.message);
    res.status(500).json({ error: "Failed to delete sponsor" });
  }
};

exports.getSponsorsByTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sponsors = await sponsorService.getSponsorsByTournament(tournamentId);
    res.json(sponsors);
  } catch (err) {
    console.error("Error fetching sponsors by tournament:", err.message);
    res.status(500).json({ error: "Failed to load sponsors" });
  }
};

exports.getSponsorsByCompanyId = async (req, res) => {
  try {
    const { companyId } = req.params;
    const sponsors = await sponsorService.getSponsorsByCompanyId(companyId);
    res.json(sponsors);
  } catch (err) {
    console.error("Error fetching sponsors by company:", err.message);
    res.status(500).json({ error: "Failed to load sponsors" });
  }
};

exports.getSponsorById = async (req, res) => {
  try {
    const { id } = req.params;
    const sponsor = await sponsorService.getSponsorById(id);
    if (!sponsor) {
      return res.status(404).json({ error: "Sponsor not found" });
    }
    res.json(sponsor);
  } catch (err) {
    console.error("Error fetching sponsor:", err.message);
    res.status(500).json({ error: "Failed to load sponsor" });
  }
};

exports.getSponsorsWithVisibilityByCompany = async (req, res) => {
  const { tournamentId, companyId } = req.params;
  try {
    const sponsors = await sponsorService.getSponsorsWithVisibilityByCompany(
      tournamentId,
      companyId
    );
    res.json(sponsors);
  } catch (err) {
    console.error("Error getting sponsors with visibility:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Add sponsor to tournament (set visible = true)
exports.addSponsorToTournament = async (req, res) => {
  const { tournamentId } = req.params;
  const { sponsorId } = req.body;

  try {
    const result = await sponsorService.addSponsorToTournament(
      tournamentId,
      sponsorId
    );
    res.json({ message: "Sponsor added to tournament", data: result });
  } catch (err) {
    console.error("Error adding sponsor to tournament:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Remove sponsor from tournament
exports.removeSponsorFromTournament = async (req, res) => {
  const { tournamentId, sponsorId } = req.params;

  try {
    await sponsorService.removeSponsorFromTournament(tournamentId, sponsorId);
    res.json({ message: "Sponsor removed from tournament" });
  } catch (err) {
    console.error("Error removing sponsor from tournament:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
