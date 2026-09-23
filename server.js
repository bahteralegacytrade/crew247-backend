const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json()); // supaya server bisa baca data JSON yang dikirim dari aplikasi

const authRoutes = require('./routes/auth');
app.use(authRoutes);

const crewRoutes = require('./routes/crew');
app.use(crewRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Crew247.id backend jalan di http://localhost:${PORT}`);
});

const scheduleRoutes = require('./routes/schedule');
app.use(scheduleRoutes);

const directoryRoutes = require('./routes/directory');
app.use(directoryRoutes);

const eventsRoutes = require('./routes/events');
app.use(eventsRoutes);

const applicationsRoutes = require('./routes/applications');
app.use(applicationsRoutes);

const ratingsRoutes = require('./routes/ratings');
app.use(ratingsRoutes);