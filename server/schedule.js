const moment = require("moment");

const PlayerScheduleResolver = {
    get: (schedules) => {
        const now = moment();
        const currentDay = now.day(); // 0 (Sunday) to 6 (Saturday)
        let url = '';

        for (const schedule of schedules) {
            let start = moment(schedule.start_time, "HH:mm");
            let end = moment(schedule.end_time, "HH:mm");
            const futureEnd = end.clone();

            // If end time is before start time, it means it's on the next day
            if (end.isBefore(start) && now.isBefore(end)) {
                futureEnd.add(1, 'day');
            }

            // Check if current time is between start and end
            let isCurrentTimeBetween = now.isBetween(start, futureEnd);

            // If not, check if it's after start time of previous day
            if (!isCurrentTimeBetween && end.isBefore(start)) {
                let yesterdayStart = moment(start).subtract(1, 'day');
                isCurrentTimeBetween = now.isBetween(yesterdayStart, futureEnd);
            }

            const days = JSON.parse(schedule.days);

            if (!days || days.length === 0) {
                continue;
            }

            const isCorrectDay = days.length === 0 ||
                days.includes(currentDay) ||
                (end.day() !== start.day() && days.includes(now.subtract(1, 'day').day()));

            if (isCorrectDay && isCurrentTimeBetween) {
                url = schedule.url;
                break;
            }
        }

        return url;
    }
}

module.exports = {
    PlayerScheduleResolver
};
