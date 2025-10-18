const sponsorService = require("../services/sponsor.service");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGE_UPLOAD_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "images",
  "sponsors"
);

if (!fs.existsSync(IMAGE_UPLOAD_PATH)) {
  fs.mkdirSync(IMAGE_UPLOAD_PATH, { recursive: true });
}

async function processLogo(file) {
  const filename = `sponsor-${Date.now()}.webp`;
  const outputPath = path.join(IMAGE_UPLOAD_PATH, filename);

  await sharp(file.buffer)
    .resize({ width: 512, height: 512, fit: "inside" })
    .webp({ quality: 80 }) // compress
    .toFile(outputPath);

  return filename;
}

exports.createSponsor = async (req, res) => {
  try {
    let logoFileName = null;

    if (req.file) {
      logoFileName = await processLogo(req.file);
    }

    const sponsorData = {
      ...req.body,
      logo_url: logoFileName,
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

    // Get current sponsor from DB
    const sponsor = await sponsorService.getSponsorById(id);
    if (!sponsor) {
      return res.status(404).json({ error: "Sponsor not found" });
    }

    let logoFileName = sponsor.logo_url; // current filename in DB

    if (req.file) {
      // Process new logo
      logoFileName = await processLogo(req.file);

      // Delete old logo if exists
      if (sponsor.logo_url) {
        const oldPath = path.join(IMAGE_UPLOAD_PATH, sponsor.logo_url);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    }

    const updateData = {
      ...req.body,
      logo_url: logoFileName, // still just a filename
    };

    const updatedSponsor = await sponsorService.updateSponsor(id, updateData);
    res.json(updatedSponsor);
  } catch (err) {
    console.error("Error updating sponsor:", err.message);
    res.status(500).json({ error: "Failed to update sponsor" });
  }
};

exports.deleteSponsor = async (req, res) => {
  try {
    const { id } = req.params;
    const sponsor = await sponsorService.getSponsorById(id);
    if (!sponsor) {
      return res.status(404).json({ error: "Sponsor not found" });
    }

    if (sponsor.logo_url) {
      const filePath = path.join(IMAGE_UPLOAD_PATH, sponsor.logo_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    const success = await sponsorService.deleteSponsor(id);

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
