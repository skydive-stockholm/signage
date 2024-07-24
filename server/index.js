// Signage Server index.js

const express = require('express');
const moment = require('moment');
const config = require("./config");

const app = express();
const port = 3030;
const defaultURL = config.defaultUrl;

// Sample configuration with days parameter
const players = config.players;

let currentUrls = {};

function updateCurrentUrls() {
  const now = moment();
  const currentDay = now.day(); // 0 (Sunday) to 6 (Saturday)

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
  res.json({ url: currentUrls[playerId] || null });
});

setInterval(updateCurrentUrls, 60000); // Update every minute
updateCurrentUrls(); // Initial update

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
