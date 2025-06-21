const express = require("express");
const cors = require("cors");
const participantsRouter = require("./routes/participants");

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');

const tournamentRoutes = require("./routes/tournamentRoutes");

require("dotenv").config();


const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json());

// api integration
app.use("/api", tournamentRoutes);

// backend integration
app.use("/api/participants", participantsRouter);

// admin
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on localhost: ${PORT}`);
});
