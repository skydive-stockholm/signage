const { getDb} = require('./database');

const schedulesForPlayer = (playerId) => {
    const db = getDb()
    return db.all('SELECT * FROM schedules WHERE player_id = ?', playerId);
}

const getPlayerByName = (playerName) => {
    const db = getDb()
    return db.get('SELECT * FROM players WHERE name = ?', playerName);
}

module.exports = {
    schedulesForPlayer,
    getPlayerByName,
}
