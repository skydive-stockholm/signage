const moment = require("moment");

class PlayerScheduleResolver {
    static get(schedules) {
        const now = moment();
        const currentDay = now.day();
        const currentTime = now.format('HH:mm');

        for (const schedule of schedules) {
            const { start_time, end_time, days, url } = schedule;
            const scheduleDays = JSON.parse(days);

            if (scheduleDays.includes(currentDay)) {
                if (this.isWithinTimeRange(currentTime, start_time, end_time)) {
                    return url;
                }
            }
        }

        return '';
    }

    static isWithinTimeRange(currentTime, start, end) {
        const current = moment(currentTime, 'HH:mm');
        const startTime = moment(start, 'HH:mm');
        const endTime = moment(end, 'HH:mm');

        if (endTime.isSameOrBefore(startTime)) {
            // Handle overnight schedule
            return current.isSameOrAfter(startTime) || current.isBefore(endTime);
        } else {
            return current.isBetween(startTime, endTime, null, '[]');
        }
    }
}

module.exports = { PlayerScheduleResolver };
