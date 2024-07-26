const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

let db;

async function initializeDatabase() {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT,
      url TEXT,
      start_time TEXT,
      end_time TEXT,
      days TEXT,
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);
}

module.exports = {
    initializeDatabase,
    getDb: () => db,
    db,
};
