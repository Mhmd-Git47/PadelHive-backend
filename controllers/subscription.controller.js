const subscriptionService = require("../services/subscription.sevice");

// Add a new subscriber
exports.addSubscriber = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Optionally, simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const subscription = await subscriptionService.createSubscription(email);
    res
      .status(201)
      .json({ message: "Subscribed successfully", data: subscription });
  } catch (err) {
    console.error("Error creating subscription:", err.message);
    // Handle duplicate emails
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already subscribed" });
    }
    res.status(500).json({ error: "Failed to subscribe" });
  }
};

// Optional: Get all subscribers (admin-only)
exports.getSubscribers = async (req, res) => {
  try {
    const subscribers = await subscriptionService.getAllSubscriptions();
    res.json(subscribers);
  } catch (err) {
    console.error("Error fetching subscriptions:", err.message);
    res.status(500).json({ error: "Failed to fetch subscribers" });
  }
};
