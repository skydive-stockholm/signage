// Signage Server index.js

const express = require('express');
const moment = require('moment');
const fs = require('node:fs');

const app = express();
const port = 3030;
let currentUrls = {};

async function updateCurrentUrls() {
  console.log('Updating URLs...')
  const now = moment();
  const currentDay = now.day(); // 0 (Sunday) to 6 (Saturday)

  const config = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));

  const players = config.players;

  // Reset current URLs
  currentUrls = {};

  for (const [player, schedules] of Object.entries(players)) {
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

      const isCorrectDay = schedule.days.length === 0 ||
          schedule.days.includes(currentDay) ||
          (end.day() !== start.day() && schedule.days.includes(now.subtract(1, 'day').day()));

      if (isCorrectDay && isCurrentTimeBetween) {
        currentUrls[player] = schedule.url;
        break;
      }
    }

    // If no schedule matches, set a default URL
    // if (!currentUrls[player]) {
    //   currentUrls[player] = defaultURL;
    // }
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

setInterval(updateCurrentUrls, 10000); // Update every 10 seconds
updateCurrentUrls(); // Initial update

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
