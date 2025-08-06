const { syncAllTournaments } = require('../services/tournamentSync.service');

exports.syncTournaments = async (req, res) => {
  try {
    await syncAllTournaments();
    res.status(200).json({ message: 'Tournaments synced successfully' });
  } catch (err) {
    console.error('❌ Sync error:', err); // Log full error
    res.status(500).json({ error: 'Failed to sync tournaments' });
  }
};

