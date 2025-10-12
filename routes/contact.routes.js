// routes/contact.routes.js
const express = require("express");
const {
  submitContactForm,
  sendTestingEmails,
} = require("../controllers/contact.controller");

const router = express.Router();

// POST /api/contact
router.post("/", submitContactForm);

router.post("/test", sendTestingEmails);
module.exports = router;
