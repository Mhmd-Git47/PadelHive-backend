const express = require("express");
const router = express.Router();
const { testSms } = require("../controllers/sms.controller");

router.post("/send-test", testSms);

module.exports = router;
