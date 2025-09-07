// routes/contact.routes.js
const express = require("express");
const { submitContactForm } = require("../controllers/contact.controller");

const router = express.Router();

// POST /api/contact
router.post("/", submitContactForm);

module.exports = router;
