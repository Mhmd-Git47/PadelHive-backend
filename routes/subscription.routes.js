const express = require("express");
const router = express.Router();
const subscriptionController = require("../controllers/subscription.controller");
const authMiddleware = require("../middleware/auth.middleware");
// Public route to subscribe
router.post("/", subscriptionController.addSubscriber);

router.get(
  "/",
  authMiddleware.authorizeSuperAdmin,
  subscriptionController.getSubscribers
);

module.exports = router;
