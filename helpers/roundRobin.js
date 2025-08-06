function generateRoundRobin(players) {
  const rounds = [];
  const playerCount = players.length;
  const hasBye = playerCount % 2 !== 0;

  if (hasBye) {
    players.push(null); // add bye
  }

  const n = players.length;
  const totalRounds = n - 1;
  const half = n / 2;

  for (let round = 0; round < totalRounds; round++) {
    const matches = [];

    for (let i = 0; i < half; i++) {
      const p1 = players[i];
      const p2 = players[n - 1 - i];

      if (p1 !== null && p2 !== null && p1 !== p2) {
        matches.push({ player1: p1, player2: p2, round: round + 1 });
      }
    }

    // rotate: keep first player static, rotate rest
    const fixed = players[0];
    const rotated = [
      fixed,
      ...players.slice(1).slice(-1),
      ...players.slice(1, -1),
    ];
    players = rotated;

    rounds.push(matches);
  }

  return rounds.flat();
}

module.exports = {
  generateRoundRobin,
};
