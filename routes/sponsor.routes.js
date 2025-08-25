const express = require("express");
const router = express.Router();
const sponsorController = require("../controllers/sponsor.controller");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "images/sponsors/");
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

router.post("/", upload.single("logo"), sponsorController.createSponsor);
router.put("/:id", upload.single("logo"), sponsorController.updateSponsor);
router.delete("/:id", sponsorController.deleteSponsor);
router.get(
  "/tournament/:tournamentId",
  sponsorController.getSponsorsByTournament
);
router.get("/company/:companyId", sponsorController.getSponsorsByCompanyId);
router.get("/:id", sponsorController.getSponsorById);

router.get(
  "/tournament/:tournamentId/company/:companyId",
  sponsorController.getSponsorsWithVisibilityByCompany
);

router.post(
  "/tournament/:tournamentId/add",
  sponsorController.addSponsorToTournament
);

router.delete(
  "/tournament/:tournamentId/remove/:sponsorId",
  sponsorController.removeSponsorFromTournament
);

module.exports = router;
