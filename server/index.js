// Signage Server index.js

const express = require('express');
const moment = require('moment');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
const port = 3030;
app.use(express.json());
app.use(express.static('public'));

let currentUrls = {};
let db;

// Initialize database
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

async function updateCurrentUrls() {
  console.log('Updating URLs...')
  const now = moment();
  const currentDay = now.day(); // 0 (Sunday) to 6 (Saturday)

  const players = await db.all('SELECT id FROM players');

  // Reset current URLs
  currentUrls = {};

  for (const player of players) {
    const schedules = await db.all('SELECT * FROM schedules WHERE player_id = ?', player.id);

    for (const schedule of schedules) {
      let start = moment(schedule.start_time, "HH:mm");
      let end = moment(schedule.end_time, "HH:mm");

      // If end time is before start time, it means it's on the next day
      if (end.isBefore(start)) {
        end.add(1, 'day');
      }

      // Check if current time is between start and end
      let isCurrentTimeBetween = now.isBetween(start, end);

      // If not, check if it's after start time of previous day
      if (!isCurrentTimeBetween) {
        let yesterdayStart = moment(start).subtract(1, 'day');
        isCurrentTimeBetween = now.isBetween(yesterdayStart, end);
      }

      const days = JSON.parse(schedule.days);

      if (!days) {
        continue;
      }

      const isCorrectDay = days.length === 0 ||
          days.includes(currentDay) ||
          (end.day() !== start.day() && days.includes(now.subtract(1, 'day').day()));

      if (isCorrectDay && isCurrentTimeBetween) {
        currentUrls[player.id] = schedule.url;
        break;
      }
    }
  }
}

app.get('/player/:player_id', (req, res) => {
  const playerId = req.params.player_id;
  let url = currentUrls[playerId];

  if (!url) {
    res.status(404).json({ error: 'Player not found' });
  } else {
    res.json({ url: url || null });
  }
});

/**
 * Public UI
 */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/players', async (req, res) => {
  const players = await db.all('SELECT * FROM players');

  for (const player of players) {
    const schedules = await db.all('SELECT * FROM schedules WHERE player_id = ?', player.id);
    player['schedules'] = schedules.map(s => ({
      ...s,
      days: JSON.parse(s.days)
    }));
  }

  res.json(players);
});

app.post('/player', async (req, res) => {
  const { name } = req.body;
  try {
    // Insert the new player
    const result = await db.run('INSERT INTO players (name) VALUES (?)', name);

    // Get the ID of the newly inserted row
    const id = result.lastID;

    // Fetch the entire row
    const row = await db.get('SELECT * FROM players WHERE id = ?', id);

    // Send the entire row as the response
    res.json(row);
  } catch (error) {
    console.error('Error creating player:', error);
    res.status(500).json({ error: 'An error occurred while creating the player' });
  }
});

app.delete('/player/:playerId', async (req, res) => {
  const { playerId } = req.params;
  await db.run('DELETE FROM schedules WHERE player_id = ?', playerId);
  await db.run('DELETE FROM players WHERE id = ?', playerId);
  res.json({ message: 'Player deleted successfully' });
  await updateCurrentUrls();
});

app.post('/player/:playerId/schedule', async (req, res) => {
  const { playerId } = req.params;
  const { url, start_time, end_time, days } = req.body;

  try {
    await db.run(
        'INSERT INTO schedules (player_id, url, start_time, end_time, days) VALUES (?, ?, ?, ?, ?)',
        playerId, url, start_time, end_time, JSON.stringify(days)
    );
    res.json({ message: 'Schedule added successfully' });
    await updateCurrentUrls();
  } catch (error) {
    res.status(400).json({ error: 'Invalid data or player not found' });
  }
});

app.delete('/schedule/:scheduleId', async (req, res) => {
  const { playerId, scheduleId } = req.params;
  await db.run('DELETE FROM schedules WHERE id = ?', scheduleId);
  res.json({ message: 'Schedule deleted successfully' });
  await updateCurrentUrls();
});

async function startServer() {
  await initializeDatabase();
  await updateCurrentUrls(); // Initial update

  setInterval(updateCurrentUrls, 10000); // Update every 10 seconds

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer().catch(console.error);
